from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from fastapi import HTTPException

from app.api_models import QuantAnalysisRunRequest
from app.core import database
from app.modules import ai_advice, ai_settings, position_import, trading_data
from app.modules.quant_analysis import manager, reflection


class PrivacyPolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        db_patch = patch.object(database, 'DB_PATH', Path(directory.name) / 'app.db')
        db_patch.start()
        self.addCleanup(db_patch.stop)
        database.init_db()
        trading_data.save_trading_state({'privacyMode': 'local-only'})
        self.settings = {'baseUrl': 'https://example.test/v1', 'apiKey': 'synthetic', 'model': 'model-test', 'protocol': 'chat/completions'}

    def assert_forbidden(self, call) -> None:
        with self.assertRaises(HTTPException) as error:
            call()
        self.assertEqual(error.exception.status_code, 403)

    def completion(self, **extra):
        return ai_settings.call_openai_compatible_completion(
            base_url='https://example.test/v1', model='model-test', api_key='fake',
            messages=[{'role': 'user', 'content': 'synthetic private note'}], timeout=5,
            protocol='chat/completions', **extra,
        )

    def test_daily_and_chat_are_blocked_before_context_or_transport(self) -> None:
        with patch.object(ai_advice, 'load_ai_settings', return_value=self.settings), patch.object(ai_advice, 'get_quotes', return_value=[]) as quotes, patch.object(ai_advice, 'get_signal_rows', return_value=[]), patch.object(ai_advice, 'build_intraday_market_context', return_value=[]), patch.object(ai_advice, 'call_ai_response') as transport:
            self.assert_forbidden(lambda: ai_advice.create_external_ai_advice('synthetic'))
            self.assert_forbidden(lambda: ai_advice.create_ai_chat_reply('synthetic'))
            quotes.assert_not_called()
            transport.assert_not_called()
        self.assertIsNone(database.get_state_payload('ai_advice_v1'))

    def test_ocr_is_blocked_before_sending_image(self) -> None:
        with patch.object(position_import, 'load_ai_settings', return_value=self.settings), patch.object(position_import, 'call_openai_compatible_completion', return_value={'content': '{"positions": [{"ticker": "SYNTH", "shares": 1, "averageCost": 10}]}', 'endpoint': 'chat/completions'}) as transport:
            self.assert_forbidden(lambda: position_import.recognize_position_screenshot('data:image/png;base64,aGVsbG8='))
            transport.assert_not_called()

    def test_quant_submit_and_resume_do_not_create_or_queue_work(self) -> None:
        instance = manager.QuantAnalysisManager()
        request = QuantAnalysisRunRequest.model_validate({'ticker': 'SYNTH', 'analysisDate': '2026-09-01', 'mode': 'quick', 'analysts': ['technical']})
        with patch.object(manager, 'load_ai_settings', return_value=self.settings), patch.object(manager, 'resolve_instrument', return_value={'ticker': 'SYNTH', 'assetType': 'STOCK'}) as resolve:
            self.assert_forbidden(lambda: instance.submit(request))
            self.assert_forbidden(lambda: instance.resume('synthetic-run'))
            resolve.assert_not_called()
        self.assertTrue(instance._queue.empty())
        with database.connect() as connection:
            self.assertEqual(connection.execute('select count(*) from quant_analysis_runs').fetchone()[0], 0)

    def test_reflection_is_blocked_before_reading_or_updating_run(self) -> None:
        with patch.object(reflection, 'get_analysis_run') as get_run, patch.object(reflection, 'call_openai_compatible_completion') as transport:
            self.assert_forbidden(lambda: reflection.generate_reflection('synthetic'))
            get_run.assert_not_called()
            transport.assert_not_called()

    def test_direct_common_transport_cannot_bypass_saved_policy(self) -> None:
        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps({'choices': [{'message': {'content': 'ok'}}]}).encode()
        with patch.object(requests, 'post', return_value=response) as post, patch.object(ai_settings, 'OpenAI') as sdk:
            self.assert_forbidden(self.completion)
            self.assert_forbidden(lambda: ai_settings.call_responses_completion_with_sdk(base_url='https://example.test/v1', model='model-test', api_key='fake', messages=[{'role': 'user', 'content': 'private'}], timeout=5))
            post.assert_not_called()
            sdk.assert_not_called()

    def test_external_ready_and_unconfigured_keep_existing_transport_behavior(self) -> None:
        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps({'choices': [{'message': {'content': 'ok'}}]}).encode()
        for payload in [json.dumps({'privacyMode': 'external-ai-ready'}), None]:
            if payload is None:
                database.delete_state_payload('trading_data_v1')
            else:
                database.set_state_payload('trading_data_v1', payload)
            with patch.object(requests, 'post', return_value=response):
                self.assertEqual(self.completion()['content'], 'ok')

    def test_explicit_connection_test_sends_only_fixed_public_probe(self) -> None:
        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps({'choices': [{'message': {'content': 'ok'}}]}).encode()
        with patch.object(ai_settings, 'load_ai_settings', return_value={}), patch.object(requests, 'get', return_value=response), patch.object(requests, 'post', return_value=response) as post:
            result = ai_settings.test_ai_settings_connection(self.settings)
            self.assertTrue(result['generationOk'])
            self.assertEqual(post.call_args.kwargs['json']['messages'], [
                {'role': 'system', 'content': '你是测试助手。'},
                {'role': 'user', 'content': '请只回复 ok。'},
            ])

    def test_probe_flag_cannot_exempt_private_messages(self) -> None:
        with patch.object(requests, 'post') as post:
            self.assert_forbidden(lambda: self.completion(_connection_probe=True))
            post.assert_not_called()

    def test_http_inference_routes_return_403_without_startup(self) -> None:
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        self.addCleanup(client.close)
        for path, payload in [
            ('/api/ai-advice/generate', {'brief': 'synthetic'}),
            ('/api/ai-advice/chat', {'prompt': 'synthetic'}),
            ('/api/position-import/recognize', {'imageDataUrl': 'data:image/png;base64,aA=='}),
            ('/api/quant-analysis/runs', {'ticker': 'SYNTH', 'analysisDate': '2026-09-01', 'mode': 'quick', 'analysts': ['technical']}),
            ('/api/quant-analysis/runs/synthetic/resume', {}),
            ('/api/quant-analysis/runs/synthetic/reflection', {}),
        ]:
            with self.subTest(path=path), patch.object(requests, 'post') as post:
                self.assertEqual(client.post(path, json=payload).status_code, 403)
                post.assert_not_called()
