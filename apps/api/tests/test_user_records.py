from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core import database
from app.modules.ai_journal.decisions import RecordRequest, UserRecords
from app.modules.ai_journal.store import JournalStore
from app.modules.ledger_store import read_ledger
from app.modules.local_backup import create_backup, prepare_restore, validate_database


class UserRecordTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / 'local'
        self.db = self.home / 'app.db'
        mock = patch.object(database, 'DB_PATH', self.db)
        mock.start(); self.addCleanup(mock.stop)
        self.ledger = read_ledger()
        self.store = JournalStore()
        self.records = UserRecords(self.store)
        self.snapshot = self.store.save_snapshot({'request': {'question': 'Synthetic question', 'task_type': 'conversation', 'instrument_key': None}, 'private_context': {'notes': []}, 'facts': [], 'missing': [], 'created_at': '2026-10-03T00:00:00+00:00'}, 'synthetic')
        self.session, self.turn, _ = self.store.claim(type('R', (), {'idempotency_key': 'synthetic-turn', 'snapshot_id': self.snapshot['id']})(), self.snapshot, None)
        self.store.finish(self.turn, 'Synthetic answer')

    def request(self, **changes):
        return RecordRequest(**{'operation_id': 'operation-create', 'expected_version': 0, 'confirmed': True,
                                'kind': 'user_decision', 'scope': 'SYNTH', 'reason': 'Continue observing',
                                'source_turn_id': self.turn, 'review_date': '2026-10-03', **changes})

    def test_create_revise_review_replay_keeps_original_and_ledger(self):
        original = self.records.save('decision-one', self.request())
        self.assertEqual(original, self.records.save('decision-one', self.request()))
        second = self.records.save('decision-one', self.request(expected_version=1, operation_id='operation-revise', action='revise', stance='disagree', reason='Different evidence'))
        self.records.save('decision-one', self.request(expected_version=2, operation_id='operation-review', action='maintain', stance='disagree', reason=second['reason'], new_facts='No comparable fresh quote', review_date=None))
        history = self.records.history('decision-one')
        self.assertEqual([r['version'] for r in history], [3, 2, 1])
        self.assertEqual(history[-1]['reason'], original['reason'])
        self.assertEqual(history[0]['source']['snapshot_id'], self.snapshot['id'])
        self.assertIsNone(history[0]['review_date'])
        self.assertEqual(read_ledger(), self.ledger)

    def test_concurrent_revision_and_operation_content_conflict(self):
        self.records.save('decision-one', self.request())
        def write(n):
            try:
                return self.records.save('decision-one', self.request(expected_version=1, operation_id=f'operation-{n}', action='revise', reason=str(n)))['version']
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(write, [1, 2])), [2, 409])
        with self.assertRaises(HTTPException):
            self.records.save('decision-one', self.request(reason='different same operation'))

    def test_confirmation_action_date_and_source_validation(self):
        for changes in ({'confirmed': False}, {'review_date': '2026-02-30'}, {'action': 'complete', 'status': 'active'}):
            with self.assertRaises(ValidationError):
                self.request(**changes)
        with self.assertRaises(HTTPException):
            self.records.save('bad-source', self.request(source_turn_id='unknown'))
        self.records.save('decision-one', self.request())
        for changes in ({'action': 'maintain', 'reason': 'silent edit'}, {'action': 'defer', 'review_date': '2026-10-02'}, {'action': 'revise', 'source_turn_id': None}):
            with self.assertRaises(HTTPException):
                self.records.save('decision-one', self.request(expected_version=1, operation_id='operation-invalid', **changes))

    def test_defer_complete_cancel_and_explicit_source_unavailable(self):
        self.records.save('decision-one', self.request())
        self.records.save('decision-one', self.request(expected_version=1, operation_id='operation-defer', action='defer', review_date='2026-10-05'))
        self.records.save('decision-one', self.request(expected_version=2, operation_id='operation-complete', action='complete', status='completed', review_date=None))
        self.records.save('decision-one', self.request(expected_version=3, operation_id='operation-cancel', action='cancel', status='cancelled', review_date=None))
        with self.store.connect() as db:
            db.execute('delete from ai_journal_turns where id=?', (self.turn,))
        self.assertFalse(self.records.history('decision-one')[0]['source_available'])
        self.assertEqual(self.records.history('decision-one')[0]['source']['turn_id'], self.turn)

    def test_note_versions_and_deleted_originals_do_not_resurface(self):
        note_id = self.store.save_note('original', journal_date='2026-01-15')['id']
        self.store.save_note('revision', note_id, '2026-02-15')
        self.assertEqual([r['body'] for r in self.store.note_versions(note_id)['versions']], ['revision', 'original'])
        self.store.delete_note(note_id)
        with self.assertRaises(HTTPException):
            self.store.note_versions(note_id)

    def test_policy_versions_and_backup_restore_without_trades(self):
        policy = self.request(operation_id='operation-policy1', kind='investment_policy', source_turn_id=None, review_date=None, horizon='3 years', cash_needs='synthetic budget', restrictions='no leverage', goals='record discipline')
        self.records.save('investment-policy', policy)
        self.records.save('investment-policy', policy.model_copy(update={'expected_version': 1, 'operation_id': 'operation-policy2', 'action': 'revise', 'goals': 'new goal'}))
        self.records.save('decision-one', self.request())
        note_id = self.store.save_note('original')['id']; self.store.save_note('revised', note_id)
        archive = create_backup(self.home, self.db, Path(self.tmp.name) / 'backup.zip')
        restored = Path(self.tmp.name) / 'restored'
        prepare_restore(archive, restored)
        with patch.object(database, 'DB_PATH', restored / 'app.db'):
            self.assertEqual(len(self.records.history('investment-policy')), 2)
            self.assertEqual(self.records.history('decision-one')[0]['source']['snapshot_id'], self.snapshot['id'])
            self.assertEqual(len(self.store.note_versions(note_id)['versions']), 2)
            self.assertEqual(read_ledger()['state'], self.ledger['state'])

    def test_schema8_upgrade_retains_note_and_rejects_broken_version_chain(self):
        with self.store.connect() as db:
            db.execute('drop table ai_journal_user_records')
            db.execute('drop table ai_journal_note_versions')
            db.execute("insert into ai_journal_notes values ('legacy-note','kept','2026-01-01','2026-01-01',null)")
            db.execute('pragma user_version=8')
        database.init_db()
        self.assertEqual(self.store.note_versions('legacy-note')['versions'][0]['body'], 'kept')
        self.assertTrue(list((self.home / 'backups').glob('*.db')))
        self.records.save('decision-one', self.request())
        with self.store.connect() as db:
            with self.assertRaises(sqlite3.DatabaseError):
                db.execute("update ai_journal_user_records set payload='{}'")
            db.execute("insert into ai_journal_user_records values ('broken',2,'user_decision','operation-broken','x','{}')")
        with self.assertRaises(ValueError):
            validate_database(self.db)

    def test_http_read_write_and_no_unconfirmed_policy_in_ai_context(self):
        from app.main import app
        from app.modules.ai_journal.context import private_context
        from app.modules.ai_journal.models import PreviewRequest
        client = TestClient(app)
        body = self.request().model_dump(mode='json')
        self.assertEqual(client.put('/api/ai-journal/user-records/decision-one', json=body).status_code, 200)
        self.assertEqual(len(client.get('/api/ai-journal/user-records').json()['items']), 1)
        body['confirmed'] = False
        self.assertEqual(client.put('/api/ai-journal/user-records/decision-two', json=body).status_code, 422)
        self.records.save('investment-policy', self.request(operation_id='operation-policy1', kind='investment_policy', source_turn_id=None, horizon='synthetic-policy-only'))
        context, _ = private_context(self.store, None, PreviewRequest(task_type='conversation', question='test'))
        self.assertNotIn('synthetic-policy-only', str(context))
