from __future__ import annotations

import unittest

from pydantic import ValidationError


class QuantAnalysisContractTest(unittest.TestCase):
    def test_run_request_normalizes_ticker_and_keeps_selected_analysts(self) -> None:
        from app.api_models import QuantAnalysisRunRequest

        request = QuantAnalysisRunRequest.model_validate(
            {
                "ticker": " brk-b ",
                "analysisDate": "2026-08-28",
                "mode": "quick",
                "analysts": ["technical", "news"],
                "reflectionEnabled": True,
            }
        )

        self.assertEqual(request.ticker, "BRK-B")
        self.assertEqual([item.value for item in request.analysts], ["technical", "news"])
        self.assertFalse(request.forceRegenerate)

    def test_run_request_rejects_empty_analyst_selection(self) -> None:
        from app.api_models import QuantAnalysisRunRequest

        with self.assertRaises(ValidationError):
            QuantAnalysisRunRequest.model_validate(
                {
                    "ticker": "NVDA",
                    "analysisDate": "2026-08-28",
                    "mode": "quick",
                    "analysts": [],
                }
            )

    def test_run_request_rejects_invalid_ticker_and_future_date(self) -> None:
        from app.api_models import QuantAnalysisRunRequest

        for payload in (
            {
                "ticker": "../NVDA",
                "analysisDate": "2026-08-28",
                "mode": "quick",
                "analysts": ["technical"],
            },
            {
                "ticker": "NVDA",
                "analysisDate": "2099-01-01",
                "mode": "quick",
                "analysts": ["technical"],
            },
        ):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                QuantAnalysisRunRequest.model_validate(payload)

    def test_research_settings_contract_rejects_non_string_key(self) -> None:
        from app.api_models import ResearchSettingsUpdateRequest

        with self.assertRaises(ValidationError):
            ResearchSettingsUpdateRequest.model_validate({"fredApiKey": 123})


if __name__ == "__main__":
    unittest.main()
