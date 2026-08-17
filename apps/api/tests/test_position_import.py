from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.modules import ai_settings, position_import


class PositionImportTest(unittest.TestCase):
    def test_multimodal_payloads_support_both_compatible_endpoints(self) -> None:
        messages = [
            {"role": "system", "content": "read image"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "extract"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                ],
            },
        ]

        chat = ai_settings.build_chat_completions_payload("vision", messages)
        responses = ai_settings.build_responses_payload("vision", messages)

        self.assertEqual(chat["messages"][1]["content"][1]["type"], "image_url")
        self.assertEqual(responses["input"][0]["content"][1]["type"], "input_image")

    def test_recognition_sanitizes_model_output(self) -> None:
        completion = {
            "content": """```json
            {"positions":[
              {"ticker":" qqqm ","assetType":"ETF","shares":8,"averageCost":220,"confidence":1.2},
              {"ticker":"QQQM","shares":1,"averageCost":10},
              {"ticker":"","shares":1,"averageCost":10}
            ],"warnings":["核对成本"]}
            ```""",
            "endpoint": "responses",
        }
        with (
            patch.object(
                position_import,
                "load_ai_settings",
                return_value={"baseUrl": "https://example.test/v1", "model": "vision", "apiKey": "sk-test"},
            ),
            patch.object(position_import, "call_openai_compatible_completion", return_value=completion),
        ):
            result = position_import.recognize_position_screenshot("data:image/png;base64,AAAA")

        self.assertEqual(len(result["positions"]), 1)
        self.assertEqual(result["positions"][0]["ticker"], "QQQM")
        self.assertEqual(result["positions"][0]["confidence"], 1.0)
        self.assertIn("核对成本", result["warnings"])

    def test_recognition_requires_configured_ai(self) -> None:
        with patch.object(position_import, "load_ai_settings", return_value={}):
            with self.assertRaises(HTTPException) as context:
                position_import.recognize_position_screenshot("data:image/png;base64,AAAA")
        self.assertEqual(context.exception.status_code, 400)

    def test_trade_amount_is_converted_to_fractional_shares(self) -> None:
        trades, warnings = position_import.sanitize_trades([
            {"ticker": "SMH", "action": "买入", "quantityType": "amount", "amount": 35, "executionPrice": 589.16},
            {"ticker": "MSFT", "action": "卖出", "quantityType": "shares", "quantity": 0.0591, "executionPrice": 496},
        ])
        self.assertFalse(warnings)
        self.assertAlmostEqual(trades[0]["shares"], 35 / 589.16, places=6)
        self.assertEqual(trades[1]["shares"], 0.0591)

    def test_trade_sanitizer_accepts_english_actions(self) -> None:
        trades, warnings = position_import.sanitize_trades([
            {"ticker": "SMCI", "action": "Sell", "shares": 2, "executionPrice": 41.69},
            {"ticker": "SMH", "action": "Buy", "shares": 50, "amount": 29500},
        ])
        self.assertFalse(warnings)
        self.assertEqual([row["action"] for row in trades], ["卖出", "买入"])
        self.assertEqual(trades[1]["unitPrice"], 590)

    def test_auto_mode_uses_trade_rows_when_model_omits_mode(self) -> None:
        completion = {"content": '{"trades":[{"ticker":"SMCI","action":"Sell","shares":2,"executionPrice":41.69}]}', "endpoint": "responses"}
        with (
            patch.object(position_import, "load_ai_settings", return_value={"baseUrl": "https://example.test/v1", "model": "vision", "apiKey": "sk-test"}),
            patch.object(position_import, "call_openai_compatible_completion", return_value=completion),
        ):
            result = position_import.recognize_position_screenshot("data:image/png;base64,AAAA")
        self.assertEqual(result["mode"], "trades")
        self.assertEqual(result["trades"][0]["action"], "卖出")

    def test_trade_price_falls_back_to_bid_ask_for_market_orders(self) -> None:
        trades, warnings = position_import.sanitize_trades([
            {"ticker": "MSFT", "action": "Sell", "quantityType": "shares", "quantity": 0.0591, "amount": 29.289, "bidPrice": 496, "askPrice": 496.95, "sourceText": "Sell 0.0591 @ Market"},
        ])
        self.assertFalse(warnings)
        self.assertAlmostEqual(trades[0]["unitPrice"], (496 + 496.95) / 2, places=6)
        self.assertEqual(trades[0]["sourceText"], "Sell 0.0591 @ Market")


if __name__ == "__main__":
    unittest.main()
