from __future__ import annotations

import unittest
from unittest.mock import patch

from app.modules.quant_analysis.sources import (
    InstrumentResolutionError,
    collect_analysis_sources,
    collect_fundamentals,
    collect_macro,
    collect_social,
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

    @patch("app.modules.quant_analysis.sources.collect_macro")
    @patch("app.modules.quant_analysis.sources.collect_social")
    def test_current_weekend_request_keeps_live_sources_enabled(
        self, collect_social_source, collect_macro_source
    ) -> None:
        collect_social_source.return_value = {
            "analyst": "social",
            "status": "available",
            "data": {"items": [{"title": "current"}]},
            "sources": [],
        }
        collect_macro_source.return_value = {
            "analyst": "macro",
            "status": "available",
            "data": {"fred": []},
            "sources": [],
        }

        results = collect_analysis_sources(
            ticker="AAPL",
            asset_type="EQUITY",
            effective_date="2026-08-28",
            requested_date="2026-08-30",
            analysts=["social", "macro"],
            today="2026-08-30",
        )

        collect_social_source.assert_called_once_with("AAPL")
        collect_macro_source.assert_called_once_with("2026-08-28", include_polymarket=True)
        self.assertEqual(results["social"]["status"], "available")

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_fundamentals_falls_back_to_nasdaq_summary(self, fetch_json) -> None:
        fetch_json.return_value = {
            "data": {
                "summaryData": {
                    "MarketCap": {"label": "Market Cap", "value": "3.2T"},
                    "Sector": {"label": "Sector", "value": "Technology"},
                }
            }
        }

        with patch.dict("sys.modules", {"yfinance": None}):
            result = collect_fundamentals("AAPL", "EQUITY", "2026-08-28")

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["sources"][0]["name"], "nasdaq")
        self.assertEqual(
            result["data"]["summaryFields"]["Sector"]["value"], "Technology"
        )

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_social_falls_back_to_hacker_news_discussion(self, fetch_json) -> None:
        fetch_json.side_effect = [
            RuntimeError("stocktwits blocked"),
            RuntimeError("reddit blocked"),
            {
                "hits": [
                    {
                        "objectID": "123",
                        "comment_text": "<p>$AAPL looks strong</p>",
                        "created_at": "2026-08-30T01:00:00Z",
                    }
                ]
            },
        ]

        result = collect_social("AAPL")

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"]["sampleSize"], 1)
        self.assertEqual(result["data"]["items"][0]["title"], "$AAPL looks strong")
        self.assertEqual(result["sources"][0]["name"], "hacker-news")

    @patch("app.modules.quant_analysis.sources.load_research_settings")
    @patch("app.modules.quant_analysis.sources._fetch_json")
    @patch("app.modules.quant_analysis.sources._fetch_fred_csv_observation")
    def test_macro_uses_keyless_fred_csv_fallback(
        self, fetch_fred, fetch_json, load_settings
    ) -> None:
        load_settings.return_value = {"fredApiKey": ""}
        fetch_fred.side_effect = lambda series_id, effective_date: {
            "date": effective_date,
            "value": "4.5",
        }
        fetch_json.side_effect = RuntimeError("other providers blocked")

        result = collect_macro("2026-08-28", include_polymarket=False)

        self.assertEqual(result["status"], "available")
        self.assertEqual(len(result["data"]["fred"]), 4)
        self.assertEqual(result["sources"][0]["name"], "fred")


if __name__ == "__main__":
    unittest.main()
