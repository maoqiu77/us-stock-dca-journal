from __future__ import annotations

import csv
import html
import json
import math
import random
import re
import time as time_module
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from app.modules.indicators import add_indicators, latest_metrics
from app.modules.market import get_chart
from app.modules.research_settings import load_research_settings


YAHOO_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
POLYMARKET_URL = "https://gamma-api.polymarket.com/markets"
STOCKTWITS_URL = "https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json"
REDDIT_RSS_URL = (
    "https://www.reddit.com/r/wallstreetbets+stocks+investing/search.rss"
)
HACKER_NEWS_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date"
NASDAQ_SUMMARY_URL = "https://api.nasdaq.com/api/quote/{ticker}/summary"
NASDAQ_INFO_URL = "https://api.nasdaq.com/api/quote/{ticker}/info"
NASDAQ_FINANCIALS_URL = "https://api.nasdaq.com/api/company/{ticker}/financials"
NASDAQ_EARNINGS_SURPRISE_URL = (
    "https://api.nasdaq.com/api/company/{ticker}/earnings-surprise"
)
NASDAQ_EARNINGS_FORECAST_URL = (
    "https://api.nasdaq.com/api/analyst/{ticker}/earnings-forecast"
)
NASDAQ_NEWS_URL = "https://api.nasdaq.com/api/news/topic/articlebysymbol"
NASDAQ_ARTICLE_BASE_URL = "https://www.nasdaq.com"
REQUEST_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "StockLab/0.1 public-research-client",
}
US_EXCHANGES = {
    "ASE",
    "BATS",
    "BTS",
    "NASDAQ",
    "NAS",
    "NCM",
    "NGM",
    "NMS",
    "NYQ",
    "NYSE",
    "PCX",
}
FRED_SERIES = {
    "FEDFUNDS": "联邦基金利率",
    "DGS10": "10 年期美债收益率",
    "CPIAUCSL": "CPI",
    "UNRATE": "失业率",
}
ANALYST_ORDER = ("technical", "fundamentals", "news", "social", "macro")
ANALYSIS_WINDOW_DAYS = 7
SOCIAL_WINDOW_DAYS = 14
FUNDAMENTAL_FRESH_REPORT_DAYS = 45
FUNDAMENTAL_MAX_REPORT_AGE_DAYS = 100
NEWS_RECENCY_HALF_LIFE_DAYS = 2.0
NEWS_MAX_ITEMS = 12
REDDIT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024
REDDIT_RETRY_FALLBACK_SECONDS = 5.0
ATOM_NAMESPACE = {"atom": "http://www.w3.org/2005/Atom"}
FRED_TIMEZONE = ZoneInfo("America/Chicago")


class InstrumentResolutionError(ValueError):
    pass


def analyst_source_policy(
    effective_date: str, *, today: str | None = None
) -> dict[str, dict[str, Any]]:
    current = date.fromisoformat(today) if today else date.today()
    effective = date.fromisoformat(effective_date)
    historical = effective < current
    return {
        "technical": {"enabled": True},
        "fundamentals": {
            "enabled": not historical,
            "reason": "historical_point_in_time_unavailable" if historical else "",
        },
        "news": {"enabled": True},
        "social": {
            "enabled": not historical,
            "reason": "historical_date" if historical else "",
        },
        "macro": {
            "enabled": True,
            "historical": historical,
            "polymarketEnabled": not historical,
            "reason": "historical_prediction_market_excluded" if historical else "",
        },
    }


def evidence_for_ai(source_result: dict[str, Any]) -> Any | None:
    if source_result.get("status") != "available":
        return None
    data = source_result.get("data")
    return data if data not in (None, {}, []) else None


def fundamentals_role(asset_type: str) -> str:
    return "etf_structure" if asset_type.upper() == "ETF" else "company_fundamentals"


def resolve_instrument(ticker: str) -> dict[str, str]:
    requested = ticker.strip().upper()
    payload = _fetch_json(
        YAHOO_SEARCH_URL,
        params={"q": requested, "quotesCount": 10, "newsCount": 0},
        timeout=10,
    )
    quotes = payload.get("quotes") if isinstance(payload, dict) else None
    aliases = {requested, requested.replace(".", "-"), requested.replace("-", ".")}
    for quote in quotes if isinstance(quotes, list) else []:
        if not isinstance(quote, dict):
            continue
        symbol = str(quote.get("symbol") or "").upper()
        if symbol not in aliases:
            continue
        quote_type = str(quote.get("quoteType") or "").upper()
        exchange = str(quote.get("exchange") or "").upper()
        exchange_display = str(quote.get("exchangeDisplay") or "").upper()
        if quote_type not in {"EQUITY", "ETF"}:
            break
        if exchange not in US_EXCHANGES and exchange_display not in US_EXCHANGES:
            break
        return {
            "ticker": symbol,
            "name": str(
                quote.get("longname") or quote.get("shortname") or symbol
            ).strip(),
            "assetType": quote_type,
            "exchange": exchange_display or exchange,
        }
    raise InstrumentResolutionError("仅支持 Yahoo 可识别的美国个股或 ETF。")


def collect_analysis_sources(
    *,
    ticker: str,
    asset_type: str,
    effective_date: str,
    requested_date: str | None = None,
    analysts: list[str],
    today: str | None = None,
) -> dict[str, dict[str, Any]]:
    policy = analyst_source_policy(requested_date or effective_date, today=today)
    selected = [item for item in ANALYST_ORDER if item in set(analysts)]
    results: dict[str, dict[str, Any]] = {}
    tasks: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=max(1, min(len(selected), 5))) as executor:
        for analyst in selected:
            if not policy[analyst]["enabled"]:
                results[analyst] = {
                    "analyst": analyst,
                    "status": "disabled",
                    "reason": policy[analyst].get("reason", ""),
                    "sources": [],
                }
                continue
            if analyst == "technical":
                tasks[analyst] = executor.submit(
                    collect_technical, ticker, effective_date
                )
            elif analyst == "fundamentals":
                tasks[analyst] = executor.submit(
                    collect_fundamentals, ticker, asset_type, effective_date
                )
            elif analyst == "news":
                tasks[analyst] = executor.submit(collect_news, ticker, effective_date)
            elif analyst == "social":
                tasks[analyst] = executor.submit(
                    collect_social, ticker, requested_date or effective_date
                )
            elif analyst == "macro":
                tasks[analyst] = executor.submit(
                    collect_macro,
                    effective_date,
                    include_polymarket=bool(
                        policy[analyst].get("polymarketEnabled")
                    ),
                    historical=bool(policy[analyst].get("historical")),
                )
        for analyst, future in tasks.items():
            try:
                results[analyst] = future.result()
            except Exception as exc:
                results[analyst] = _unavailable(analyst, str(exc))
    return {analyst: results[analyst] for analyst in selected}


def collect_technical(ticker: str, effective_date: str) -> dict[str, Any]:
    chart = get_chart(ticker, "10y", "1d")
    bars = _bars_through_date(chart.get("bars"), effective_date)
    if chart.get("source") == "sample":
        latest_close = bars[-1].get("close") if bars else None
        return {
            "analyst": "technical",
            "status": "sample",
            "reason": "real_market_data_unavailable",
            "samplePreview": {"latestClose": latest_close},
            "sources": [_source("sample", "", effective_date, False)],
        }
    if chart.get("source") not in {"yahoo", "nasdaq"} or not bars:
        return _unavailable("technical", "真实行情数据不可用。")
    if _has_unsettled_latest_bar(chart, effective_date):
        return _unavailable(
            "technical", f"{ticker} 在 {effective_date} 的最新行情尚无完整收盘价。"
        )

    frame = _bars_to_frame(bars)
    if frame.empty:
        return _unavailable("technical", "行情数据无法计算指标。")
    metrics = _json_safe(latest_metrics(add_indicators(frame)))
    spy_chart = get_chart("SPY", "10y", "1d")
    spy_bars = _bars_through_date(spy_chart.get("bars"), effective_date)
    if _has_unsettled_latest_bar(spy_chart, effective_date):
        return _unavailable(
            "technical", f"SPY 在 {effective_date} 的最新行情尚无完整收盘价。"
        )
    relative = _relative_returns(bars, spy_bars)
    return {
        "analyst": "technical",
        "status": "available",
        "data": {
            "asOf": str(bars[-1]["time"])[:10],
            "metrics": {**metrics, **relative},
            "recentBars": bars[-30:],
        },
        "sources": [
            _source(str(chart.get("source")), "", effective_date, True),
            _source(str(spy_chart.get("source")), "SPY benchmark", effective_date, True),
        ],
    }


def collect_fundamentals(
    ticker: str, asset_type: str, effective_date: str
) -> dict[str, Any]:
    is_etf = asset_type.upper() == "ETF"
    yahoo_error = ""
    try:
        import yfinance as yf

        instrument = yf.Ticker(ticker)
        info = instrument.info or {}
    except Exception as exc:
        info = {}
        yahoo_error = str(exc)

    if isinstance(info, dict) and info:
        if is_etf:
            keys = (
                "category",
                "fundFamily",
                "annualReportExpenseRatio",
                "totalAssets",
                "navPrice",
                "yield",
                "threeYearAverageReturn",
                "fiveYearAverageReturn",
                "beta3Year",
            )
        else:
            keys = (
                "marketCap",
                "enterpriseValue",
                "trailingPE",
                "forwardPE",
                "priceToBook",
                "enterpriseToEbitda",
                "revenueGrowth",
                "earningsGrowth",
                "profitMargins",
                "operatingMargins",
                "freeCashflow",
                "operatingCashflow",
                "totalCash",
                "totalDebt",
                "dividendYield",
                "beta",
            )
        data = {
            key: _json_safe(info.get(key))
            for key in keys
            if info.get(key) is not None
        }
        snapshot_epoch = _epoch_value(info.get("regularMarketTime"))
        data.update({
            "role": fundamentals_role(asset_type),
            "currency": str(info.get("currency") or "USD"),
            "asOf": effective_date,
            "snapshotAsOf": _epoch_date(snapshot_epoch) if snapshot_epoch else None,
            "freshnessStatus": "current_snapshot",
        })
        if len(data) > 3:
            yahoo_result = {
                "analyst": "fundamentals",
                "status": "available",
                "data": data,
                "sources": [_source("yahoo", "", effective_date, True)],
            }
            if is_etf:
                return yahoo_result
        else:
            yahoo_result = None
    else:
        yahoo_result = None

    nasdaq_errors: list[str] = []
    url = NASDAQ_SUMMARY_URL.format(ticker=ticker)
    try:
        payload = _fetch_json(
            url,
            params={"assetclass": "etf" if is_etf else "stocks"},
            timeout=12,
        )
        fields = _nasdaq_summary_fields(payload, is_etf=is_etf)
    except Exception as exc:
        fields = {}
        nasdaq_errors.append(f"Nasdaq summary: {exc}")

    info_url = NASDAQ_INFO_URL.format(ticker=ticker)
    try:
        info_payload = _fetch_json(
            info_url,
            params={"assetclass": "etf" if is_etf else "stocks"},
            timeout=12,
        )
        snapshot_date = _nasdaq_snapshot_date(info_payload)
    except Exception as exc:
        snapshot_date = ""
        nasdaq_errors.append(f"Nasdaq info: {exc}")

    if is_etf:
        if fields:
            limitations = []
            if yahoo_error:
                limitations.append("Yahoo ETF 结构不可用，已使用 Nasdaq 当前快照。")
            if not snapshot_date:
                limitations.append("提供方未返回可验证的快照时间戳。")
            return {
                "analyst": "fundamentals",
                "status": "available",
                "data": {
                    "role": fundamentals_role(asset_type),
                    "currency": "USD",
                    "asOf": effective_date,
                    "snapshotAsOf": snapshot_date or None,
                    "freshnessStatus": "current_snapshot",
                    "summaryFields": fields,
                    "dataLimitations": limitations,
                },
                "sources": [
                    _source("nasdaq", url, snapshot_date or effective_date, True)
                ],
            }
        nasdaq_errors.append("Nasdaq ETF 结构字段不足。")
    else:
        result = _collect_nasdaq_company_fundamentals(
            ticker=ticker,
            effective_date=effective_date,
            summary_fields=fields,
            snapshot_date=snapshot_date,
            errors=nasdaq_errors,
        )
        if result is not None:
            if yahoo_result:
                result["data"]["valuationSnapshot"] = yahoo_result["data"]
                result["sources"] = [*yahoo_result["sources"], *result["sources"]]
            return result

    details = "；".join(
        item
        for item in (
            f"Yahoo: {yahoo_error}" if yahoo_error else "Yahoo 可用基本面字段不足",
            *nasdaq_errors,
        )
        if item
    )
    return _unavailable("fundamentals", details)


def _collect_nasdaq_company_fundamentals(
    *,
    ticker: str,
    effective_date: str,
    summary_fields: dict[str, Any],
    snapshot_date: str,
    errors: list[str],
) -> dict[str, Any] | None:
    financials_url = NASDAQ_FINANCIALS_URL.format(ticker=ticker)
    earnings_url = NASDAQ_EARNINGS_SURPRISE_URL.format(ticker=ticker)
    forecast_url = NASDAQ_EARNINGS_FORECAST_URL.format(ticker=ticker)

    try:
        financials_payload = _fetch_json(
            financials_url, params={"frequency": 2}, timeout=12
        )
    except Exception as exc:
        financials_payload = {}
        errors.append(f"Nasdaq financials: {exc}")
    try:
        earnings_payload = _fetch_json(earnings_url, timeout=12)
    except Exception as exc:
        earnings_payload = {}
        errors.append(f"Nasdaq earnings: {exc}")
    try:
        forecast_payload = _fetch_json(forecast_url, timeout=12)
    except Exception as exc:
        forecast_payload = {}
        errors.append(f"Nasdaq forecast: {exc}")

    effective = date.fromisoformat(effective_date)
    earnings_history = _nasdaq_earnings_history(earnings_payload, effective)
    latest_report = earnings_history[0] if earnings_history else None
    report_date = (
        _parse_us_date(latest_report.get("dateReported")) if latest_report else None
    )
    if report_date is None:
        errors.append("Nasdaq 未提供可验证的最近财报发布日期。")
        return None

    report_age_days = (effective - report_date).days
    if report_age_days > FUNDAMENTAL_MAX_REPORT_AGE_DAYS:
        errors.append(
            f"最近财报已过去 {report_age_days} 天，超过 "
            f"{FUNDAMENTAL_MAX_REPORT_AGE_DAYS} 天有效期。"
        )
        return None

    financials = _nasdaq_quarterly_financials(financials_payload, effective)
    period_end = _parse_iso_date(financials.get("periods", [None])[0])
    if period_end is None or not any(
        financials.get(key) for key in ("incomeStatement", "balanceSheet", "cashFlow")
    ):
        errors.append("Nasdaq 未提供有效的最近季度财务报表。")
        return None
    freshness_status = (
        "fresh"
        if report_age_days <= FUNDAMENTAL_FRESH_REPORT_DAYS
        else "aging"
    )
    freshness_weight = 1.0
    limitations = list(errors)
    if freshness_status == "aging":
        aging_range = (
            FUNDAMENTAL_MAX_REPORT_AGE_DAYS - FUNDAMENTAL_FRESH_REPORT_DAYS
        )
        freshness_weight = max(
            0.25,
            1.0
            - (report_age_days - FUNDAMENTAL_FRESH_REPORT_DAYS)
            / max(1, aging_range)
            * 0.75,
        )
        limitations.append(
            f"最近财报发布于 {report_date.isoformat()}，已超过 "
            f"{FUNDAMENTAL_FRESH_REPORT_DAYS} 天，分析时应降低权重。"
        )
    if not snapshot_date:
        limitations.append("当前估值快照缺少可验证的提供方时间戳。")

    forecast = _nasdaq_earnings_forecast(forecast_payload)
    data: dict[str, Any] = {
        "role": "company_fundamentals",
        "currency": "USD",
        "asOf": effective_date,
        "snapshotAsOf": snapshot_date or None,
        "latestReportDate": report_date.isoformat(),
        "latestReportAgeDays": report_age_days,
        "latestFinancialPeriodEnd": period_end.isoformat() if period_end else None,
        "latestFinancialPeriodAgeDays": (
            (effective - period_end).days if period_end else None
        ),
        "freshnessStatus": freshness_status,
        "freshnessWeight": round(freshness_weight, 3),
        "summaryFields": summary_fields,
        "latestEarnings": latest_report,
        "earningsHistory": earnings_history,
        "quarterlyFinancials": financials,
        "earningsForecast": forecast,
        "dataLimitations": limitations,
    }
    sources = []
    if summary_fields:
        sources.append(
            _source(
                "nasdaq-summary",
                NASDAQ_SUMMARY_URL.format(ticker=ticker),
                snapshot_date or effective_date,
                True,
            )
        )
    if financials:
        sources.append(
            _source(
                "nasdaq-financials",
                financials_url,
                period_end.isoformat() if period_end else report_date.isoformat(),
                True,
            )
        )
    sources.append(
        _source("nasdaq-earnings", earnings_url, report_date.isoformat(), True)
    )
    if forecast:
        sources.append(
            _source("nasdaq-forecast", forecast_url, effective_date, True)
        )
    return {
        "analyst": "fundamentals",
        "status": "available",
        "data": data,
        "sources": sources,
    }


def _nasdaq_summary_fields(
    payload: Any, *, is_etf: bool
) -> dict[str, dict[str, Any]]:
    root = payload.get("data") if isinstance(payload, dict) else None
    summary = root.get("summaryData") if isinstance(root, dict) else None
    allowed = (
        {
            "AUM",
            "ExpenseRatio",
            "Yield",
            "AnnualizedDividend",
            "Beta",
            "StandardDeviation",
            "WeightedAlpha",
            "MarketCap",
        }
        if is_etf
        else {
            "MarketCap",
            "OneYrTarget",
            "Yield",
            "AnnualizedDividend",
            "Sector",
            "Industry",
        }
    )
    if not isinstance(summary, dict):
        return {}
    return {
        key: {
            "label": str(value.get("label") or key),
            "value": _json_safe(value.get("value")),
        }
        for key, value in summary.items()
        if key in allowed
        and isinstance(value, dict)
        and value.get("value") not in (None, "", "N/A")
    }


def _nasdaq_snapshot_date(payload: Any) -> str:
    root = payload.get("data") if isinstance(payload, dict) else None
    primary = root.get("primaryData") if isinstance(root, dict) else None
    timestamp = (
        str(primary.get("lastTradeTimestamp") or "")
        if isinstance(primary, dict)
        else ""
    )
    match = re.match(r"^([A-Z][a-z]{2} \d{1,2}, \d{4})", timestamp)
    if not match:
        return ""
    try:
        return datetime.strptime(match.group(1), "%b %d, %Y").date().isoformat()
    except ValueError:
        return ""


def _parse_us_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    for pattern in ("%m/%d/%Y", "%m/%d/%y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def _parse_iso_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return _parse_us_date(text)


def _nasdaq_earnings_history(payload: Any, effective: date) -> list[dict[str, Any]]:
    root = payload.get("data") if isinstance(payload, dict) else None
    table = root.get("earningsSurpriseTable") if isinstance(root, dict) else None
    rows = table.get("rows") if isinstance(table, dict) else None
    dated_rows: list[tuple[date, dict[str, Any]]] = []
    for raw in rows if isinstance(rows, list) else []:
        if not isinstance(raw, dict):
            continue
        reported = _parse_us_date(raw.get("dateReported"))
        if reported is None or reported > effective:
            continue
        dated_rows.append((reported, _json_safe(raw)))
    dated_rows.sort(key=lambda item: item[0], reverse=True)
    return [row for _, row in dated_rows[:4]]


def _nasdaq_quarterly_financials(payload: Any, effective: date) -> dict[str, Any]:
    root = payload.get("data") if isinstance(payload, dict) else None
    tables = {
        "incomeStatement": (
            "incomeStatementTable",
            {"Total Revenue", "Gross Profit", "Operating Income", "Net Income"},
        ),
        "balanceSheet": (
            "balanceSheetTable",
            {"Cash and Cash Equivalents", "Total Assets", "Long-Term Debt"},
        ),
        "cashFlow": (
            "cashFlowTable",
            {"Net Cash Flow-Operating", "Capital Expenditures", "Net Cash Flow"},
        ),
    }
    output: dict[str, Any] = {}
    all_periods: list[str] = []
    for output_key, (source_key, wanted_metrics) in tables.items():
        table = root.get(source_key) if isinstance(root, dict) else None
        headers = table.get("headers") if isinstance(table, dict) else None
        rows = table.get("rows") if isinstance(table, dict) else None
        periods: list[tuple[str, str]] = []
        for column, raw_period in headers.items() if isinstance(headers, dict) else []:
            parsed = _parse_us_date(raw_period)
            if column != "value1" and parsed is not None and parsed <= effective:
                periods.append((column, parsed.isoformat()))
        periods = periods[:4]
        if not all_periods:
            all_periods = [period for _, period in periods]
        metrics: dict[str, dict[str, Any]] = {}
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict) or row.get("value1") not in wanted_metrics:
                continue
            metrics[str(row["value1"])] = {
                period: _json_safe(row.get(column))
                for column, period in periods
                if row.get(column) not in (None, "", "--", "N/A")
            }
        if metrics:
            output[output_key] = metrics
    if all_periods:
        output["periods"] = all_periods
        output["unit"] = "USD thousands"
    return output


def _nasdaq_earnings_forecast(payload: Any) -> dict[str, Any]:
    root = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(root, dict):
        return {}
    output: dict[str, Any] = {"revisionWindowDays": 28}
    for output_key, source_key in (
        ("quarterly", "quarterlyForecast"),
        ("yearly", "yearlyForecast"),
    ):
        table = root.get(source_key)
        rows = table.get("rows") if isinstance(table, dict) else None
        if isinstance(rows, list):
            output[output_key] = [
                _json_safe(row) for row in rows[:5] if isinstance(row, dict)
            ]
    return output if len(output) > 1 else {}


def _company_search_terms(payload: Any, ticker: str) -> list[str]:
    quotes = payload.get("quotes") if isinstance(payload, dict) else None
    candidates: list[str] = []
    for quote in quotes if isinstance(quotes, list) else []:
        if not isinstance(quote, dict):
            continue
        if str(quote.get("symbol") or "").upper() != ticker.upper():
            continue
        candidates.extend(
            str(quote.get(key) or "")
            for key in ("shortname", "longname", "displayName", "prevName")
        )
        break

    legal_suffixes = {
        "co",
        "company",
        "corp",
        "corporation",
        "inc",
        "incorporated",
        "ltd",
        "limited",
        "llc",
        "plc",
        "group",
        "holdings",
    }
    terms: list[str] = []
    for candidate in candidates:
        normalized = " ".join(re.findall(r"[a-z0-9]+", candidate.lower()))
        words = normalized.split()
        while words and words[-1] in legal_suffixes:
            words.pop()
        cleaned = " ".join(words)
        if cleaned:
            terms.append(cleaned)
        if words and len(words[0]) >= 4:
            terms.append(words[0])
    return list(dict.fromkeys(terms))


def _contains_news_term(text: str, term: str) -> bool:
    if not text or not term:
        return False
    return bool(
        re.search(
            rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])",
            text.lower(),
        )
    )


def _related_ticker_symbols(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    symbols: list[str] = []
    for item in value:
        raw = item.get("symbol") if isinstance(item, dict) else item
        symbol = str(raw or "").split("|", 1)[0].strip().upper()
        if symbol:
            symbols.append(symbol)
    return symbols


def _news_relevance(
    ticker: str,
    title: str,
    summary: str,
    related_tickers: Any,
    company_terms: list[str],
) -> tuple[float, str]:
    combined = " ".join(item for item in (title, summary) if item)
    if _contains_news_term(combined, ticker):
        return 1.0, "ticker_mentioned"
    if any(_contains_news_term(combined, term) for term in company_terms):
        return 0.95, "company_mentioned"

    related = _related_ticker_symbols(related_tickers)
    if related and related[0] == ticker.upper():
        return 0.7, "primary_related_ticker"
    return 0.0, "weak_or_indirect"


def _deduplicate_news(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for item in items:
        normalized_title = " ".join(
            re.findall(r"[a-z0-9]+", str(item.get("title") or "").lower())
        )
        url = str(item.get("url") or "").split("?", 1)[0].rstrip("/")
        key = normalized_title or url
        if not key:
            continue
        existing = selected.get(key)
        rank = (
            float(item.get("importanceScore") or 0),
            str(item.get("publishedAt") or ""),
        )
        existing_rank = (
            float(existing.get("importanceScore") or 0),
            str(existing.get("publishedAt") or ""),
        ) if existing else (-1.0, "")
        if existing is None:
            selected[key] = item
            continue
        preferred = item if item.get("summary") and not existing.get("summary") else existing
        fallback = existing if preferred is item else item
        merged = dict(preferred)
        merged["summary"] = str(preferred.get("summary") or fallback.get("summary") or "")
        merged["publishedAt"] = max(
            str(item.get("publishedAt") or ""),
            str(existing.get("publishedAt") or ""),
        )
        if rank > existing_rank:
            merged["relevance"] = item.get("relevance")
        merged["relevanceScore"] = max(
            float(item.get("relevanceScore") or 0),
            float(existing.get("relevanceScore") or 0),
        )
        merged["recencyWeight"] = max(
            float(item.get("recencyWeight") or 0),
            float(existing.get("recencyWeight") or 0),
        )
        merged["importanceScore"] = max(
            float(item.get("importanceScore") or 0),
            float(existing.get("importanceScore") or 0),
        )
        selected[key] = merged
    return list(selected.values())


def collect_news(ticker: str, effective_date: str) -> dict[str, Any]:
    errors: list[str] = []
    try:
        yahoo_payload = _fetch_json(
            YAHOO_SEARCH_URL,
            params={"q": ticker, "quotesCount": 1, "newsCount": 30},
            timeout=12,
        )
    except Exception as exc:
        yahoo_payload = {}
        errors.append(f"Yahoo 新闻不可用：{exc}")
    company_terms = _company_search_terms(yahoo_payload, ticker)
    items: list[dict[str, Any]] = []
    provider_names: set[str] = set()
    window_start, window_end = _utc_date_window(effective_date)

    def append_item(
        *,
        title: str,
        summary: str,
        published: float,
        publisher: str,
        url: str,
        related_tickers: Any,
        provider_name: str,
    ) -> None:
        if not title:
            return
        if not _within_utc_window(published, window_start, window_end):
            return
        relevance_score, relevance = _news_relevance(
            ticker, title, summary, related_tickers, company_terms
        )
        if relevance_score < 0.6:
            return
        age_days = max(0.0, (window_end - published) / 86400)
        recency_weight = 0.5 ** (age_days / NEWS_RECENCY_HALF_LIFE_DAYS)
        items.append(
            {
                "title": title[:240],
                "summary": summary[:400],
                "publishedAt": _epoch_iso(published),
                "source": publisher,
                "url": url,
                "relevance": relevance,
                "relevanceScore": relevance_score,
                "recencyWeight": round(recency_weight, 4),
                "importanceScore": round(relevance_score * recency_weight, 4),
            }
        )
        provider_names.add(provider_name)

    for raw in (
        yahoo_payload.get("news", []) if isinstance(yahoo_payload, dict) else []
    ):
        if not isinstance(raw, dict):
            continue
        append_item(
            title=str(raw.get("title") or "").strip(),
            summary=str(raw.get("summary") or "").strip(),
            published=_epoch_value(raw.get("providerPublishTime")),
            publisher=str(raw.get("publisher") or "Yahoo"),
            url=str(raw.get("link") or ""),
            related_tickers=raw.get("relatedTickers"),
            provider_name="yahoo",
        )

    try:
        nasdaq_payload = _fetch_json(
            NASDAQ_NEWS_URL,
            params={"q": f"{ticker}|stocks", "offset": 0, "limit": 30},
            timeout=12,
        )
        root = nasdaq_payload.get("data") if isinstance(nasdaq_payload, dict) else None
        rows = root.get("rows") if isinstance(root, dict) else None
        for raw in rows if isinstance(rows, list) else []:
            if not isinstance(raw, dict):
                continue
            published_date = _parse_us_date(raw.get("created"))
            published = (
                datetime.combine(
                    published_date, datetime.min.time(), tzinfo=timezone.utc
                ).timestamp()
                + 12 * 60 * 60
                if published_date
                else 0.0
            )
            path = str(raw.get("url") or "")
            related = raw.get("related_symbols")
            related_symbols = related if isinstance(related, list) else []
            append_item(
                title=str(raw.get("title") or "").strip(),
                summary=str(raw.get("description") or "").strip(),
                published=published,
                publisher=str(raw.get("publisher") or "Nasdaq"),
                url=(f"{NASDAQ_ARTICLE_BASE_URL}{path}" if path.startswith("/") else path),
                related_tickers=[raw.get("primarysymbol"), *related_symbols],
                provider_name="nasdaq-news",
            )
    except Exception as exc:
        errors.append(f"Nasdaq 新闻不可用：{exc}")

    items = _deduplicate_news(items)
    items.sort(
        key=lambda item: (
            float(item["importanceScore"]), str(item["publishedAt"])
        ),
        reverse=True,
    )
    items = items[:NEWS_MAX_ITEMS]
    if not items:
        detail = "；".join(errors)
        return _unavailable(
            "news",
            "最近 7 天没有与该标的直接相关的有效新闻。"
            + (f" {detail}" if detail else ""),
        )
    return {
        "analyst": "news",
        "status": "available",
        "data": {
            "asOf": effective_date,
            "windowDays": ANALYSIS_WINDOW_DAYS,
            "windowStart": _epoch_date(window_start),
            "windowEnd": effective_date,
            "rankingMethod": "标的相关性乘以时间衰减，时间半衰期 2 天",
            "sampleSize": len(items),
            "items": items,
        },
        "sources": [
            _source(name, url, effective_date, True)
            for name, url in (
                ("yahoo", YAHOO_SEARCH_URL),
                ("nasdaq-news", NASDAQ_NEWS_URL),
            )
            if name in provider_names
        ],
    }


def collect_social(ticker: str, effective_date: str | None = None) -> dict[str, Any]:
    analysis_date = effective_date or date.today().isoformat()
    window_start, window_end = _utc_date_window(
        analysis_date, days=SOCIAL_WINDOW_DAYS
    )
    items: list[dict[str, Any]] = []
    errors: list[str] = []
    try:
        stocktwits = _fetch_json(STOCKTWITS_URL.format(ticker=ticker), timeout=10)
        for message in stocktwits.get("messages", [])[:30]:
            if not isinstance(message, dict):
                continue
            published = _iso_epoch_value(message.get("created_at"))
            if not _within_utc_window(published, window_start, window_end):
                continue
            sentiment = message.get("entities", {}).get("sentiment")
            items.append(
                {
                    "source": "StockTwits",
                    "title": str(message.get("body") or "")[:280],
                    "summary": "",
                    "publishedAt": _epoch_iso(published),
                    "sentiment": str(
                        sentiment.get("basic") if isinstance(sentiment, dict) else ""
                    ),
                    "url": "",
                }
            )
    except Exception as exc:
        errors.append(f"StockTwits: {exc}")
    try:
        for data in _fetch_reddit_rss(ticker):
            published = _epoch_value(data.get("created_utc"))
            if not _within_utc_window(published, window_start, window_end):
                continue
            items.append(
                {
                    "source": "Reddit",
                    "title": str(data.get("title") or "")[:240],
                    "summary": str(data.get("selftext") or "")[:400],
                    "publishedAt": _epoch_iso(published),
                    "sentiment": "",
                    "url": str(data.get("url") or ""),
                }
            )
    except Exception as exc:
        errors.append(f"Reddit: {exc}")
    if not items:
        try:
            payload = _fetch_json(
                HACKER_NEWS_SEARCH_URL,
                params={
                    "query": f"${ticker}",
                    "tags": "(story,comment)",
                    "hitsPerPage": 100,
                    "numericFilters": (
                        f"created_at_i>={int(window_start)},"
                        f"created_at_i<{int(window_end)}"
                    ),
                },
                timeout=12,
            )
            ticker_pattern = re.compile(
                rf"\${re.escape(ticker)}(?![A-Za-z0-9])", re.IGNORECASE
            )
            for hit in payload.get("hits", []) if isinstance(payload, dict) else []:
                if not isinstance(hit, dict):
                    continue
                published = _iso_epoch_value(hit.get("created_at"))
                if not _within_utc_window(published, window_start, window_end):
                    continue
                raw_text = str(hit.get("title") or hit.get("comment_text") or "")
                if not ticker_pattern.search(raw_text):
                    continue
                text = _plain_text(raw_text)
                if not text:
                    continue
                object_id = str(hit.get("objectID") or "")
                items.append(
                    {
                        "source": "Hacker News",
                        "title": text[:280],
                        "summary": "",
                        "publishedAt": _epoch_iso(published),
                        "sentiment": "",
                        "url": (
                            f"https://news.ycombinator.com/item?id={object_id}"
                            if object_id
                            else str(hit.get("url") or hit.get("story_url") or "")
                        ),
                    }
                )
        except Exception as exc:
            errors.append(f"Hacker News: {exc}")
    items = [item for item in items if item["title"]]
    if not items:
        return _unavailable("social", "；".join(errors) or "无社交样本。")
    bullish = sum(item.get("sentiment", "").lower() == "bullish" for item in items)
    bearish = sum(item.get("sentiment", "").lower() == "bearish" for item in items)
    return {
        "analyst": "social",
        "status": "available",
        "data": {
            "asOf": analysis_date,
            "windowDays": SOCIAL_WINDOW_DAYS,
            "windowStart": _epoch_date(window_start),
            "windowEnd": analysis_date,
            "sampleSize": len(items),
            "labeledBullish": bullish,
            "labeledBearish": bearish,
            "disagreement": min(bullish, bearish) / max(1, bullish + bearish),
            "items": items,
        },
        "sources": [
            _source(name.lower().replace(" ", "-"), url, analysis_date, True)
            for name, url in (
                ("StockTwits", STOCKTWITS_URL.format(ticker=ticker)),
                ("Reddit", REDDIT_RSS_URL),
                ("Hacker News", HACKER_NEWS_SEARCH_URL),
            )
            if any(item.get("source") == name for item in items)
        ],
    }


def collect_macro(
    effective_date: str, *, include_polymarket: bool, historical: bool = False
) -> dict[str, Any]:
    fred: list[dict[str, Any]] = []
    news: list[dict[str, Any]] = []
    markets: list[dict[str, Any]] = []
    errors: list[str] = []
    fred_key = str(load_research_settings().get("fredApiKey") or "")
    fred_vintage = min(effective_date, _fred_today())
    if fred_key:
        for series_id, label in FRED_SERIES.items():
            try:
                payload = _fetch_json(
                    FRED_OBSERVATIONS_URL,
                    params={
                        "series_id": series_id,
                        "api_key": fred_key,
                        "file_type": "json",
                        "observation_end": effective_date,
                        "realtime_start": fred_vintage,
                        "realtime_end": fred_vintage,
                        "sort_order": "desc",
                        "limit": 1,
                    },
                    timeout=12,
                )
                observations = payload.get("observations", [])
                observation = observations[0] if observations else {}
                if observation.get("value") not in (None, "."):
                    fred.append(
                        {
                            "series": series_id,
                            "label": label,
                            "date": observation.get("date"),
                            "value": observation.get("value"),
                        }
                    )
            except Exception as exc:
                errors.append(f"FRED {series_id}: {exc}")
    collected_series = {str(item.get("series")) for item in fred}
    if historical and not fred_key:
        errors.append("历史 FRED 需要 API Key 才能固定数据 vintage；已跳过当前修订值 CSV。")
    else:
        for series_id, label in FRED_SERIES.items():
            if series_id in collected_series:
                continue
            try:
                observation = _fetch_fred_csv_observation(series_id, effective_date)
                if observation:
                    fred.append({"series": series_id, "label": label, **observation})
            except Exception as exc:
                errors.append(f"FRED CSV {series_id}: {exc}")
    try:
        payload = _fetch_json(
            YAHOO_SEARCH_URL,
            params={
                "q": "US economy Federal Reserve inflation interest rates",
                "quotesCount": 0,
                "newsCount": 15,
            },
            timeout=12,
        )
        window_start, window_end = _utc_date_window(effective_date)
        for raw in payload.get("news", []) if isinstance(payload, dict) else []:
            published = _epoch_value(raw.get("providerPublishTime"))
            if not _within_utc_window(published, window_start, window_end):
                continue
            title = str(raw.get("title") or "")[:240]
            if title:
                news.append(
                    {
                        "title": title,
                        "summary": str(raw.get("summary") or "")[:400],
                        "publishedAt": _epoch_iso(published),
                        "source": str(raw.get("publisher") or "Yahoo"),
                        "url": str(raw.get("link") or ""),
                    }
                )
    except Exception as exc:
        errors.append(f"Macro news: {exc}")
    if include_polymarket:
        try:
            payload = _fetch_json(
                POLYMARKET_URL,
                params={"active": "true", "closed": "false", "limit": 50},
                timeout=12,
            )
            keywords = ("fed", "rate", "inflation", "recession", "economy", "tariff")
            for raw in payload if isinstance(payload, list) else []:
                question = str(raw.get("question") or "")
                if not any(keyword in question.lower() for keyword in keywords):
                    continue
                markets.append(
                    {
                        "question": question[:240],
                        "outcomes": _maybe_json(raw.get("outcomes")),
                        "outcomePrices": _maybe_json(raw.get("outcomePrices")),
                        "url": str(raw.get("url") or ""),
                    }
                )
        except Exception as exc:
            errors.append(f"Polymarket: {exc}")
    if not (fred or news or markets):
        return _unavailable("macro", "；".join(errors) or "宏观数据不可用。")
    sources = []
    if fred:
        sources.append(
            _source(
                "fred",
                FRED_OBSERVATIONS_URL if fred_key else FRED_CSV_URL,
                effective_date,
                True,
            )
        )
    if news:
        sources.append(_source("yahoo", YAHOO_SEARCH_URL, effective_date, True))
    if markets:
        sources.append(_source("polymarket", POLYMARKET_URL, effective_date, True))
    return {
        "analyst": "macro",
        "status": "available",
        "data": {
            "asOf": effective_date,
            "fred": fred,
            "news": news,
            "predictionMarkets": markets,
            "polymarketExcludedForHistory": not include_polymarket,
            "fredVintage": fred_vintage if fred_key else None,
            "dataLimitations": errors,
        },
        "sources": sources,
    }


def _fetch_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: int = 10,
) -> Any:
    response = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=timeout)
    try:
        response.raise_for_status()
        return response.json()
    finally:
        close = getattr(response, "close", None)
        if callable(close):
            close()


def _fetch_reddit_rss(
    ticker: str, *, limit: int = 25, timeout: int = 10
) -> list[dict[str, Any]]:
    attempts = 2
    for attempt in range(attempts):
        response = requests.get(
            REDDIT_RSS_URL,
            params={
                "q": ticker,
                "restrict_sr": "on",
                "sort": "new",
                "t": "month",
                "limit": limit,
            },
            headers={**REQUEST_HEADERS, "Accept": "application/atom+xml"},
            timeout=timeout,
            stream=True,
        )
        try:
            if response.status_code == 429 and attempt + 1 < attempts:
                retry_after = _retry_after_seconds(response)
                delay = (
                    retry_after
                    if retry_after is not None
                    else _jitter(REDDIT_RETRY_FALLBACK_SECONDS)
                )
                time_module.sleep(delay)
                continue
            response.raise_for_status()
            root = ET.fromstring(
                _read_capped_bytes(response, REDDIT_MAX_RESPONSE_BYTES)
            )
            posts: list[dict[str, Any]] = []
            for entry in root.findall("atom:entry", ATOM_NAMESPACE)[:limit]:
                title = entry.find("atom:title", ATOM_NAMESPACE)
                content = entry.find("atom:content", ATOM_NAMESPACE)
                published = entry.find("atom:published", ATOM_NAMESPACE)
                link = entry.find("atom:link", ATOM_NAMESPACE)
                posts.append(
                    {
                        "title": _plain_text(title.text if title is not None else ""),
                        "selftext": _plain_text(
                            content.text if content is not None else ""
                        ),
                        "created_utc": _iso_epoch_value(
                            published.text if published is not None else ""
                        ),
                        "url": str(
                            link.get("href", "") if link is not None else ""
                        ),
                    }
                )
            return posts
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()
    raise RuntimeError("Reddit RSS 重试失败。")


def _fred_today(now: datetime | None = None) -> str:
    current = now or datetime.now(FRED_TIMEZONE)
    if current.tzinfo is None:
        current = current.replace(tzinfo=FRED_TIMEZONE)
    return current.astimezone(FRED_TIMEZONE).date().isoformat()


def _utc_date_window(
    effective_date: str, *, days: int = ANALYSIS_WINDOW_DAYS
) -> tuple[float, float]:
    end_date = date.fromisoformat(effective_date) + timedelta(days=1)
    start_date = end_date - timedelta(days=days)
    start = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    end = datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc)
    return start.timestamp(), end.timestamp()


def _within_utc_window(value: float, start: float, end: float) -> bool:
    return bool(value) and start <= value < end


def _epoch_date(value: float) -> str:
    return datetime.fromtimestamp(value, tz=timezone.utc).date().isoformat()


def _iso_epoch_value(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _retry_after_seconds(response: Any) -> float | None:
    try:
        raw = response.headers.get("Retry-After")
        if raw is None:
            return None
        return max(0.0, min(float(raw), 30.0))
    except (AttributeError, TypeError, ValueError):
        return None


def _jitter(seconds: float, fraction: float = 0.2) -> float:
    return seconds * (1.0 + random.uniform(-fraction, fraction))


def _read_capped_bytes(response: Any, max_response_bytes: int) -> bytes:
    try:
        content_length = int(response.headers.get("Content-Length") or 0)
    except (AttributeError, TypeError, ValueError):
        content_length = 0
    if content_length > max_response_bytes:
        raise ValueError(f"数据源响应超过 {max_response_bytes} 字节限制。")

    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_response_bytes:
            raise ValueError(f"数据源响应超过 {max_response_bytes} 字节限制。")
        chunks.append(chunk)
    return b"".join(chunks)


def _fetch_fred_csv_observation(
    series_id: str, effective_date: str
) -> dict[str, str] | None:
    response = requests.get(
        FRED_CSV_URL,
        params={"id": series_id},
        headers=REQUEST_HEADERS,
        timeout=12,
    )
    response.raise_for_status()
    latest: dict[str, str] | None = None
    for row in csv.DictReader(StringIO(response.text)):
        observation_date = str(row.get("observation_date") or "")
        value = str(row.get(series_id) or "")
        if not observation_date or observation_date > effective_date or value in {"", "."}:
            continue
        latest = {"date": observation_date, "value": value}
    return latest


def _plain_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return " ".join(html.unescape(without_tags).split())


def _bars_through_date(raw_bars: Any, effective_date: str) -> list[dict[str, Any]]:
    if not isinstance(raw_bars, list):
        return []
    return [
        bar
        for bar in raw_bars
        if isinstance(bar, dict)
        and str(bar.get("time") or "")[:10] <= effective_date
        and bar.get("close") is not None
    ]


def _has_unsettled_latest_bar(chart: dict[str, Any], effective_date: str) -> bool:
    incomplete_date = str(chart.get("incompleteLatestBar") or "")[:10]
    return bool(incomplete_date) and incomplete_date <= effective_date


def _bars_to_frame(bars: list[dict[str, Any]]) -> pd.DataFrame:
    rows = []
    for bar in bars:
        rows.append(
            {
                "Date": pd.Timestamp(str(bar["time"])[:10]),
                "Open": bar.get("open"),
                "High": bar.get("high"),
                "Low": bar.get("low"),
                "Close": bar.get("close"),
                "Volume": bar.get("volume"),
            }
        )
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.set_index("Date").apply(pd.to_numeric, errors="coerce")


def _relative_returns(
    ticker_bars: list[dict[str, Any]], spy_bars: list[dict[str, Any]]
) -> dict[str, float | None]:
    ticker_close = {str(bar.get("time"))[:10]: bar.get("close") for bar in ticker_bars}
    spy_close = {str(bar.get("time"))[:10]: bar.get("close") for bar in spy_bars}
    dates = sorted(set(ticker_close) & set(spy_close))
    output: dict[str, float | None] = {}
    for window in (20, 60):
        if len(dates) <= window:
            output[f"RelativeSPYReturn{window}"] = None
            continue
        start, end = dates[-window - 1], dates[-1]
        ticker_return = float(ticker_close[end]) / float(ticker_close[start]) - 1
        spy_return = float(spy_close[end]) / float(spy_close[start]) - 1
        output[f"RelativeSPYReturn{window}"] = ticker_return - spy_return
    return output


def _source(
    name: str, url: str, as_of: str, available: bool
) -> dict[str, Any]:
    return {"name": name, "url": url, "asOf": as_of, "available": available}


def _unavailable(analyst: str, error: str) -> dict[str, Any]:
    return {
        "analyst": analyst,
        "status": "unavailable",
        "error": error[:500],
        "sources": [],
    }


def _epoch_value(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _epoch_iso(value: float) -> str:
    if not value:
        return ""
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _maybe_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            value = value.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value
