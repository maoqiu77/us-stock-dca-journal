"""User-confirmed, append-only decisions and voluntary local policies. No trading or AI calls."""
from __future__ import annotations

from datetime import date
import json
from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .store import JournalStore, digest, encoded, fail, now_iso


class RecordRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    operation_id: str = Field(min_length=8, max_length=100)
    expected_version: int = Field(ge=0)
    confirmed: Literal[True]
    kind: Literal['user_decision', 'investment_policy']
    scope: str = Field(min_length=1, max_length=200)
    stance: Literal['observe', 'no_action', 'disagree', 'maintain'] = 'observe'
    reason: str = Field(min_length=1, max_length=6000)
    review_date: Optional[date] = None
    status: Literal['active', 'completed', 'cancelled'] = 'active'
    action: Literal['create', 'revise', 'maintain', 'defer', 'complete', 'cancel'] = 'create'
    new_facts: str = Field(default='', max_length=6000)
    source_turn_id: Optional[str] = Field(default=None, max_length=100)
    horizon: str = Field(default='', max_length=1000)
    cash_needs: str = Field(default='', max_length=1000)
    restrictions: str = Field(default='', max_length=1000)
    goals: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def validate_action(self):
        if (self.expected_version == 0) != (self.action == 'create'):
            raise ValueError('新记录使用 create，已有记录必须显式修订或复盘')
        expected_status = {'complete': 'completed', 'cancel': 'cancelled'}.get(self.action, 'active')
        if self.status != expected_status:
            raise ValueError('状态与复盘动作不一致')
        if self.action == 'defer' and not self.review_date:
            raise ValueError('延后需要复盘日期')
        if self.kind == 'investment_policy' and self.source_turn_id:
            raise ValueError('政策必须由用户自愿填写，不能从回答自动生成')
        return self


def migrate_records(db):
    db.execute('savepoint user_records_upgrade')
    try:
        db.execute('''create table if not exists ai_journal_user_records (
            id text not null, version integer not null, kind text not null,
            operation_id text not null unique, request_digest text not null,
            payload text not null, primary key(id,version))''')
        db.execute('''create table if not exists ai_journal_note_versions (
            note_id text not null, version integer not null, body text not null,
            recorded_at text not null, journal_date text, primary key(note_id,version))''')
        db.execute('''insert or ignore into ai_journal_note_versions
            select n.id,1,n.body,n.updated_at,d.journal_date from ai_journal_notes n
            left join ai_journal_note_dates d on d.note_id=n.id where n.deleted_at is null''')
        for table in ('ai_journal_user_records', 'ai_journal_note_versions'):
            db.execute(f"create trigger if not exists {table}_immutable before update on {table} begin select raise(abort, 'immutable user revision'); end")
        db.execute("create trigger if not exists user_records_no_delete before delete on ai_journal_user_records begin select raise(abort, 'retain user revisions'); end")
        db.execute('release user_records_upgrade')
    except Exception:
        db.execute('rollback to user_records_upgrade')
        db.execute('release user_records_upgrade')
        raise


class UserRecords:
    def __init__(self, store=None):
        self.store = store or JournalStore()

    def history(self, record_id):
        with self.store.connect() as db:
            rows = db.execute('select payload from ai_journal_user_records where id=? order by version desc', (record_id,)).fetchall()
            if not rows:
                fail('user_record_not_found', 404)
            return [self.decorate(db, json.loads(row[0])) for row in rows]

    def list(self):
        with self.store.connect() as db:
            rows = db.execute('''select r.payload from ai_journal_user_records r join
                (select id,max(version) version from ai_journal_user_records group by id) latest
                on latest.id=r.id and latest.version=r.version order by r.rowid desc''').fetchall()
            return [self.decorate(db, json.loads(row[0])) for row in rows]

    @staticmethod
    def decorate(db, value):
        source = value.get('source')
        if source:
            row = db.execute('''select t.snapshot_id from ai_journal_turns t
                join ai_journal_sessions s on s.id=t.session_id
                join ai_journal_snapshots p on p.id=t.snapshot_id
                where t.id=? and t.session_id=?''', (source['turn_id'], source['session_id'])).fetchone()
            value['source_available'] = bool(row and row[0] == source['snapshot_id'])
        else:
            value['source_available'] = False
        return value

    def save(self, record_id, request):
        data = request.model_dump(mode='json')
        checksum = digest({'id': record_id, **data})
        with self.store.connect() as db:
            db.execute('begin immediate')
            receipt = db.execute('select request_digest,payload from ai_journal_user_records where operation_id=?', (request.operation_id,)).fetchone()
            if receipt:
                if receipt[0] != checksum:
                    fail('user_record_operation_conflict')
                return self.decorate(db, json.loads(receipt[1]))
            row = db.execute('select payload from ai_journal_user_records where id=? order by version desc limit 1', (record_id,)).fetchone()
            previous = json.loads(row[0]) if row else None
            if request.expected_version != (previous['version'] if previous else 0):
                fail('user_record_conflict')
            source = previous['source'] if previous else None
            if previous:
                if request.kind != previous['kind'] or request.source_turn_id != (source['turn_id'] if source else None):
                    fail('user_record_source_immutable', 422)
                if request.action in ('maintain', 'defer', 'complete', 'cancel') and any(data[key] != previous[key] for key in ('scope', 'stance', 'reason', 'horizon', 'cash_needs', 'restrictions', 'goals')):
                    fail('user_record_use_revise', 422)
                if request.action == 'defer' and previous['review_date'] and data['review_date'] <= previous['review_date']:
                    fail('user_record_defer_date', 422)
            elif request.source_turn_id:
                turn = db.execute("select * from ai_journal_turns where id=? and status='completed'", (request.source_turn_id,)).fetchone()
                if not turn:
                    fail('user_record_source_unavailable', 422)
                snapshot = db.execute('select payload from ai_journal_snapshots where id=?', (turn['snapshot_id'],)).fetchone()
                if not snapshot:
                    fail('user_record_source_unavailable', 422)
                origin = json.loads(snapshot[0])
                source = {'turn_id': turn['id'], 'session_id': turn['session_id'], 'snapshot_id': turn['snapshot_id'],
                          'instrument_key': origin['request'].get('instrument_key'), 'observed_at': origin['created_at']}
            stamp = now_iso()
            value = {**data, 'id': record_id, 'version': request.expected_version + 1, 'source': source,
                     'confirmed_at': stamp, 'effective_at': stamp,
                     'created_at': previous['created_at'] if previous else stamp}
            db.execute('insert into ai_journal_user_records values (?,?,?,?,?,?)',
                       (record_id, value['version'], request.kind, request.operation_id, checksum, encoded(value)))
            return self.decorate(db, value)


router = APIRouter(prefix='/api/ai-journal/user-records', tags=['ai-journal'])
records = UserRecords()


@router.get('')
def list_records():
    return {'items': records.list()}


@router.get('/{record_id}')
def record_history(record_id: str):
    return {'versions': records.history(record_id)}


@router.put('/{record_id}')
def save_record(record_id: str, payload: RecordRequest):
    if not 8 <= len(record_id) <= 100:
        fail('user_record_id_invalid', 422)
    return records.save(record_id, payload)
