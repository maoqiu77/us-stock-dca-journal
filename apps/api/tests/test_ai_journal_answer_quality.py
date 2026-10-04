from __future__ import annotations

import json
import time
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from app.modules.ai_journal.agent.answer_quality import normalize_report, review_issues, review_messages, answer_size
from app.modules.ai_journal.agent.contracts import EvidenceBook, Report, make_evidence
from app.modules.ai_journal.agent.research import extract_article, validated_keywords
from app.modules.ai_journal.agent.research_plan import research_plan
from app.modules.ai_journal.agent.runtime import Budget, ToolExecutor, ModelOutcomeUnknown
from app.modules.ai_journal.agent.tools import make_tools
from app.modules.ai_journal.agent.model import runtime_available

KEY = 'US:XNAS:SMCI:STOCK'
NOW = datetime.now(timezone.utc)


def source(kind='news', **updates):
    payload = {'instrument_key': KEY, 'title': 'SMCI expands NetApp partnership', 'url': 'https://finance.yahoo.com/news/fixture',
        'publisher': 'Fixture', 'reading_scope': 'headline_only', 'published_at': NOW.isoformat(), 'fetched_at': NOW.isoformat(), **updates}
    return make_evidence(kind, KEY, 'fixture', payload, NOW, NOW)


def report(sid, text='合作消息仍需核实订单转化', **updates):
    return Report.model_validate({'summary': text, 'stance': 'observe', 'facts': [{'text': text, 'source_ids': [sid]}],
        'interpretations': [], 'risks': [], 'missing': [], 'next_questions': [], **updates})


class QualityChecksTest(unittest.TestCase):
    def test_decision_intent_and_followup_override(self):
        cases = [
            ('SMCI明后天还能涨吗，简短回答', 'price_outlook', False),
            ('我已经持有SMCI，成本是30，要不要卖？', 'portfolio', True),
            ('SMCI现在适合买入吗', 'entry_exit', False),
            ('比较SMCI和NVDA，哪个适合长期持有', 'comparison', False),
            ('核实SMCI的订单消息是真的吗', 'fact_check', False),
            ('解释一下量比是什么意思', 'explanation', False),
        ]
        for question, intent, portfolio in cases:
            with self.subTest(question=question):
                plan = research_plan(question)
                self.assertEqual(plan['intent'], intent)
                self.assertEqual(plan['portfolio_relevant'], portfolio)
        prior = research_plan(cases[0][0])
        self.assertEqual(research_plan('再核实一下订单', prior)['horizon'], 'short_term')
        self.assertEqual(research_plan('长期持有呢', prior)['horizon'], 'long_term')
        self.assertEqual(research_plan('TSLA能买吗', prior)['horizon'], 'general')
        self.assertEqual(research_plan('那按我的情况呢', prior)['intent'], 'portfolio')
        self.assertEqual(prior['answer_contract']['target_characters'], 400)

    def test_public_refinement_cannot_use_private_or_unobserved_text(self):
        row = source()
        self.assertEqual(validated_keywords(['NetApp'], row, KEY), ['NetApp'])
        self.assertEqual(validated_keywords(['订单转化'], source(title='公司订单转化仍待确认'), KEY), ['订单转化'])
        for terms, basis, key in [(['my cost is 30'], row, KEY), (['NetApp'], None, KEY),
                                  (['NetApp'], source('note'), KEY), (['NetApp'], row, 'US:XNAS:NVDA:STOCK'),
                                  (['site:private'], row, KEY), (['ci'], row, KEY)]:
            with self.assertRaises(ValueError):
                validated_keywords(terms, basis, key)

    def test_context_keeps_qualification_next_to_matching_claim(self):
        raw = ('<article><p>' + 'Unrelated background. '*100 + '</p>'
               '<p>The following is a forecast, not confirmed orders.</p>'
               '<p>Gross margin may recover to 15%.</p>'
               '<p>This assumes no additional production delays.</p></article>').encode()
        result = extract_article(raw, 'margins')
        text = ' '.join(result['excerpts'])
        self.assertIn('not confirmed orders', text)
        self.assertIn('assumes no additional production delays', text)

    def test_exact_dedup_preserves_distinct_numbers_and_all_citations(self):
        draft = report('a', facts=[{'text': '订单仍需核实。', 'source_ids': ['a']}],
            interpretations=[{'text': '订单仍需核实', 'source_ids': ['b']}],
            risks=[{'text': '毛利率为15%', 'source_ids': ['a']}, {'text': '毛利率为16%', 'source_ids': ['b']}])
        draft = Report.model_validate(draft.model_dump())
        result = normalize_report(draft)
        self.assertEqual(result.interpretations, [])
        self.assertEqual(result.facts[0].source_ids, ['a', 'b'])
        self.assertEqual(len(result.risks), 2)
        self.assertEqual(len(draft.interpretations), 1)

    def test_claim_review_flags_headline_metrics_and_unrelated_holdings(self):
        book, row = EvidenceBook(), source()
        book.add_batch([row], NOW)
        draft = report(row.id, '已确认600亿订单，上涨概率80%；你的持仓应该加仓')
        issues = review_issues(draft, book, research_plan('SMCI明天会涨吗'))
        self.assertTrue(any('标题' in item for item in issues))
        self.assertTrue(any('概率' in item for item in issues))
        self.assertTrue(any('无关持仓' in item for item in issues))

    @unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
    def test_review_compacts_transcript_without_losing_cited_document(self):
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
        from app.modules.ai_journal.agent.graph import model_input_bytes
        row = source('document', reading_scope='excerpts', excerpts=['The company has not confirmed purchase orders.'])
        book = EvidenceBook()
        book.add_batch([row], NOW)
        messages = [SystemMessage(content='fixture rules'), HumanMessage(content=json.dumps({'question': '订单是真的吗', 'task_type': 'conversation'})),
                    AIMessage(content='', tool_calls=[{'id': 'old-tool', 'name': 'read_research_document', 'args': {}}]),
                    ToolMessage(content='irrelevant repeated discovery '*3000, tool_call_id='old-tool')]
        compact = review_messages(messages, report(row.id), book, research_plan('订单是真的吗'))
        self.assertLess(model_input_bytes(compact, []), 10000)
        self.assertIn(row.id, compact[-1].content)
        self.assertIn('not confirmed purchase orders', compact[-1].content)
        self.assertNotIn('irrelevant repeated discovery', compact[-1].content)
        self.assertIn('订单是真的吗', compact[-1].content)


@unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
class QualityGraphTest(unittest.IsolatedAsyncioTestCase):
    async def test_single_stock_position_query_excludes_other_holdings(self):
        other = 'US:XNAS:NVDA:STOCK'
        positions = [source('position'), source('position', instrument_key=other)]
        async def read(*_):
            return positions
        scope = {'instrument_keys': [KEY, other], 'positions': True, 'plans': False, 'memory': False,
                 'periods_by_key': {KEY: ['1d'], other: ['1d']}}
        book = EvidenceBook()
        executor = ToolExecutor(make_tools(book=book, scope=scope, read_private=read, read_market=read,
            read_series=read, search_memory=read), book, Budget(), lambda: None)
        result = json.loads(await executor.invoke({'name': 'read_portfolio_snapshot', 'args': {'instrument_key': KEY}}))
        self.assertEqual(result['data']['coverage'], 'requested_instrument_only')
        self.assertEqual([row['instrument_key'] for row in result['data']['positions']], [KEY])
        self.assertEqual(len(book.rows), 1)
        self.assertFalse(json.loads(await executor.invoke({'name': 'read_portfolio_snapshot', 'args': {'instrument_key': 'forged'}}))['ok'])

    def runtime(self):
        row, book = source(), EvidenceBook()
        book.add_batch([row], NOW)
        research = SimpleNamespace(search=Mock(return_value=[row.payload]), filings=Mock(return_value=[]),
            read=Mock(return_value={**row.payload, 'reading_scope': 'excerpts', 'status': 'available',
                'focus': 'orders', 'excerpts': ['The partnership does not represent confirmed orders.']}))
        async def empty(*_):
            return []
        scope = {'instrument_keys': [KEY], 'positions': False, 'plans': False, 'memory': False,
                 'periods_by_key': {KEY: ['1d']}, 'public_research': True}
        budget = Budget(max_model_calls=7, max_tool_calls=14, max_external_tools=8, max_input_bytes=56000, max_reserved_units=420000)
        executor = ToolExecutor(make_tools(book=book, scope=scope, read_private=empty, read_market=empty,
            read_series=empty, search_memory=empty, research=research), book, budget, lambda: None)
        return row, book, research, budget, executor

    async def graph(self, model, book, budget, executor):
        from app.modules.ai_journal.agent.graph import build_graph
        graph = build_graph(model_call=model, book=book, budget=budget, executor=executor,
            check_access=lambda: None, research_plan=research_plan('SMCI的订单是真的吗？简短说'))
        return await graph.ainvoke({'messages': [], 'result': None, 'repair_count': 0, 'stop_code': ''})

    async def test_review_can_read_original_then_correct_unsupported_draft_once(self):
        from langchain_core.messages import AIMessage
        row, book, research, budget, executor = self.runtime()
        calls = []
        async def model(messages, tools):
            calls.append(1)
            if len(calls) == 1:
                return AIMessage(content=report(row.id, '已确认600亿订单').model_dump_json())
            if len(calls) == 2:
                self.assertIn('仅引用标题', messages[-1].content)
                return AIMessage(content='', tool_calls=[{'id': 'read-for-review', 'name': 'read_research_document',
                    'args': {'source_id': row.id, 'focus': 'orders'}}])
            self.assertEqual(tools, [])
            sid = json.loads(messages[-2].content)['data']['source_id']
            return AIMessage(content=report(sid, '原文仅说明合作，不代表已确认订单').model_dump_json())
        result = await self.graph(model, book, budget, executor)
        self.assertEqual(result['stop_code'], 'completed')
        self.assertNotIn('600亿', result['result']['summary'])
        self.assertEqual(budget.model_calls, 3)
        self.assertEqual(budget.answer_review, 'completed')
        self.assertEqual(research.read.call_count, 1)
        self.assertEqual(executor.events[-1]['tool'], 'review_answer')
        self.assertTrue(result['review_requested'])

    async def test_repeated_search_reuses_id_and_refinement_reaches_provider(self):
        row, book, research, _, executor = self.runtime()
        response = json.loads(await executor.invoke({'name': 'search_public_news', 'args': {
            'instrument_key': KEY, 'topic': 'orders', 'keywords': ['NetApp'], 'basis_source_id': row.id}}))
        self.assertEqual(research.search.call_args.args, (KEY, 'orders', ['NetApp']))
        self.assertEqual(response['data']['new_source_count'], 0)
        self.assertEqual(response['data']['items'][0]['source_id'], row.id)
        self.assertEqual(len(book.rows), 1)
        denied = json.loads(await executor.invoke({'name': 'search_public_news', 'args': {
            'instrument_key': KEY, 'keywords': ['my account 1234'], 'basis_source_id': row.id}}))
        self.assertFalse(denied['ok'])
        self.assertEqual(research.search.call_count, 1)

    async def test_review_timeout_is_not_replayed_or_marked_completed(self):
        from langchain_core.messages import AIMessage
        row, book, _, budget, executor = self.runtime()
        count = 0
        async def model(*_):
            nonlocal count
            count += 1
            if count == 1:
                return AIMessage(content=report(row.id).model_dump_json())
            raise TimeoutError('fixture')
        with self.assertRaises(ModelOutcomeUnknown):
            await self.graph(model, book, budget, executor)
        self.assertEqual(count, 2)
        self.assertEqual(budget.answer_review, 'in_progress')
        self.assertFalse(any(event['tool'] == 'review_answer' for event in executor.events))

    async def test_low_budget_does_not_claim_review_happened(self):
        from langchain_core.messages import AIMessage
        row, book, _, budget, executor = self.runtime()
        budget.deadline = time.monotonic() + 5
        async def model(*_):
            return AIMessage(content=report(row.id).model_dump_json())
        result = await self.graph(model, book, budget, executor)
        self.assertEqual(result['stop_code'], 'completed')
        self.assertEqual(budget.answer_review, 'skipped_budget')
        self.assertEqual(budget.model_calls, 1)

    async def test_overlong_review_gets_only_one_bounded_compression(self):
        from langchain_core.messages import AIMessage
        row, book, _, budget, executor = self.runtime()
        count = 0
        async def model(messages, tools):
            nonlocal count
            count += 1
            if count <= 2:
                return AIMessage(content=report(row.id, '本轮仅有合作报道，订单仍待核实。'*35).model_dump_json())
            self.assertEqual(tools, [])
            self.assertTrue(any('仅做一次精简' in message.content for message in messages[-2:]))
            return AIMessage(content=report(row.id).model_dump_json())
        result = await self.graph(model, book, budget, executor)
        self.assertEqual(result['stop_code'], 'completed')
        self.assertEqual(count, 3)
        self.assertEqual(result['style_repair_count'], 1)
        self.assertLess(answer_size(Report.model_validate(result['result'])), 400)
        self.assertEqual(sum(event['tool'] == 'review_answer' for event in executor.events), 1)

    async def test_late_review_reserves_last_call_for_validation_repair(self):
        from langchain_core.messages import AIMessage
        row, book, _, budget, executor = self.runtime()
        budget.model_calls = 4
        count = 0
        async def model(messages, tools):
            nonlocal count
            count += 1
            if count == 1:
                return AIMessage(content=report(row.id).model_dump_json())
            self.assertEqual(tools, [])
            if count == 2:
                return AIMessage(content=report('unobserved-source').model_dump_json())
            return AIMessage(content=report(row.id).model_dump_json())
        result = await self.graph(model, book, budget, executor)
        self.assertEqual(result['stop_code'], 'completed')
        self.assertEqual(budget.model_calls, 7)
        self.assertEqual(budget.answer_review, 'completed')
        self.assertEqual(budget.report_validation_errors, [{'call': 6, 'errors': [
            {'type': 'citation_not_observed_or_ungrounded_stance'}]}])
