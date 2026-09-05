from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import requests
from fastapi import HTTPException

from app.modules import ai_settings


def response(status=200, payload=None):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps(payload or {"choices": [{"message": {"content": "ok"}}]}).encode()
    return result


class ProviderSettingsTest(unittest.TestCase):
    def setUp(self):
        self.state = {}
        self.get = patch.object(ai_settings, "get_state_payload", side_effect=lambda key: self.state.get(key))
        self.put = patch.object(ai_settings, "set_state_payload", side_effect=lambda key, value: self.state.update({key: value}))
        self.get.start()
        self.put.start()
        self.addCleanup(self.get.stop)
        self.addCleanup(self.put.stop)

    def test_legacy_settings_preserve_custom_connection(self):
        self.state[ai_settings.APP_STATE_KEY] = json.dumps({"baseUrl": "https://relay.test/v1", "model": "old-model", "apiKey": "old-secret"})
        settings = ai_settings.load_ai_settings()
        self.assertEqual(settings["provider"], "custom")
        self.assertEqual(settings["protocol"], "auto")
        self.assertEqual(settings["complexModel"], "old-model")
        self.assertEqual(settings["apiKey"], "old-secret")

    def test_official_requires_only_key_and_profiles_restore_independently(self):
        ai_settings.update_ai_settings({"baseUrl": "https://relay.test/v1", "apiKey": "relay-secret"})
        public = ai_settings.update_ai_settings({"provider": "deepseek", "apiKey": "deepseek-secret"})
        self.assertEqual(public["baseUrl"], "https://api.deepseek.com/v1")
        self.assertEqual(public["protocol"], "chat/completions")
        self.assertTrue(public["complexModel"].startswith("deepseek-"))
        self.assertNotIn("deepseek-secret", json.dumps(public))
        self.assertNotIn("relay-secret", json.dumps(public))
        ai_settings.update_ai_settings({"provider": "custom"})
        self.assertEqual(ai_settings.load_ai_settings()["apiKey"], "relay-secret")
        ai_settings.update_ai_settings({"provider": "deepseek"})
        self.assertEqual(ai_settings.load_ai_settings()["apiKey"], "deepseek-secret")

    def test_switching_to_unconfigured_provider_does_not_reuse_key_for_test(self):
        ai_settings.update_ai_settings({"baseUrl": "https://relay.test/v1", "apiKey": "relay-secret"})
        with patch.object(requests, "post") as post:
            with self.assertRaises(HTTPException) as error:
                ai_settings.test_ai_settings_connection({"provider": "kimi"})
        self.assertEqual(error.exception.status_code, 400)
        post.assert_not_called()

    def test_custom_origin_change_drops_saved_key(self):
        ai_settings.update_ai_settings({"baseUrl": "https://first.test/v1", "apiKey": "first-secret"})
        with self.assertRaises(HTTPException):
            ai_settings.test_ai_settings_connection({"baseUrl": "https://second.test/v1"})
        ai_settings.update_ai_settings({"baseUrl": "https://second.test/v1"})
        self.assertEqual(ai_settings.load_ai_settings()["apiKey"], "")

    def test_official_address_cannot_be_overridden(self):
        with self.assertRaises(HTTPException):
            ai_settings.update_ai_settings({"provider": "deepseek", "baseUrl": "https://relay.test/v1", "apiKey": "secret"})

    def test_clear_key_is_scoped_to_selected_provider(self):
        ai_settings.update_ai_settings({"provider": "deepseek", "apiKey": "deepseek-secret"})
        ai_settings.update_ai_settings({"provider": "kimi", "apiKey": "kimi-secret"})
        ai_settings.update_ai_settings({"provider": "deepseek", "clearApiKey": True})
        self.assertEqual(ai_settings.load_ai_settings()["apiKey"], "")
        ai_settings.update_ai_settings({"provider": "kimi"})
        self.assertEqual(ai_settings.load_ai_settings()["apiKey"], "kimi-secret")

    def test_official_native_test_uses_messages_and_does_not_save_draft(self):
        with patch.object(requests, "get", return_value=response(404, {"error": "not found"})), patch.object(requests, "post", return_value=response(payload={"content": [{"type": "text", "text": "ok"}]})) as post:
            result = ai_settings.test_ai_settings_connection({"provider": "anthropic", "apiKey": "draft-secret"})
        self.assertTrue(result["generationOk"])
        self.assertFalse(result["responsesOk"])
        self.assertEqual(result["generationEndpoint"], "messages")
        self.assertEqual(post.call_args.args[0], "https://api.anthropic.com/v1/messages")
        self.assertEqual(self.state, {})

    def test_unsupported_official_protocol_is_rejected(self):
        with self.assertRaises(HTTPException):
            ai_settings.update_ai_settings({"provider": "anthropic", "protocol": "chat/completions"})

    def test_bad_url_returns_validation_error(self):
        with self.assertRaises(HTTPException) as error:
            ai_settings.update_ai_settings({"baseUrl": "http://[invalid"})
        self.assertEqual(error.exception.status_code, 400)

    def test_model_listing_error_does_not_echo_secret(self):
        with patch.object(requests, "get", return_value=response(403, {"error": "denied secret-should-not-leak"})), patch.object(requests, "post", return_value=response()):
            result = ai_settings.test_ai_settings_connection({"provider": "deepseek", "apiKey": "secret-should-not-leak"})
        self.assertNotIn("secret-should-not-leak", json.dumps(result))

    def test_http_settings_contract_keeps_provider_profiles_and_masks_keys(self):
        from fastapi.testclient import TestClient
        from app.main import app

        # Exercise HTTP contracts without running application startup/workers.
        client = TestClient(app)
        self.addCleanup(client.close)
        result = client.put("/api/ai-settings", json={"provider": "deepseek", "apiKey": "synthetic-deepseek-secret"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["provider"], "deepseek")
        self.assertEqual(result.json()["protocol"], "chat/completions")
        client.put("/api/ai-settings", json={"provider": "anthropic", "apiKey": "synthetic-claude-secret"})
        result = client.get("/api/ai-settings")
        self.assertTrue(result.json()["profiles"]["deepseek"]["hasApiKey"])
        self.assertNotIn("synthetic-deepseek-secret", result.text)
        self.assertNotIn("synthetic-claude-secret", result.text)
        self.assertNotIn('"apiKey":', result.text)


class ProviderProtocolTest(unittest.TestCase):
    def call(self, **kwargs):
        return ai_settings.call_openai_compatible_completion(
            base_url=kwargs.pop("base_url", "https://example.test/v1"), model=kwargs.pop("model", "model-test"),
            api_key="fake", messages=kwargs.pop("messages", [{"role": "user", "content": "hello"}]),
            timeout=5, **kwargs,
        )

    def test_explicit_chat_uses_compatible_token_field(self):
        with patch.object(requests, "post", return_value=response()) as post:
            self.call(protocol="chat/completions", provider="deepseek", max_output_tokens=8192)
        self.assertEqual(post.call_args.args[0], "https://example.test/v1/chat/completions")
        self.assertEqual(post.call_args.kwargs["json"]["max_tokens"], 8192)
        self.assertNotIn("max_completion_tokens", post.call_args.kwargs["json"])

    def test_explicit_responses_never_falls_back(self):
        with patch.object(requests, "post", return_value=response(404, {"error": "unsupported endpoint"})) as post:
            with self.assertRaises(ai_settings.OpenAICompatibleRequestError):
                self.call(protocol="responses")
        self.assertEqual(post.call_count, 1)

    def test_auto_falls_back_for_unsupported_route(self):
        with patch.object(requests, "post", side_effect=[response(404, {"error": "unsupported endpoint"}), response()]) as post:
            result = self.call()
        self.assertEqual(result["content"], "ok")
        self.assertEqual(result["endpoint"], "chat/completions")
        self.assertEqual(post.call_count, 2)

    def test_auth_quota_timeout_and_model_errors_do_not_trigger_protocol_fallback(self):
        for status, message in [(401, "invalid key"), (403, "forbidden"), (429, "quota"), (503, "unavailable"), (404, "model not found")]:
            with self.subTest(status=status), patch.object(requests, "post", return_value=response(status, {"error": {"message": message}})) as post:
                with self.assertRaises(ai_settings.OpenAICompatibleRequestError):
                    self.call()
                self.assertEqual(post.call_count, 1)
        with patch.object(requests, "post", side_effect=requests.Timeout("timed out")) as post:
            with self.assertRaises(ai_settings.OpenAICompatibleRequestError):
                self.call()
            self.assertEqual(post.call_count, 1)

    def test_claude_native_messages_auth_and_image_conversion(self):
        messages = [{"role": "system", "content": "system prompt"}, {"role": "user", "content": [
            {"type": "text", "text": "read this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,aGVsbG8="}},
        ]}]
        with patch.object(requests, "post", return_value=response(payload={"content": [{"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": "answer"}]})) as post:
            result = self.call(protocol="messages", provider="anthropic", messages=messages)
        self.assertEqual(result["content"], "answer")
        self.assertEqual(post.call_args.args[0], "https://example.test/v1/messages")
        headers = post.call_args.kwargs["headers"]
        self.assertEqual(headers["x-api-key"], "fake")
        self.assertEqual(headers["anthropic-version"], "2023-06-01")
        self.assertNotIn("Authorization", headers)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["system"], "system prompt")
        self.assertGreater(payload["max_tokens"], 0)
        self.assertEqual(payload["messages"][0]["content"][1]["source"], {"type": "base64", "media_type": "image/png", "data": "aGVsbG8="})

    def test_known_text_only_model_rejects_images_before_request(self):
        with patch.object(requests, "post") as post:
            with self.assertRaisesRegex(ai_settings.OpenAICompatibleRequestError, "图片"):
                self.call(provider="deepseek", protocol="chat/completions", model="deepseek-v4-pro", messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,aA=="}}]}])
        post.assert_not_called()
