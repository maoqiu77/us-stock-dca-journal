from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pandas as pd

from app.modules.backtest_engine import (
    result_to_dict,
    run_legacy_strategy_set,
    run_strategy_comparison,
)
from app.modules.indicators import add_indicators, latest_metrics
from app.modules.market import get_chart
from app.modules.signal_engine import evaluate_add_signal
from app.modules.trading_data import (
    account_summary,
    active_strategy_settings,
    derive_positions,
    etf_investment_pool,
    load_trading_state,
    strategy_settings_to_engine_config,
)


def get_signal_rows() -> list[dict[str, Any]]:
    state = load_trading_state()
    summary = account_summary(state)
    settings = active_strategy_settings(state)
    strategy_config, risk_config = strategy_settings_to_engine_config(settings)
    positions = derive_positions(state)

    if not positions:
        return []

    max_workers = min(len(positions), 6)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        contexts = list(executor.map(load_signal_context, positions))
    pool = etf_investment_pool(state, settings)
    trades = state.get("trades", [])
    candidates = []
    for context in contexts:
        position = context["position"]
        price = finite_metric(context["metrics"].get("Close")) or 0.0
        market_value = price * float(position["shares"])
        target_gap = max(float(summary["totalAssets"]) * float(position["targetWeight"]) - market_value, 0.0)
        candidates.append(
            {
                "ticker": position["ticker"],
                "assetType": position["assetType"],
                "drawdown252": finite_metric(context["metrics"].get("Drawdown252")) or 0.0,
                "targetGap": target_gap,
                "etfLimitGap": max(
                    float(summary["totalAssets"]) * float(risk_config.get("max_etf_weight", 0.6))
                    - market_value,
                    0.0,
                ),
                "cycleInvested": sum(
                    max(float(trade.get("amount", 0.0)), 0.0)
                    for trade in trades
                    if trade.get("action") == "买入"
                    and str(trade.get("ticker", "")).upper() == str(position["ticker"]).upper()
                    and (
                        not context["metrics"].get("High252Date")
                        or str(trade.get("date", "")) >= str(context["metrics"]["High252Date"])
                    )
                ),
            }
        )
    allocations = allocate_etf_investments(candidates, pool, float(summary["cash"]))
    return [
        build_signal_row(
            context["position"],
            summary,
            {**strategy_config, "etf_allocation_amount": allocations.get(context["position"]["ticker"], 0.0)},
            risk_config,
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


def build_signal_row(
    position: dict[str, Any],
    summary: dict[str, Any],
    strategy_config: dict[str, Any],
    risk_config: dict[str, Any],
    chart: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    chart = chart or get_chart(position["ticker"], "1y", "1d")
    if metrics is None:
        prices = bars_to_dataframe(chart.get("bars", []))
        indicators = (
            add_indicators(prices, int(strategy_config.get("rsi_period", 14)))
            if not prices.empty
            else prices
        )
        metrics = latest_metrics(indicators) if not indicators.empty else {}
    signal = evaluate_add_signal(
        ticker=position["ticker"],
        metrics=metrics,
        shares=float(position["shares"]),
        target_weight=float(position["targetWeight"]),
        asset_type=str(position["assetType"]),
        total_assets=float(summary["totalAssets"]),
        cash=float(summary["cash"]),
        strategy_config=strategy_config,
        risk_config=risk_config,
        cost_basis=float(position["costBasis"]),
        take_profit_pct=float(position["takeProfitPct"]),
        stop_loss_pct=float(position["stopLossPct"]),
    )
    row = signal.to_row()
    row["source"] = chart.get("source")
    row["ma20"] = finite_metric(metrics.get("MA20"))
    row["ma60"] = finite_metric(metrics.get("MA60"))
    row["ma120"] = finite_metric(metrics.get("MA120"))
    row["ma200"] = finite_metric(metrics.get("MA200"))
    row["drawdown252"] = finite_metric(metrics.get("Drawdown252"))
    row["high252_date"] = metrics.get("High252Date")
    return row


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
