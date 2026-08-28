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
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/png;base64,AAAA",
                            "detail": "high",
                        },
                    },
                ],
            },
        ]

        chat = ai_settings.build_chat_completions_payload("vision", messages)
        responses = ai_settings.build_responses_payload("vision", messages)

        self.assertEqual(chat["messages"][1]["content"][1]["type"], "image_url")
        self.assertEqual(responses["input"][0]["content"][1]["type"], "input_image")
        self.assertEqual(responses["input"][0]["content"][1]["detail"], "high")
        self.assertIs(responses["store"], False)

    def test_json_parser_accepts_explanation_around_payload(self) -> None:
        parsed = position_import.parse_json_object(
            "识别结果如下：\n"
            '{"mode":"portfolio","positions":[],"trades":[],"warnings":[]}'
            "\n请核对。"
        )

        self.assertEqual(parsed["mode"], "portfolio")

    def test_json_parser_accepts_fenced_payload_after_explanation(self) -> None:
        parsed = position_import.parse_json_object(
            "我已完成识别。\n```json\n"
            '{"mode":"trades","positions":[],"trades":[],"warnings":[]}'
            "\n```\n以上为结果。"
        )

        self.assertEqual(parsed["mode"], "trades")

    def test_json_parser_rejects_response_without_an_object(self) -> None:
        with self.assertRaises(ValueError):
            position_import.parse_json_object("抱歉，我无法读取这张图片。")

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

    def test_trade_sanitizer_accepts_common_model_field_aliases(self) -> None:
        trades, warnings = position_import.sanitize_trades([
            {
                "symbol": "NOK",
                "side": "buy",
                "quantity": 10,
                "fill_price": 10.928,
            },
            {
                "symbol": "SMH",
                "name": "VanEck Semiconductor ETF",
                "side": "buy",
                "quantity": 35,
                "quantity_unit": "USD",
                "fill_price": 595.2642,
            },
        ])

        self.assertFalse(warnings)
        self.assertEqual(trades[0]["ticker"], "NOK")
        self.assertEqual(trades[0]["action"], "买入")
        self.assertEqual(trades[0]["shares"], 10)
        self.assertEqual(trades[1]["assetType"], "ETF")
        self.assertEqual(trades[1]["amount"], 35)
        self.assertAlmostEqual(trades[1]["shares"], 35 / 595.2642, places=6)

    def test_recognition_repairs_a_nonstandard_first_response(self) -> None:
        completions = [
            {"content": "无法输出结构化结果", "endpoint": "responses"},
            {
                "content": '{"mode":"trades","positions":[],"trades":[{"ticker":"NOK","action":"买入","quantityType":"shares","quantity":10,"executionPrice":10.928}],"warnings":[]}',
                "endpoint": "responses",
            },
        ]
        with (
            patch.object(
                position_import,
                "load_ai_settings",
                return_value={"baseUrl": "https://example.test/v1", "model": "vision", "apiKey": "sk-test"},
            ),
            patch.object(
                position_import,
                "call_openai_compatible_completion",
                side_effect=completions,
            ) as completion_mock,
        ):
            result = position_import.recognize_position_screenshot(
                "data:image/png;base64,AAAA"
            )

        self.assertEqual(completion_mock.call_count, 2)
        self.assertEqual(result["trades"][0]["ticker"], "NOK")
        repair_messages = completion_mock.call_args_list[1].kwargs["messages"]
        self.assertEqual(repair_messages[-2]["role"], "assistant")
        self.assertIn("顶层必须包含", repair_messages[-1]["content"])

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
