from __future__ import annotations
import sqlite3, tempfile, unittest
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

    class store:
        @staticmethod
        def _connect():
            db = sqlite3.connect(':memory:')
            db.execute('create table board_instruments (key text)')
            return db


class MockAiJournalTest(unittest.TestCase):
    def test_operator_disable_blocks_verified_agent_and_keeps_legacy_available(self):
        import os
        from unittest.mock import patch
        from app.modules.ai_journal.agent.model import ADAPTER_VERSION, ready
        from app.modules.ai_journal.agent.store import AgentStore
        from app.modules.ai_journal.service import model_fingerprint
        original = database.DB_PATH
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'STOCK_APP_AI_JOURNAL_AGENT_ENABLED': '0'}):
            database.DB_PATH = Path(temp) / 'isolated.db'
            try:
                with database.connect() as db:
                    db.execute('create table app_state(key text primary key,payload text,updated_at text)')
                    migrate_journal_db(db)
                settings = {'provider': 'custom', 'protocol': 'chat/completions', 'complexModel': 'synthetic',
                    'baseUrl': 'https://mock.invalid', 'apiKey': 'synthetic'}
                store = JournalStore()
                capability = {'model_fingerprint': model_fingerprint(settings), 'endpoint': 'chat/completions',
                    'adapter_version': ADAPTER_VERSION, 'tool_calling': True, 'verification': 'real_provider',
                    'verified_at': '2026-10-01T00:00:00+00:00'}
                AgentStore(store).save_capability(capability)
                self.assertFalse(ready(settings, capability))
                calls = []
                def completion(**kwargs):
                    calls.append(kwargs)
                    return {'content': 'synthetic legacy'}
                service = JournalService(store, _Board(), settings=lambda: settings, completion=completion)
                preview = service.preview(PreviewRequest(task_type='conversation', question='synthetic', engine='agent'))
                self.assertFalse(preview['agent_available'])
                disabled = service.confirm(ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='disable-agent'))
                self.assertEqual(disabled['turns'][0]['run']['error_code'], 'agent_execution_not_ready')
                self.assertEqual(calls, [])
                preview = service.preview(PreviewRequest(task_type='conversation', question='new legacy turn', session_id=disabled['id']))
                result = service.confirm(ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='keep-legacy'), disabled['id'])
                self.assertEqual(result['turns'][-1]['answer'], 'synthetic legacy')
                self.assertEqual(len(calls), 1)
            finally:
                database.DB_PATH = original

    def test_disabled_agent_keeps_legacy_completion_available_in_same_conversation(self):
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
                    return {'content': 'synthetic legacy answer'}

                service = JournalService(JournalStore(), _Board(), settings=lambda: {
                    'provider': 'mock', 'protocol': 'chat/completions', 'complexModel': 'mock',
                    'baseUrl': 'https://mock.invalid', 'apiKey': 'synthetic'}, completion=completion)
                agent_preview = service.preview(PreviewRequest(task_type='conversation', question='first', engine='agent'))
                self.assertFalse(agent_preview['agent_available'])
                agent_turn = service.confirm(ConfirmRequest(snapshot_id=agent_preview['id'],
                    digest=agent_preview['digest'], idempotency_key='synthetic-agent-disabled'))
                self.assertEqual(agent_turn['turns'][0]['run']['error_code'], 'agent_execution_not_ready')
                self.assertEqual(calls, [])

                llm_preview = service.preview(PreviewRequest(task_type='conversation', question='continue',
                    engine='llm', session_id=agent_turn['id']))
                conversation = service.confirm(ConfirmRequest(snapshot_id=llm_preview['id'],
                    digest=llm_preview['digest'], idempotency_key='synthetic-legacy-active'), agent_turn['id'])
                self.assertEqual([turn['status'] for turn in conversation['turns']], ['failed', 'completed'])
                self.assertEqual(conversation['turns'][1]['answer'], 'synthetic legacy answer')
                self.assertEqual(len(calls), 1)
            finally:
                database.DB_PATH = original

    def test_failed_confirmation_is_terminal_and_new_preview_can_continue(self):
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
                repeated = service.confirm(request)
                self.assertEqual(repeated, failed)
                self.assertEqual(len(calls), 1)
                preview = service.preview(PreviewRequest(task_type='portfolio_review',
                    question='新一轮一般性风险检查', session_id=failed['id']))
                next_request = ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='new-round')
                completed = service.confirm(next_request, failed['id'])
                self.assertEqual(len(completed['turns']), 2)
                self.assertEqual(completed['turns'][-1]['status'], 'completed')
                self.assertEqual(completed['turns'][0]['snapshot'], failed['turns'][0]['snapshot'])
                self.assertGreaterEqual(calls[0]['max_output_tokens'], 8192)
                service.confirm(request)
                self.assertEqual(len(calls), 2)
            finally:
                database.DB_PATH = original

    def test_partial_oversized_and_unknown_replies_never_replay_or_save_an_answer(self):
        from app.modules.ai_settings import CompletionOutcomeUnknownError
        from unittest.mock import Mock
        cases = [({'content': 'partial', 'finish_reason': 'length'}, 'model_output_truncated'),
            ({'content': 'partial', 'status': 'incomplete'}, 'model_output_truncated'),
            ({'content': 'x' * 24001}, 'model_output_truncated'),
            (CompletionOutcomeUnknownError('synthetic transport loss'), 'model_outcome_unknown')]
        original = database.DB_PATH
        with tempfile.TemporaryDirectory() as temp:
            database.DB_PATH = Path(temp) / 'isolated.db'
            try:
                with database.connect() as db:
                    db.execute('create table app_state(key text primary key,payload text,updated_at text)')
                    migrate_journal_db(db)
                for index, (reply, code) in enumerate(cases):
                    with self.subTest(code=code, index=index):
                        completion = Mock(side_effect=reply) if isinstance(reply, Exception) else Mock(return_value=reply)
                        store = JournalStore()
                        service = JournalService(store, _Board(), settings=lambda: {
                            'provider': 'mock', 'protocol': 'chat/completions', 'complexModel': 'mock',
                            'baseUrl': 'https://mock.invalid', 'apiKey': 'synthetic'}, completion=completion)
                        preview = service.preview(PreviewRequest(task_type='conversation', question='synthetic'))
                        request = ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key=f'terminal-{index}')
                        result = service.confirm(request)
                        self.assertEqual(result['turns'][0]['error_code'], code)
                        self.assertEqual(result['turns'][0]['answer'], '')
                        self.assertEqual(service.confirm(request), result)
                        self.assertFalse(store.claim(request, preview, result['id'])[2])
                        completion.assert_called_once()
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
