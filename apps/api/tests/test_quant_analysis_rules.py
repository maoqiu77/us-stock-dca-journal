from __future__ import annotations

import unittest

from app.modules.quant_analysis.calendar import (
    add_us_trading_days,
    normalize_us_trading_date,
    reflection_eligible,
)
from app.modules.quant_analysis.engine import (
    build_input_signature,
    build_stage_plan,
    parse_structured_response,
)
from app.modules.quant_analysis.sources import (
    analyst_source_policy,
    evidence_for_ai,
    fundamentals_role,
)


class QuantAnalysisRulesTest(unittest.TestCase):
    def test_us_market_date_normalizes_weekends_and_observed_holidays(self) -> None:
        self.assertEqual(normalize_us_trading_date("2026-08-29"), "2026-08-28")
        self.assertEqual(normalize_us_trading_date("2026-07-04"), "2026-07-02")

    def test_reflection_unlocks_after_five_following_trading_days(self) -> None:
        self.assertEqual(add_us_trading_days("2026-08-21", 5), "2026-08-28")
        self.assertFalse(reflection_eligible("2026-08-21", "2026-08-27"))
        self.assertTrue(reflection_eligible("2026-08-21", "2026-08-28"))

    def test_historical_policy_disables_current_social_and_prediction_markets(self) -> None:
        policy = analyst_source_policy("2026-08-20", today="2026-08-29")

        self.assertFalse(policy["social"]["enabled"])
        self.assertEqual(policy["social"]["reason"], "historical_date")
        self.assertTrue(policy["macro"]["enabled"])
        self.assertFalse(policy["macro"]["polymarketEnabled"])

    def test_sample_evidence_never_enters_ai_and_etf_uses_fund_structure_role(self) -> None:
        self.assertIsNone(
            evidence_for_ai({"status": "sample", "data": {"close": 123.45}})
        )
        self.assertEqual(
            evidence_for_ai({"status": "available", "data": {"close": 123.45}}),
            {"close": 123.45},
        )
        self.assertEqual(fundamentals_role("ETF"), "etf_structure")
        self.assertEqual(fundamentals_role("EQUITY"), "company_fundamentals")

    def test_quick_and_deep_stage_plans_have_exact_estimated_call_counts(self) -> None:
        analysts = ["technical", "news"]
        quick = build_stage_plan("quick", analysts)
        deep = build_stage_plan("deep", analysts)

        self.assertEqual(len(quick), len(analysts) + 8)
        self.assertEqual(len(deep), len(analysts) + 18)
        self.assertEqual(
            [step["stepKey"] for step in quick[:2]],
            ["analyst:technical", "analyst:news"],
        )
        self.assertEqual(len([step for step in deep if step["role"] == "bull"]), 3)
        self.assertEqual(len([step for step in deep if step["role"] == "risk_neutral"]), 3)

    def test_signature_is_stable_and_structured_parser_accepts_json_fences(self) -> None:
        first = build_input_signature(
            ticker="AAPL",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["news", "technical"],
            model="test-model",
        )
        second = build_input_signature(
            ticker="AAPL",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["technical", "news"],
            model="test-model",
        )

        self.assertEqual(first, second)
        self.assertEqual(
            parse_structured_response('```json\n{"rating":"持有"}\n```'),
            {"rating": "持有"},
        )


if __name__ == "__main__":
    unittest.main()
