from __future__ import annotations

import hashlib
import json
import math
import random
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from urllib import error, parse, request
from zoneinfo import ZoneInfo


VALID_INTERVALS = {"1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"}
VALID_RANGES = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "5y", "10y", "max"}
NASDAQ_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
}
NASDAQ_KNOWN_ETFS = {"QQQM", "VOO"}
YFINANCE_RATE_LIMITED_UNTIL: Optional[datetime] = None
NASDAQ_CACHE_TTL = timedelta(seconds=15)
NASDAQ_JSON_CACHE: dict[str, tuple[datetime, Any]] = {}
REGULAR_SESSION_OPEN = time(hour=9, minute=30)
REGULAR_SESSION_CLOSE = time(hour=16)
KNOWN_LISTING_DATES = {
    "MSFT": date(1986, 3, 13),
    "NOK": date(1994, 7, 1),
    "NVDA": date(1999, 1, 22),
    "MRVL": date(2000, 6, 27),
    "VOO": date(2010, 9, 9),
    "QQQM": date(2020, 10, 13),
}
SAMPLE_PRICE_ANCHORS = {
    "AMD": 166.0,
    "AVGO": 375.0,
    "MRVL": 280.0,
    "MSFT": 391.0,
    "MU": 236.0,
    "NOK": 14.8,
    "NVDA": 205.0,
    "QQQ": 597.0,
    "QQQM": 297.0,
    "VOO": 682.0,
}


def get_quotes(
    symbols: list[dict[str, Any]],
    *,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    tickers = [item["ticker"] for item in symbols]
    provider_quotes = _try_yahoo_quotes(tickers, force_refresh=force_refresh)
    missing_tickers = [ticker for ticker in tickers if ticker not in provider_quotes]
    if missing_tickers:
        provider_quotes.update(_try_yfinance_quotes(missing_tickers))
    missing_tickers = [ticker for ticker in tickers if ticker not in provider_quotes]
    if missing_tickers:
        provider_quotes.update(
            _try_nasdaq_quotes(missing_tickers, force_refresh=force_refresh)
        )

    quotes: list[dict[str, Any]] = []
    for item in symbols:
        ticker = item["ticker"]
        provider_quote = provider_quotes.get(ticker)
        quote = provider_quote or _sample_quote(ticker)
        quotes.append(
            {
                "ticker": ticker,
                "name": item["name"],
                "market": item["market"],
                **quote,
            }
        )
    return quotes


def get_chart(
    ticker: str,
    range_: str,
    interval: str,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if range_ not in VALID_RANGES:
        range_ = "1y"
    if interval not in VALID_INTERVALS:
        interval = "1d"
    is_intraday = interval not in {"1d", "1wk", "1mo"}

    chart = _try_yahoo_chart(
        ticker, range_, interval, force_refresh=force_refresh
    )
    if chart:
        return chart

    chart = _try_yfinance_chart(ticker, range_, interval)
    if chart:
        return chart

    if is_intraday and range_ == "1d":
        chart = _try_nasdaq_intraday_chart(
            ticker, range_, interval, force_refresh=force_refresh
        )
    elif is_intraday:
        chart = None
    else:
        chart = _try_nasdaq_chart(
            ticker, range_, interval, force_refresh=force_refresh
        )
    if chart:
        return chart

    if is_intraday and range_ == "5d":
        return _unavailable_chart(
            ticker,
            range_,
            interval,
            "真实五日分时暂不可用",
        )

    return _sample_chart(ticker, range_, interval)


def _try_yahoo_quotes(
    tickers: list[str],
    *,
    force_refresh: bool = False,
) -> dict[str, dict[str, Any]]:
    symbols = [ticker.upper() for ticker in tickers]
    if not symbols:
        return {}

    query = parse.urlencode({"symbols": ",".join(symbols)})
    url = f"https://query1.finance.yahoo.com/v7/finance/quote?{query}"
    try:
        payload = _fetch_json(url, timeout=8, force_refresh=force_refresh)
    except (OSError, error.URLError, json.JSONDecodeError):
        return {}

    response = payload.get("quoteResponse") if isinstance(payload, dict) else None
    results = response.get("result") if isinstance(response, dict) else None
    if not isinstance(results, list):
        return {}

    quotes: dict[str, dict[str, Any]] = {}
    for result in results:
        if not isinstance(result, dict):
            continue
        ticker = str(result.get("symbol") or "").upper()
        if ticker not in symbols:
            continue
        price = _parse_market_number(result.get("regularMarketPrice"))
        if price is None:
            continue
        change = _parse_market_number(result.get("regularMarketChange")) or 0.0
        change_percent = (
            _parse_market_number(result.get("regularMarketChangePercent")) or 0.0
        )
        volume = int(_parse_market_number(result.get("regularMarketVolume")) or 0)
        quotes[ticker] = {
            "price": round(price, 2),
            "change": round(change, 2),
            "changePercent": round(change_percent, 2),
            "volume": volume,
            "source": "yahoo",
        }
    return quotes


def _try_yfinance_quotes(tickers: list[str]) -> dict[str, dict[str, Any]]:
    global YFINANCE_RATE_LIMITED_UNTIL
    now = datetime.now(timezone.utc)
    if YFINANCE_RATE_LIMITED_UNTIL and now < YFINANCE_RATE_LIMITED_UNTIL:
        return {}

    try:
        import yfinance as yf
    except Exception:
        return {}

    quotes: dict[str, dict[str, Any]] = {}
    for ticker in tickers:
        try:
            history = yf.Ticker(ticker).history(period="5d", interval="1d")
            if history.empty:
                continue
            last = history.iloc[-1]
            prev = history.iloc[-2] if len(history) > 1 else last
            close = float(last["Close"])
            previous_close = float(prev["Close"])
            change = close - previous_close
            change_percent = (change / previous_close * 100) if previous_close else 0
            quotes[ticker] = {
                "price": round(close, 2),
                "change": round(change, 2),
                "changePercent": round(change_percent, 2),
                "volume": int(last.get("Volume", 0)),
                "source": "yahoo",
            }
        except Exception as exc:
            if exc.__class__.__name__ == "YFRateLimitError":
                YFINANCE_RATE_LIMITED_UNTIL = now + timedelta(minutes=5)
                break
            continue
    return quotes


def _try_nasdaq_quotes(
    tickers: list[str],
    *,
    force_refresh: bool = False,
) -> dict[str, dict[str, Any]]:
    quotes: dict[str, dict[str, Any]] = {}
    if not tickers:
        return quotes
    max_workers = min(len(tickers), 6)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        tasks = ((ticker, force_refresh) for ticker in tickers)
        for ticker, quote in executor.map(_fetch_first_nasdaq_quote, tasks):
            if quote:
                quotes[ticker] = quote
    return quotes


def _fetch_first_nasdaq_quote(
    task: tuple[str, bool],
) -> tuple[str, Optional[dict[str, Any]]]:
    ticker, force_refresh = task
    for asset_class in _nasdaq_asset_classes(ticker):
        quote = _fetch_nasdaq_quote(
            ticker,
            asset_class,
            force_refresh=force_refresh,
        )
        if quote:
            return ticker, quote
    return ticker, None


def _fetch_nasdaq_quote(
    ticker: str,
    asset_class: str,
    *,
    force_refresh: bool = False,
) -> Optional[dict[str, Any]]:
    encoded_ticker = parse.quote(ticker.upper())
    url = (
        f"https://api.nasdaq.com/api/quote/{encoded_ticker}/info"
        f"?assetclass={asset_class}"
    )
    try:
        payload = _fetch_json(url, timeout=5, force_refresh=force_refresh)
    except (OSError, error.URLError, json.JSONDecodeError):
        return None

    data = payload.get("data") if isinstance(payload, dict) else None
    primary = data.get("primaryData") if isinstance(data, dict) else None
    if not isinstance(primary, dict):
        return None

    price = _parse_market_number(primary.get("lastSalePrice"))
    if price is None:
        return None
    change = _parse_market_number(primary.get("netChange")) or 0.0
    change_percent = _parse_market_number(primary.get("percentageChange")) or 0.0
    volume = int(_parse_market_number(primary.get("volume")) or 0)
    return {
        "price": round(price, 2),
        "change": round(change, 2),
        "changePercent": round(change_percent, 2),
        "volume": volume,
        "source": "nasdaq",
    }


def _nasdaq_asset_classes(ticker: str) -> list[str]:
    symbol = ticker.upper().split(".", 1)[0]
    return ["etf", "stocks"] if symbol in NASDAQ_KNOWN_ETFS else ["stocks", "etf"]


def _parse_market_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned or cleaned.upper() in {"N/A", "NA", "--"}:
        return None
    cleaned = (
        cleaned.replace("$", "")
        .replace(",", "")
        .replace("%", "")
        .replace("+", "")
    )
    try:
        return float(cleaned)
    except ValueError:
        return None


def _try_yfinance_chart(
    ticker: str, range_: str, interval: str
) -> Optional[dict[str, Any]]:
    global YFINANCE_RATE_LIMITED_UNTIL
    now = datetime.now(timezone.utc)
    if YFINANCE_RATE_LIMITED_UNTIL and now < YFINANCE_RATE_LIMITED_UNTIL:
        return None

    try:
        import yfinance as yf
    except Exception:
        return None

    try:
        history = yf.Ticker(ticker).history(
            period=range_,
            interval=interval,
            auto_adjust=False,
            prepost=False,
        )
    except Exception as exc:
        if exc.__class__.__name__ == "YFRateLimitError":
            YFINANCE_RATE_LIMITED_UNTIL = now + timedelta(minutes=5)
        return None

    if history.empty:
        return None

    timezone_name = str(getattr(history.index, "tz", None) or _infer_market_timezone(ticker))
    bars: list[dict[str, Any]] = []
    incomplete_latest_bar = ""
    for index, row in history.iterrows():
        timestamp = index.to_pydatetime()
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        time_value = _format_time(timestamp, interval)
        close = _finite_number(row.get("Close"))
        if close is None:
            incomplete_latest_bar = max(incomplete_latest_bar, time_value)
            continue
        open_ = _finite_number(row.get("Open"))
        high = _finite_number(row.get("High"))
        low = _finite_number(row.get("Low"))
        if None in {open_, high, low}:
            incomplete_latest_bar = max(incomplete_latest_bar, time_value)
            continue
        bars.append(
            {
                "time": time_value,
                "open": round(open_, 4),
                "high": round(high, 4),
                "low": round(low, 4),
                "close": round(close, 4),
                "volume": int(row.get("Volume", 0)),
            }
        )

    if not bars:
        return None

    series_type = "line" if range_ == "5d" and interval not in {"1d", "1wk", "1mo"} else "candlestick"
    chart = {
        "ticker": ticker.upper(),
        "range": range_,
        "interval": interval,
        "seriesType": series_type,
        "timezone": timezone_name,
        "source": "yahoo",
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }
    if incomplete_latest_bar and incomplete_latest_bar >= str(bars[-1]["time"]):
        chart["incompleteLatestBar"] = incomplete_latest_bar
    return chart


def _try_yahoo_chart(
    ticker: str,
    range_: str,
    interval: str,
    *,
    force_refresh: bool = False,
) -> Optional[dict[str, Any]]:
    if interval in {"1d", "1wk", "1mo"}:
        return _try_yahoo_history_chart(
            ticker,
            range_,
            interval,
            force_refresh=force_refresh,
        )

    payload = _fetch_yahoo_chart_payload(
        ticker,
        range_,
        interval,
        force_refresh=force_refresh,
    )
    parsed = _parse_yahoo_chart_bars(payload, ticker, interval)
    if not parsed:
        return None

    timezone_name, bars, incomplete_latest_bar = parsed
    if not bars:
        return None

    chart = {
        "ticker": ticker.upper(),
        "range": range_,
        "interval": interval,
        "seriesType": "line" if range_ == "5d" else "candlestick",
        "timezone": timezone_name,
        "source": "yahoo",
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }
    if incomplete_latest_bar:
        chart["incompleteLatestBar"] = incomplete_latest_bar
    return chart


def _try_yahoo_history_chart(
    ticker: str,
    range_: str,
    interval: str,
    *,
    force_refresh: bool = False,
) -> Optional[dict[str, Any]]:
    base_payload = _fetch_yahoo_chart_payload(
        ticker,
        range_,
        "1d",
        force_refresh=force_refresh,
    )
    base_parsed = _parse_yahoo_chart_bars(base_payload, ticker, "1d")
    if not base_parsed:
        return None

    timezone_name, daily_bars, incomplete_latest_bar = base_parsed
    tail_payload = _fetch_yahoo_chart_payload(
        ticker,
        "1mo",
        "1mo",
        force_refresh=force_refresh,
    )
    tail_parsed = _parse_yahoo_chart_bars(tail_payload, ticker, "1mo")
    if tail_parsed:
        tail_timezone_name, tail_bars, tail_incomplete_latest_bar = tail_parsed
        timezone_name = tail_timezone_name or timezone_name
        daily_bars = _merge_daily_bars(daily_bars, tail_bars)
        incomplete_latest_bar = max(
            incomplete_latest_bar, tail_incomplete_latest_bar
        )

    if interval == "1d":
        bars = daily_bars
    elif interval == "1wk":
        bars = _aggregate_daily_bars(daily_bars, "week")
    else:
        bars = _aggregate_daily_bars(daily_bars, "month")

    if not bars:
        return None

    chart = {
        "ticker": ticker.upper(),
        "range": range_,
        "interval": interval,
        "seriesType": "candlestick",
        "timezone": timezone_name,
        "source": "yahoo",
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }
    if incomplete_latest_bar:
        chart["incompleteLatestBar"] = incomplete_latest_bar
    return chart


def _merge_daily_bars(
    daily_bars: list[dict[str, Any]],
    tail_bars: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for bar in daily_bars:
        time_value = str(bar.get("time") or "")
        if time_value:
            merged[time_value] = bar
    latest_time = max(merged) if merged else ""
    for bar in tail_bars:
        time_value = str(bar.get("time") or "")
        if time_value and time_value > latest_time and time_value not in merged:
            merged[time_value] = bar
    return sorted(merged.values(), key=lambda bar: str(bar.get("time") or ""))


def _fetch_yahoo_chart_payload(
    ticker: str,
    range_: str,
    interval: str,
    *,
    force_refresh: bool = False,
) -> Any:
    encoded_ticker = parse.quote(ticker.upper())
    query = parse.urlencode(
        {
            "range": range_,
            "interval": interval,
            "includePrePost": "false",
            "events": "history",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_ticker}?{query}"
    try:
        return _fetch_json(url, timeout=8, force_refresh=force_refresh)
    except (OSError, error.URLError, json.JSONDecodeError):
        return None


def _parse_yahoo_chart_bars(
    payload: Any,
    ticker: str,
    interval: str,
) -> Optional[tuple[str, list[dict[str, Any]], str]]:
    chart = payload.get("chart") if isinstance(payload, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    if not isinstance(results, list) or not results:
        return None

    result = results[0]
    if not isinstance(result, dict):
        return None
    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    quotes = indicators.get("quote") if isinstance(indicators, dict) else None
    quote = quotes[0] if isinstance(quotes, list) and quotes else None
    if not isinstance(timestamps, list) or not isinstance(quote, dict):
        return None

    meta = result.get("meta") if isinstance(result.get("meta"), dict) else {}
    timezone_name = str(meta.get("exchangeTimezoneName") or _infer_market_timezone(ticker))
    market_zone = ZoneInfo(timezone_name)
    is_intraday = interval not in {"1d", "1wk", "1mo"}
    bars: list[dict[str, Any]] = []
    incomplete_latest_bar = ""
    for index, raw_timestamp in enumerate(timestamps):
        timestamp = _parse_epoch_seconds(raw_timestamp)
        if timestamp is None:
            continue
        market_time = timestamp.astimezone(market_zone).time()
        if is_intraday and not (REGULAR_SESSION_OPEN <= market_time < REGULAR_SESSION_CLOSE):
            continue

        open_ = _finite_quote_value(quote.get("open"), index)
        high = _finite_quote_value(quote.get("high"), index)
        low = _finite_quote_value(quote.get("low"), index)
        close = _finite_quote_value(quote.get("close"), index)
        if None in {open_, high, low, close}:
            incomplete_latest_bar = max(
                incomplete_latest_bar, _format_time(timestamp, interval)
            )
            continue
        volume = _finite_quote_value(quote.get("volume"), index) or 0
        bars.append(
            {
                "time": _format_time(timestamp, interval),
                "open": round(open_, 4),
                "high": round(high, 4),
                "low": round(low, 4),
                "close": round(close, 4),
                "volume": int(volume),
            }
        )

    if not bars:
        return None

    if incomplete_latest_bar < str(bars[-1]["time"]):
        incomplete_latest_bar = ""
    return timezone_name, bars, incomplete_latest_bar


def _try_nasdaq_chart(
    ticker: str,
    range_: str,
    interval: str,
    *,
    force_refresh: bool = False,
) -> Optional[dict[str, Any]]:
    if interval not in {"1d", "1wk", "1mo"}:
        return None

    rows = _fetch_first_nasdaq_history(
        ticker,
        range_,
        force_refresh=force_refresh,
    )
    if not rows:
        return None

    bars = []
    for row in rows:
        bar = _nasdaq_history_row_to_bar(row)
        if bar:
            bars.append(bar)
    bars.sort(key=lambda bar: bar["time"])

    if interval == "1wk":
        bars = _aggregate_daily_bars(bars, "week")
    elif interval == "1mo":
        bars = _aggregate_daily_bars(bars, "month")

    if not bars:
        return None

    return {
        "ticker": ticker.upper(),
        "range": range_,
        "interval": interval,
        "seriesType": "candlestick",
        "timezone": _infer_market_timezone(ticker),
        "source": "nasdaq",
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }


def _try_nasdaq_intraday_chart(
    ticker: str,
    range_: str,
    interval: str,
    *,
    force_refresh: bool = False,
) -> Optional[dict[str, Any]]:
    points = _fetch_first_nasdaq_intraday_points(
        ticker,
        force_refresh=force_refresh,
    )
    if not points:
        return None

    timezone_name = _infer_market_timezone(ticker)
    points = _filter_regular_session_points(points, timezone_name)
    bars = _aggregate_intraday_points(points, interval)
    if not bars:
        return None

    return {
        "ticker": ticker.upper(),
        "range": range_,
        "interval": interval,
        "seriesType": "candlestick",
        "timezone": timezone_name,
        "source": "nasdaq",
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }


def _fetch_first_nasdaq_history(
    ticker: str,
    range_: str,
    *,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    for asset_class in _nasdaq_asset_classes(ticker):
        rows = _fetch_nasdaq_history(
            ticker,
            asset_class,
            range_,
            force_refresh=force_refresh,
        )
        if rows:
            return rows
    return []


def _fetch_first_nasdaq_intraday_points(
    ticker: str,
    *,
    force_refresh: bool = False,
) -> list[tuple[datetime, float]]:
    for asset_class in _nasdaq_asset_classes(ticker):
        points = _fetch_nasdaq_intraday_points(
            ticker,
            asset_class,
            force_refresh=force_refresh,
        )
        if points:
            return points
    return []


def _fetch_nasdaq_history(
    ticker: str,
    asset_class: str,
    range_: str,
    *,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    start_date, end_date = _history_date_range(ticker, range_)
    encoded_ticker = parse.quote(ticker.upper())
    query = parse.urlencode(
        {
            "assetclass": asset_class,
            "fromdate": start_date.isoformat(),
            "todate": end_date.isoformat(),
            "limit": "9999",
        }
    )
    url = f"https://api.nasdaq.com/api/quote/{encoded_ticker}/historical?{query}"
    try:
        payload = _fetch_json(url, timeout=8, force_refresh=force_refresh)
    except (OSError, error.URLError, json.JSONDecodeError):
        return []

    data = payload.get("data") if isinstance(payload, dict) else None
    trades_table = data.get("tradesTable") if isinstance(data, dict) else None
    rows = trades_table.get("rows") if isinstance(trades_table, dict) else None
    return rows if isinstance(rows, list) else []


def _fetch_nasdaq_intraday_points(
    ticker: str,
    asset_class: str,
    *,
    force_refresh: bool = False,
) -> list[tuple[datetime, float]]:
    timezone_name = _infer_market_timezone(ticker)
    encoded_ticker = parse.quote(ticker.upper())
    query = parse.urlencode({"assetclass": asset_class})
    url = f"https://api.nasdaq.com/api/quote/{encoded_ticker}/chart?{query}"
    try:
        payload = _fetch_json(url, timeout=8, force_refresh=force_refresh)
    except (OSError, error.URLError, json.JSONDecodeError):
        return []

    data = payload.get("data") if isinstance(payload, dict) else None
    chart = data.get("chart") if isinstance(data, dict) else None
    if not isinstance(chart, list):
        return []

    points: list[tuple[datetime, float]] = []
    for item in chart:
        if not isinstance(item, dict):
            continue
        timestamp = _parse_nasdaq_intraday_millis(item.get("x"), timezone_name)
        price = _parse_market_number(item.get("y"))
        if timestamp is None or price is None:
            continue
        points.append((timestamp, price))
    return sorted(points, key=lambda point: point[0])


def _fetch_json(url: str, timeout: int, *, force_refresh: bool = False) -> Any:
    now = datetime.now(timezone.utc)
    cached = NASDAQ_JSON_CACHE.get(url)
    if not force_refresh and cached and now - cached[0] < NASDAQ_CACHE_TTL:
        return cached[1]

    http_request = request.Request(url, headers=NASDAQ_HEADERS)
    with request.urlopen(http_request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    NASDAQ_JSON_CACHE[url] = (now, payload)
    return payload


def _history_date_range(ticker: str, range_: str) -> tuple[date, date]:
    market_zone = ZoneInfo(_infer_market_timezone(ticker))
    end_date = _latest_weekday(datetime.now(market_zone).date())
    if range_ == "max":
        return _known_listing_date(ticker), end_date

    days_by_range = {
        "10y": 3650,
        "5y": 1825,
        "1y": 365,
        "6mo": 183,
        "3mo": 92,
        "1mo": 31,
        "5d": 10,
        "1d": 5,
    }
    start_date = end_date - timedelta(days=days_by_range.get(range_, 365))
    return start_date, end_date


def _parse_epoch_millis(value: Any) -> Optional[datetime]:
    try:
        timestamp = float(value) / 1000
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)


def _parse_epoch_seconds(value: Any) -> Optional[datetime]:
    try:
        timestamp = float(value)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)


def _finite_quote_value(values: Any, index: int) -> Optional[float]:
    if not isinstance(values, list) or index >= len(values):
        return None
    try:
        value = float(values[index])
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _finite_number(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _parse_nasdaq_intraday_millis(value: Any, timezone_name: str) -> Optional[datetime]:
    timestamp = _parse_epoch_millis(value)
    if timestamp is None:
        return None

    market_zone = ZoneInfo(timezone_name)
    market_time = datetime(
        timestamp.year,
        timestamp.month,
        timestamp.day,
        timestamp.hour,
        timestamp.minute,
        timestamp.second,
        timestamp.microsecond,
        tzinfo=market_zone,
    )
    return market_time.astimezone(timezone.utc)


def _filter_regular_session_points(
    points: list[tuple[datetime, float]], timezone_name: str
) -> list[tuple[datetime, float]]:
    market_zone = ZoneInfo(timezone_name)
    return [
        (timestamp, price)
        for timestamp, price in points
        if REGULAR_SESSION_OPEN
        <= timestamp.astimezone(market_zone).time()
        < REGULAR_SESSION_CLOSE
    ]


def _nasdaq_history_row_to_bar(row: Any) -> Optional[dict[str, Any]]:
    if not isinstance(row, dict):
        return None
    row_date = row.get("date")
    if not row_date:
        return None
    try:
        parsed_date = datetime.strptime(str(row_date), "%m/%d/%Y").date()
    except ValueError:
        return None

    open_ = _parse_market_number(row.get("open"))
    high = _parse_market_number(row.get("high"))
    low = _parse_market_number(row.get("low"))
    close = _parse_market_number(row.get("close"))
    if None in {open_, high, low, close}:
        return None

    return {
        "time": parsed_date.isoformat(),
        "open": round(open_, 4),
        "high": round(high, 4),
        "low": round(low, 4),
        "close": round(close, 4),
        "volume": int(_parse_market_number(row.get("volume")) or 0),
    }


def _aggregate_daily_bars(
    daily_bars: list[dict[str, Any]], bucket: str
) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for bar in daily_bars:
        try:
            bar_date = date.fromisoformat(str(bar["time"]))
        except ValueError:
            continue
        if bucket == "month":
            key = (bar_date.year, bar_date.month)
        else:
            iso_year, iso_week, _ = bar_date.isocalendar()
            key = (iso_year, iso_week)
        grouped.setdefault(key, []).append(bar)

    bars = []
    for bucket_bars in grouped.values():
        first = bucket_bars[0]
        last = bucket_bars[-1]
        bars.append(
            {
                "time": last["time"],
                "open": first["open"],
                "high": max(bar["high"] for bar in bucket_bars),
                "low": min(bar["low"] for bar in bucket_bars),
                "close": last["close"],
                "volume": sum(int(bar.get("volume", 0)) for bar in bucket_bars),
            }
        )
    return bars


def _aggregate_intraday_points(
    points: list[tuple[datetime, float]],
    interval: str,
) -> list[dict[str, Any]]:
    interval_minutes = _interval_minutes(interval) or 1
    buckets: dict[int, list[tuple[datetime, float]]] = {}
    for timestamp, price in points:
        bucket = int(timestamp.timestamp() // (interval_minutes * 60))
        buckets.setdefault(bucket, []).append((timestamp, price))

    bars = []
    for bucket_points in buckets.values():
        first_time = bucket_points[0][0]
        prices = [price for _, price in bucket_points]
        bars.append(
            {
                "time": first_time.isoformat(),
                "open": round(prices[0], 4),
                "high": round(max(prices), 4),
                "low": round(min(prices), 4),
                "close": round(prices[-1], 4),
                "volume": 0,
            }
        )
    return sorted(bars, key=lambda bar: bar["time"])


def _unavailable_chart(
    ticker: str, range_: str, interval: str, message: str
) -> dict[str, Any]:
    return {
        "ticker": ticker.upper(),
        "range": range_,
        "interval": interval,
        "seriesType": "line",
        "timezone": _infer_market_timezone(ticker),
        "source": "unavailable",
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "message": message,
        "bars": [],
    }


def _sample_quote(ticker: str) -> dict[str, Any]:
    rng = _rng(ticker)
    base_price = _sample_base_price(ticker)
    price = base_price * (1 + rng.uniform(-0.018, 0.018))
    change_percent = rng.uniform(-2.4, 2.4)
    change = price * change_percent / 100
    return {
        "price": round(price, 2),
        "change": round(change, 2),
        "changePercent": round(change_percent, 2),
        "volume": rng.randint(800_000, 80_000_000),
        "source": "sample",
    }


def _sample_chart(ticker: str, range_: str, interval: str) -> dict[str, Any]:
    rng = _rng(f"{ticker}:{range_}:{interval}")
    count, step = _sample_shape(range_, interval)
    timestamps = _sample_timestamps(ticker, range_, interval, count, step)
    base_price = _sample_base_price(ticker)
    price = base_price * (1 + rng.uniform(-0.06, 0.06))
    bars: list[dict[str, Any]] = []

    for index, current in enumerate(timestamps):
        drift = (
            (base_price - price) * 0.035
            + math.sin(index / 9) * base_price * 0.0025
            + rng.uniform(-0.011, 0.011) * base_price
        )
        open_ = price
        close = max(max(0.5, base_price * 0.2), open_ + drift)
        day_range = base_price * rng.uniform(0.002, 0.012)
        high = max(open_, close) + day_range
        low = max(0.5, min(open_, close) - day_range)
        volume = rng.randint(500_000, 90_000_000)
        bars.append(
            {
                "time": _format_time(current, interval),
                "open": round(open_, 4),
                "high": round(high, 4),
                "low": round(low, 4),
                "close": round(close, 4),
                "volume": volume,
            }
        )
        price = close

    return {
        "ticker": ticker.upper(),
        "range": range_,
        "interval": interval,
        "seriesType": "candlestick",
        "timezone": _infer_market_timezone(ticker),
        "source": "sample",
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "bars": bars,
    }


def _sample_base_price(ticker: str) -> float:
    symbol = ticker.upper().split(".", 1)[0]
    if symbol in SAMPLE_PRICE_ANCHORS:
        return SAMPLE_PRICE_ANCHORS[symbol]
    rng = _rng(symbol)
    return 40 + rng.random() * 260


def _sample_shape(range_: str, interval: str) -> tuple[int, timedelta]:
    if range_ == "1d":
        return 78, timedelta(minutes=5)
    if range_ == "5d":
        return 130, timedelta(minutes=15)
    if interval == "1wk":
        return 260, timedelta(days=7)
    if interval == "1mo":
        return 120, timedelta(days=30)
    if range_ == "1mo":
        return 22, timedelta(days=1)
    return 252, timedelta(days=1)


def _sample_timestamps(
    ticker: str, range_: str, interval: str, count: int, step: timedelta
) -> list[datetime]:
    if range_ in {"1d", "5d"} and interval not in {"1d", "1wk", "1mo"}:
        return _sample_intraday_timestamps(ticker, range_, interval, count)
    if range_ == "max" and interval in {"1d", "1wk", "1mo"}:
        return _sample_listing_timestamps(ticker, interval)

    start = datetime.now(timezone.utc) - step * count
    return [start + step * index for index in range(count)]


def _sample_listing_timestamps(ticker: str, interval: str) -> list[datetime]:
    timezone_name = _infer_market_timezone(ticker)
    market_zone = ZoneInfo(timezone_name)
    start_date = _known_listing_date(ticker)
    end_date = _latest_weekday(datetime.now(market_zone).date())
    current = datetime.combine(start_date, time(hour=9, minute=30), tzinfo=market_zone)
    end = datetime.combine(end_date, time(hour=9, minute=30), tzinfo=market_zone)
    step = {"1wk": timedelta(days=7), "1mo": timedelta(days=30)}.get(
        interval,
        timedelta(days=1),
    )
    timestamps: list[datetime] = []
    while current <= end:
        if interval != "1d" or current.weekday() < 5:
            timestamps.append(current)
        current += step
    return timestamps


def _sample_intraday_timestamps(
    ticker: str, range_: str, interval: str, count: int
) -> list[datetime]:
    timezone_name = _infer_market_timezone(ticker)
    market_zone = ZoneInfo(timezone_name)
    interval_minutes = _interval_minutes(interval) or 5
    session_count = 1 if range_ == "1d" else 5
    latest = _latest_weekday(datetime.now(market_zone).date())
    dates = []
    current = latest

    while len(dates) < session_count:
        if current.weekday() < 5:
            dates.append(current)
        current -= timedelta(days=1)

    timestamps: list[datetime] = []
    for session_date in reversed(dates):
        session_start = datetime.combine(
            session_date, time(hour=9, minute=30), tzinfo=market_zone
        )
        bars_per_session = int(timedelta(hours=6, minutes=30) / timedelta(minutes=interval_minutes))
        for index in range(bars_per_session):
            timestamps.append(session_start + timedelta(minutes=index * interval_minutes))

    return timestamps[-count:]


def _latest_weekday(value):
    current = value
    while current.weekday() >= 5:
        current -= timedelta(days=1)
    return current


def _interval_minutes(interval: str) -> int | None:
    if interval.endswith("m") and interval[:-1].isdigit():
        return int(interval[:-1])
    if interval.endswith("h") and interval[:-1].isdigit():
        return int(interval[:-1]) * 60
    return None


def _format_time(value: datetime, interval: str) -> str:
    if interval in {"1d", "1wk", "1mo"}:
        return value.date().isoformat()
    return value.astimezone(timezone.utc).isoformat()


def _infer_market_timezone(ticker: str) -> str:
    symbol = ticker.upper()
    if symbol.endswith(".HK"):
        return "Asia/Hong_Kong"
    if symbol.endswith(".SS") or symbol.endswith(".SZ"):
        return "Asia/Shanghai"
    return "America/New_York"


def _known_listing_date(ticker: str) -> date:
    symbol = ticker.upper().split(".", 1)[0]
    return KNOWN_LISTING_DATES.get(symbol, date(1990, 1, 1))


def _rng(seed: str) -> random.Random:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))
