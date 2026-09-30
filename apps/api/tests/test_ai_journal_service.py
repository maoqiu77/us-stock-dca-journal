from __future__ import annotations
import tempfile, unittest
from pathlib import Path
from app.core import database
from app.modules.ai_journal.migration import migrate_journal_db
from app.modules.ai_journal.models import ConfirmRequest, PreviewRequest
from app.modules.ai_journal.service import JournalService
from app.modules.ai_journal.store import JournalStore


class _Catalog:
    def resolve(self, key): return None


class _Board:
    catalog = _Catalog()


class MockAiJournalTest(unittest.TestCase):
    def test_reasoning_budget_and_failed_retry_preserve_one_turn(self):
        original = database.DB_PATH
        with tempfile.TemporaryDirectory() as temp:
            database.DB_PATH = Path(temp) / 'isolated.db'
            try:
                with database.connect() as db:
                    db.execute('create table app_state(key text primary key,payload text,updated_at text)')
                    migrate_journal_db(db)
                calls = []

                def completion(**kwargs):
                    calls.append(kwargs)
                    # A reasoning-only response must not be recorded as a successful answer.
                    return {'content': '' if len(calls) == 1 else '一般性风险检查完成'}

                service = JournalService(JournalStore(), _Board(), settings=lambda: {'provider': 'mock', 'protocol': 'chat/completions', 'complexModel': 'mock', 'baseUrl': 'https://mock.invalid', 'apiKey': 'synthetic'}, completion=completion)
                snapshot = service.preview(PreviewRequest(task_type='portfolio_review', question='一般性风险检查'))
                request = ConfirmRequest(snapshot_id=snapshot['id'], digest=snapshot['digest'], idempotency_key='retry-reasoning-budget')
                failed = service.confirm(request)
                self.assertEqual(failed['turns'][0]['status'], 'failed')
                completed = service.confirm(request)
                self.assertEqual(completed['id'], failed['id'])
                self.assertEqual(len(completed['turns']), 1)
                self.assertEqual(completed['turns'][0]['status'], 'completed')
                self.assertEqual(completed['turns'][0]['snapshot'], failed['turns'][0]['snapshot'])
                self.assertGreaterEqual(calls[0]['max_output_tokens'], 8192)
                service.confirm(request)
                self.assertEqual(len(calls), 2)
            finally:
                database.DB_PATH = original

    def test_unconfigured_ai_keeps_snapshot_and_failed_turn_without_private_leak(self):
        original = database.DB_PATH
        with tempfile.TemporaryDirectory() as temp:
            database.DB_PATH = Path(temp) / 'isolated.db'
            try:
                with database.connect() as db:
                    db.execute('create table app_state(key text primary key,payload text,updated_at text)')
                    migrate_journal_db(db)
                store = JournalStore()
                service = JournalService(store, _Board(), settings=lambda: {'provider':'mock','protocol':'auto','complexModel':'mock','baseUrl':'','apiKey':''}, completion=lambda **_: (_ for _ in ()).throw(AssertionError('AI must not be called')))
                request = PreviewRequest(task_type='portfolio_review', question='仅做一般性检查')
                snapshot = service.preview(request)
                result = service.confirm(ConfirmRequest(snapshot_id=snapshot['id'], digest=snapshot['digest'], idempotency_key='mock-idempotency-1'))
                self.assertEqual(result['turns'][0]['status'], 'failed')
                self.assertEqual(result['turns'][0]['error_code'], 'ai_not_configured')
                self.assertEqual(result['turns'][0]['snapshot']['private_context'], {})
            finally:
                database.DB_PATH = original
