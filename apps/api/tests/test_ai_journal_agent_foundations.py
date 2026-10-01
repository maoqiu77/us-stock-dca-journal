from __future__ import annotations

import copy
import importlib.util
import socket
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from app.core import database
from app.modules.ai_journal.models import PreviewRequest, ConfirmRequest
from app.modules.ai_journal.service import JournalService
from app.modules.ai_journal.store import JournalStore, digest
from app.modules.ai_journal.migration import backup_before_upgrade, migrate_journal_db
from app.modules.ai_journal.agent.migration import migrate_agent_db, STATEMENTS
from app.modules.ai_journal.agent.capabilities import ModelCapability, protocol_matrix
from app.modules.ai_journal.agent.contracts import Evidence, EvidenceBook, Report, make_evidence
from app.modules.ai_journal.agent.store import AgentStore
from app.modules.ai_journal.agent.scope import build_scope


class Board:
    catalog = type('Catalog', (), {'resolve': lambda _, key: None})()


class FoundationsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = database.DB_PATH
        database.DB_PATH = Path(self.temp.name) / 'synthetic.db'
        with database.connect() as db:
            db.execute('create table app_state(key text primary key,payload text,updated_at text)')
            migrate_journal_db(db)
        self.network = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        self.network.start()
        self.store = JournalStore()
        self.agent = AgentStore(self.store)
        self.service = JournalService(self.store, Board(), settings=lambda: {}, completion=lambda **_: self.fail('model must not run'))

    def tearDown(self):
        self.network.stop()
        database.DB_PATH = self.original
        self.temp.cleanup()

    def preview(self, **kwargs):
        return self.service.preview(PreviewRequest(task_type='portfolio_review', question='synthetic NVDA', engine='agent', **kwargs))

    def confirm_request(self, preview):
        return ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='synthetic-' + preview['id'])

    def test_request_rejects_browser_evidence_and_refresh_reuse(self):
        for fields in ({'agent_scope': {}}, {'agent_sources': []}, {'facts': []}, {'reuse_snapshot_id': 'x', 'market_policy': 'refresh_within_scope'}):
            with self.assertRaises(ValidationError):
                PreviewRequest(task_type='portfolio_review', question='q', engine='agent', **fields)

    def test_question_does_not_authorize_instruments_and_scope_is_hashed(self):
        preview = self.preview()
        self.assertEqual(preview['agent_scope']['instrument_keys'], [])
        altered = copy.deepcopy(preview); altered.pop('digest')
        altered['agent_scope']['instrument_keys'] = ['US:XNAS:NVDA:STOCK']
        self.assertNotEqual(digest(altered), preview['digest'])
        request = self.confirm_request(preview).model_copy(update={'digest': digest(altered)})
        with self.assertRaises(HTTPException): self.service.confirm(request)

    def test_selected_notes_frozen_with_revision_and_exclusion(self):
        note = self.store.save_note('synthetic original')['id']
        preview = self.preview(note_ids=[note])
        source = Evidence.model_validate(preview['agent_sources'][0])
        self.assertEqual(source.classification, 'user_original')
        self.assertEqual(source.entity_id, 'note:' + note)
        self.assertIn(preview['private_context']['notes'][0]['updated_at'], source.revision)
        excluded = self.preview(note_ids=[note], memory_excluded_ids=[note])
        self.assertFalse(excluded['agent_scope']['memory'])
        self.assertEqual(excluded['agent_sources'], [])
        self.assertEqual(excluded['private_context']['notes'], [])

    def test_related_retrieval_freezes_originals(self):
        note = self.store.save_note('synthetic NVDA original')['id']
        with patch('app.modules.trading_data.load_trading_state', return_value={'privacyMode':'normal','trades':[]}):
            preview = self.preview(memory_mode='suggest_related')
        self.assertTrue(preview['agent_scope']['memory'])
        self.assertEqual(preview['private_context']['notes'][0]['id'], note)

    def test_catalog_scope_uses_verified_web_periods_and_ignores_bad_observations(self):
        key = 'US:XNAS:NVDA:STOCK'
        instrument = type('I', (), {'market': type('M', (), {'value': 'US'})()})()
        board = type('B', (), {'catalog': type('C', (), {'resolve': lambda _, candidate: instrument if candidate == key else None})()})()
        request = PreviewRequest(task_type='instrument_research', instrument_key=key, question='TSLA', engine='agent')
        stamp = datetime.now(timezone.utc)
        facts = [{'instrument_key':key,'kind':'交易报价','value':{'meta':{'status':'sample','as_of':stamp.isoformat()}}}]
        scope, sources = build_scope(board, request, {}, facts, stamp)
        self.assertEqual(scope['instrument_keys'], [key]); self.assertEqual(scope['periods_by_key'], {key:['1d']})
        self.assertEqual(sources, [])

    def test_agent_repeated_confirmation_is_one_terminal_run_even_after_expiry(self):
        preview = self.preview(); request = self.confirm_request(preview)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.service.confirm(request), range(2)))
        self.assertEqual(results[0]['id'], results[1]['id'])
        run = results[0]['turns'][0]['run']
        self.assertEqual(run['status'], 'failed'); self.assertEqual(run['error_code'], 'agent_execution_not_ready')
        self.assertNotIn('lease_token', run)
        self.service.clock = lambda: datetime.now(timezone.utc) + timedelta(days=1)
        self.assertEqual(self.service.confirm(request)['turns'][0]['run_id'], run['id'])
        with self.store.connect() as db:
            self.assertEqual(db.execute('select count(*) from ai_journal_agent_runs').fetchone()[0], 1)
            self.assertEqual(db.execute('select count(*) from ai_journal_turns').fetchone()[0], 1)
        self.assertFalse(self.store.claim(request, preview, results[0]['id'])[2])

    def test_worker_ownership_cancel_and_atomic_result_storage(self):
        preview = self.preview(); request = self.confirm_request(preview)
        created = self.agent.create(request, preview, 'synthetic-fp', None)
        run_id = created['run_id']
        token = self.agent.claim_queued(run_id)
        self.assertIsNone(self.agent.claim_queued(run_id))
        stamp = datetime.now(timezone.utc)
        source = make_evidence('note', 'note:synthetic', '1', {'text':'synthetic'}, stamp, stamp)
        report = Report(summary='synthetic', stance='observe', facts=[{'text':'synthetic','source_ids':[source.id]}], interpretations=[], risks=[], missing=[], next_questions=[])
        with self.assertRaises(HTTPException): self.agent.finish(run_id, 'wrong', report, 'synthetic', [source], [], {})
        self.agent.finish(run_id, token, report, 'synthetic', [source], [{'tool':'read_note','status':'succeeded','duration_ms':1,'source_count':1}], {'usage_complete':False})
        result = self.agent.get(run_id)
        self.assertEqual(result['status'], 'succeeded'); self.assertEqual(result['source_count'], 1)
        self.assertEqual(self.store.session(created['session_id'])['turns'][0]['answer'], 'synthetic')
        next_preview = self.preview()
        next_run = self.agent.create(self.confirm_request(next_preview), next_preview, 'synthetic-fp', None)['run_id']
        next_token = self.agent.claim_queued(next_run)
        self.agent.cancel(next_run)
        with self.assertRaises(HTTPException): self.agent.finish(next_run, next_token, report, 'late', [source], [], {})
        self.assertEqual(self.agent.get(next_run)['source_count'], 0)

    def test_capabilities_are_disabled_and_fingerprint_bound(self):
        self.assertTrue(all(not row['enabled'] for row in protocol_matrix()))
        self.assertFalse(self.agent.capability('new').tool_calling)
        self.agent.save_capability({'model_fingerprint':'synthetic','endpoint':'responses','verification':'offline'})
        self.assertEqual(self.agent.capability('synthetic').verification, 'offline')
        self.assertEqual(self.agent.capability('changed').verification, 'unverified')
        with self.assertRaises(ValidationError): ModelCapability(model_fingerprint='synthetic', endpoint='responses', tool_calling=True, verification='offline')

    def test_evidence_integrity_atomic_batch_and_report_references(self):
        stamp = datetime.now(timezone.utc)
        source = make_evidence('note', 'n', '1', {'text':'synthetic'}, stamp, stamp)
        with self.assertRaises(ValidationError): Evidence.model_validate({**source.model_dump(), 'classification':'observed'})
        with self.assertRaises(ValidationError): Evidence.model_validate({**source.model_dump(), 'payload':{'text':'forged'}})
        book = EvidenceBook(excluded={'deleted'})
        bad = make_evidence('note', 'deleted', '1', {}, stamp, stamp)
        with self.assertRaises(ValueError): book.add_batch([source, bad], stamp)
        self.assertEqual(book.rows, {})
        report = Report(summary='synthetic',stance='observe',facts=[{'text':'x','source_ids':[source.id]}],interpretations=[],risks=[],missing=[],next_questions=[])
        with self.assertRaises(ValueError): book.validate_report(report.model_dump_json())
        book.add_batch([source],stamp); self.assertEqual(book.validate_report(report.model_dump_json()), report)

    def test_deepseek_output_allowance_is_reserved_and_total_bound_remains_enforced(self):
        from app.modules.ai_journal.agent.model import output_limit_for
        from app.modules.ai_journal.agent.runtime import Budget, LimitReached, MAX_MODEL_INPUT_BYTES
        self.assertEqual(output_limit_for({'provider':'deepseek'}),6144)
        self.assertEqual(output_limit_for({'provider':'openai'}),3072)
        budget=Budget(max_output_tokens=6144)
        for _ in range(3):budget.model(32000)
        self.assertEqual(budget.reserved_units,3*(32000+6144+512))
        with self.assertRaises(LimitReached):budget.model(32000)
        self.assertEqual(budget.model_calls,3)
        self.assertEqual(budget.usage()['max_output_tokens_per_request'],6144)

    def test_model_input_limit_records_a_local_reason_without_provider_retry(self):
        from app.modules.ai_journal.agent.runtime import Budget, LimitReached, MAX_MODEL_INPUT_BYTES

        budget = Budget()
        with self.assertRaises(LimitReached) as error:
            budget.model(MAX_MODEL_INPUT_BYTES + 1)
        self.assertEqual(error.exception.reason, 'model_input_bytes')
        self.assertEqual(budget.usage()['limit_reason'], 'model_input_bytes')
        self.assertEqual(budget.usage()['limit_details'], {
            'attempted_input_bytes': MAX_MODEL_INPUT_BYTES + 1,
            'max_input_bytes': MAX_MODEL_INPUT_BYTES,
        })
        self.assertEqual(budget.model_calls, 0)

    def test_v6_backup_upgrade_and_old_snapshot_immutability(self):
        with self.store.connect() as db:
            for table in ('ai_journal_agent_events','ai_journal_agent_sources','ai_journal_agent_runs','ai_journal_agent_capabilities'):
                db.execute('drop table ' + table)
            db.execute('pragma user_version=6')
        payload = {'request':{'question':'legacy','task_type':'portfolio_review','instrument_key':None},'private_context':{},'created_at':'synthetic'}
        preview = self.store.save_snapshot(payload, 'synthetic')
        session_id, turn_id, _ = self.store.claim(self.confirm_request(preview), payload, None)
        self.store.finish(turn_id, answer='synthetic old answer')
        with self.store.connect() as db:
            backup_before_upgrade(db)
            migrate_agent_db(db)
            self.assertEqual(db.execute('pragma user_version').fetchone()[0], 7)
            with self.assertRaises(sqlite3.DatabaseError): db.execute('update ai_journal_snapshots set digest=?', ('forged',))
        backups = list((Path(self.temp.name)/'backups').glob('*.db'))
        self.assertEqual(len(backups), 1)
        with sqlite3.connect(backups[0]) as db: self.assertEqual(db.execute('pragma user_version').fetchone()[0], 6)
        self.assertEqual(self.store.snapshot(preview['id'])[1], preview['digest'])
        self.assertEqual(self.store.session(session_id)['turns'][0]['answer'], 'synthetic old answer')

    def test_migration_failure_rolls_back_tables_and_version(self):
        with sqlite3.connect(':memory:') as db:
            db.execute('pragma user_version=6')
            with patch('app.modules.ai_journal.agent.migration.STATEMENTS', STATEMENTS + ('INVALID SQL',)):
                with self.assertRaises(sqlite3.DatabaseError): migrate_agent_db(db)
            self.assertEqual(db.execute('pragma user_version').fetchone()[0], 6)
            self.assertFalse(db.execute("select name from sqlite_master where name like 'ai_journal_agent_%'").fetchall())

    def test_nested_journal_upgrade_failure_preserves_v5(self):
        with sqlite3.connect(':memory:') as db:
            db.execute('pragma user_version=5')
            with patch('app.modules.ai_journal.agent.migration.STATEMENTS', STATEMENTS + ('INVALID SQL',)):
                with self.assertRaises(sqlite3.DatabaseError): migrate_journal_db(db)
            self.assertEqual(db.execute('pragma user_version').fetchone()[0], 5)
            self.assertFalse(db.execute("select name from sqlite_master where name like 'ai_journal_%'").fetchall())


@unittest.skipUnless(importlib.util.find_spec('langchain_core'), 'optional Python 3.12 Agent environment required')
class OfflineProtocolTest(unittest.IsolatedAsyncioTestCase):
    async def test_fake_protocol_without_network_or_credentials(self):
        from app.modules.ai_journal.agent.evaluation import evaluate
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            result = await evaluate()
        self.assertEqual(result['offline'], 'passed'); self.assertFalse(result['real_model_tested'])
