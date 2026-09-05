from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import httpx
import requests
from fastapi import HTTPException
from openai import OpenAI

from app.modules import ai_settings


class AiSettingsTest(unittest.TestCase):
    def test_legacy_luna_settings_migrate_to_tiered_defaults(self) -> None:
        settings = ai_settings.sanitize_ai_settings(
            {
                "schemaVersion": 1,
                "baseUrl": "https://example.test/v1",
                "model": "gpt-5.6-luna",
                "apiKey": "sk-test",
            }
        )

        self.assertEqual(settings["schemaVersion"], 3)
        self.assertEqual(settings["complexModel"], "gpt-5.6-luna")
        self.assertEqual(settings["simpleModel"], "gpt-5.6-luna")

    def test_connection_test_checks_both_tiered_models(self) -> None:
        completions = [
            {"content": "ok", "endpoint": "responses"},
            {"content": "ok", "endpoint": "responses"},
        ]
        with (
            patch.object(ai_settings, "load_ai_settings", return_value={}),
            patch.object(
                requests,
                "get",
                return_value=FakeResponse(
                    {"data": [{"id": "gpt-5.6-luna"}]}
                ),
            ),
            patch.object(
                ai_settings,
                "call_openai_compatible_completion",
                side_effect=completions,
            ) as completion,
        ):
            result = ai_settings.test_ai_settings_connection(
                {
                    "baseUrl": "https://example.test/v1",
                    "complexModel": "gpt-5.6-luna",
                    "simpleModel": "gpt-5.6-luna",
                    "apiKey": "sk-test",
                }
            )

        self.assertEqual(
            [call.kwargs["model"] for call in completion.call_args_list],
            ["gpt-5.6-luna", "gpt-5.6-luna"],
        )
        self.assertTrue(result["modelResults"]["complex"]["modelMatched"])
        self.assertTrue(result["modelResults"]["simple"]["modelMatched"])

    def test_connection_test_checks_responses_api(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["path"] = request.url.path
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json=sdk_responses_payload("ok"))

        sdk_client = OpenAI(
            api_key="sk-test",
            base_url="https://example.test/v1",
            max_retries=0,
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        )

        with (
            patch.object(ai_settings, "load_ai_settings", return_value={}),
            patch.object(
                requests,
                "get",
                return_value=FakeResponse({"data": [{"id": "gpt-5.6-sol"}]}),
            ) as get,
            patch.object(ai_settings, "OpenAI", return_value=sdk_client) as openai_client,
        ):
            result = ai_settings.test_ai_settings_connection(
                {
                    "baseUrl": "https://example.test/v1",
                    "model": "gpt-5.6-sol",
                    "apiKey": "sk-test",
                }
            )

        get.assert_called_once()
        openai_client.assert_called_once_with(
            api_key="sk-test",
            base_url="https://example.test/v1",
            timeout=60,
            max_retries=0,
        )
        self.assertEqual(captured["path"], "/v1/responses")
        body = captured["body"]
        self.assertIsInstance(body, dict)
        self.assertEqual(body["model"], "gpt-5.6-sol")
        self.assertIs(body["store"], False)
        self.assertEqual(
            body["reasoning"],
            {"effort": "low"},
        )
        self.assertEqual(body["instructions"], "你是测试助手。")
        self.assertEqual(body["input"], [{"role": "user", "content": "请只回复 ok。"}])
        self.assertNotIn("messages", body)
        self.assertNotIn("temperature", body)
        self.assertTrue(result["responsesOk"])
        self.assertEqual(result["generationEndpoint"], "responses")
        self.assertIn("Responses API 可用", result["message"])

    def test_connection_test_falls_back_to_chat_completions(self) -> None:
        responses = [
            FakeResponse({"data": [{"id": "gpt-test"}]}),
            FakeResponse(
                {"error": "unsupported"},
                status_code=404,
                reason="Not Found",
            ),
            FakeResponse(
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "ok",
                            }
                        }
                    ]
                }
            ),
        ]

        with (
            patch.object(ai_settings, "load_ai_settings", return_value={}),
            patch.object(requests, "get", return_value=responses[0]),
            patch.object(requests, "post", side_effect=responses[1:]) as post,
        ):
            result = ai_settings.test_ai_settings_connection(
                {
                    "baseUrl": "https://example.test/v1",
                    "model": "gpt-test",
                    "apiKey": "sk-test",
                }
            )

        self.assertEqual(
            [call.args[0] for call in post.call_args_list],
            [
                "https://example.test/v1/responses",
                "https://example.test/v1/chat/completions",
            ],
        )
        self.assertEqual(result["generationEndpoint"], "chat/completions")
        self.assertIn("chat/completions API 可用", result["message"])

    def test_sol_does_not_fall_back_to_chat_completions(self) -> None:
        paths: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            paths.append(request.url.path)
            return httpx.Response(
                404,
                json={"error": {"message": "no route available"}},
            )

        sdk_client = OpenAI(
            api_key="sk-test",
            base_url="https://example.test/v1",
            max_retries=0,
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        with patch.object(ai_settings, "OpenAI", return_value=sdk_client):
            with self.assertRaises(ai_settings.OpenAICompatibleRequestError) as context:
                ai_settings.call_openai_compatible_completion(
                    base_url="https://example.test/v1",
                    model="gpt-5.6-sol",
                    api_key="sk-test",
                    messages=[{"role": "user", "content": "hello"}],
                    timeout=20,
                )

        self.assertEqual(paths, ["/v1/responses"])
        self.assertIn("404", str(context.exception))
        self.assertIn("no route available", str(context.exception))
        self.assertNotIn("sk-test", str(context.exception))

    def test_connection_test_continues_when_models_endpoint_is_blocked(self) -> None:
        with (
            patch.object(ai_settings, "load_ai_settings", return_value={}),
            patch.object(
                requests,
                "get",
                return_value=FakeResponse(
                    {"error": "blocked"},
                    status_code=403,
                    reason="Forbidden",
                ),
            ),
            patch.object(
                requests,
                "post",
                return_value=FakeResponse(
                    {
                        "output": [
                            {
                                "type": "message",
                                "role": "assistant",
                                "content": [{"type": "output_text", "text": "ok"}],
                            }
                        ]
                    }
                ),
            ) as post,
        ):
            result = ai_settings.test_ai_settings_connection(
                {
                    "baseUrl": "https://example.test/v1",
                    "model": "gpt-test",
                    "apiKey": "sk-test",
                }
            )

        self.assertEqual(result["generationEndpoint"], "responses")
        self.assertIsNone(result["modelMatched"])
        self.assertIn("/models 测试失败", result["message"])
        self.assertEqual(post.call_count, 1)

    def test_connection_test_fails_when_responses_api_is_unavailable(self) -> None:
        with (
            patch.object(ai_settings, "load_ai_settings", return_value={}),
            patch.object(
                requests,
                "get",
                return_value=FakeResponse({"data": [{"id": "gpt-test"}]}),
            ),
            patch.object(
                requests,
                "post",
                side_effect=[
                    FakeResponse(
                        {"error": "unavailable"},
                        status_code=503,
                        reason="Service Unavailable",
                    ),
                    FakeResponse(
                        {"error": "unavailable"},
                        status_code=503,
                        reason="Service Unavailable",
                    ),
                ],
            ) as post,
        ):
            with self.assertRaises(HTTPException) as context:
                ai_settings.test_ai_settings_connection(
                    {
                        "baseUrl": "https://example.test/v1",
                        "model": "gpt-test",
                        "apiKey": "sk-test",
                    }
                )

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("AI 生成接口测试失败", str(context.exception.detail))
        self.assertIn("503", str(context.exception.detail))
        self.assertEqual(
            [call.args[0] for call in post.call_args_list],
            [
                "https://example.test/v1/responses",
            ],
        )

    def test_connection_test_includes_provider_error_message(self) -> None:
        with (
            patch.object(ai_settings, "load_ai_settings", return_value={}),
            patch.object(
                requests,
                "get",
                return_value=FakeResponse({"data": [{"id": "gpt-test"}]}),
            ),
            patch.object(
                requests,
                "post",
                side_effect=[
                    FakeResponse(
                        {
                            "error": {
                                "message": "Client not allowed (detected: python-requests/2.32.5)"
                            }
                        },
                        status_code=400,
                        reason="Bad Request",
                    ),
                    FakeResponse(
                        {
                            "error": {
                                "message": "Client not allowed (detected: python-requests/2.32.5)"
                            }
                        },
                        status_code=400,
                        reason="Bad Request",
                    ),
                ],
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                ai_settings.test_ai_settings_connection(
                    {
                        "baseUrl": "https://example.test/v1",
                        "model": "gpt-test",
                        "apiKey": "sk-test",
                    }
                )

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("Client not allowed", str(context.exception.detail))

    def test_output_token_limit_maps_to_each_openai_endpoint(self) -> None:
        messages = [{"role": "user", "content": "hello"}]

        responses_payload = ai_settings.build_openai_compatible_payload(
            "responses", "gpt-5.6-luna", messages, max_output_tokens=8192
        )
        chat_payload = ai_settings.build_openai_compatible_payload(
            "chat/completions", "gpt-5.6-luna", messages, max_output_tokens=8192
        )

        self.assertEqual(responses_payload["max_output_tokens"], 8192)
        self.assertNotIn("max_completion_tokens", responses_payload)
        self.assertEqual(chat_payload["max_completion_tokens"], 8192)
        self.assertNotIn("max_output_tokens", chat_payload)


class FakeResponse:
    def __init__(
        self,
        payload: dict[str, object],
        status_code: int = 200,
        reason: str = "OK",
    ) -> None:
        self.payload = payload
        self.status_code = status_code
        self.reason = reason

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(
                f"{self.status_code} Server Error: {self.reason}",
                response=self,
            )

    def json(self) -> dict[str, object]:
        return self.payload

    @property
    def text(self) -> str:
        return str(self.payload)


def sdk_responses_payload(content: str) -> dict[str, object]:
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 1,
        "model": "gpt-5.6-sol",
        "status": "completed",
        "output": [
            {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "type": "output_text",
                        "text": content,
                        "annotations": [],
                        "logprobs": [],
                    }
                ],
            }
        ],
        "usage": {
            "input_tokens": 1,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens": 1,
            "output_tokens_details": {"reasoning_tokens": 0},
            "total_tokens": 2,
        },
    }


if __name__ == "__main__":
    unittest.main()
