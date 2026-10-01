"""Production SDK/graph fault checks against a loopback-only synthetic HTTP peer."""
from __future__ import annotations

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest

from app.modules.ai_journal.agent.model import runtime_available


@unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
class LoopbackFaultTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.received = threading.Event()
        self.release = threading.Event()
        self.finished = threading.Event()
        self.requests = []
        self.mode = 'disconnect'
        test = self

        class Peer(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def handle(self):
                try:
                    super().handle()
                except ConnectionResetError:
                    pass

            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                test.requests.append(body)
                test.received.set()
                if test.mode != 'disconnect':
                    test.release.wait(3)
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', '200')
                    self.end_headers()
                    self.wfile.write(b'{"id":"synthetic-partial"')
                    self.wfile.flush()
                    self.close_connection = True
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    test.finished.set()

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Peer)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01})
        self.thread.start()

    async def asyncTearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def graph(self, *, short_http_timeout=False):
        import httpx
        from openai import AsyncOpenAI
        from app.modules.ai_journal.agent.deepseek import build_deepseek_agent_model
        from app.modules.ai_journal.service import model_fingerprint
        from app.modules.ai_journal.agent.graph import build_graph
        from app.modules.ai_journal.agent.contracts import EvidenceBook
        from app.modules.ai_journal.agent.runtime import AccessRevoked, Budget, ToolExecutor
        settings = {'provider': 'deepseek', 'protocol': 'chat/completions', 'complexModel': 'synthetic-model',
                    'baseUrl': 'https://api.deepseek.com/v1', 'apiKey': 'synthetic-key'}
        capability = {'model_fingerprint': model_fingerprint(settings), 'endpoint': 'chat/completions',
            'adapter_version': 'deepseek-chat-v1', 'tool_calling': True, 'verification': 'real_provider',
            'verified_at': '2026-10-01T00:00:00+00:00'}

        def client_factory(**kwargs):
            self.assertEqual(kwargs['max_retries'], 0)
            self.assertEqual(kwargs['timeout'], 25)
            kwargs['base_url'] = f'http://127.0.0.1:{self.server.server_port}/v1'
            if short_http_timeout:
                kwargs['timeout'] = .1
            return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(trust_env=False))

        def access():
            if self.mode == 'cancel' and self.received.is_set():
                raise AccessRevoked('synthetic_cancel')

        budget = Budget()
        book = EvidenceBook()
        executor = ToolExecutor([], book, budget, access)
        call = build_deepseek_agent_model(settings, capability, client_factory=client_factory)
        graph = build_graph(model_call=call, executor=executor, book=book, budget=budget, check_access=access)
        return graph, budget

    async def invoke(self, graph):
        from langchain_core.messages import HumanMessage
        await graph.ainvoke({'messages': [HumanMessage(content='synthetic loopback fault test')],
            'result': None, 'repair_count': 0, 'stop_code': ''})

    async def test_actual_partial_http_disconnect_is_unknown_and_single_request(self):
        from app.modules.ai_journal.agent.runtime import ModelOutcomeUnknown
        graph, budget = self.graph()
        with self.assertRaises(ModelOutcomeUnknown):
            await self.invoke(graph)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(budget.model_calls, 1)
        self.assertIsNone(budget.usage()['input_tokens'])
        self.assertTrue(budget.usage()['model_request_in_flight'])
        self.assertFalse(budget.usage()['usage_complete'])

    async def test_actual_http_read_timeout_is_unknown_without_sdk_retry(self):
        from app.modules.ai_journal.agent.runtime import ModelOutcomeUnknown
        self.mode = 'timeout'
        graph, budget = self.graph(short_http_timeout=True)
        with self.assertRaises(ModelOutcomeUnknown):
            await self.invoke(graph)
        self.assertTrue(self.received.is_set())
        self.assertEqual(len(self.requests), 1)
        self.assertFalse(budget.usage()['usage_complete'])

    async def test_local_cancellation_does_not_claim_upstream_stopped(self):
        from app.modules.ai_journal.agent.runtime import AccessRevoked
        self.mode = 'cancel'
        graph, budget = self.graph()
        with self.assertRaises(AccessRevoked):
            await asyncio.wait_for(self.invoke(graph), timeout=2)
        self.assertEqual(len(self.requests), 1)
        self.assertFalse(self.finished.is_set())
        self.assertIsNone(budget.usage()['output_tokens'])
        self.release.set()
        self.assertTrue(await asyncio.to_thread(self.finished.wait, 1))
        self.assertEqual(len(self.requests), 1)
