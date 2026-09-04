from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

import pandas as pd

from app.modules.backtest_engine import (
    result_to_dict,
    run_legacy_strategy_set,
    run_strategy_comparison,
)
from app.modules.indicators import add_indicators, latest_metrics
from app.modules.market import get_chart
from app.modules.trading_data import (
    account_summary,
    active_strategy_settings,
    derive_positions,
    load_trading_state,
    strategy_settings_to_engine_config,
)


def get_signal_rows() -> list[dict[str, Any]]:
    state = load_trading_state()
    summary = account_summary(state)
    positions = derive_positions(state)

    if not positions:
        return []

    max_workers = min(len(positions), 6)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        contexts = list(executor.map(load_signal_context, positions))
    return [
        build_market_observation_row(
            context["position"],
            summary,
            chart=context["chart"],
            metrics=context["metrics"],
        )
        for context in contexts
    ]


def drawdown_entitlement(drawdown: float) -> float:
    if drawdown >= 0.20:
        return 1.0
    if drawdown >= 0.15:
        return 0.60
    if drawdown >= 0.10:
        return 0.35
    if drawdown >= 0.05:
        return 0.15
    return 0.0


def allocate_etf_investments(
    candidates: list[dict[str, Any]],
    pool: dict[str, float],
    cash: float,
) -> dict[str, float]:
    """Allocate one shared cumulative ETF entitlement by target gaps."""
    eligible = [
        item
        for item in candidates
        if item.get("assetType") == "ETF"
        and min(float(item.get("targetGap", 0.0)), float(item.get("etfLimitGap", item.get("targetGap", 0.0)))) > 0
        and drawdown_entitlement(float(item.get("drawdown252", 0.0))) > 0
    ]
    if not eligible:
        return {}
    tier_available = max(
        max(
            float(pool.get("total", 0.0)) * drawdown_entitlement(float(item["drawdown252"]))
            - float(item.get("cycleInvested", pool.get("invested", 0.0))),
            0.0,
        )
        for item in eligible
    )
    available = min(
        tier_available,
        float(pool.get("remaining", 0.0)),
        max(cash, 0.0),
        sum(min(float(item["targetGap"]), float(item.get("etfLimitGap", item["targetGap"]))) for item in eligible),
    )
    gaps = {
        str(item["ticker"]): min(
            float(item["targetGap"]),
            float(item.get("etfLimitGap", item["targetGap"])),
        )
        for item in eligible
    }
    total_gap = sum(gaps.values())
    if available <= 0 or total_gap <= 0:
        return {}
    return {
        str(item["ticker"]): round(
            min(available * gaps[str(item["ticker"])] / total_gap, gaps[str(item["ticker"])]),
            2,
        )
        for item in eligible
    }


def load_signal_context(position: dict[str, Any]) -> dict[str, Any]:
    chart = get_chart(position["ticker"], "1y", "1d")
    prices = bars_to_dataframe(chart.get("bars", []))
    indicators = add_indicators(prices) if not prices.empty else prices
    return {
        "position": position,
        "chart": chart,
        "metrics": latest_metrics(indicators) if not indicators.empty else {},
    }


def build_market_observation_row(
    position: dict[str, Any],
    summary: dict[str, Any],
    chart: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    chart = chart or get_chart(position["ticker"], "1y", "1d")
    if metrics is None:
        prices = bars_to_dataframe(chart.get("bars", []))
        indicators = add_indicators(prices) if not prices.empty else prices
        metrics = latest_metrics(indicators) if not indicators.empty else {}
    price = finite_metric(metrics.get("Close")) or 0.0
    shares = max(float(position.get("shares", 0.0)), 0.0)
    cost_basis = max(float(position.get("costBasis", 0.0)), 0.0)
    market_value = price * shares
    total_assets = max(float(summary.get("totalAssets", 0.0)), 0.0)
    status, observation, reasons = classify_technical_observation(metrics)
    return {
        "ticker": str(position.get("ticker", "")).upper(),
        "current_price": price,
        "trend_status": status,
        "drawdown": finite_metric(metrics.get("Drawdown20")) or 0.0,
        "drawdown252": finite_metric(metrics.get("Drawdown252")),
        "high252_date": metrics.get("High252Date"),
        "rsi": finite_metric(metrics.get("RSI14")) or 0.0,
        "ma20": finite_metric(metrics.get("MA20")),
        "ma60": finite_metric(metrics.get("MA60")),
        "ma120": finite_metric(metrics.get("MA120")),
        "ma200": finite_metric(metrics.get("MA200")),
        "market_value": market_value,
        "cost_basis": cost_basis,
        "return_from_cost": price / cost_basis - 1 if price > 0 and cost_basis > 0 else 0.0,
        "take_profit_pct": 0.0,
        "stop_loss_pct": 0.0,
        "unrealized_pnl": (price - cost_basis) * shares,
        "current_weight": market_value / total_assets if total_assets > 0 else 0.0,
        "target_weight": 0.0,
        "action": observation,
        "status": status,
        "suggested_amount": 0.0,
        "suggested_shares": 0.0,
        "reasons": "；".join(reasons),
        "blocked_reasons": "",
        "risk_notes": "技术状态仅描述当前行情，不构成具体交易指令。",
        "manual_instruction": "未生成具体交易指令。",
        "date": date.today().isoformat(),
        "source": chart.get("source"),
    }


def classify_technical_observation(
    metrics: dict[str, Any],
) -> tuple[str, str, list[str]]:
    price = finite_metric(metrics.get("Close"))
    ma60 = finite_metric(metrics.get("MA60"))
    ma120 = finite_metric(metrics.get("MA120"))
    rsi = finite_metric(metrics.get("RSI14"))
    drawdown252 = finite_metric(metrics.get("Drawdown252"))
    if price is None or ma60 is None or ma120 is None or rsi is None:
        return "数据不足", "等待有效行情", ["当前数据不足以判断技术状态"]

    reasons = [f"现价 {price:.2f}，MA60 {ma60:.2f}，MA120 {ma120:.2f}，RSI {rsi:.1f}"]
    if drawdown252 is not None:
        reasons.append(f"52 周回撤 {drawdown252:.2%}")
    if price < ma120:
        return "趋势偏弱", "关注长期趋势风险", reasons
    if rsi >= 70:
        return "短期偏热", "关注波动风险", reasons
    if price >= ma60 and ma60 >= ma120:
        return "趋势偏强", "保持观察", reasons
    if price < ma60:
        return "中期走弱", "关注趋势变化", reasons
    return "趋势中性", "保持观察", reasons


def get_backtest_result(
    ticker: str,
    initial_cash: float | None = None,
    range_: str = "10y",
) -> dict[str, Any]:
    state = load_trading_state()
    summary = account_summary(state)
    settings = active_strategy_settings(state)
    strategy_config, _ = strategy_settings_to_engine_config(settings)
    cash = initial_cash if initial_cash is not None and initial_cash > 0 else summary["totalAssets"]
    chart = get_chart(ticker, range_, "1d")
    prices = bars_to_dataframe(chart.get("bars", []))
    results = run_strategy_comparison(prices, cash, strategy_config)
    legacy_results = run_legacy_strategy_set(prices, cash, strategy_config)
    return {
        "ticker": ticker.upper(),
        "source": chart.get("source"),
        "range": range_,
        "initialCash": cash,
        "items": [result_to_dict(result) for result in results],
        "legacyItems": [result_to_dict(result) for result in legacy_results],
    }


def bars_to_dataframe(bars: list[dict[str, Any]]) -> pd.DataFrame:
    if not bars:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    rows = []
    index = []
    for bar in bars:
        timestamp = pd.to_datetime(bar.get("time"), utc=True, errors="coerce")
        if pd.isna(timestamp):
            continue
        index.append(timestamp.tz_convert(None).normalize())
        rows.append(
            {
                "Open": float(bar.get("open", 0.0)),
                "High": float(bar.get("high", 0.0)),
                "Low": float(bar.get("low", 0.0)),
                "Close": float(bar.get("close", 0.0)),
                "Volume": float(bar.get("volume", 0.0)),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    return pd.DataFrame(rows, index=pd.DatetimeIndex(index)).sort_index()


def finite_metric(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None
