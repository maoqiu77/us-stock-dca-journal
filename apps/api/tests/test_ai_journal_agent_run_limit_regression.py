from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
import unittest

from app.modules.ai_journal.agent.contracts import EvidenceBook, make_evidence
from app.modules.ai_journal.agent.memory import memory_view
from app.modules.ai_journal.agent.model import runtime_available
from app.modules.ai_journal.agent.runtime import Budget, ToolExecutor, ToolResult, ToolSpec
from app.modules.ai_journal.agent.tools import MemoryQuery

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / 'storage/templates/ai-journal-agent-run-limit-regression.json'
EXPANDED = ROOT / 'storage/templates/ai-journal-agent-expanded-holdout.json'
OTHER_SEMANTIC_FIXTURES = (
    ROOT / 'storage/templates/ai-journal-agent-evaluation.json',
    ROOT / 'storage/templates/ai-journal-agent-phase7-heldout.json',
    ROOT / 'storage/templates/ai-journal-agent-release-semantic-v2.json',
)


def _old_originals():
    paths = (EXPANDED,) + OTHER_SEMANTIC_FIXTURES
    return [original for path in paths for original in json.loads(path.read_text(encoding='utf-8')).get('originals', [])]


@unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
class RunLimitRegressionTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dataset = json.loads(FIXTURE.read_text(encoding='utf-8'))

    def test_fixture_is_new_and_covers_the_four_failed_categories(self):
        originals = self.dataset['originals']
        cases = self.dataset['cases']
        old = _old_originals()
        self.assertEqual(self.dataset['split'], 'agent-run-limit-regression-v1')
        self.assertTrue(self.dataset['synthetic'])
        self.assertEqual({case['category'] for case in cases}, {
            'business_conditions', 'note_time', 'contradictory_sources', 'multiple_sources'})
        self.assertEqual(len(cases), 4)
        self.assertEqual(len({row['id'] for row in originals}), len(originals))
        self.assertTrue({row['id'] for row in originals}.isdisjoint({row['id'] for row in old}))
        self.assertTrue({row['text'] for row in originals}.isdisjoint({row['text'] for row in old}))
        original_ids = {row['id'] for row in originals}
        for case in cases:
            with self.subTest(case=case['id']):
                self.assertEqual(len(case['source_ids']), 6)
                self.assertTrue(set(case['expected_original_ids']).issubset(case['source_ids']))
                self.assertTrue(set(case['source_ids']).issubset(original_ids))
                self.assertIn(case['category'].replace('_', '-'), case['id'])

    def test_compaction_preserves_distinct_excerpts_from_the_same_original(self):
        from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
        from app.modules.ai_journal.agent.graph import compact_tool_messages

        stamp = datetime.fromisoformat(self.dataset['known_at'])
        first_section = 'ALPHAANCHOR 第一段证据：续约需要签署件。\n' + '甲段填充文字。' * 100
        second_section = 'BETAANCHOR 第二段证据：回款需要银行凭证。\n' + '乙段填充文字。' * 100
        self.assertGreater(len(first_section.encode()), 1000)
        self.assertGreater(len(second_section.encode()), 1000)
        source = make_evidence('note', 'note:distinct-excerpts', '1', {
            'body': first_section + '\n' + second_section,
            'updated_at': stamp.isoformat(),
        }, stamp, stamp)
        views = [memory_view(source, query) for query in ('ALPHAANCHOR', 'BETAANCHOR')]
        self.assertIn('ALPHAANCHOR', views[0]['body'])
        self.assertNotIn('BETAANCHOR', views[0]['body'])
        self.assertIn('BETAANCHOR', views[1]['body'])
        self.assertNotIn('ALPHAANCHOR', views[1]['body'])
        self.assertNotEqual(views[0]['excerpt'], views[1]['excerpt'])
        calls = [{'id': f'excerpt-{index}', 'name': 'search_investment_memory',
                  'args': {'query': query}}
                 for index, query in enumerate(('ALPHAANCHOR', 'BETAANCHOR', 'BETAANCHOR'))]
        source_ref = {'id': source.id, 'kind': source.kind, 'as_of': stamp.isoformat(),
                      'hash': source.content_hash}
        messages = [HumanMessage(content='分别核对续约与回款条件。'),
                    AIMessage(content='', tool_calls=calls)] + [
            ToolMessage(content=json.dumps({'ok': True, 'data': {'matches': [view]},
                                           'sources': [source_ref]}, ensure_ascii=False),
                        tool_call_id=call['id'])
            for call, view in zip(calls, (views[0], views[1], views[1]))]
        original_contents = [message.content for message in messages]

        compacted = compact_tool_messages(messages)
        for candidate in (compacted, compact_tool_messages(compacted)):
            outputs = [message for message in candidate if isinstance(message, ToolMessage)]
            self.assertEqual([message.tool_call_id for message in outputs], [call['id'] for call in calls])
            self.assertEqual(candidate[1].tool_calls, messages[1].tool_calls)
            payloads = [json.loads(message.content) for message in outputs]
            self.assertEqual(payloads[0]['data']['matches'], [views[0]])
            self.assertEqual(payloads[1]['data']['matches'], [views[1]])
            self.assertTrue(payloads[2]['data']['already_observed'])
            self.assertEqual(payloads[2]['data']['source_ids'], [source.id])
            self.assertNotIn('body', outputs[2].content)
            self.assertTrue(all([row['id'] for row in payload['sources']] == [source.id]
                                for payload in payloads))
        self.assertEqual([message.content for message in messages], original_contents)
        self.assertEqual(source.payload['body'], first_section + '\n' + second_section)

    async def test_compacted_cache_hit_keeps_the_first_full_observation(self):
        from langchain_core.messages import AIMessage, ToolMessage
        from app.modules.ai_journal.agent.graph import compact_tool_messages

        stamp = datetime.fromisoformat(self.dataset['known_at'])
        source = make_evidence('note', 'note:cache-observation', '1', {
            'body': 'CACHEANCHOR 银行回单和合同属于两份独立资料。' + '合成填充文字。' * 100,
        }, stamp, stamp)
        view = memory_view(source, 'CACHEANCHOR')
        search_calls = []

        async def search(args):
            search_calls.append(args.query)
            return ToolResult([source], {'matches': [view]})

        book, budget = EvidenceBook(), Budget()
        executor = ToolExecutor([ToolSpec('search_investment_memory', 'Synthetic cached search.',
                                          MemoryQuery, search)], book, budget, lambda: None)
        calls = [{'id': f'cache-{index}', 'name': 'search_investment_memory',
                  'args': {'query': 'CACHEANCHOR'}} for index in range(2)]
        messages = [AIMessage(content='', tool_calls=calls)] + [
            ToolMessage(content=await executor.invoke(call), tool_call_id=call['id']) for call in calls]
        self.assertEqual(search_calls, ['CACHEANCHOR'])
        self.assertEqual([event['status'] for event in executor.events], ['succeeded', 'cached'])
        self.assertEqual(budget.tool_calls, 2)

        compacted = compact_tool_messages(messages)
        for candidate in (compacted, compact_tool_messages(compacted)):
            outputs = [message for message in candidate if isinstance(message, ToolMessage)]
            self.assertEqual([message.tool_call_id for message in outputs], [call['id'] for call in calls])
            payloads = [json.loads(message.content) for message in outputs]
            self.assertEqual(payloads[0]['data']['matches'], [view])
            self.assertEqual(payloads[0]['sources'][0]['id'], source.id)
            self.assertEqual(payloads[1]['data'], {'already_observed': True, 'source_ids': [source.id]})
            self.assertEqual(payloads[1]['sources'][0]['id'], source.id)
            self.assertNotIn('body', outputs[1].content)
        self.assertEqual(book.rows, {source.id: source})

    async def test_each_case_reaches_a_cited_final_answer_after_repeated_search(self):
        """Repeated bounded tool rounds must leave room for the final model call.

        Each fake search returns six long excerpts. Three calls in each of two
        rounds intentionally reproduce the growing tool transcript that caused
        the frozen cohort's third model call to return the run-limit sentinel.
        """
        from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
        from app.modules.ai_journal.agent.graph import build_graph

        stamp = datetime.fromisoformat(self.dataset['known_at'])
        by_id = {row['id']: row for row in self.dataset['originals']}
        padding = (' ' + self.dataset['context_padding']) * 20
        rounds = self.dataset['tool_rounds']
        calls_per_round = self.dataset['tool_calls_per_round']

        for case in self.dataset['cases']:
            with self.subTest(case=case['id']):
                rows = [make_evidence(
                    'note', 'note:' + original_id, '1',
                    {'body': by_id[original_id]['text'] + padding}, stamp, stamp)
                    for original_id in case['source_ids']]
                book = EvidenceBook()
                budget = Budget()

                async def search(args, rows=rows):
                    # Distinct query keys keep these calls out of the executor
                    # cache; graph-level transcript compaction must handle the
                    # repeated evidence as the production model did.
                    return ToolResult(rows, {'matches': [memory_view(row, args.query) for row in rows]})

                executor = ToolExecutor([
                    ToolSpec('search_investment_memory', 'Search only the frozen synthetic originals.',
                             MemoryQuery, search)
                ], book, budget, lambda: None)
                model_calls = 0

                async def model(_messages, _tools, case=case, rows=rows):
                    nonlocal model_calls
                    model_calls += 1
                    if model_calls == rounds + 1:
                        tool_payloads = [json.loads(message.content) for message in _messages
                                         if isinstance(message, ToolMessage)]
                        self.assertTrue(any(isinstance(payload.get('data'), dict)
                                            and payload['data'].get('matches') for payload in tool_payloads))
                        self.assertTrue(any('already_observed' in message.content
                                            for message in _messages if isinstance(message, ToolMessage)))
                    if model_calls <= rounds:
                        tool_calls = [{
                            'id': f"{case['id']}-round-{model_calls}-call-{index}",
                            'name': 'search_investment_memory',
                            'args': {'query': f"{case['tool_query']} round-{model_calls}-call-{index}"},
                        } for index in range(calls_per_round)]
                        return AIMessage(content='', tool_calls=tool_calls,
                                         usage_metadata={'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2})
                    cited = [row.id for row in rows[:len(case['expected_original_ids'])]]
                    answer = {
                        'summary': '合成回归证据已读取。',
                        'stance': 'observe',
                        'facts': [{'text': '已读取本案所需原始资料。', 'source_ids': cited}],
                        'interpretations': [], 'risks': [], 'missing': [], 'next_questions': [],
                    }
                    return AIMessage(content=json.dumps(answer, ensure_ascii=False),
                                     usage_metadata={'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2})

                state = await build_graph(
                    model_call=model, book=book, budget=budget, executor=executor,
                    check_access=lambda: None,
                ).ainvoke({
                    'messages': [HumanMessage(content=case['question'])],
                    'result': None, 'repair_count': 0, 'stop_code': '',
                }, {'recursion_limit': 32})
                self.assertEqual(state['stop_code'], 'completed')
                self.assertNotEqual(state['result']['missing'], ['已达到运行上限。'])
                self.assertEqual(model_calls, rounds + 1)
                self.assertEqual(budget.model_calls, rounds + 1)
                self.assertEqual(budget.tool_calls, rounds * calls_per_round)
                self.assertEqual(sum(event['status'] == 'cached' for event in executor.events), 0)
                self.assertEqual(sum(event['status'] == 'succeeded' for event in executor.events),
                                 rounds * calls_per_round)
                self.assertTrue(set(state['result']['facts'][0]['source_ids']).issubset(book.rows))
