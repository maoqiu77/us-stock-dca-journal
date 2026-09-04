from __future__ import annotations

import json
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.modules import market


class MarketCacheTest(unittest.TestCase):
    def setUp(self) -> None:
        market.NASDAQ_JSON_CACHE.clear()

    def tearDown(self) -> None:
        market.NASDAQ_JSON_CACHE.clear()

    def test_fetch_json_force_refresh_bypasses_cached_payload(self) -> None:
        url = "https://example.test/quote"
        market.NASDAQ_JSON_CACHE[url] = (
            market.datetime.now(market.timezone.utc),
            {"cached": True},
        )

        class Response:
            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def read(self) -> bytes:
                return json.dumps({"fresh": True}).encode("utf-8")

        with patch.object(market.request, "urlopen", return_value=Response()) as urlopen:
            payload = market._fetch_json(url, timeout=5, force_refresh=True)

        self.assertEqual(payload, {"fresh": True})
        self.assertEqual(market.NASDAQ_JSON_CACHE[url][1], {"fresh": True})
        self.assertEqual(urlopen.call_count, 1)

    def test_nasdaq_cache_ttl_matches_quote_polling_interval(self) -> None:
        self.assertEqual(market.NASDAQ_CACHE_TTL, market.timedelta(seconds=15))

    def test_get_quotes_prefers_yahoo_http_then_uses_nasdaq_for_missing_tickers(self) -> None:
        symbols = [
            {"ticker": "SMCI", "name": "SMCI", "market": "US"},
            {"ticker": "NVDA", "name": "NVDA", "market": "US"},
        ]

        with (
            patch.object(
                market,
                "_try_yahoo_quotes",
                return_value={
                    "SMCI": {
                        "price": 31.0,
                        "change": 0.5,
                        "changePercent": 1.64,
                        "volume": 100,
                        "source": "yahoo",
                    }
                },
                create=True,
            ) as yahoo_http_quotes,
            patch.object(
                market,
                "_try_yfinance_quotes",
                return_value={},
            ) as yfinance_quotes,
            patch.object(
                market,
                "_try_nasdaq_quotes",
                return_value={
                    "NVDA": {
                        "price": 212.0,
                        "change": 1.0,
                        "changePercent": 0.47,
                        "volume": 200,
                        "source": "nasdaq",
                    }
                },
            ) as nasdaq_quotes,
        ):
            quotes = market.get_quotes(symbols, force_refresh=True)

        yahoo_http_quotes.assert_called_once_with(["SMCI", "NVDA"], force_refresh=True)
        yfinance_quotes.assert_called_once_with(["NVDA"])
        nasdaq_quotes.assert_called_once_with(["NVDA"], force_refresh=True)
        self.assertEqual([quote["source"] for quote in quotes], ["yahoo", "nasdaq"])

    def test_yahoo_quote_http_response_is_parsed_as_yahoo_source(self) -> None:
        payload = {
            "quoteResponse": {
                "result": [
                    {
                        "symbol": "SMCI",
                        "regularMarketPrice": 31.25,
                        "regularMarketChange": 0.79,
                        "regularMarketChangePercent": 2.59,
                        "regularMarketVolume": 123456,
                    }
                ]
            }
        }

        with patch.object(market, "_fetch_json", return_value=payload):
            quotes = market._try_yahoo_quotes(["SMCI"], force_refresh=True)

        self.assertEqual(
            quotes["SMCI"],
            {
                "price": 31.25,
                "change": 0.79,
                "changePercent": 2.59,
                "volume": 123456,
                "source": "yahoo",
            },
        )

    def test_get_chart_prefers_yahoo_http_then_yfinance_before_nasdaq(self) -> None:
        yahoo_chart = {
            "ticker": "SMCI",
            "range": "1d",
            "interval": "1m",
            "seriesType": "line",
            "timezone": "America/New_York",
            "source": "yahoo",
            "lastUpdated": "2026-06-16T00:00:00+00:00",
            "bars": [],
        }

        with (
            patch.object(market, "_try_yahoo_chart", return_value=None) as yahoo,
            patch.object(
                market,
                "_try_yfinance_chart",
                return_value=yahoo_chart,
            ) as yfinance,
            patch.object(market, "_try_nasdaq_intraday_chart") as nasdaq_intraday,
            patch.object(market, "_try_nasdaq_chart") as nasdaq_daily,
        ):
            chart = market.get_chart("SMCI", "1d", "1m")

        self.assertEqual(chart, yahoo_chart)
        yahoo.assert_called_once_with("SMCI", "1d", "1m", force_refresh=False)
        yfinance.assert_called_once_with("SMCI", "1d", "1m")
        nasdaq_intraday.assert_not_called()
        nasdaq_daily.assert_not_called()

    def test_yahoo_chart_supports_daily_intervals(self) -> None:
        payload = {
            "chart": {
                "result": [
                    {
                        "timestamp": [1772496000],
                        "meta": {"exchangeTimezoneName": "America/New_York"},
                        "indicators": {
                            "quote": [
                                {
                                    "open": [31.0],
                                    "high": [32.0],
                                    "low": [30.5],
                                    "close": [31.5],
                                    "volume": [123456],
                                }
                            ]
                        },
                    }
                ]
            }
        }

        with patch.object(market, "_fetch_json", return_value=payload):
            chart = market._try_yahoo_chart("SMCI", "1mo", "1d")

        self.assertIsNotNone(chart)
        self.assertEqual(chart["source"], "yahoo")
        self.assertEqual(chart["bars"][0]["time"], "2026-03-03")

    def test_yahoo_parser_surfaces_unsettled_latest_bar(self) -> None:
        payload = {
            "chart": {
                "result": [
                    {
                        "timestamp": [1772496000, 1772582400],
                        "meta": {"exchangeTimezoneName": "America/New_York"},
                        "indicators": {
                            "quote": [
                                {
                                    "open": [31.0, None],
                                    "high": [32.0, None],
                                    "low": [30.5, None],
                                    "close": [31.5, None],
                                    "volume": [123456, None],
                                }
                            ]
                        },
                    }
                ]
            }
        }

        timezone_name, bars, incomplete = market._parse_yahoo_chart_bars(
            payload, "SMCI", "1d"
        )

        self.assertEqual(timezone_name, "America/New_York")
        self.assertEqual(len(bars), 1)
        self.assertEqual(incomplete, "2026-03-04")

    def test_yahoo_history_chart_merges_newer_tail_bar(self) -> None:
        base_payload = {
            "chart": {
                "result": [
                    {
                        "timestamp": [1781136000, 1781222400],
                        "meta": {"exchangeTimezoneName": "America/New_York"},
                        "indicators": {
                            "quote": [
                                {
                                    "open": [100.0, 102.0],
                                    "high": [103.0, 104.0],
                                    "low": [99.0, 101.0],
                                    "close": [102.0, 103.0],
                                    "volume": [1000, 1200],
                                }
                            ]
                        },
                    }
                ]
            }
        }
        tail_payload = {
            "chart": {
                "result": [
                    {
                        "timestamp": [1781481600],
                        "meta": {"exchangeTimezoneName": "America/New_York"},
                        "indicators": {
                            "quote": [
                                {
                                    "open": [105.0],
                                    "high": [108.0],
                                    "low": [104.0],
                                    "close": [107.0],
                                    "volume": [2000],
                                }
                            ]
                        },
                    }
                ]
            }
        }

        with patch.object(
            market,
            "_fetch_yahoo_chart_payload",
            side_effect=[base_payload, tail_payload, base_payload, tail_payload],
        ):
            daily_chart = market._try_yahoo_history_chart("SMCI", "5y", "1d")
            weekly_chart = market._try_yahoo_history_chart("SMCI", "10y", "1wk")

        self.assertIsNotNone(daily_chart)
        self.assertEqual(daily_chart["bars"][-1]["time"], "2026-06-15")
        self.assertEqual(daily_chart["bars"][-1]["close"], 107.0)
        self.assertIsNotNone(weekly_chart)
        self.assertEqual(weekly_chart["bars"][-1]["time"], "2026-06-15")
        self.assertEqual(weekly_chart["bars"][-1]["open"], 105.0)
        self.assertEqual(weekly_chart["bars"][-1]["close"], 107.0)

    def test_yfinance_quotes_are_reported_as_yahoo_source(self) -> None:
        class Rows:
            empty = False

            def __len__(self) -> int:
                return 2

            @property
            def iloc(self) -> "Rows":
                return self

            def __getitem__(self, index: int) -> dict[str, float]:
                return [
                    {"Close": 30.0, "Volume": 100},
                    {"Close": 31.0, "Volume": 200},
                ][index]

        fake_yfinance = SimpleNamespace(
            Ticker=lambda ticker: SimpleNamespace(history=lambda **kwargs: Rows())
        )

        with patch.dict(sys.modules, {"yfinance": fake_yfinance}):
            quotes = market._try_yfinance_quotes(["SMCI"])

        self.assertEqual(quotes["SMCI"]["source"], "yahoo")


if __name__ == "__main__":
    unittest.main()
