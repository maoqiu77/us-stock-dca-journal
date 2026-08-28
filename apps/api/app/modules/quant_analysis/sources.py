from __future__ import annotations

import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timezone
from typing import Any
from urllib.parse import urlencode

import pandas as pd
import requests

from app.modules.indicators import add_indicators, latest_metrics
from app.modules.market import get_chart
from app.modules.research_settings import load_research_settings


YAHOO_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations"
POLYMARKET_URL = "https://gamma-api.polymarket.com/markets"
STOCKTWITS_URL = "https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json"
REDDIT_SEARCH_URL = "https://www.reddit.com/search.json"
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
        "fundamentals": {"enabled": True},
        "news": {"enabled": True},
        "social": {
            "enabled": not historical,
            "reason": "historical_date" if historical else "",
        },
        "macro": {
            "enabled": True,
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
    analysts: list[str],
    today: str | None = None,
) -> dict[str, dict[str, Any]]:
    policy = analyst_source_policy(effective_date, today=today)
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
                tasks[analyst] = executor.submit(collect_social, ticker)
            elif analyst == "macro":
                tasks[analyst] = executor.submit(
                    collect_macro,
                    effective_date,
                    include_polymarket=bool(
                        policy[analyst].get("polymarketEnabled")
                    ),
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

    frame = _bars_to_frame(bars)
    if frame.empty:
        return _unavailable("technical", "行情数据无法计算指标。")
    metrics = _json_safe(latest_metrics(add_indicators(frame)))
    spy_chart = get_chart("SPY", "10y", "1d")
    spy_bars = _bars_through_date(spy_chart.get("bars"), effective_date)
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
    try:
        import yfinance as yf

        instrument = yf.Ticker(ticker)
        info = instrument.info or {}
    except Exception as exc:
        return _unavailable("fundamentals", f"Yahoo 基本面数据不可用：{exc}")

    if not isinstance(info, dict) or not info:
        return _unavailable("fundamentals", "Yahoo 基本面数据为空。")
    if asset_type.upper() == "ETF":
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
    data = {key: _json_safe(info.get(key)) for key in keys if info.get(key) is not None}
    data.update(
        {
            "role": fundamentals_role(asset_type),
            "currency": str(info.get("currency") or "USD"),
            "asOf": effective_date,
        }
    )
    if len(data) <= 3:
        return _unavailable("fundamentals", "Yahoo 可用基本面字段不足。")
    return {
        "analyst": "fundamentals",
        "status": "available",
        "data": data,
        "sources": [_source("yahoo", "", effective_date, True)],
    }


def collect_news(ticker: str, effective_date: str) -> dict[str, Any]:
    try:
        payload = _fetch_json(
            YAHOO_SEARCH_URL,
            params={"q": ticker, "quotesCount": 0, "newsCount": 20},
            timeout=12,
        )
    except Exception as exc:
        return _unavailable("news", f"Yahoo 新闻不可用：{exc}")
    items = []
    cutoff = datetime.combine(
        date.fromisoformat(effective_date), time.max, tzinfo=timezone.utc
    ).timestamp()
    for raw in payload.get("news", []) if isinstance(payload, dict) else []:
        if not isinstance(raw, dict):
            continue
        published = _epoch_value(raw.get("providerPublishTime"))
        if published and published > cutoff:
            continue
        items.append(
            {
                "title": str(raw.get("title") or "")[:240],
                "summary": str(raw.get("summary") or "")[:400],
                "publishedAt": _epoch_iso(published),
                "source": str(raw.get("publisher") or "Yahoo"),
                "url": str(raw.get("link") or ""),
            }
        )
    items = [item for item in items if item["title"]]
    if not items:
        return _unavailable("news", "该日期前无可用的标的新闻。")
    return {
        "analyst": "news",
        "status": "available",
        "data": {"asOf": effective_date, "sampleSize": len(items), "items": items},
        "sources": [_source("yahoo", YAHOO_SEARCH_URL, effective_date, True)],
    }


def collect_social(ticker: str) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    errors: list[str] = []
    try:
        stocktwits = _fetch_json(STOCKTWITS_URL.format(ticker=ticker), timeout=10)
        for message in stocktwits.get("messages", [])[:30]:
            if not isinstance(message, dict):
                continue
            sentiment = message.get("entities", {}).get("sentiment")
            items.append(
                {
                    "source": "StockTwits",
                    "title": str(message.get("body") or "")[:280],
                    "summary": "",
                    "publishedAt": str(message.get("created_at") or ""),
                    "sentiment": str(
                        sentiment.get("basic") if isinstance(sentiment, dict) else ""
                    ),
                    "url": "",
                }
            )
    except Exception as exc:
        errors.append(f"StockTwits: {exc}")
    try:
        reddit = _fetch_json(
            REDDIT_SEARCH_URL,
            params={"q": f"${ticker} OR {ticker} stock", "sort": "new", "limit": 25},
            timeout=10,
        )
        children = reddit.get("data", {}).get("children", [])
        for child in children if isinstance(children, list) else []:
            data = child.get("data") if isinstance(child, dict) else None
            if not isinstance(data, dict):
                continue
            items.append(
                {
                    "source": "Reddit",
                    "title": str(data.get("title") or "")[:240],
                    "summary": str(data.get("selftext") or "")[:400],
                    "publishedAt": _epoch_iso(_epoch_value(data.get("created_utc"))),
                    "sentiment": "",
                    "url": f"https://www.reddit.com{data.get('permalink', '')}",
                    "score": int(data.get("score") or 0),
                    "comments": int(data.get("num_comments") or 0),
                }
            )
    except Exception as exc:
        errors.append(f"Reddit: {exc}")
    items = [item for item in items if item["title"]]
    if not items:
        return _unavailable("social", "；".join(errors) or "无社交样本。")
    bullish = sum(item.get("sentiment", "").lower() == "bullish" for item in items)
    bearish = sum(item.get("sentiment", "").lower() == "bearish" for item in items)
    return {
        "analyst": "social",
        "status": "available",
        "data": {
            "asOf": date.today().isoformat(),
            "sampleSize": len(items),
            "labeledBullish": bullish,
            "labeledBearish": bearish,
            "disagreement": min(bullish, bearish) / max(1, bullish + bearish),
            "items": items,
        },
        "sources": [
            _source("stocktwits", STOCKTWITS_URL.format(ticker=ticker), date.today().isoformat(), True),
            _source("reddit", REDDIT_SEARCH_URL, date.today().isoformat(), True),
        ],
    }


def collect_macro(effective_date: str, *, include_polymarket: bool) -> dict[str, Any]:
    fred: list[dict[str, Any]] = []
    news: list[dict[str, Any]] = []
    markets: list[dict[str, Any]] = []
    errors: list[str] = []
    fred_key = str(load_research_settings().get("fredApiKey") or "")
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
        cutoff = datetime.combine(
            date.fromisoformat(effective_date), time.max, tzinfo=timezone.utc
        ).timestamp()
        for raw in payload.get("news", []) if isinstance(payload, dict) else []:
            published = _epoch_value(raw.get("providerPublishTime"))
            if published and published > cutoff:
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
        sources.append(_source("fred", FRED_OBSERVATIONS_URL, effective_date, True))
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
    response.raise_for_status()
    return response.json()


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
