from __future__ import annotations

from contextlib import redirect_stdout
from datetime import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

from app.core import database, settings as core
from app.modules.ai_journal.agent.model import runtime_available

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
class SemanticHarnessTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('semantic_harness', ROOT / 'scripts/verify_ai_journal_deepseek.py')
        self.harness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.harness)
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        (self.home / 'storage/local').mkdir(parents=True)
        self.paths = database.DB_PATH, core.DB_PATH, core.DATA_HOME
        database.DB_PATH = core.DB_PATH = self.home / 'original.db'
        core.DATA_HOME = self.home
        database.init_db()
        from app.modules.ai_settings import save_ai_settings
        from app.modules.ai_journal.agent.store import AgentStore
        from app.modules.ai_journal.store import JournalStore
        from app.modules.ai_journal.service import model_fingerprint
        settings = save_ai_settings({'provider':'deepseek', 'protocol':'chat/completions',
            'complexModel':'deepseek-flash', 'baseUrl':'https://api.deepseek.com/v1', 'apiKey':'synthetic-key'})
        AgentStore(JournalStore()).save_capability({'model_fingerprint':model_fingerprint(settings),
            'endpoint':'chat/completions', 'adapter_version':'deepseek-chat-v1', 'tool_calling':True,
            'verification':'real_provider', 'verified_at':'2026-10-01T00:00:00+00:00'})

    def tearDown(self):
        database.DB_PATH, core.DB_PATH, core.DATA_HOME = self.paths
        self.temp.cleanup()

    def run_harness(self, factory, post, limit=9, mode='--semantic-retest'):
        with patch.object(self.harness, 'ROOT', self.home), \
             patch.object(sys, 'argv', ['verify', '--real', mode, '--request-limit', str(limit)]), \
             patch.dict(os.environ), \
             patch('app.modules.ai_journal.agent.model.build_agent_model', factory), \
             patch('app.modules.ai_journal.agent.model.probe', side_effect=AssertionError('no repeated probe')), \
             patch('app.modules.ai_settings.requests.post', post), \
             patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
             redirect_stdout(io.StringIO()):
            self.harness.main()

    def receipt(self):
        return json.loads(next((self.home / 'storage/local').glob('deepseek-verification-*/verification.json')).read_text())

    def semantic_module(self):
        spec = importlib.util.spec_from_file_location('answer_review_harness', ROOT / 'scripts/verify_ai_journal_semantics.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.ROOT = self.home
        return module

    def test_heldout_prepare_uses_production_freezing_with_zero_requests(self):
        module = self.semantic_module()
        dataset = json.loads(module.DATASET.read_text())
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
            patch('app.modules.ai_journal.agent.model.build_agent_model', side_effect=AssertionError('no model')), \
            patch('app.modules.ai_journal.agent.model.probe', side_effect=AssertionError('no probe')):
            result = module.verify(dataset)
        self.assertEqual(len(result['cases']), 22)
        self.assertEqual(result['requests_reserved'], 0)
        self.assertEqual(result['status'], 'prepared_no_requests')
        self.assertTrue(result['closed'])
        self.assertFalse(result['real_model_tested'])
        self.assertTrue(all(row['semantic_pass'] is None for row in result['cases']))

    def test_heldout_unknown_agent_stops_before_legacy_or_next_case(self):
        module = self.semantic_module()
        dataset = json.loads(module.DATASET.read_text())
        def factory(*_):
            async def call(*_): raise TimeoutError('synthetic')
            return call
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
            patch('app.modules.ai_journal.agent.model.build_agent_model', factory), \
            patch('app.modules.ai_settings.requests.post', side_effect=AssertionError('no legacy')):
            result = module.verify(dataset, real=True)
        self.assertEqual(result['requests_reserved'], 1)
        self.assertEqual(result['status'], 'stopped_no_replay')
        self.assertEqual(len(result['cases']), 1)
        self.assertEqual(set(result['cases'][0]['engines']), {'agent'})
        self.assertIsNone(result['calls'][0]['usage'])

    def test_pair_admission_does_not_spend_remaining_budget_on_an_incomplete_pair(self):
        module = self.semantic_module()
        dataset = json.loads(module.DATASET.read_text())
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
            patch('app.modules.ai_journal.agent.model.build_agent_model', side_effect=AssertionError('no model')):
            result = module.verify(dataset, real=True, request_limit=4)
        self.assertEqual(result['status'], 'stopped_before_pair_budget')
        self.assertEqual(result['requests_reserved'], 0)
        self.assertEqual(result['cases'], [])

    def test_missing_usage_stops_before_another_agent_request(self):
        module = self.semantic_module()
        dataset = json.loads(module.DATASET.read_text())
        from langchain_core.messages import AIMessage
        observed = []
        def factory(*_):
            async def call(*_):
                observed.append('request')
                return AIMessage(content='', tool_calls=[{'id': 'unmetered',
                    'name': 'search_investment_memory', 'args': {'query': 'IBM'}}])
            return call
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
            patch('app.modules.ai_journal.agent.model.build_agent_model', factory), \
            patch('app.modules.ai_settings.requests.post', side_effect=AssertionError('no legacy')):
            result = module.verify(dataset, real=True)
        self.assertEqual(observed, ['request'])
        self.assertEqual(result['requests_reserved'], 1)
        self.assertTrue(result['closed'])
        self.assertEqual(result['cases'][0]['engines']['agent']['status'], 'failed')

    def test_complete_pairs_use_balanced_order_and_immutable_input_hashes(self):
        module = self.semantic_module()
        dataset = json.loads(module.DATASET.read_text())
        dataset['cases'] = dataset['cases'][:2]
        from langchain_core.messages import AIMessage
        from app.modules.ai_journal.agent.contracts import insufficient
        def factory(*_):
            async def call(*_):
                return AIMessage(content=insufficient('synthetic').model_dump_json(),
                    usage_metadata={'input_tokens': 1, 'output_tokens': 2, 'total_tokens': 3})
            return call
        def post(*_, **__):
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices': [{'message': {'content': 'synthetic'}, 'finish_reason': 'stop'}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 2}}
            return Reply()
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
            patch('app.modules.ai_journal.agent.model.build_agent_model', factory), \
            patch('app.modules.ai_settings.requests.post', post), redirect_stdout(io.StringIO()):
            result = module.verify(dataset, real=True, request_limit=10)
        self.assertEqual(result['status'], 'answers_ready_for_review')
        self.assertEqual([case['engine_order'] for case in result['cases']],
            [['agent', 'legacy_llm'], ['legacy_llm', 'agent']])
        self.assertEqual(set(result['prompt_hashes']), {'agent', 'legacy_llm'})
        for case in result['cases']:
            self.assertTrue(all(output['fixed_input_sha256'] == case['fixed_input_sha256']
                for output in case['engines'].values()))
            self.assertTrue(all(len(output['calls']) == output['requests'] for output in case['engines'].values()))

    def test_heldout_pair_freezes_equal_evidence_and_stops_on_legacy_truncation(self):
        module = self.semantic_module()
        dataset = json.loads(module.DATASET.read_text())
        from langchain_core.messages import AIMessage
        from app.modules.ai_journal.agent.contracts import insufficient
        def factory(*_):
            async def call(*_):
                return AIMessage(content=insufficient('synthetic').model_dump_json(),
                    usage_metadata={'input_tokens': 1, 'output_tokens': 2, 'total_tokens': 3})
            return call
        posts = []
        def post(url, **kwargs):
            posts.append(kwargs)
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices': [{'message': {'content': 'partial'}, 'finish_reason': 'length'}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 8192, 'total_tokens': 8193}}
            return Reply()
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
            patch('app.modules.ai_journal.agent.model.build_agent_model', factory), \
            patch('app.modules.ai_settings.requests.post', post):
            result = module.verify(dataset, real=True)
        self.assertEqual(result['requests_reserved'], 2)
        self.assertEqual(len(result['cases']), 1)
        self.assertEqual(len(posts), 1)
        self.assertEqual(result['status'], 'stopped_no_replay')
        case = result['cases'][0]
        self.assertIsNone(case['semantic_pass'])
        self.assertEqual(case['engines']['legacy_llm']['answer'], '')
        self.assertEqual(case['engines']['legacy_llm']['error_code'], 'model_output_truncated')
        payload = json.loads(posts[0]['json']['messages'][1]['content'])
        self.assertEqual(payload['private_context'], case['fixed_input']['private_context'])

    def test_two_turns_and_legacy_share_evidence_without_claiming_tool_success(self):
        from langchain_core.messages import AIMessage
        from app.modules.ai_journal.agent.contracts import insufficient
        inputs = []
        def factory(*_, **__):
            async def call(messages, tools):
                inputs.append(messages)
                return AIMessage(content=insufficient('synthetic').model_dump_json(),
                    additional_kwargs={'deepseek_message':{'reasoning_content':'ephemeral'}},
                    usage_metadata={'input_tokens':1,'output_tokens':2,'total_tokens':3})
            return call
        posts = []
        def post(url, **kwargs):
            posts.append((url, kwargs))
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices':[{'message':{'content':'synthetic legacy answer'}}],
                    'usage':{'prompt_tokens':1,'completion_tokens':2,'total_tokens':3},'model':'synthetic'}
            return Reply()
        self.run_harness(factory, post)
        result = self.receipt()
        self.assertEqual(result['requests_reserved'], 3)
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][1]['timeout'], 25)
        self.assertEqual(posts[0][1]['json']['max_tokens'], 8192)
        self.assertEqual([row['history_turn_count'] for row in result['cases'][:2]], [0,1])
        self.assertEqual(result['cases'][0]['session_id'], result['cases'][1]['session_id'])
        self.assertTrue(result['cases'][2]['same_frozen_evidence'])
        self.assertFalse(result['execution_checks_passed'])
        self.assertEqual(result['semantic_review'], 'pending')
        self.assertTrue(result['closed'])
        self.assertTrue(result['archive_excludes_reasoning_and_key'])
        self.assertEqual(len(inputs[1]), 4)

    def tool_factory(self, instrument_key):
        from langchain_core.messages import AIMessage, ToolMessage
        def factory(*_, **__):
            count = 0
            async def call(messages, tools):
                nonlocal count
                count += 1
                sources = [row for message in messages if isinstance(message, ToolMessage)
                    for row in json.loads(message.content).get('sources', [])]
                by_kind = {row['kind']: row['id'] for row in sources}
                key = {'instrument_key': instrument_key}
                if count == 1:
                    planned = [('read_portfolio_snapshot', {}), ('read_investment_policy', {}), ('get_market_facts', key)]
                elif count == 2:
                    planned = [('get_price_series', {**key, 'period': '1d'}), ('calculate_portfolio_exposure', {
                        'position_source_ids': [by_kind['position']], 'quote_source_ids': [by_kind['quote']]})]
                elif count == 3:
                    planned = [('calculate_indicators', {'series_source_id': by_kind['series']}),
                        ('search_investment_memory', {'query': instrument_key.split(':')[2]})]
                else:
                    from app.modules.ai_journal.agent.contracts import insufficient
                    content = insufficient('synthetic reviewed separately').model_dump_json()
                    return AIMessage(content=content, additional_kwargs={'deepseek_message': {
                        'role': 'assistant', 'content': content, 'reasoning_content': 'ephemeral'}})
                calls = [{'id': f'call-{count}-{index}', 'name': name, 'args': args}
                    for index, (name, args) in enumerate(planned)]
                raw = {'role': 'assistant', 'content': None, 'reasoning_content': 'ephemeral',
                    'tool_calls': [{'id': row['id'], 'type': 'function', 'function': {
                        'name': row['name'], 'arguments': json.dumps(row['args'])}} for row in calls]}
                return AIMessage(content='', tool_calls=calls, additional_kwargs={'deepseek_message': raw})
            return call
        return factory

    def test_portfolio_pair_runs_real_local_tools_and_identical_frozen_inputs(self):
        factory = self.tool_factory(self.harness.KEY)
        posts = []
        def post(url, **kwargs):
            posts.append(kwargs)
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices': [{'message': {'content': 'synthetic legacy answer'}, 'finish_reason': 'stop'}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 2, 'total_tokens': 3}, 'model': 'synthetic'}
            return Reply()
        self.run_harness(factory, post, limit=5, mode='--portfolio-comparison')
        receipt = self.receipt()
        self.assertEqual(receipt['requests_reserved'], 5)
        self.assertEqual([case['case'] for case in receipt['cases']], ['portfolio', 'legacy_portfolio'])
        self.assertTrue(receipt['execution_checks_passed'])
        self.assertEqual(receipt['cases'][0]['history_turn_count'], 0)
        self.assertTrue(receipt['cases'][1]['same_frozen_evidence'])
        self.assertTrue(receipt['cases'][1]['same_question'])
        self.assertTrue(receipt['archive_excludes_reasoning_and_key'])
        self.assertTrue(receipt['closed'])
        self.assertEqual(receipt['semantic_review'], 'pending')
        payload = json.loads(posts[0]['json']['messages'][1]['content'])
        self.assertEqual(payload['request']['question'], self.harness.PORTFOLIO_QUESTION)
        self.assertEqual(len(next(row['value']['bars'] for row in payload['facts'] if row['kind'] == '已收盘 K 线')), 20)

    def test_closeout_pair_uses_new_fractional_fixture_and_normal_legacy_timeout(self):
        fixture = json.loads(self.harness.CLOSEOUT_FILE.read_text())
        posts = []
        def post(url, **kwargs):
            posts.append(kwargs)
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices': [{'message': {'content': 'synthetic legacy answer'}, 'finish_reason': 'stop'}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 2, 'total_tokens': 3}, 'model': 'synthetic'}
            return Reply()
        self.run_harness(self.tool_factory(fixture['instrument_key']), post, limit=5, mode='--closeout-comparison')
        receipt = self.receipt()
        self.assertEqual(receipt['requests_reserved'], 5)
        self.assertEqual(receipt['fixture_id'], fixture['id'])
        self.assertTrue(receipt['execution_checks_passed'])
        self.assertEqual(posts[0]['timeout'], 120)
        self.assertIsNone(receipt['cases'][-1]['timeout_test_override_seconds'])
        self.assertTrue(receipt['cases'][-1]['same_frozen_evidence'])
        self.assertTrue(receipt['cases'][-1]['same_question'])
        payload = json.loads(posts[0]['json']['messages'][1]['content'])
        self.assertEqual(payload['private_context']['positions'][0]['quantity'], 3.5)
        self.assertEqual(payload['private_context']['positions'][0]['cost'], 7.24)
        series = next(row['value'] for row in payload['facts'] if row['kind'] == '已收盘 K 线')
        self.assertEqual(len(series['bars']), 60)
        self.assertEqual(datetime.fromisoformat(series['bars'][-1]['time']), datetime.fromisoformat(fixture['observation_at']))
        self.assertEqual(receipt['expected']['market_value'], '40.25')
        self.assertEqual(receipt['expected']['holding_cost'], '25.34')
        self.assertEqual(receipt['semantic_review'], 'pending')

    def test_phase7_pair_uses_new_fixture_and_labels_receipt(self):
        fixture = json.loads(self.harness.PHASE7_PAIR_FILE.read_text())
        posts = []
        def post(url, **kwargs):
            posts.append(kwargs)
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices': [{'message': {'content': 'synthetic legacy answer'}, 'finish_reason': 'stop'}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 2, 'total_tokens': 3}, 'model': 'synthetic'}
            return Reply()
        self.run_harness(self.tool_factory(fixture['instrument_key']), post, limit=5, mode='--phase7-paired')
        receipt = self.receipt()
        self.assertEqual(receipt['requests_reserved'], 5)
        self.assertEqual(receipt['test'], 'phase7_paired_comparison')
        self.assertEqual(receipt['fixture_id'], fixture['id'])
        self.assertTrue(receipt['execution_checks_passed'])
        self.assertEqual(posts[0]['timeout'], 120)
        payload = json.loads(posts[0]['json']['messages'][1]['content'])
        self.assertEqual(payload['private_context']['positions'][0]['quantity'], 2.75)
        self.assertEqual(payload['private_context']['positions'][0]['cost'], 13.16)
        series = next(row['value'] for row in payload['facts'] if row['kind'] == '已收盘 K 线')
        self.assertEqual(len(series['bars']), 40)
        self.assertEqual(receipt['expected']['market_value'], '50.60')
        self.assertEqual(receipt['expected']['holding_cost'], '36.19')

    def test_prepare_closeout_sends_no_requests_or_probe(self):
        with patch.object(self.harness, 'ROOT', self.home), patch.object(sys, 'argv', [
            'verify', '--prepare-only', '--closeout-comparison', '--request-limit', '5']), patch.dict(os.environ), \
            patch('app.modules.ai_journal.agent.model.build_agent_model', side_effect=AssertionError('no model')), \
            patch('app.modules.ai_journal.agent.model.probe', side_effect=AssertionError('no probe')), \
            patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), redirect_stdout(io.StringIO()):
            self.harness.main()
        receipt = self.receipt()
        self.assertEqual(receipt['requests_reserved'], 0)
        self.assertEqual(receipt['calls'], [])
        self.assertEqual(receipt['fixture_id'], 'phase6-closeout-msft-fractional-60-v1')

    def test_release_pair_uses_a_fresh_fixture_and_production_legacy_budget(self):
        fixture = json.loads(self.harness.RELEASE_PAIR_FILE.read_text())
        previous = json.loads(self.harness.PHASE7_PAIR_FILE.read_text())
        self.assertNotEqual(fixture['id'], previous['id'])
        self.assertNotEqual(fixture['instrument_key'], previous['instrument_key'])
        posts = []
        def post(url, **kwargs):
            posts.append(kwargs)
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices': [{'message': {'content': 'synthetic'}, 'finish_reason': 'stop'}]}
            return Reply()
        self.run_harness(self.tool_factory(fixture['instrument_key']), post, limit=5, mode='--release-paired')
        result = self.receipt()
        self.assertEqual(result['test'], 'release_paired_comparison')
        self.assertTrue(result['execution_checks_passed'])
        self.assertEqual(posts[0]['json']['max_tokens'], 8192)
        self.assertEqual(posts[0]['json']['reasoning_effort'], 'low')
        self.assertEqual(result['output_limit_per_request'], 6144)
        self.assertEqual(result['legacy_output_limit'], 8192)
        self.assertIsNone(result['cases'][-1]['output_limit_test_override'])
        payload = json.loads(posts[0]['json']['messages'][1]['content'])
        series = next(row['value'] for row in payload['facts'] if row['kind'] == '已收盘 K 线')
        quote = next(row['value']['price'] for row in payload['facts'] if row['kind'] == '交易报价')
        self.assertEqual(float(series['bars'][-1]['close']), quote)

    def test_truncated_legacy_pair_closes_admission_and_is_not_a_valid_answer(self):
        fixture = json.loads(self.harness.RELEASE_PAIR_FILE.read_text())
        posts = []
        def post(url, **kwargs):
            posts.append(kwargs)
            class Reply:
                def raise_for_status(self): pass
                def json(self): return {'choices': [{'message': {'content': 'partial'}, 'finish_reason': 'length'}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 8192, 'total_tokens': 8193}}
            return Reply()
        self.run_harness(self.tool_factory(fixture['instrument_key']), post, limit=5, mode='--release-paired')
        result = self.receipt()
        self.assertEqual(len(posts), 1)
        self.assertEqual(result['status'], 'stopped_no_replay')
        self.assertTrue(result['closed'])
        self.assertFalse(result['execution_checks_passed'])
        self.assertEqual(result['cases'][-1]['error_code'], 'model_output_truncated')
        self.assertEqual(result['calls'][-1]['usage']['completion_tokens'], 8192)

    def test_portfolio_unknown_stops_before_legacy(self):
        def factory(*_, **__):
            async def call(*_): raise TimeoutError('synthetic interruption')
            return call
        with self.assertRaises(SystemExit):
            self.run_harness(factory, lambda *_, **__: self.fail('legacy must not run'),
                limit=5, mode='--portfolio-comparison')
        receipt = self.receipt()
        self.assertEqual(receipt['requests_reserved'], 1)
        self.assertEqual(receipt['cases'][0]['status'], 'outcome_unknown')
        self.assertEqual(len(receipt['cases']), 1)
        self.assertTrue(receipt['closed'])

    def test_legacy_timeout_is_unknown_and_never_repeated(self):
        from langchain_core.messages import AIMessage
        from app.modules.ai_journal.agent.contracts import insufficient
        import requests
        def factory(*_, **__):
            async def call(*_):
                content = insufficient('synthetic').model_dump_json()
                return AIMessage(content=content, additional_kwargs={'deepseek_message': {
                    'role': 'assistant', 'content': content}})
            return call
        posts = []
        def post(*_, **__):
            posts.append(1)
            raise requests.ReadTimeout('synthetic response unknown')
        self.run_harness(factory, post, limit=5, mode='--portfolio-comparison')
        receipt = self.receipt()
        self.assertEqual(posts, [1])
        self.assertEqual(receipt['requests_reserved'], 2)
        self.assertEqual(receipt['calls'][-1]['outcome'], 'outcome_unknown')
        self.assertEqual(receipt['calls'][-1]['error_type'], 'ReadTimeout')
        self.assertNotIn('usage', receipt['calls'][-1])
        self.assertEqual(receipt['cases'][-1]['transport_outcome'], 'outcome_unknown')
        self.assertFalse(receipt['cases'][-1]['usage_complete'])
        self.assertEqual(receipt['status'], 'stopped_no_replay')
        self.assertTrue(receipt['closed'])

    def test_unknown_first_run_closes_all_followup_and_legacy_admission(self):
        calls = []
        def factory(*_, **__):
            async def call(*_): calls.append(1);raise TimeoutError('synthetic interruption')
            return call
        with self.assertRaises(SystemExit):
            self.run_harness(factory, lambda *_, **__: self.fail('legacy must not run after unknown'))
        result = self.receipt()
        self.assertEqual(calls, [1])
        self.assertEqual(result['requests_reserved'], 1)
        self.assertTrue(result['closed'])
        self.assertEqual(result['cases'][0]['status'], 'outcome_unknown')
        self.assertEqual(result['status'], 'stopped_no_replay')
        self.assertEqual(len(result['cases']), 1)

    def test_shared_eight_request_limit_blocks_ninth_legacy_http_request(self):
        from langchain_core.messages import AIMessage
        from app.modules.ai_journal.agent.contracts import insufficient
        def factory(*_, **__):
            count=0
            async def call(messages, tools):
                nonlocal count
                count+=1
                if tools:
                    raw={'role':'assistant','content':None,'reasoning_content':'ephemeral',
                        'tool_calls':[{'id':f'read-{count}','type':'function','function':{
                            'name':'search_investment_memory','arguments':'{"query":"NVDA"}'}}]}
                    return AIMessage(content='',tool_calls=[{'id':f'read-{count}',
                        'name':'search_investment_memory','args':{'query':'NVDA'}}],
                        additional_kwargs={'deepseek_message':raw})
                content=insufficient('synthetic').model_dump_json()
                return AIMessage(content=content,additional_kwargs={'deepseek_message':{
                    'role':'assistant','content':content,'reasoning_content':'ephemeral'}})
            return call
        self.run_harness(factory, lambda *_, **__: self.fail('no ninth HTTP request'), limit=8)
        result=self.receipt()
        self.assertEqual(result['requests_reserved'],8)
        self.assertEqual([row['requests'] for row in result['cases']],[4,4,0])
        self.assertEqual(result['status'],'stopped_no_replay')
        self.assertTrue(result['closed'])
        self.assertFalse(result['execution_checks_passed'])
