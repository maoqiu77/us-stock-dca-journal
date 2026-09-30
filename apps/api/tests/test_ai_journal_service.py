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
