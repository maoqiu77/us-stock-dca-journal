from __future__ import annotations

import numpy as np
import pandas as pd


def moving_average(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window=window, min_periods=window).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    value = 100 - (100 / (1 + rs))
    return value.fillna(100).where(avg_loss != 0, 100)


def add_indicators(df: pd.DataFrame, rsi_period: int = 14) -> pd.DataFrame:
    out = df.copy()
    close = out["Close"]
    out["MA20"] = moving_average(close, 20)
    out["MA60"] = moving_average(close, 60)
    out["MA120"] = moving_average(close, 120)
    out["MA200"] = moving_average(close, 200)
    out["RSI14"] = rsi(close, rsi_period)
    out["High20"] = close.rolling(window=20, min_periods=20).max()
    out["High60"] = close.rolling(window=60, min_periods=60).max()
    out["High252"] = close.rolling(window=252, min_periods=1).max()
    out["Drawdown20"] = (out["High20"] - close) / out["High20"]
    out["Drawdown60"] = (out["High60"] - close) / out["High60"]
    out["Drawdown252"] = (out["High252"] - close) / out["High252"]
    out["Return20"] = close.pct_change(20)
    out["Return60"] = close.pct_change(60)
    return out


def latest_metrics(df: pd.DataFrame) -> dict[str, float | str]:
    if df.empty:
        return {}
    row = df.dropna(subset=["Close"]).iloc[-1]
    keys = [
        "Close",
        "MA20",
        "MA60",
        "MA120",
        "MA200",
        "RSI14",
        "High20",
        "High60",
        "High252",
        "Drawdown20",
        "Drawdown60",
        "Drawdown252",
        "Return20",
        "Return60",
    ]
    metrics: dict[str, float | str] = {
        key: float(row[key]) if pd.notna(row.get(key)) else np.nan for key in keys
    }
    window = df.dropna(subset=["Close"]).tail(252)
    if not window.empty:
        high_value = window["Close"].max()
        high_rows = window.index[window["Close"] == high_value]
        if len(high_rows):
            metrics["High252Date"] = pd.Timestamp(high_rows[-1]).date().isoformat()
    return metrics


def trend_status(
    metrics: dict[str, float],
    pullback_min: float = 0.03,
    pullback_max: float = 0.08,
    rsi_max: float = 75,
) -> str:
    price = metrics.get("Close", np.nan)
    ma60 = metrics.get("MA60", np.nan)
    ma120 = metrics.get("MA120", np.nan)
    rsi_value = metrics.get("RSI14", np.nan)
    drawdown20 = metrics.get("Drawdown20", np.nan)

    if np.isnan(price) or np.isnan(ma60) or np.isnan(ma120):
        return "数据不足"
    if price < ma120:
        return "风险暂停"
    if rsi_value > rsi_max:
        return "过热"
    if price > ma60 and pullback_min <= drawdown20 <= pullback_max:
        return "回调中"
    if price > ma60 and price > ma120:
        return "趋势向上"
    return "观察等待"
