from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd
import requests
from fastapi import HTTPException

from app.modules import ai_advice, ai_settings


class AiAdvicePromptTest(unittest.TestCase):
    def test_ai_context_v3_normalizes_facts_and_market_observations(self) -> None:
        trades = [
            {
                "date": f"2026-07-{day:02d}",
                "ticker": "QQQM" if day % 2 else "NVDA",
                "action": "买入" if day % 3 else "卖出",
                "amount": float(day * 100),
                "unitPrice": float(day + 100),
                "shares": float(day) / 10,
                "note": "保留中文备注",
            }
            for day in range(1, 26)
        ]

        context = ai_advice.build_ai_context_v3(
            summary={"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            state={"trades": trades},
            positions=[
                {
                    "ticker": "QQQM",
                    "assetType": "ETF",
                    "targetWeight": 0.35,
                    "shares": 3,
                    "costBasis": 200,
                    "holdingCost": 600,
                    "takeProfitPct": 0,
                    "stopLossPct": 0.1,
                }
            ],
            quotes=[{"ticker": "QQQM", "price": 210, "source": "yahoo"}],
            signals=[
                {
                    "ticker": "QQQM",
                    "source": "yahoo",
                    "action": "关注趋势变化",
                    "status": "中期走弱",
                    "suggested_amount": 300,
                    "suggested_shares": 1.4,
                    "ma120": 220,
                    "rsi": 48,
                    "drawdown252": 0.1,
                    "reasons": ["现价低于 MA60"],
                    "blocked_reasons": [],
                }
            ],
            intraday_context=[
                {
                    "ticker": "QQQM",
                    "source": "yahoo",
                    "latest": 210,
                    "entry_timing": "等待回踩",
                    "last_bar_time": "2026-07-25T15:55:00-04:00",
                }
            ],
            context={
                "beijing_time": "2026-07-26 03:55",
                "new_york_time": "2026-07-25 15:55",
                "is_regular_session": True,
            },
        )

        self.assertEqual(context["meta"]["version"], "AIContext v3")
        self.assertEqual(context["meta"]["prompt_language"], "en")
        self.assertEqual(context["meta"]["response_language"], "zh-CN")
        self.assertEqual(context["account"]["cash_basis"], "estimated_from_historical_cost")
        self.assertFalse(context["account"]["is_broker_realtime_cash"])
        self.assertNotIn("strategy_policy", context)
        self.assertEqual(context["positions"][0]["position_state"], "held")
        self.assertEqual(context["trade_context"]["total_count"], 25)
        self.assertEqual(len(context["trade_context"]["recent"]), 20)
        self.assertEqual(context["trade_context"]["recent"][-1]["action"], "buy")
        self.assertEqual(context["trade_context"]["recent"][-1]["note"], "保留中文备注")
        self.assertEqual(len(context["market_observations"]), 1)
        decision = context["market_observations"][0]
        self.assertEqual(decision["ticker"], "QQQM")
        self.assertEqual(decision["quote"]["price"], 210)
        self.assertNotIn("entry_timing", decision["intraday"])
        observation = decision["technical_observation"]
        self.assertEqual(observation["action"], "关注趋势变化")
        self.assertEqual(observation["status"], "中期走弱")
        self.assertNotIn("suggested_amount", observation)
        self.assertNotIn("suggested_shares", observation)
        self.assertEqual(observation["reasons_source_text"], ["现价低于 MA60"])

    def test_v3_prompts_use_market_facts_without_hidden_strategy(self) -> None:
        arguments = {
            "summary": {"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            "state": {
                "trades": [
                    {
                        "date": "2026-08-12",
                        "ticker": "NVDA",
                        "action": "买入",
                        "amount": 500,
                        "unitPrice": 100,
                        "shares": 5,
                        "note": "长期配置，不追高",
                    }
                ]
            },
            "positions": [
                {
                    "ticker": "NVDA",
                    "assetType": "STOCK",
                    "targetWeight": 0.2,
                    "shares": 5,
                    "costBasis": 100,
                    "holdingCost": 500,
                    "takeProfitPct": 0.5,
                    "stopLossPct": 0.15,
                }
            ],
            "quotes": [{"ticker": "NVDA", "price": 101, "source": "sample"}],
            "signals": [{"ticker": "NVDA", "action": "等待有效行情", "source": "sample"}],
            "intraday_context": [{"ticker": "NVDA", "latest": 101, "source": "sample"}],
            "context": {
                "beijing_time": "2026-08-13 00:30",
                "new_york_time": "2026-08-12 12:30",
                "is_regular_session": True,
            },
        }

        daily_prompt = ai_advice.build_external_advice_prompt(
            brief="今天英伟达是否适合加仓？",
            **arguments,
        )
        chat_prompt = ai_advice.build_chat_context_prompt(**arguments)

        for prompt in (daily_prompt, chat_prompt):
            self.assertIn("AIContext v3", prompt)
            self.assertIn("Respond in Simplified Chinese", prompt)
            self.assertIn('"cash_basis":"estimated_from_historical_cost"', prompt)
            self.assertIn('"precise_trigger_prices_allowed":false', prompt)
            self.assertNotIn("strategy_policy", prompt)
            self.assertNotIn("recent_funding", prompt)
            self.assertNotIn("target_weight", prompt)
        self.assertIn("今天英伟达是否适合加仓？", daily_prompt)
        self.assertIn("长期配置，不追高", daily_prompt)
        self.assertIn("no active portfolio strategy", daily_prompt)
        self.assertIn("Do not provide a specific buy/sell amount", daily_prompt)
        self.assertIn("omit prices instead of explaining the internal flag", daily_prompt)

        daily_system = ai_advice.daily_advice_system_prompt()
        chat_system = ai_advice.chat_system_prompt()
        for system_prompt in (daily_system, chat_system):
            self.assertIn("Respond in Simplified Chinese", system_prompt)
            self.assertNotIn("你是一个谨慎", system_prompt)

    def test_daily_prompt_requires_a_short_chinese_only_user_facing_answer(self) -> None:
        prompt = ai_advice.build_external_advice_prompt(
            brief="今天有什么操作？",
            summary={"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            state={"trades": []},
            positions=[],
            quotes=[],
            signals=[],
            intraday_context=[],
            context={"beijing_time": "2026-08-13 00:50", "is_regular_session": True},
        )

        self.assertIn("Do not show internal field names", prompt)
        self.assertIn("Do not output English enum values", prompt)
        self.assertIn("Do not use a table", prompt)
        self.assertIn("Keep the entire answer under 500 Chinese characters", prompt)
        self.assertNotIn("Provide one decision row per ticker", prompt)
        self.assertNotIn("Cite relevant AIContext field paths", prompt)
        self.assertNotIn("strategy-feedback section", prompt)
        self.assertIn("CURRENT_OVERVIEW_TICKERS", prompt)
        self.assertIn("cover every ticker", prompt)
        self.assertIn("结论：ACTION", prompt)
        self.assertIn("持有不动", prompt)
        self.assertIn("可以建仓", prompt)
        self.assertNotIn("at most 3 tickers", prompt)
        self.assertNotIn("Skip tickers with no action", prompt)

        system_prompt = ai_advice.daily_advice_system_prompt()
        self.assertIn("Never expose internal English keys", system_prompt)
        self.assertIn("under 500 Chinese characters", system_prompt)

        chat_prompt = ai_advice.build_chat_context_prompt(
            summary={"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            state={"trades": []},
            positions=[],
            quotes=[],
            signals=[],
            intraday_context=[],
            context={"beijing_time": "2026-08-13 00:50", "is_regular_session": True},
        )
        self.assertIn("under 300 Chinese characters", chat_prompt)
        self.assertIn("Do not expose internal English keys", chat_prompt)

    def test_external_prompt_lists_held_and_watching_tickers_in_overview_order(self) -> None:
        prompt = ai_advice.build_external_advice_prompt(
            brief="",
            summary={"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            state={"trades": []},
            positions=[
                {"ticker": "QQQM", "shares": 3},
                {"ticker": "NVDA", "shares": 0},
                {"ticker": "MSFT", "shares": 2},
            ],
            quotes=[],
            signals=[],
            intraday_context=[],
            context={"beijing_time": "2026-08-30 12:00"},
        )

        overview_section = prompt.split(
            "CURRENT_OVERVIEW_TICKERS (authoritative overview order and position state):\n",
            1,
        )[1]
        self.assertTrue(
            overview_section.startswith("- QQQM: held\n- NVDA: watching\n- MSFT: held\n")
        )

    def test_local_draft_gives_one_technical_observation_for_every_holding(self) -> None:
        content = ai_advice.build_local_advice_content(
            "",
            {"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            [
                {"ticker": "QQQM", "shares": 3},
                {"ticker": "NVDA", "shares": 0},
                {"ticker": "MSFT", "shares": 2},
            ],
            [
                {"ticker": "QQQM", "status": "趋势偏强", "reasons": ["现价高于 MA60 和 MA120"]},
                {"ticker": "MSFT", "status": "数据不足"},
            ],
            {"beijing_time": "2026-08-30 12:00", "estimated_session_status": "休市", "timing_suggestion": "等待"},
        )

        self.assertIn("- QQQM：趋势偏强，现价高于 MA60 和 MA120。", content)
        self.assertIn("- MSFT：数据不足，当前数据不足以判断技术状态。", content)
        self.assertNotIn("策略参数", content)
        self.assertNotIn("加仓", content)
        self.assertNotIn("- NVDA：", content)

    def test_chat_history_budget_keeps_latest_question_and_marks_truncation(self) -> None:
        messages = [
            {"role": "assistant", "content": "首份日报" + "甲" * 6000},
            {"role": "user", "content": "旧问题一" + "乙" * 4500},
            {"role": "assistant", "content": "旧回答一" + "丙" * 4500},
            {"role": "user", "content": "旧问题二" + "丁" * 4500},
            {"role": "assistant", "content": "旧回答二" + "戊" * 4500},
            {"role": "user", "content": "这是必须完整保留的最新问题"},
        ]

        result = ai_advice.budget_conversation_messages(messages)

        self.assertLessEqual(sum(len(item["content"]) for item in result), 12000)
        self.assertTrue(all(len(item["content"]) <= 4000 for item in result))
        self.assertEqual(result[-1], {"role": "user", "content": "这是必须完整保留的最新问题"})
        self.assertEqual(result[0]["role"], "assistant")
        self.assertIn("[truncated]", result[0]["content"])
        self.assertNotIn("旧问题一", [item["content"] for item in result])

    def test_beijing_late_evening_is_us_regular_session_during_daylight_saving_time(self) -> None:
        context = ai_advice.beijing_now_context(pd.Timestamp("2026-08-12 23:53", tz="Asia/Shanghai"))

        self.assertTrue(context["is_regular_session"])
        self.assertIn("美股常规交易时段内", context["estimated_session_status"])
        self.assertEqual(context["new_york_time"], "2026-08-12 11:53")

    def test_beijing_saturday_early_morning_uses_new_york_trading_day(self) -> None:
        context = ai_advice.beijing_now_context(pd.Timestamp("2026-08-15 02:00", tz="Asia/Shanghai"))

        self.assertTrue(context["is_regular_session"])
        self.assertEqual(context["new_york_time"], "2026-08-14 14:00")

    def test_advice_date_keeps_after_midnight_us_session_on_previous_date(self) -> None:
        before_close = ai_advice.beijing_now_context(
            pd.Timestamp("2026-08-14 03:59", tz="Asia/Shanghai")
        )
        at_close = ai_advice.beijing_now_context(
            pd.Timestamp("2026-08-14 04:00", tz="Asia/Shanghai")
        )

        self.assertEqual(before_close["beijing_date"], "2026-08-14")
        self.assertEqual(before_close["advice_date"], "2026-08-13")
        self.assertEqual(at_close["advice_date"], "2026-08-14")

    def test_external_prompt_forbids_contradicting_the_calculated_session(self) -> None:
        context = ai_advice.beijing_now_context(pd.Timestamp("2026-08-12 23:53", tz="Asia/Shanghai"))

        prompt = ai_advice.build_external_advice_prompt(
            brief="",
            summary={"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            state={"account": {}, "trades": []},
            positions=[],
            quotes=[],
            signals=[],
            intraday_context=[],
            context=context,
        )

        self.assertIn("Follow the session state exactly", prompt)
        self.assertIn('"is_regular_session":true', prompt)
        self.assertNotIn("等北京时间 21:30 后再确认", prompt)

    def test_clearing_today_chat_preserves_the_first_ai_summary(self) -> None:
        clear_today_chat = getattr(ai_advice, "clear_today_ai_advice_chat", None)
        self.assertIsNotNone(clear_today_chat)
        if clear_today_chat is None:
            return

        state = {
            "schemaVersion": 1,
            "records": {
                "2026-06-16": {
                    "date": "2026-06-16",
                    "generated_at": "2026-06-16 21:45",
                    "content": "首次总结",
                    "messages": [
                        {
                            "role": "assistant",
                            "content": "首次总结",
                            "created_at": "2026-06-16 21:45",
                        },
                        {
                            "role": "user",
                            "content": "今天适合加仓吗？",
                            "created_at": "2026-06-16 21:50",
                        },
                        {
                            "role": "assistant",
                            "content": "请结合实时行情确认。",
                            "created_at": "2026-06-16 21:51",
                        },
                    ],
                    "beijing_context": {},
                    "extra_question": "",
                    "prompt": "",
                    "news": [],
                    "source": "external-ai",
                }
            },
        }
        with (
            patch.object(ai_advice, "beijing_now_context", return_value={"beijing_date": "2026-06-16"}),
            patch.object(ai_advice, "load_ai_advice_state", return_value=state),
            patch.object(ai_advice, "save_ai_advice_state") as save_state,
            patch.object(ai_advice, "get_ai_advice_calendar", return_value={"today": "2026-06-16"}),
        ):
            clear_today_chat()

        saved_state = save_state.call_args.args[0]
        messages = saved_state["records"]["2026-06-16"]["messages"]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["content"], "首次总结")

    def test_chat_reply_preserves_the_daily_advice_generation_metadata(self) -> None:
        original_context = {
            "beijing_time": "2026-06-16 21:45",
            "beijing_date": "2026-06-16",
            "advice_date": "2026-06-16",
        }
        chat_context = {
            "beijing_time": "2026-06-16 22:30",
            "beijing_date": "2026-06-16",
            "advice_date": "2026-06-16",
        }
        current_record = {
            "date": "2026-06-16",
            "generated_at": chat_context["beijing_time"],
            "content": "首次总结",
            "messages": [
                {
                    "role": "assistant",
                    "content": "首次总结",
                    "created_at": original_context["beijing_time"],
                }
            ],
            "beijing_context": original_context,
            "extra_question": "",
            "prompt": "",
            "news": [],
            "source": "external-ai",
        }
        advice_state = {"schemaVersion": 1, "records": {"2026-06-16": current_record}}

        with (
            patch.object(
                ai_advice,
                "load_ai_settings",
                return_value={"apiKey": "test", "baseUrl": "https://example.test", "model": "test"},
            ),
            patch.object(ai_advice, "beijing_now_context", return_value=chat_context),
            patch.object(ai_advice, "load_trading_state", return_value={}),
            patch.object(ai_advice, "get_ai_advice_record", return_value=current_record),
            patch.object(ai_advice, "account_summary", return_value={}),
            patch.object(ai_advice, "derive_positions", return_value=[]),
            patch.object(ai_advice, "get_signal_rows", return_value=[]),
            patch.object(ai_advice, "get_effective_watchlist", return_value=[]),
            patch.object(ai_advice, "get_quotes", return_value=[]),
            patch.object(ai_advice, "build_intraday_market_context", return_value=[]),
            patch.object(ai_advice, "call_ai_response", return_value="追问回复"),
            patch.object(ai_advice, "load_ai_advice_state", return_value=advice_state),
            patch.object(ai_advice, "save_ai_advice_state") as save_state,
            patch.object(ai_advice, "get_ai_advice_calendar", return_value={"today": "2026-06-16"}),
        ):
            ai_advice.create_ai_chat_reply("继续追问")

        saved_record = save_state.call_args.args[0]["records"]["2026-06-16"]
        self.assertEqual(saved_record["generated_at"], original_context["beijing_time"])
        self.assertEqual(saved_record["beijing_context"], original_context)
        self.assertEqual(saved_record["messages"][-1]["created_at"], chat_context["beijing_time"])

    def test_external_prompt_excludes_hidden_position_strategy_fields(self) -> None:
        prompt = ai_advice.build_external_advice_prompt(
            brief="",
            summary={"totalAssets": 10000.0, "holdingCost": 3000.0, "cash": 7000.0},
            state={"account": {}, "trades": []},
            positions=[
                {
                    "ticker": "QQQM",
                    "assetType": "ETF",
                    "targetWeight": 0.35,
                    "shares": 3,
                    "costBasis": 200,
                },
                {
                    "ticker": "MRVL",
                    "assetType": "STOCK",
                    "targetWeight": 0.05,
                    "shares": 5,
                    "costBasis": 60,
                },
            ],
            quotes=[{"ticker": "MRVL", "price": 65, "source": "yahoo"}],
            signals=[],
            intraday_context=[],
            context={"beijing_time": "2026-06-16 21:45"},
        )

        self.assertIn("AIContext v3", prompt)
        self.assertIn('"asset_type":"etf"', prompt)
        self.assertIn('"asset_type":"stock"', prompt)
        self.assertNotIn("strategy_role", prompt)
        self.assertNotIn("target_weight", prompt)
        self.assertNotIn("take_profit_pct", prompt)
        self.assertNotIn("stop_loss_pct", prompt)
        self.assertNotIn("新闻", prompt)
        self.assertNotIn("Yahoo Finance", prompt)

    def test_intraday_summary_exposes_timing_levels(self) -> None:
        chart = {"range": "1d", "interval": "5m", "source": "yahoo"}
        bars = [
            {"time": "2026-06-16T13:30:00Z", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 10},
            {"time": "2026-06-16T13:35:00Z", "open": 100, "high": 103, "low": 100, "close": 102, "volume": 20},
            {"time": "2026-06-16T13:40:00Z", "open": 102, "high": 104, "low": 101, "close": 103, "volume": 30},
            {"time": "2026-06-16T13:45:00Z", "open": 103, "high": 105, "low": 102, "close": 104, "volume": 40},
            {"time": "2026-06-16T13:50:00Z", "open": 104, "high": 106, "low": 103, "close": 105, "volume": 50},
            {"time": "2026-06-16T13:55:00Z", "open": 105, "high": 107, "low": 104, "close": 106, "volume": 60},
        ]

        row = ai_advice.summarize_intraday_bars("NVDA", chart, bars)

        self.assertEqual(row["support_levels"], [104, 103, 99])
        self.assertEqual(row["resistance_levels"], [107, 106, 105])
        self.assertEqual(row["key_observation_price"], 104)
        self.assertEqual(row["entry_timing"], "等待回踩")
        self.assertIn("站稳", row["bullish_scenario"])
        self.assertIn("跌破", row["bearish_scenario"])

    def test_sanitized_record_preserves_saved_prompt(self) -> None:
        record = ai_advice.sanitize_ai_advice_record(
            {
                "date": "2026-06-16",
                "generated_at": "2026-06-16 21:45",
                "content": "生成时间：2026-06-16 21:45",
                "prompt": "发送给 AI 的上下文",
                "messages": [],
                "beijing_context": {},
                "news": [],
                "source": "external-ai",
            }
        )

        self.assertEqual(record["prompt"], "发送给 AI 的上下文")

    def test_call_ai_response_uses_responses_api(self) -> None:
        with (
            patch.object(
                ai_advice,
                "load_ai_settings",
                return_value={
                    "baseUrl": "https://example.test/v1",
                    "complexModel": "gpt-complex",
                    "simpleModel": "gpt-5.6-luna",
                    "apiKey": "sk-test",
                },
            ),
            patch.object(
                ai_settings.requests,
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
            content = ai_advice.call_ai_response(
                [
                    {"role": "system", "content": "system rules"},
                    {"role": "user", "content": "user prompt"},
                ]
            )

        self.assertEqual(content, "ok")
        self.assertEqual(post.call_args.args[0], "https://example.test/v1/responses")
        self.assertEqual(post.call_args.kwargs["json"]["model"], "gpt-complex")
        self.assertIs(post.call_args.kwargs["json"]["store"], False)
        self.assertEqual(post.call_args.kwargs["json"]["instructions"], "system rules")
        self.assertEqual(post.call_args.kwargs["json"]["input"], [{"role": "user", "content": "user prompt"}])

    def test_call_ai_response_falls_back_to_chat_completions(self) -> None:
        with (
            patch.object(
                ai_advice,
                "load_ai_settings",
                return_value={
                    "baseUrl": "https://example.test/v1",
                    "model": "gpt-test",
                    "apiKey": "sk-test",
                },
            ),
            patch.object(
                ai_settings.requests,
                "post",
                side_effect=[
                    FakeResponse(
                        {"error": "unsupported endpoint"},
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
                ],
            ) as post,
        ):
            content = ai_advice.call_ai_response(
                [
                    {"role": "system", "content": "system rules"},
                    {"role": "user", "content": "user prompt"},
                ]
            )

        self.assertEqual(content, "ok")
        self.assertEqual(
            [call.args[0] for call in post.call_args_list],
            [
                "https://example.test/v1/responses",
                "https://example.test/v1/chat/completions",
            ],
        )
        self.assertEqual(
            post.call_args.kwargs["json"]["messages"],
            [
                {"role": "system", "content": "system rules"},
                {"role": "user", "content": "user prompt"},
            ],
        )

    def test_call_ai_response_includes_provider_error_message(self) -> None:
        with (
            patch.object(
                ai_advice,
                "load_ai_settings",
                return_value={
                    "baseUrl": "https://example.test/v1",
                    "model": "gpt-test",
                    "apiKey": "sk-test",
                },
            ),
            patch.object(
                ai_settings.requests,
                "post",
                return_value=FakeResponse(
                    {
                        "error": {
                            "message": "Client not allowed (detected: python-requests/2.32.5)"
                        }
                    },
                    status_code=400,
                    reason="Bad Request",
                ),
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                ai_advice.call_ai_response([{"role": "user", "content": "user prompt"}])

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("Client not allowed", str(context.exception.detail))


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
        return None

    def json(self) -> dict[str, object]:
        return self.payload

    @property
    def text(self) -> str:
        return str(self.payload)


if __name__ == "__main__":
    unittest.main()
