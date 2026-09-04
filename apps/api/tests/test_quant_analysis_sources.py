from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.modules.quant_analysis import sources
from app.modules.quant_analysis.sources import (
    InstrumentResolutionError,
    collect_analysis_sources,
    collect_fundamentals,
    collect_macro,
    collect_news,
    collect_social,
    collect_technical,
    resolve_instrument,
)


def nasdaq_fundamentals_fetch(
    *, report_dates: tuple[str, ...], financial_periods: tuple[str, ...]
):
    def fetch(url, *, params=None, timeout=10):
        if url == sources.NASDAQ_SUMMARY_URL.format(ticker="AAPL"):
            return {
                "data": {
                    "summaryData": {
                        "MarketCap": {"label": "Market Cap", "value": "3.2T"},
                        "Sector": {"label": "Sector", "value": "Technology"},
                    }
                }
            }
        if url == sources.NASDAQ_INFO_URL.format(ticker="AAPL"):
            return {
                "data": {
                    "primaryData": {
                        "lastTradeTimestamp": "Aug 28, 2026 4:00 PM ET"
                    }
                }
            }
        if url == sources.NASDAQ_FINANCIALS_URL.format(ticker="AAPL"):
            headers = {"value1": "Quarterly Ending:"}
            revenue = {"value1": "Total Revenue"}
            net_income = {"value1": "Net Income"}
            for index, period in enumerate(financial_periods, start=2):
                headers[f"value{index}"] = period
                revenue[f"value{index}"] = f"${index * 100}"
                net_income[f"value{index}"] = f"${index * 10}"
            return {
                "data": {
                    "incomeStatementTable": {
                        "headers": headers,
                        "rows": [revenue, net_income],
                    }
                }
            }
        if url == sources.NASDAQ_EARNINGS_SURPRISE_URL.format(ticker="AAPL"):
            return {
                "data": {
                    "earningsSurpriseTable": {
                        "rows": [
                            {
                                "dateReported": report_date,
                                "eps": 1.25,
                                "consensusForecast": "1.20",
                            }
                            for report_date in report_dates
                        ]
                    }
                }
            }
        if url == sources.NASDAQ_EARNINGS_FORECAST_URL.format(ticker="AAPL"):
            return {
                "data": {
                    "quarterlyForecast": {
                        "rows": [
                            {
                                "fiscalEnd": "Sep 2026",
                                "consensusEPSForecast": 1.3,
                                "up": 3,
                                "down": 1,
                            }
                        ]
                    }
                }
            }
        raise AssertionError(f"Unexpected URL: {url}")

    return fetch


def nasdaq_etf_fetch(url, *, params=None, timeout=10):
    if url == sources.NASDAQ_SUMMARY_URL.format(ticker="QQQ"):
        return {
            "data": {
                "summaryData": {
                    "AUM": {"label": "AUM", "value": "$400B"},
                    "ExpenseRatio": {
                        "label": "Expense Ratio",
                        "value": "0.18%",
                    },
                    "Sector": {"label": "Sector", "value": "Technology"},
                }
            }
        }
    if url == sources.NASDAQ_INFO_URL.format(ticker="QQQ"):
        return {
            "data": {
                "primaryData": {
                    "lastTradeTimestamp": "Aug 28, 2026 4:00 PM ET"
                }
            }
        }
    raise AssertionError(f"Unexpected URL: {url}")


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
    @patch("app.modules.quant_analysis.sources.collect_fundamentals")
    def test_historical_collection_skips_social_and_current_polymarket(
        self, collect_fundamentals, collect_social, collect_macro
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
            analysts=["fundamentals", "social", "macro"],
            today="2026-08-29",
        )

        collect_fundamentals.assert_not_called()
        collect_social.assert_not_called()
        collect_macro.assert_called_once_with(
            "2026-08-20", include_polymarket=False, historical=True
        )
        self.assertEqual(results["fundamentals"]["status"], "disabled")
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

        collect_social_source.assert_called_once_with("AAPL", "2026-08-30")
        collect_macro_source.assert_called_once_with(
            "2026-08-28", include_polymarket=True, historical=False
        )
        self.assertEqual(results["social"]["status"], "available")

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_company_fundamentals_require_recent_report_and_financials(
        self, fetch_json
    ) -> None:
        fetch_json.side_effect = nasdaq_fundamentals_fetch(
            report_dates=("9/1/2026", "8/27/2026", "5/27/2026"),
            financial_periods=("9/30/2026", "8/1/2026", "5/2/2026"),
        )

        with patch.dict("sys.modules", {"yfinance": None}):
            result = collect_fundamentals("AAPL", "EQUITY", "2026-08-28")

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"]["freshnessStatus"], "fresh")
        self.assertEqual(result["data"]["latestReportDate"], "2026-08-27")
        self.assertEqual(result["data"]["latestReportAgeDays"], 1)
        self.assertEqual(result["data"]["latestFinancialPeriodEnd"], "2026-08-01")
        self.assertEqual(result["data"]["quarterlyFinancials"]["periods"], [
            "2026-08-01",
            "2026-05-02",
        ])
        self.assertEqual(
            result["data"]["quarterlyFinancials"]["unit"], "USD thousands"
        )
        self.assertEqual(
            result["data"]["summaryFields"]["Sector"]["value"], "Technology"
        )
        self.assertIn("nasdaq-financials", [item["name"] for item in result["sources"]])

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_company_fundamentals_age_and_reject_stale_reports(
        self, fetch_json
    ) -> None:
        fetch_json.side_effect = nasdaq_fundamentals_fetch(
            report_dates=("7/1/2026",),
            financial_periods=("6/30/2026",),
        )
        with patch.dict("sys.modules", {"yfinance": None}):
            aging = collect_fundamentals("AAPL", "EQUITY", "2026-08-28")

        self.assertEqual(aging["status"], "available")
        self.assertEqual(aging["data"]["freshnessStatus"], "aging")
        self.assertLess(aging["data"]["freshnessWeight"], 1)
        self.assertTrue(aging["data"]["dataLimitations"])

        fetch_json.side_effect = nasdaq_fundamentals_fetch(
            report_dates=("5/1/2026",),
            financial_periods=("4/30/2026",),
        )
        with patch.dict("sys.modules", {"yfinance": None}):
            stale = collect_fundamentals("AAPL", "EQUITY", "2026-08-28")

        self.assertEqual(stale["status"], "unavailable")
        self.assertIn("超过 100 天有效期", stale["error"])

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_etf_structure_uses_current_nasdaq_snapshot(self, fetch_json) -> None:
        fetch_json.side_effect = nasdaq_etf_fetch

        with patch.dict("sys.modules", {"yfinance": None}):
            result = collect_fundamentals("QQQ", "ETF", "2026-08-28")

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"]["freshnessStatus"], "current_snapshot")
        self.assertEqual(result["data"]["snapshotAsOf"], "2026-08-28")
        self.assertEqual(result["data"]["summaryFields"]["ExpenseRatio"]["value"], "0.18%")

    @patch("app.modules.quant_analysis.sources._fetch_json")
    @patch("app.modules.quant_analysis.sources._fetch_reddit_rss")
    def test_social_falls_back_to_hacker_news_discussion(
        self, fetch_reddit, fetch_json
    ) -> None:
        fetch_reddit.side_effect = RuntimeError("reddit blocked")
        fetch_json.side_effect = [
            RuntimeError("stocktwits blocked"),
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

        result = collect_social("AAPL", "2026-08-30")

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"]["sampleSize"], 1)
        self.assertEqual(result["data"]["windowDays"], 14)
        self.assertEqual(result["data"]["windowStart"], "2026-08-17")
        self.assertEqual(result["data"]["items"][0]["title"], "$AAPL looks strong")
        self.assertEqual(result["sources"][0]["name"], "hacker-news")
        hacker_news_params = fetch_json.call_args_list[1].kwargs["params"]
        self.assertIn("created_at_i>=", hacker_news_params["numericFilters"])

    @patch("app.modules.quant_analysis.sources._fetch_json")
    @patch("app.modules.quant_analysis.sources._fetch_reddit_rss")
    def test_social_keeps_only_recent_two_week_reddit_posts(
        self, fetch_reddit, fetch_json
    ) -> None:
        fetch_json.side_effect = RuntimeError("stocktwits blocked")
        fetch_reddit.return_value = [
            {
                "title": "recent MRVL discussion",
                "selftext": "new evidence",
                "created_utc": datetime(2026, 8, 17, tzinfo=timezone.utc).timestamp(),
                "url": "https://www.reddit.com/r/stocks/recent",
            },
            {
                "title": "stale MRVL discussion",
                "selftext": "old evidence",
                "created_utc": datetime(2026, 8, 16, 23, 59, tzinfo=timezone.utc).timestamp(),
                "url": "https://www.reddit.com/r/stocks/stale",
            },
        ]

        result = collect_social("MRVL", "2026-08-30")

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"]["sampleSize"], 1)
        self.assertEqual(
            result["data"]["items"][0]["title"], "recent MRVL discussion"
        )
        self.assertEqual(result["sources"][0]["name"], "reddit")

    @patch("app.modules.quant_analysis.sources.requests.get")
    def test_reddit_rss_parser_returns_dated_posts(self, get) -> None:
        body = b"""<?xml version='1.0' encoding='UTF-8'?>
        <feed xmlns='http://www.w3.org/2005/Atom'>
          <entry>
            <title>MRVL earnings discussion</title>
            <published>2026-08-29T10:00:00Z</published>
            <content type='html'>&lt;p&gt;Recent outlook&lt;/p&gt;</content>
            <link href='https://www.reddit.com/r/stocks/comments/abc' />
          </entry>
        </feed>"""
        get.return_value = StreamingResponse(200, body)

        posts = sources._fetch_reddit_rss("MRVL")

        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["title"], "MRVL earnings discussion")
        self.assertEqual(posts[0]["selftext"], "Recent outlook")
        self.assertEqual(
            posts[0]["url"], "https://www.reddit.com/r/stocks/comments/abc"
        )
        self.assertGreater(posts[0]["created_utc"], 0)

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

    def test_historical_fred_api_pins_vintage(self) -> None:
        fred_params: list[dict[str, object]] = []

        def fetch(url, *, params=None, timeout=10, **kwargs):
            if url == sources.FRED_OBSERVATIONS_URL:
                fred_params.append(params)
                return {"observations": [{"date": "2026-08-01", "value": "4.5"}]}
            return {"news": []}

        with (
            patch.object(sources, "load_research_settings", return_value={"fredApiKey": "key"}),
            patch.object(sources, "_fetch_json", side_effect=fetch),
            patch.object(sources, "_fetch_fred_csv_observation") as csv_fallback,
        ):
            result = collect_macro(
                "2026-08-20", include_polymarket=False, historical=True
            )

        self.assertEqual(result["data"]["fredVintage"], "2026-08-20")
        self.assertEqual(len(fred_params), 4)
        self.assertTrue(
            all(params["realtime_start"] == "2026-08-20" for params in fred_params)
        )
        self.assertTrue(
            all(params["realtime_end"] == "2026-08-20" for params in fred_params)
        )
        csv_fallback.assert_not_called()

    def test_historical_fred_without_key_never_uses_current_csv_vintage(self) -> None:
        with (
            patch.object(sources, "load_research_settings", return_value={"fredApiKey": ""}),
            patch.object(sources, "_fetch_json", return_value={"news": []}),
            patch.object(sources, "_fetch_fred_csv_observation") as csv_fallback,
        ):
            result = collect_macro(
                "2026-08-20", include_polymarket=False, historical=True
            )

        csv_fallback.assert_not_called()
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("vintage", result["error"])

    @patch("app.modules.quant_analysis.sources.get_chart")
    def test_technical_rejects_unsettled_latest_bar(self, get_chart) -> None:
        get_chart.return_value = {
            "ticker": "AAPL",
            "source": "yahoo",
            "incompleteLatestBar": "2026-08-28",
            "bars": [{"time": "2026-08-27", "close": 200}],
        }

        result = collect_technical("AAPL", "2026-08-28")

        self.assertEqual(result["status"], "unavailable")
        self.assertIn("尚无完整收盘价", result["error"])
        get_chart.assert_called_once()

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_news_uses_seven_day_half_open_window(self, fetch_json) -> None:
        def epoch(value: str) -> float:
            return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()

        fetch_json.return_value = {
            "quotes": [
                {
                    "symbol": "AAPL",
                    "shortname": "Apple Inc.",
                }
            ],
            "news": [
                {
                    "title": "Apple inside",
                    "providerPublishTime": epoch("2026-08-28T12:00:00"),
                    "relatedTickers": ["AAPL"],
                },
                {
                    "title": "Apple too old",
                    "providerPublishTime": epoch("2026-08-21T23:59:59"),
                    "relatedTickers": ["AAPL"],
                },
                {
                    "title": "Apple future",
                    "providerPublishTime": epoch("2026-08-29T00:00:00"),
                    "relatedTickers": ["AAPL"],
                },
            ]
        }

        result = collect_news("AAPL", "2026-08-28")

        self.assertEqual(
            [item["title"] for item in result["data"]["items"]], ["Apple inside"]
        )
        self.assertEqual(result["data"]["windowStart"], "2026-08-22")

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_news_filters_weak_links_and_weights_newer_items_more(
        self, fetch_json
    ) -> None:
        def epoch(value: str) -> float:
            return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()

        fetch_json.return_value = {
            "quotes": [
                {
                    "symbol": "MRVL",
                    "shortname": "Marvell Technology, Inc.",
                }
            ],
            "news": [
                {
                    "title": "Qualcomm outlook changes",
                    "providerPublishTime": epoch("2026-08-28T22:00:00"),
                    "relatedTickers": ["QCOM", "MRVL"],
                },
                {
                    "title": "Marvell expands its AI silicon roadmap",
                    "providerPublishTime": epoch("2026-08-28T20:00:00"),
                    "relatedTickers": ["MRVL"],
                    "link": "https://example.com/new?tracking=1",
                },
                {
                    "title": "Marvell expands its AI silicon roadmap",
                    "providerPublishTime": epoch("2026-08-28T19:00:00"),
                    "relatedTickers": ["MRVL"],
                    "link": "https://example.com/duplicate",
                },
                {
                    "title": "MRVL older direct update",
                    "providerPublishTime": epoch("2026-08-23T12:00:00"),
                    "relatedTickers": ["MRVL"],
                },
                {
                    "title": "Semiconductor market recap",
                    "providerPublishTime": epoch("2026-08-28T21:00:00"),
                    "relatedTickers": ["MRVL", "NVDA"],
                },
            ],
        }

        result = collect_news("MRVL", "2026-08-28")

        titles = [item["title"] for item in result["data"]["items"]]
        self.assertNotIn("Qualcomm outlook changes", titles)
        self.assertEqual(titles.count("Marvell expands its AI silicon roadmap"), 1)
        self.assertEqual(titles[0], "Marvell expands its AI silicon roadmap")
        self.assertIn("Semiconductor market recap", titles)
        scores = {
            item["title"]: item["importanceScore"]
            for item in result["data"]["items"]
        }
        self.assertGreater(
            scores["Marvell expands its AI silicon roadmap"],
            scores["MRVL older direct update"],
        )

    @patch("app.modules.quant_analysis.sources._fetch_json")
    def test_news_uses_nasdaq_summaries_when_yahoo_is_unavailable(
        self, fetch_json
    ) -> None:
        fetch_json.side_effect = [
            RuntimeError("Yahoo blocked"),
            {
                "data": {
                    "rows": [
                        {
                            "title": "Marvell AI growth still faces valuation risk",
                            "description": "Recent growth is strong, but valuation is elevated.",
                            "created": "Aug 28, 2026",
                            "publisher": "The Motley Fool",
                            "primarysymbol": "mrvl",
                            "related_symbols": ["mrvl|stocks"],
                            "url": "/articles/marvell-update",
                        },
                        {
                            "title": "Qualcomm outlook",
                            "description": "This article is about Qualcomm.",
                            "created": "Aug 28, 2026",
                            "publisher": "Example",
                            "primarysymbol": "qcom",
                            "related_symbols": ["qcom|stocks", "mrvl|stocks"],
                            "url": "/articles/qualcomm-update",
                        },
                    ]
                }
            },
        ]

        result = collect_news("MRVL", "2026-08-28")

        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"]["sampleSize"], 1)
        self.assertEqual(
            result["data"]["items"][0]["summary"],
            "Recent growth is strong, but valuation is elevated.",
        )
        self.assertEqual(result["sources"][0]["name"], "nasdaq-news")

    def test_reddit_rss_retry_honors_zero_and_caps_response(self) -> None:
        payload = b"""<?xml version='1.0' encoding='UTF-8'?>
        <feed xmlns='http://www.w3.org/2005/Atom'></feed>"""
        responses = [
            StreamingResponse(429, b"", headers={"Retry-After": "0"}),
            StreamingResponse(200, payload),
        ]
        with (
            patch.object(sources.requests, "get", side_effect=responses),
            patch.object(sources.time_module, "sleep") as sleep,
        ):
            result = sources._fetch_reddit_rss("MRVL")

        self.assertEqual(result, [])
        sleep.assert_called_once_with(0.0)
        self.assertTrue(all(response.closed for response in responses))

        oversized = StreamingResponse(200, b"x" * 11)
        with (
            patch.object(sources.requests, "get", return_value=oversized),
            patch.object(sources, "REDDIT_MAX_RESPONSE_BYTES", 10),
        ):
            with self.assertRaisesRegex(ValueError, "超过 10 字节限制"):
                sources._fetch_reddit_rss("MRVL")


class StreamingResponse:
    def __init__(
        self, status_code: int, body: bytes, *, headers: dict[str, str] | None = None
    ) -> None:
        self.status_code = status_code
        self.body = body
        self.headers = headers or {}
        self.closed = False

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise sources.requests.HTTPError(str(self.status_code), response=self)

    def iter_content(self, chunk_size: int):
        for index in range(0, len(self.body), chunk_size):
            yield self.body[index : index + chunk_size]

    def close(self) -> None:
        self.closed = True


if __name__ == "__main__":
    unittest.main()
