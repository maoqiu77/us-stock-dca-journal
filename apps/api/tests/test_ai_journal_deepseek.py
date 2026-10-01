from __future__ import annotations

import json
import asyncio
import tempfile
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

from app.modules.ai_journal.agent.model import (
    DEEPSEEK_ADAPTER_VERSION, adapter_version_for, probe, ready, runtime_available,
)
from app.modules.ai_journal.service import model_fingerprint

SETTINGS = {'provider': 'deepseek', 'protocol': 'chat/completions',
    'baseUrl': 'https://api.deepseek.com/v1', 'apiKey': 'synthetic-key', 'complexModel': 'synthetic-model'}


@unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
class DeepSeekAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.network = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        self.network.start()

    async def asyncTearDown(self):
        self.network.stop()

    def capability(self):
        return {'model_fingerprint': model_fingerprint(SETTINGS), 'endpoint': 'chat/completions',
            'adapter_version': DEEPSEEK_ADAPTER_VERSION, 'tool_calling': True,
            'verification': 'real_provider', 'verified_at': '2026-10-01T00:00:00+00:00'}

    async def test_sdk_roundtrip_preserves_empty_content_raw_arguments_and_reasoning(self):
        import httpx
        from openai import AsyncOpenAI
        from langchain_core.messages import HumanMessage, ToolMessage
        from app.modules.ai_journal.agent.deepseek import build_deepseek_agent_model
        bodies = []
        def handler(request):
            body = json.loads(request.content); bodies.append(body)
            index = len(bodies)
            message = {'role': 'assistant', 'content': None if index == 1 else '',
                'reasoning_content': f'ephemeral-synthetic-{index}',
                'reasoning_details': [{'type': 'synthetic-extension', 'data': str(index)}]}
            if index < 3:
                message['tool_calls'] = [{'id': f'call-{index}', 'type': 'function',
                    'function': {'name': 'echo_capability', 'arguments': '{ "value" : "synthetic-capability" }'}}]
            else:
                message['content'] = 'synthetic-capability'
            return httpx.Response(200, json={'id': 'synthetic', 'object': 'chat.completion',
                'created': 0, 'model': 'synthetic-model', 'choices': [{'index': 0, 'message': message,
                    'finish_reason': 'tool_calls' if index < 3 else 'stop'}],
                'usage': {'prompt_tokens': 10, 'completion_tokens': 3, 'total_tokens': 13,
                    'prompt_cache_hit_tokens': 2, 'completion_tokens_details': {'reasoning_tokens': 1}}})
        def factory(**kwargs):
            self.assertEqual(kwargs['max_retries'], 0)
            return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        call = build_deepseek_agent_model(SETTINGS, self.capability(), client_factory=factory)
        messages = [HumanMessage(content='synthetic')]
        tools = [{'type': 'function', 'function': {'name': 'echo_capability', 'parameters': {'type': 'object'}}}]
        for index in (1, 2):
            reply = await call(messages, tools)
            self.assertEqual(reply.tool_calls[0]['id'], f'call-{index}')
            messages += [reply, ToolMessage(content='synthetic-capability', tool_call_id=f'call-{index}')]
        reply = await call(messages, [])
        self.assertEqual(reply.text, 'synthetic-capability')
        self.assertEqual(reply.usage_metadata['output_token_details']['reasoning'], 1)
        self.assertEqual(reply.usage_metadata['input_token_details']['cache_read'], 2)
        self.assertEqual(bodies[1]['messages'][1]['content'], None)
        self.assertEqual(bodies[1]['messages'][1]['tool_calls'][0]['function']['arguments'], '{ "value" : "synthetic-capability" }')
        for index in (1, 2):
            row = bodies[2]['messages'][2 * index - 1]
            self.assertEqual(row['reasoning_content'], f'ephemeral-synthetic-{index}')
            self.assertEqual(row['reasoning_details'][0]['data'], str(index))
            self.assertEqual(bodies[2]['messages'][2 * index]['tool_call_id'], f'call-{index}')
        self.assertNotIn('tools', bodies[2])
        self.assertTrue(all(row['max_tokens'] == 6144 and row['stream'] is False for row in bodies))

    async def test_errors_never_retry_or_change_endpoint(self):
        import httpx
        from openai import AsyncOpenAI, APIConnectionError, BadRequestError
        from langchain_core.messages import HumanMessage
        from app.modules.ai_journal.agent.deepseek import build_deepseek_agent_model
        for failure in ('disconnect', 'bad_request'):
            requests = []
            def handler(request):
                requests.append(str(request.url))
                if failure == 'disconnect':
                    raise httpx.ReadError('synthetic interruption')
                return httpx.Response(400, json={'error': {'message': 'synthetic error'}})
            def factory(**kwargs):
                return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
            call = build_deepseek_agent_model(SETTINGS, self.capability(), client_factory=factory)
            with self.assertRaises(APIConnectionError if failure == 'disconnect' else BadRequestError):
                await call([HumanMessage(content='synthetic')], [])
            self.assertEqual(requests, ['https://api.deepseek.com/v1/chat/completions'])

    async def test_gate_and_forged_tool_linkage_fail_before_network(self):
        from langchain_core.messages import AIMessage, ToolMessage
        from app.modules.ai_journal.agent.deepseek import wire_messages, build_deepseek_agent_model
        cap = self.capability()
        self.assertTrue(ready(SETTINGS, cap))
        self.assertEqual(adapter_version_for({**SETTINGS, 'provider': 'custom'}), DEEPSEEK_ADAPTER_VERSION)
        self.assertFalse(ready(SETTINGS, {**cap, 'adapter_version': 'standard-openai-v1'}))
        self.assertFalse(ready({**SETTINGS, 'apiKey': 'changed'}, cap))
        with self.assertRaises(ValueError):
            build_deepseek_agent_model(SETTINGS, {**cap, 'endpoint': 'responses'})
        reply = AIMessage(content='', tool_calls=[{'id': 'a', 'name': 'echo', 'args': {}}])
        for messages in ([reply], [ToolMessage(content='x', tool_call_id='a')],
                         [reply, ToolMessage(content='x', tool_call_id='wrong')],
                         [reply, ToolMessage(content='x', tool_call_id='a'), reply]):
            with self.assertRaises(ValueError): wire_messages(messages)

    async def test_malformed_arguments_are_rejected_and_missing_usage_is_unknown(self):
        from openai.types.chat import ChatCompletion
        from app.modules.ai_journal.agent.deepseek import parse_reply
        payload = {'id': 'synthetic', 'object': 'chat.completion', 'created': 0, 'model': 'synthetic',
            'choices': [{'index': 0, 'finish_reason': 'tool_calls', 'message': {'role': 'assistant',
                'content': None, 'reasoning_content': None, 'tool_calls': [{'id': 'a', 'type': 'function',
                    'function': {'name': 'echo', 'arguments': 'not-json'}}]}}]}
        reply = parse_reply(ChatCompletion.model_validate(payload))
        self.assertTrue(reply.invalid_tool_calls)
        self.assertIsNone(reply.usage_metadata)
        self.assertIn('reasoning_content', reply.additional_kwargs['deepseek_message'])
        self.assertIsNone(reply.additional_kwargs['deepseek_message']['reasoning_content'])

    async def test_probe_records_dedicated_version(self):
        from langchain_core.messages import AIMessage
        calls = []
        def factory(settings, cap, probing=False):
            self.assertTrue(probing)
            self.assertEqual(cap.adapter_version, DEEPSEEK_ADAPTER_VERSION)
            async def call(messages, tools):
                calls.append(1)
                return AIMessage(content='', tool_calls=[{'id': 'a', 'name': 'echo_capability',
                    'args': {'value': 'synthetic-capability'}}]) if len(calls) == 1 else AIMessage(content='synthetic-capability')
            return call
        cap = await probe(SETTINGS, 'chat/completions', lambda: None, model_factory=factory)
        self.assertTrue(ready(SETTINGS, cap))

    async def test_production_manager_sdk_graph_and_archive_exclude_reasoning(self):
        import httpx
        from openai import AsyncOpenAI
        from app.core import database
        from app.modules.ai_journal.store import JournalStore
        from app.modules.ai_journal.service import JournalService
        from app.modules.ai_journal.models import PreviewRequest, ConfirmRequest
        from app.modules.ai_journal.agent.store import AgentStore
        from app.modules.ai_journal.agent.manager import JournalAgentManager
        from app.modules.ai_journal.agent.adapters import private_access
        from app.modules.ai_journal.agent.deepseek import build_deepseek_agent_model
        previous = database.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            try:
                database.DB_PATH = Path(directory) / 'synthetic.db'
                database.init_db()
                journal = JournalStore()
                agent = AgentStore(journal)
                agent.save_capability(self.capability())
                note = journal.save_note('synthetic original')['id']
                board = type('Board', (), {'catalog': type('Catalog', (), {'resolve': lambda _, key: None})()})()
                service = JournalService(journal, board, settings=lambda: SETTINGS)
                preview = service.preview(PreviewRequest(task_type='portfolio_review', question='synthetic original',
                    engine='agent', note_ids=[note]))
                confirm = ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='synthetic-test')
                session = service.confirm(confirm)
                run_id = session['turns'][0]['run_id']
                requests = []
                def handler(request):
                    body = json.loads(request.content); requests.append(body)
                    if len(requests) == 1:
                        message = {'role': 'assistant', 'content': None,
                            'tool_calls': [{'id': 'read-1', 'type': 'function', 'function': {
                                'name': 'search_investment_memory', 'arguments': '{"query":"original"}'}}]}
                    else:
                        self.assertEqual(body['messages'][-1]['tool_call_id'], 'read-1')
                        message = {'role': 'assistant', 'content': json.dumps({'summary': 'synthetic',
                            'stance': 'observe', 'facts': [{'text': 'synthetic original',
                                'source_ids': [preview['agent_sources'][0]['id']]}],
                            'interpretations': [], 'risks': [], 'missing': [], 'next_questions': []})}
                    message['reasoning_content'] = 'ephemeral-reasoning-never-archive'
                    return httpx.Response(200, json={'id': 'synthetic', 'object': 'chat.completion',
                        'created': 0, 'model': 'synthetic', 'choices': [{'index': 0, 'message': message,
                            'finish_reason': 'tool_calls' if len(requests) == 1 else 'stop'}],
                        'usage': {'prompt_tokens': 10, 'completion_tokens': 3, 'total_tokens': 13}})
                def client(**kwargs):
                    return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
                manager = JournalAgentManager(journal, settings=lambda: SETTINGS,
                    model_factory=lambda settings, cap: build_deepseek_agent_model(settings, cap, client_factory=client),
                    access=lambda snapshot, store: private_access(snapshot, store,
                        state_loader=lambda: {'privacyMode': 'normal', 'positions': [], 'trades': []}))
                await asyncio.to_thread(manager.execute, run_id)
                run = agent.get(run_id)
                self.assertEqual(run['status'], 'succeeded')
                self.assertEqual(run['usage']['llm_calls'], 2)
                self.assertEqual(run['source_count'], 1)
                self.assertEqual(service.confirm(confirm)['turns'][0]['run_id'], run_id)
                self.assertEqual(requests[1]['messages'][-2]['reasoning_content'], 'ephemeral-reasoning-never-archive')
                with journal.connect() as db:
                    dump = '\n'.join(db.iterdump())
                self.assertNotIn('ephemeral-reasoning-never-archive', dump)
                self.assertNotIn(SETTINGS['apiKey'], dump)
            finally:
                database.DB_PATH = previous

    async def test_structure_repair_identifies_limit_without_echoing_invalid_input(self):
        from langchain_core.messages import AIMessage, HumanMessage
        from app.modules.ai_journal.agent.graph import build_graph
        from app.modules.ai_journal.agent.contracts import EvidenceBook, insufficient
        from app.modules.ai_journal.agent.runtime import Budget, ToolExecutor
        book, budget = EvidenceBook(), Budget()
        executor = ToolExecutor([], book, budget, lambda: None)
        calls = []
        async def model(messages, tools):
            calls.append(messages)
            if len(calls) == 1:
                report = insufficient('synthetic').model_dump()
                report['facts'] = [{'text': 'invalid-input-must-not-be-echoed', 'source_ids': ['x']}] * 7
                return AIMessage(content=json.dumps(report))
            self.assertIn('too_long', messages[-1].content)
            self.assertIn('facts', messages[-1].content)
            self.assertNotIn('invalid-input-must-not-be-echoed', messages[-1].content)
            return AIMessage(content=insufficient('synthetic').model_dump_json())
        state = await build_graph(model_call=model, executor=executor, book=book, budget=budget,
            check_access=lambda: None).ainvoke({'messages': [HumanMessage(content='synthetic')],
                'result': None, 'repair_count': 0, 'stop_code': ''})
        self.assertEqual(state['stop_code'], 'completed')
        self.assertEqual(budget.model_calls, 2)


if __name__ == '__main__':
    unittest.main()
