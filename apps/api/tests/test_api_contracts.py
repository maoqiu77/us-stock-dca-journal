from __future__ import annotations

import unittest

from pydantic import ValidationError
from typing import Any, get_type_hints


class ApiContractTest(unittest.TestCase):
    def test_ai_chat_rejects_non_string_prompt(self) -> None:
        models = self.load_request_models()

        with self.assertRaises(ValidationError):
            models["AiAdviceChatRequest"].model_validate({"prompt": 123})

    def test_ai_generate_rejects_non_string_brief(self) -> None:
        models = self.load_request_models()

        with self.assertRaises(ValidationError):
            models["AiAdviceBriefRequest"].model_validate({"brief": 123})

    def test_ai_settings_rejects_non_string_fields(self) -> None:
        models = self.load_request_models()

        with self.assertRaises(ValidationError):
            models["AiSettingsUpdateRequest"].model_validate(
                {"baseUrl": 123, "model": "gpt-test", "apiKey": "sk-test"}
            )

    def test_position_screenshot_rejects_unknown_or_non_string_fields(self) -> None:
        models = self.load_request_models()

        with self.assertRaises(ValidationError):
            models["PositionScreenshotRequest"].model_validate(
                {"imageDataUrl": 123, "accountId": "private"}
            )

    def test_update_start_rejects_non_string_local_storage_snapshot(self) -> None:
        models = self.load_request_models()

        with self.assertRaises(ValidationError):
            models["UpdateStartRequest"].model_validate(
                {"localStorageSnapshot": {"key": 123}}
            )

    def test_ai_routes_use_request_models(self) -> None:
        from app import main

        models = self.load_request_models()

        self.assertIs(
            get_type_hints(main.generate_ai_advice)["payload"],
            models["AiAdviceBriefRequest"],
        )
        self.assertIs(
            get_type_hints(main.ai_advice_chat)["payload"],
            models["AiAdviceChatRequest"],
        )
        self.assertIs(
            get_type_hints(main.put_ai_settings)["payload"],
            models["AiSettingsUpdateRequest"],
        )
        self.assertIs(
            get_type_hints(main.test_ai_settings)["payload"],
            models["AiSettingsTestRequest"],
        )
        self.assertIs(
            get_type_hints(main.position_import_recognize)["payload"],
            models["PositionScreenshotRequest"],
        )
        self.assertIs(
            get_type_hints(main.update_start)["payload"],
            models["UpdateStartRequest"],
        )

    def load_request_models(self) -> dict[str, Any]:
        try:
            from app.api_models import (
                AiAdviceBriefRequest,
                AiAdviceChatRequest,
                AiSettingsTestRequest,
                AiSettingsUpdateRequest,
                PositionScreenshotRequest,
                UpdateStartRequest,
            )
        except ImportError as exc:
            self.fail(f"request models are missing: {exc}")
        return {
            "AiAdviceBriefRequest": AiAdviceBriefRequest,
            "AiAdviceChatRequest": AiAdviceChatRequest,
            "AiSettingsTestRequest": AiSettingsTestRequest,
            "AiSettingsUpdateRequest": AiSettingsUpdateRequest,
            "PositionScreenshotRequest": PositionScreenshotRequest,
            "UpdateStartRequest": UpdateStartRequest,
        }


if __name__ == "__main__":
    unittest.main()
