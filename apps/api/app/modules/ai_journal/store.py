from __future__ import annotations

import json
import hashlib
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from app.core import database


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def fail(code, status=409):
    raise HTTPException(status_code=status, detail={'code': code})


class JournalStore:
    def connect(self):
        return database.connect()

    def save_snapshot(self, payload, fingerprint):
        snapshot_id = uuid4().hex
        value = {**payload, 'id': snapshot_id}
        checksum = digest(value)
        with self.connect() as db:
            db.execute('insert into ai_journal_snapshots values (?,?,?,?,?)', (snapshot_id, encoded(value), checksum, fingerprint, value['created_at']))
        return {**value, 'digest': checksum}

    def snapshot(self, snapshot_id):
        with self.connect() as db:
            row = db.execute('select * from ai_journal_snapshots where id=?', (snapshot_id,)).fetchone()
        if not row:
            fail('snapshot_not_found', 404)
        return json.loads(row['payload']), row['digest'], row['model_fingerprint']

    def session(self, session_id):
        with self.connect() as db:
            session = db.execute('select * from ai_journal_sessions where id=?', (session_id,)).fetchone()
            turns = db.execute('select * from ai_journal_turns where session_id=? order by created_at,id', (session_id,)).fetchall()
        if not session:
            fail('session_not_found', 404)
        result = dict(session)
        result['turns'] = []
        for row in turns:
            turn = dict(row)
            payload, checksum, _ = self.snapshot(turn['snapshot_id'])
            turn['snapshot'] = {**payload, 'digest': checksum}
            if payload['request'].get('engine') == 'agent':
                from .agent.store import AgentStore
                with self.connect() as db:
                    run = db.execute('select id from ai_journal_agent_runs where turn_id=?', (turn['id'],)).fetchone()
                turn['engine'] = 'agent'
                turn['run_id'] = run['id'] if run else None
                turn['run'] = AgentStore(self).get(run['id']) if run else None
            # Deletion status is separate metadata; never modify stored evidence.
            with self.connect() as db:
                note_states = {note['id']: db.execute('select deleted_at from ai_journal_notes where id=?', (note['id'],)).fetchone() for note in payload['private_context'].get('notes', [])}
                turn['deleted_note_ids'] = [key for key, state in note_states.items() if not state or state[0]]
            if payload['request'].get('engine', 'llm') == 'llm' and turn['status'] == 'pending' and (datetime.now(timezone.utc) - datetime.fromisoformat(turn['updated_at'])).total_seconds() > 600:
                turn['status'], turn['error_code'] = 'failed', 'interrupted_repreview'
            result['turns'].append(turn)
        return result

    def session_for_snapshot(self, snapshot_id):
        with self.connect() as db:
            row = db.execute('select session_id from ai_journal_turns where snapshot_id=?', (snapshot_id,)).fetchone()
        if not row:
            fail('confirmation_not_found', 404)
        return self.session(row['session_id'])

    def claim(self, request, payload, session_id):
        stamp = now_iso()
        with self.connect() as db:
            db.execute('begin immediate')
            existing = db.execute('select * from ai_journal_turns where idempotency_key=? or snapshot_id=?', (request.idempotency_key, request.snapshot_id)).fetchone()
            if existing:
                if existing['snapshot_id'] != request.snapshot_id or existing['idempotency_key'] != request.idempotency_key or (session_id and existing['session_id'] != session_id):
                    fail('idempotency_conflict')
                return existing['session_id'], existing['id'], False
            if session_id:
                if not db.execute('select id from ai_journal_sessions where id=?', (session_id,)).fetchone():
                    fail('session_not_found', 404)
            else:
                session_id = uuid4().hex
                scope = payload['request']
                db.execute('insert into ai_journal_sessions values (?,?,?,?,?)', (session_id, scope['question'][:120], scope['task_type'], scope['instrument_key'], stamp))
            turn_id = uuid4().hex
            db.execute("insert into ai_journal_turns (id,session_id,snapshot_id,idempotency_key,status,created_at,updated_at) values (?,?,?,?,'pending',?,?)", (turn_id, session_id, request.snapshot_id, request.idempotency_key, stamp, stamp))
        return session_id, turn_id, True

    def finish(self, turn_id, answer='', error=''):
        with self.connect() as db:
            db.execute('update ai_journal_turns set status=?,answer=?,error_code=?,updated_at=? where id=?', ('failed' if error else 'completed', answer, error, now_iso(), turn_id))

    def save_note(self, body, note_id=None, journal_date=None):
        stamp = now_iso()
        with self.connect() as db:
            db.execute('begin immediate')
            if note_id:
                if db.execute('update ai_journal_notes set body=?,updated_at=? where id=? and deleted_at is null', (body, stamp, note_id)).rowcount != 1:
                    fail('note_not_found', 404)
            else:
                note_id = uuid4().hex
                db.execute('insert into ai_journal_notes values (?,?,?,?,null)', (note_id, body, stamp, stamp))
            if journal_date:
                db.execute('insert into ai_journal_note_dates(note_id,journal_date) values (?,?) on conflict(note_id) do update set journal_date=excluded.journal_date', (note_id, journal_date))
            else:
                db.execute('delete from ai_journal_note_dates where note_id=?', (note_id,))
            version = db.execute('select coalesce(max(version),0)+1 from ai_journal_note_versions where note_id=?', (note_id,)).fetchone()[0]
            db.execute('insert into ai_journal_note_versions values (?,?,?,?,?)', (note_id, version, body, stamp, journal_date))
        return {'id': note_id}

    def note_versions(self, note_id):
        with self.connect() as db:
            if not db.execute('select id from ai_journal_notes where id=? and deleted_at is null', (note_id,)).fetchone():
                fail('note_not_found', 404)
            return {'versions': [dict(row) for row in db.execute('select * from ai_journal_note_versions where note_id=? order by version desc', (note_id,))]}

    def delete_note(self, note_id):
        with self.connect() as db:
            if db.execute('update ai_journal_notes set deleted_at=? where id=? and deleted_at is null', (now_iso(), note_id)).rowcount != 1:
                fail('note_not_found', 404)
            # Same U04 policy: frozen evidence is retained, live original revisions are inaccessible.
            db.execute('delete from ai_journal_note_versions where note_id=?', (note_id,))
        return {'id': note_id, 'deleted': True}
