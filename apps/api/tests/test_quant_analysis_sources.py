from __future__ import annotations

import unittest
from unittest.mock import patch

from app.modules.quant_analysis.sources import (
    InstrumentResolutionError,
    collect_analysis_sources,
    collect_technical,
    resolve_instrument,
)


class QuantAnalysisSourcesTest(unittest.TestCase):
    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_resolver_accepts_only_us_equity_or_etf(self, fetch_json) -> None:
        fetch_json.return_value = {
            "quotes": [
                {
                    "symbol": "QQQ",
                    "shortname": "Invesco QQQ Trust",
                    "quoteType": "ETF",
                    "exchange": "NGM",
                    "exchangeDisplay": "NASDAQ",
                }
            ]
        }

        resolved = resolve_instrument("qqq")

        self.assertEqual(resolved["ticker"], "QQQ")
        self.assertEqual(resolved["assetType"], "ETF")

        fetch_json.return_value = {
            "quotes": [
                {
                    "symbol": "VOD.L",
                    "shortname": "Vodafone",
                    "quoteType": "EQUITY",
                    "exchange": "LSE",
                }
            ]
        }
        with self.assertRaises(InstrumentResolutionError):
            resolve_instrument("VOD.L")

    @patch("app.modules.quant_analysis.sources.get_chart")
    def test_technical_sample_is_display_only_and_not_real_evidence(self, get_chart) -> None:
        get_chart.return_value = {
            "ticker": "AAPL",
            "source": "sample",
            "bars": [{"time": "2026-08-28", "close": 200}],
        }

        result = collect_technical("AAPL", "2026-08-28")

        self.assertEqual(result["status"], "sample")
        self.assertNotIn("data", result)
        self.assertEqual(result["samplePreview"]["latestClose"], 200)

    @patch("app.modules.quant_analysis.sources.collect_macro")
    @patch("app.modules.quant_analysis.sources.collect_social")
    def test_historical_collection_skips_social_and_current_polymarket(
        self, collect_social, collect_macro
    ) -> None:
        collect_macro.return_value = {
            "analyst": "macro",
            "status": "available",
            "data": {"fred": []},
            "sources": [],
        }

        results = collect_analysis_sources(
            ticker="AAPL",
            asset_type="EQUITY",
            effective_date="2026-08-20",
            analysts=["social", "macro"],
            today="2026-08-29",
        )

        collect_social.assert_not_called()
        collect_macro.assert_called_once_with("2026-08-20", include_polymarket=False)
        self.assertEqual(results["social"]["status"], "disabled")
        self.assertEqual(results["macro"]["status"], "available")


if __name__ == "__main__":
    unittest.main()
