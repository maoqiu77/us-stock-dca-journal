from __future__ import annotations

import asyncio
import copy
import json
import socket
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from app.core import database
from app.modules.market_board.models import Instrument
from app.modules.ai_journal.models import PreviewRequest, ConfirmRequest
from app.modules.ai_journal.service import JournalService
from app.modules.ai_journal.store import JournalStore
from app.modules.ai_journal.migration import migrate_journal_db
from app.modules.ai_journal.automatic import conversation_targets
from app.modules.ai_journal.agent.memory import candidates, retrieve, memory_view
from app.modules.ai_journal.agent.contracts import EvidenceBook, make_evidence, Report
from app.modules.ai_journal.agent.adapters import private_access, frozen_ports
from app.modules.ai_journal.agent.analytics import portfolio_exposure
from app.modules.ai_journal.agent.runtime import AccessRevoked, Budget, ToolExecutor
from app.modules.ai_journal.agent.tools import make_tools
from app.modules.ai_journal.agent.store import AgentStore
from app.modules.ai_journal.agent.model import runtime_available

STAMP = datetime(2026, 9, 25, tzinfo=timezone.utc)
KEY = 'US:XNAS:NVDA:STOCK'
STATE = {'privacyMode': 'normal', 'account': {'baseCurrency': 'USD'}, 'stockPool': ['NVDA'],
    'positions': [{'ticker': 'NVDA', 'targetWeight': .3, 'takeProfitPct': .2, 'stopLossPct': .1}],
    'trades': [{'id': 'synthetic-old-buy', 'ticker': 'NVDA', 'date': '2020-01-01', 'action': '买入',
        'shares': 10, 'unitPrice': 12, 'amount': 120, 'note': '英伟达买入理由：长期算力需求'}]}


class Board:
    def __init__(self, store):
        self.store = SimpleNamespace(_connect=store.connect)
        self.items = {KEY: Instrument(key=KEY, symbol='NVDA', name='NVIDIA', market='US', exchange='XNAS',
            asset_type='STOCK', currency='USD', timezone='America/New_York', verified_at=STAMP)}
        self.catalog = SimpleNamespace(resolve=self.items.get)


class MemoryPortfolioTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = database.DB_PATH
        database.DB_PATH = Path(self.temp.name) / 'synthetic.db'
        self.store = JournalStore()
        with self.store.connect() as db:
            db.execute('create table app_state(key text primary key,payload text,updated_at text)')
            db.execute('create table board_instruments(key text primary key)')
            db.execute('insert into board_instruments values (?)', (KEY,))
            migrate_journal_db(db)
        self.board = Board(self.store)
        self.state = copy.deepcopy(STATE)
        self.network = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        self.network.start()

    def tearDown(self):
        self.network.stop()
        database.DB_PATH = self.previous
        self.temp.cleanup()

    def request(self, **updates):
        return PreviewRequest(task_type='conversation', question='英伟达买入理由是什么', engine='agent', auto_context=True, **updates)

    def note(self, body, stamp=STAMP):
        value = self.store.save_note(body)['id']
        with self.store.connect() as db:
            db.execute('update ai_journal_notes set updated_at=? where id=?', (stamp.isoformat(), value))
        return value

    def preview(self, request=None):
        service = JournalService(self.store, self.board, settings=lambda: {}, clock=lambda: STAMP)
        with patch('app.modules.ai_journal.automatic.load_trading_state', return_value=self.state), \
             patch('app.modules.ai_journal.service.market_facts', return_value=([], ['synthetic unavailable'])):
            return service.preview(request or self.request())

    def position(self, key=KEY, currency='USD', quantity=10, cost=12):
        return make_evidence('position', 'position:' + key, '1',
            {'instrument_key': key, 'currency': currency, 'quantity': quantity, 'cost': cost, 'ticker': key.split(':')[2]}, STAMP, STAMP)

    def quote(self, key=KEY, price=20):
        return make_evidence('quote', 'quote:' + key, '1', {'instrument_key': key, 'price': price, 'fact_kind': '交易报价',
            'currency': 'CNY' if key.startswith('CN:') else 'USD',
            'meta': {'status': 'available', 'as_of': STAMP.isoformat()}}, STAMP, STAMP)

    def test_bm25_alias_finds_old_trade_beyond_recent_records(self):
        for index in range(250):
            self.state['trades'].append({**STATE['trades'][0], 'id': f'other-{index}', 'ticker': 'OTHER', 'note': '无关交易', 'date': '2026-09-01'})
        rows = candidates(self.store, self.state, self.request(), STAMP)
        self.assertEqual([row['id'] for row in rows['trade_reasons']], ['synthetic-old-buy'])
        evidence = make_evidence('trade_reason', 'trade:synthetic-old-buy', '1', rows['trade_reasons'][0], STAMP, STAMP)
        self.assertEqual(retrieve('NVDA 算力', [evidence]), [evidence])
        self.assertEqual(retrieve('石油供应', [evidence]), [])

    def test_memory_tool_distinguishes_trade_date_version_and_snapshot_without_mutation(self):
        self.note('NVDA 算力需求', STAMP - timedelta(days=10))
        preview = self.preview()
        from app.modules.ai_journal.agent.contracts import Evidence
        rows = [Evidence.model_validate(row) for row in preview['agent_sources'] if row['kind'] in {'note', 'trade_reason'}]
        for row in rows:
            original = copy.deepcopy(row.payload)
            view = memory_view(row, 'NVDA')
            times = view['time_semantics']
            self.assertEqual(times['snapshot_available_at'], STAMP.isoformat())
            if row.kind == 'note':
                self.assertEqual(times['original_version_at'], (STAMP - timedelta(days=10)).isoformat())
                self.assertIsNone(times['trade_date'])
                self.assertEqual(times['as_of_meaning'], 'note_version_time')
            else:
                self.assertEqual(times['trade_date'], '2020-01-01')
                self.assertIsNone(times['original_version_at'])
                self.assertEqual(times['as_of_meaning'], 'snapshot_time_not_trade_or_reason_version')
            self.assertEqual(row.payload, original)

    def test_deleted_excluded_future_revised_and_unknown_trade_version_filtered(self):
        old = self.note('NVDA 买入理由', STAMP - timedelta(days=10))
        revised = self.note('NVDA 修改版本', STAMP + timedelta(days=1))
        deleted = self.note('NVDA 已删除')
        self.store.delete_note(deleted)
        excluded = self.note('NVDA 排除')
        result = candidates(self.store, self.state, self.request(memory_excluded_ids=[excluded]), STAMP)
        self.assertEqual([row['id'] for row in result['notes']], [old])
        self.assertNotIn(revised, [row['id'] for row in result['notes']])
        historical = candidates(self.store, self.state, self.request(memory_before=STAMP-timedelta(days=5)), STAMP)
        self.assertEqual([row['id'] for row in historical['notes']], [old])
        self.assertEqual(historical['trade_reasons'], [])

    def test_scope_exposes_filter_policy_without_exposing_filtered_originals(self):
        deleted = self.note('NVDA 已删除原文')
        self.store.delete_note(deleted)
        excluded = self.note('NVDA 明确排除原文')
        request = self.request(memory_excluded_ids=[excluded], memory_before=STAMP - timedelta(days=1))
        preview = self.preview(request)
        policy = preview['agent_scope']['memory_filter_policy']
        self.assertIn('已删除的手记不进入本轮检索，原文不可恢复', policy)
        self.assertIn('本轮明确排除的手记不作为可读取原文返回', policy)
        self.assertIn('历史检索只保留版本时间不晚于截止时间的手记；截止时间之后的版本不作为历史原文返回；无版本时间的交易理由不纳入', policy)
        self.assertNotIn(deleted, preview['agent_scope']['memory_source_ids'])
        self.assertNotIn(excluded, preview['agent_scope']['memory_source_ids'])
        self.assertNotIn('NVDA 已删除原文', str(preview['agent_sources']))
        self.assertNotIn('NVDA 明确排除原文', str(preview['agent_sources']))

    @unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
    def test_model_status_includes_filter_policy_without_original_text(self):
        from app.modules.ai_journal.agent.prompts import initial_messages
        deleted = self.note('NVDA 删除状态中的秘密原文')
        self.store.delete_note(deleted)
        excluded = self.note('NVDA 排除状态中的秘密原文')
        preview = self.preview(self.request(memory_excluded_ids=[excluded], memory_before=STAMP - timedelta(days=1)))
        status = [item for item in preview['missing'] if item.startswith('检索过滤状态：')]
        self.assertEqual(len(status), 4)
        self.assertTrue(all('秘密' not in item for item in status))
        inputs = json.loads(initial_messages(preview)[-1].content)
        self.assertEqual(inputs['missing'], preview['missing'])
        self.assertEqual(status, [item for item in inputs['missing'] if item.startswith('检索过滤状态：')])
        self.assertNotIn('NVDA 删除状态中的秘密原文', str(inputs))
        self.assertNotIn('NVDA 排除状态中的秘密原文', str(inputs))

    def test_final_report_adds_cutoff_status_without_source_citation(self):
        from app.modules.ai_journal.agent.prompts import add_scope_filter_status, render
        report = Report(summary='无匹配', stance='insufficient_data', facts=[], interpretations=[], risks=[], missing=[], next_questions=[])
        enriched = add_scope_filter_status(report, {'request': {'memory_before': '2026-08-01T00:00:00Z', 'memory_excluded_ids': []}})
        self.assertIn('检索过滤状态：历史截止时间之后的手记版本已从本轮检索排除，不作为历史原文返回', enriched.missing)
        self.assertIn('历史截止时间之后的手记版本已从本轮检索排除', render(enriched))
        self.assertEqual(enriched.facts, [])

    def test_explicit_originals_are_not_silently_truncated_or_expanded(self):
        values = [self.note('NVDA 原文 ' + 'x' * 11000) for _ in range(4)]
        with self.assertRaises(HTTPException) as error:
            candidates(self.store, self.state, self.request(note_ids=values), STAMP)
        self.assertEqual(error.exception.detail['code'], 'agent_memory_scope_too_large')
        selected = PreviewRequest(task_type='portfolio_review', question='NVDA', engine='agent', note_ids=[values[0]], memory_before=STAMP)
        result = candidates(self.store, self.state, selected, STAMP)
        self.assertEqual([row['id'] for row in result['notes']], [values[0]])
        self.assertEqual(result['trade_reasons'], [])
        body = 'x' * 11000 + ' NVDA 关键买入理由'
        source = make_evidence('note', 'note:long', '1', {'body': body}, STAMP, STAMP)
        self.assertEqual(retrieve('NVDA', [source]), [source])
        view = memory_view(source, 'NVDA')
        self.assertIn('NVDA', view['body'])
        self.assertEqual(view['body'], body[view['excerpt']['start']:view['excerpt']['end']])
        self.assertEqual(source.payload['body'], body)

    def test_automatic_scope_contains_positions_policy_originals_but_no_ai_memory(self):
        self.note('NVDA 算力需求')
        preview = self.preview()
        self.assertEqual(preview['private_context']['positions'][0]['quantity'], 10)
        self.assertEqual(preview['private_context']['positions'][0]['cost'], 12)
        self.assertEqual(preview['private_context']['plans'][0]['targetWeight'], .3)
        self.assertTrue(preview['agent_scope']['memory'])
        self.assertEqual(preview['resolved_instrument_keys'], [KEY])
        self.assertTrue(all(source['classification'] != 'ai_generated' for source in preview['agent_sources']))
        self.assertEqual(preview['request']['position_tickers'], [])

    @unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
    def test_user_cost_assumption_stays_separate_from_original_position_and_ledger(self):
        from app.modules.ai_journal.agent.prompts import initial_messages
        original=copy.deepcopy(self.state)
        preview=self.preview(self.request(instrument_key=KEY,cost=17,cost_currency='USD',quantity=3))
        inputs=json.loads(initial_messages(preview)[-1].content)
        self.assertEqual(inputs['user_assumptions']['cost'],'17')
        self.assertEqual(inputs['user_assumptions']['quantity'],'3')
        self.assertEqual(preview['private_context']['positions'][0]['cost'],12)
        self.assertEqual(preview['private_context']['positions'][0]['quantity'],10)
        self.assertEqual(self.state,original)

    def test_automatic_scope_honors_privacy_and_edit_new_position_revocation(self):
        note = self.note('NVDA 买入理由')
        preview = self.preview()
        private_access(preview, self.store, state_loader=lambda: self.state)
        self.store.save_note('NVDA 修改', note)
        with self.assertRaises(AccessRevoked): private_access(preview, self.store, state_loader=lambda: self.state)
        preview = self.preview()
        changed = copy.deepcopy(self.state)
        changed['stockPool'].append('OTHER')
        changed['trades'].append({**STATE['trades'][0], 'ticker': 'OTHER', 'id': 'new-position'})
        with self.assertRaises(AccessRevoked): private_access(preview, self.store, state_loader=lambda: changed)
        self.state['privacyMode'] = 'local-only'
        with self.assertRaises(HTTPException): self.preview()

    def test_unified_identity_ambiguous_requires_clarification(self):
        self.assertEqual(conversation_targets(self.board, self.request()), [KEY])
        second = self.board.items[KEY].model_copy(update={'key': 'US:XNYS:NVDA:STOCK', 'exchange': 'XNYS'})
        self.board.items[second.key] = second
        with self.store.connect() as db: db.execute('insert into board_instruments values (?)', (second.key,))
        with self.assertRaises(HTTPException) as error: conversation_targets(self.board, self.request())
        self.assertEqual(error.exception.detail['code'], 'instrument_identity_ambiguous')
        self.assertEqual(conversation_targets(self.board, self.request(instrument_key=KEY)), [KEY])

    def test_currency_exposure_cost_weights_and_missing_prices(self):
        first, second = self.position(), self.position('US:XNAS:TSLA:STOCK', quantity=5, cost=8)
        result = portfolio_exposure([first, second], [self.quote(), self.quote(second.payload['instrument_key'], 20)])
        group = result['groups'][0]
        self.assertEqual(group['market_value'], '300')
        self.assertEqual(group['holding_cost'], '160')
        self.assertEqual(group['positions'][0]['holding_cost'], '120')
        self.assertAlmostEqual(float(group['positions'][0]['weight_within_currency']), 2/3)
        missing = portfolio_exposure([first, second], [self.quote()])['groups'][0]
        self.assertIsNone(missing['market_value'])
        self.assertTrue(all(row['weight_within_currency'] is None for row in missing['positions']))
        cny = self.position('CN:XSHG:510300:ETF', 'CNY')
        mixed = portfolio_exposure([first, cny], [self.quote(), self.quote(cny.payload['instrument_key'], 5)])
        self.assertEqual(len(mixed['groups']), 2)
        self.assertIsNone(mixed['total_across_currencies'])
        self.assertIsNone(mixed['cash'])

    @unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
    def test_tool_requires_observed_sources_and_records_calculation_parents(self):
        async def check():
            position, quote = self.position(), self.quote()
            scope = {'positions': True, 'plans': False, 'memory': False, 'memory_source_ids': [],
                'instrument_keys': [KEY], 'periods_by_key': {KEY: ['1d']}, 'refresh_market': False}
            snapshot = {'agent_scope': scope, 'agent_sources': [row.model_dump(mode='json') for row in (position, quote)]}
            book = EvidenceBook()
            executor = ToolExecutor(make_tools(book=book, scope=scope, **frozen_ports(snapshot, lambda: None)), book, Budget(), lambda: None)
            args = {'position_source_ids': [position.id], 'quote_source_ids': [quote.id]}
            async def execute(name, args):
                return json.loads(await executor.invoke({'name': name, 'args': args}))
            failed = await execute('calculate_portfolio_exposure', args)
            self.assertFalse(failed['ok'])
            await execute('read_portfolio_snapshot', {})
            await execute('get_market_facts', {'instrument_key': KEY})
            result = await execute('calculate_portfolio_exposure', args)
            self.assertTrue(result['ok'])
            derived = next(row for row in book.rows.values() if row.kind == 'calculation')
            self.assertEqual(derived.input_source_ids, [position.id, quote.id])
            unavailable = await execute('get_news_and_fundamentals', {'instrument_key': KEY})
            self.assertTrue(unavailable['ok'])
            self.assertIn('unavailable', str(unavailable))
        asyncio.run(check())

    def test_read_only_recovery_sources_and_minimal_followup_history(self):
        preview = self.preview()
        agent = AgentStore(self.store)
        request = ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='synthetic-recovery')
        created = agent.create(request, preview, 'synthetic', None)
        self.assertEqual(self.store.session_for_snapshot(preview['id'])['id'], created['session_id'])
        token = agent.claim_queued(created['run_id'])
        source = self.position()
        report = Report(summary='synthetic answer', stance='observe', facts=[{'text': 'synthetic', 'source_ids': [source.id]}],
            interpretations=[], risks=[], missing=[], next_questions=[])
        agent.finish(created['run_id'], token, report, 'synthetic prior answer', [source], [], {})
        self.assertEqual(agent.sources(created['run_id'])[0]['id'], source.id)
        followup = self.preview(self.request(session_id=created['session_id']))
        self.assertEqual(followup['agent_history'][0]['answer'], 'synthetic prior answer')
        self.assertEqual(followup['agent_history'][0]['classification'], 'ai_generated')
        self.assertTrue(all(source['kind'] != 'history' for source in followup['agent_sources']))
        with self.store.connect() as db: self.assertEqual(db.execute('select count(*) from ai_journal_turns').fetchone()[0], 1)

    def test_archived_source_deletion_is_metadata_not_snapshot_mutation(self):
        note_id = self.note('NVDA 合成原文')
        preview = self.preview()
        frozen = next(source for source in preview['agent_sources'] if source['kind'] == 'note')
        from app.modules.ai_journal.agent.contracts import Evidence
        source = Evidence.model_validate(frozen)
        agent = AgentStore(self.store)
        confirmation = ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='synthetic-deletion')
        created = agent.create(confirmation, preview, 'synthetic', None)
        token = agent.claim_queued(created['run_id'])
        report = Report(summary='synthetic', stance='observe', facts=[{'text':'synthetic','source_ids':[source.id]}],
            interpretations=[], risks=[], missing=[], next_questions=[])
        agent.finish(created['run_id'], token, report, 'synthetic', [source], [], {})
        self.store.delete_note(note_id)
        saved = agent.sources(created['run_id'])[0]
        self.assertTrue(saved['original_deleted'])
        self.assertEqual(saved['payload'], source.payload)
        self.assertEqual(self.store.snapshot(preview['id'])[1], preview['digest'])
