from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from ..store import encoded, fail, now_iso
from .capabilities import ModelCapability
from .contracts import EvidenceBook, RunResponse, ToolEvent


class AgentStore:
    def __init__(self, journal):
        self.journal = journal

    def confirm_disabled(self, request, snapshot, fingerprint, session_id):
        return self.create(request, snapshot, fingerprint, session_id, disabled=True)

    def create(self, request, snapshot, fingerprint, session_id, *, disabled=False):
        """One immutable confirmation creates one turn/run, including terminal failures."""
        stamp = now_iso()
        with self.journal.connect() as db:
            db.execute('begin immediate')
            old = db.execute('select * from ai_journal_turns where snapshot_id=? or idempotency_key=?', (request.snapshot_id, request.idempotency_key)).fetchone()
            if old:
                if old['snapshot_id'] != request.snapshot_id or old['idempotency_key'] != request.idempotency_key or (session_id and old['session_id'] != session_id):
                    fail('idempotency_conflict')
                run = db.execute('select id from ai_journal_agent_runs where turn_id=?', (old['id'],)).fetchone()
                if not run:
                    fail('agent_run_missing')
                return {'session_id': old['session_id'], 'run_id': run['id']}
            if session_id:
                if not db.execute('select id from ai_journal_sessions where id=?', (session_id,)).fetchone():
                    fail('session_not_found', 404)
            else:
                session_id = uuid4().hex
                scope = snapshot['request']
                db.execute('insert into ai_journal_sessions values (?,?,?,?,?)', (session_id, scope['question'][:120], scope['task_type'], scope['instrument_key'], stamp))
            turn_id, run_id = uuid4().hex, uuid4().hex
            error = 'agent_execution_not_ready' if disabled else ''
            db.execute('insert into ai_journal_turns (id,session_id,snapshot_id,idempotency_key,status,error_code,created_at,updated_at) values (?,?,?,?,?,?,?,?)',
                       (turn_id, session_id, request.snapshot_id, request.idempotency_key, 'failed' if disabled else 'pending', error, stamp, stamp))
            db.execute('insert into ai_journal_agent_runs (id,turn_id,snapshot_id,engine_version,model_fingerprint,status,error_code,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)',
                       (run_id, turn_id, request.snapshot_id, '2', fingerprint, 'failed' if disabled else 'queued', error, stamp, stamp))
        return {'session_id': session_id, 'run_id': run_id}

    def get(self, run_id):
        with self.journal.connect() as db:
            row = db.execute('select * from ai_journal_agent_runs where id=?', (run_id,)).fetchone()
            if not row:
                fail('agent_run_not_found', 404)
            value = dict(row)
            value.pop('lease_token')
            value.pop('lease_expires_at')
            result_json, usage_json = value.pop('result_json'), value.pop('usage_json')
            value['result'] = json.loads(result_json) if result_json else None
            value['usage'] = json.loads(usage_json) if usage_json else None
            value['events'] = [json.loads(event[0]) for event in db.execute('select event_json from ai_journal_agent_events where run_id=? order by seq', (run_id,))]
            value['source_count'] = db.execute('select count(*) from ai_journal_agent_sources where run_id=?', (run_id,)).fetchone()[0]
        return RunResponse.model_validate(value).model_dump(mode='json')

    def claim_queued(self, run_id, *, lease_seconds=120):
        token = uuid4().hex
        expiry = (datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)).isoformat()
        with self.journal.connect() as db:
            db.execute('begin immediate')
            changed = db.execute("""update ai_journal_agent_runs set status='running',lease_token=?,lease_expires_at=?,updated_at=?
                where id=? and status='queued' and cancel_requested=0
                and (select count(*) from ai_journal_agent_runs where status in ('running','cancel_requested')) < 2
                and not exists (
                    select 1 from ai_journal_agent_runs active join ai_journal_turns at on at.id=active.turn_id
                    join ai_journal_turns candidate on candidate.id=ai_journal_agent_runs.turn_id
                    where at.session_id=candidate.session_id and active.status in ('running','cancel_requested'))""", (token, expiry, now_iso(), run_id)).rowcount
        return token if changed == 1 else None

    def sources(self, run_id):
        self.get(run_id)
        with self.journal.connect() as db:
            items = [json.loads(row[0]) for row in db.execute('select payload_json from ai_journal_agent_sources where run_id=? order by source_id', (run_id,))]
            for item in items:
                if item['kind'] == 'note':
                    current = db.execute('select body,updated_at,deleted_at from ai_journal_notes where id=?', (item['payload'].get('id'),)).fetchone()
                    item['original_deleted'] = not current or bool(current['deleted_at'])
                    item['original_changed'] = bool(current and (current['body'] != item['payload'].get('body') or current['updated_at'] != item['payload'].get('updated_at')))
            return items

    def cancel(self, run_id):
        stamp = now_iso()
        with self.journal.connect() as db:
            db.execute('begin immediate')
            row = db.execute('select * from ai_journal_agent_runs where id=?', (run_id,)).fetchone()
            if not row:
                fail('agent_run_not_found', 404)
            if row['status'] in {'queued', 'running', 'cancel_requested'}:
                db.execute("update ai_journal_agent_runs set status='cancelled',cancel_requested=1,lease_token=null,updated_at=? where id=?", (stamp, run_id))
                db.execute("update ai_journal_turns set status='failed',error_code='agent_cancelled',updated_at=? where id=?", (stamp, row['turn_id']))
        return self.get(run_id)

    def finish(self, run_id, token, report, answer, sources, events, usage):
        """All result writes share the ownership check and transaction."""
        book = EvidenceBook()
        book.add_batch(sources, datetime.now(timezone.utc))
        checked = book.validate_report(report.model_dump_json())
        events = [ToolEvent.model_validate(event) for event in events]
        stamp = now_iso()
        with self.journal.connect() as db:
            db.execute('begin immediate')
            changed = db.execute("update ai_journal_agent_runs set status='succeeded',result_json=?,usage_json=?,updated_at=? where id=? and lease_token=? and status='running' and cancel_requested=0 and lease_expires_at>?",
                                 (checked.model_dump_json(), encoded(usage), stamp, run_id, token, stamp)).rowcount
            if changed != 1:
                fail('stale_or_cancelled_worker')
            turn = db.execute('select turn_id from ai_journal_agent_runs where id=?', (run_id,)).fetchone()[0]
            db.execute("update ai_journal_turns set status='completed',answer=?,error_code='',updated_at=? where id=?", (answer, stamp, turn))
            db.execute('delete from ai_journal_agent_sources where run_id=?', (run_id,))
            db.execute('delete from ai_journal_agent_events where run_id=?', (run_id,))
            for source in book.rows.values():
                db.execute('insert into ai_journal_agent_sources values (?,?,?)', (run_id, source.id, source.model_dump_json()))
            for seq, event in enumerate(events):
                db.execute('insert into ai_journal_agent_events values (?,?,?,?)', (run_id, seq, event.model_dump_json(), stamp))

    def queued(self):
        with self.journal.connect() as db:
            return [row[0] for row in db.execute("select id from ai_journal_agent_runs where status='queued' order by created_at,id limit 20")]

    def assert_owned(self, run_id, token):
        from .runtime import AccessRevoked
        with self.journal.connect() as db:
            row = db.execute('select * from ai_journal_agent_runs where id=?', (run_id,)).fetchone()
        if not row or row['status'] != 'running' or row['cancel_requested'] or row['lease_token'] != token or not row['lease_expires_at'] or row['lease_expires_at'] <= now_iso():
            raise AccessRevoked('stale_or_cancelled_worker')

    def progress(self, run_id, token, usage, events, sources):
        stamp = now_iso()
        with self.journal.connect() as db:
            db.execute('begin immediate')
            changed = db.execute("update ai_journal_agent_runs set usage_json=?,updated_at=? where id=? and lease_token=? and status='running' and cancel_requested=0 and lease_expires_at>?", (encoded(usage), stamp, run_id, token, stamp)).rowcount
            if changed != 1:
                from .runtime import AccessRevoked
                raise AccessRevoked('stale_or_cancelled_worker')
            for seq, event in enumerate(events):
                value = ToolEvent.model_validate(event)
                db.execute('insert or ignore into ai_journal_agent_events values (?,?,?,?)', (run_id,seq,value.model_dump_json(),stamp))
            for source in sources:
                db.execute('insert or ignore into ai_journal_agent_sources values (?,?,?)', (run_id,source.id,source.model_dump_json()))

    def terminate(self, run_id, token, status, error_code, usage=None):
        if status not in {'failed','outcome_unknown','cancelled'}:
            raise ValueError('invalid_terminal_status')
        stamp = now_iso()
        with self.journal.connect() as db:
            db.execute('begin immediate')
            changed = db.execute("update ai_journal_agent_runs set status=?,error_code=?,usage_json=coalesce(?,usage_json),lease_token=null,updated_at=? where id=? and lease_token=? and status='running'", (status,error_code,encoded(usage) if usage is not None else None,stamp,run_id,token)).rowcount
            if changed:
                turn_id = db.execute('select turn_id from ai_journal_agent_runs where id=?',(run_id,)).fetchone()[0]
                db.execute("update ai_journal_turns set status='failed',error_code=?,updated_at=? where id=?",(error_code,stamp,turn_id))
        return bool(changed)

    def recover_expired(self):
        stamp = now_iso()
        with self.journal.connect() as db:
            db.execute('begin immediate')
            expired = db.execute("select id,turn_id from ai_journal_agent_runs where status in ('running','cancel_requested') and lease_expires_at is not null and lease_expires_at<=?", (stamp,)).fetchall()
            for row in expired:
                db.execute("update ai_journal_agent_runs set status='outcome_unknown',error_code='interrupted_outcome_unknown',lease_token=null,updated_at=? where id=?", (stamp,row['id']))
                db.execute("update ai_journal_turns set status='failed',error_code='interrupted_outcome_unknown',updated_at=? where id=?", (stamp,row['turn_id']))
        return len(expired)

    def save_capability(self, capability):
        checked = ModelCapability.model_validate(capability)
        with self.journal.connect() as db:
            db.execute('insert into ai_journal_agent_capabilities values (?,?,?) on conflict(model_fingerprint) do update set payload_json=excluded.payload_json,updated_at=excluded.updated_at',
                       (checked.model_fingerprint, checked.model_dump_json(), now_iso()))

    def capability(self, fingerprint, endpoint='auto'):
        with self.journal.connect() as db:
            row = db.execute('select payload_json from ai_journal_agent_capabilities where model_fingerprint=?', (fingerprint,)).fetchone()
        return ModelCapability.model_validate_json(row[0]) if row else ModelCapability(model_fingerprint=fingerprint, endpoint=endpoint)
