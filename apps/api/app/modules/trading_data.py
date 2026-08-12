from __future__ import annotations

import json
import math
import uuid
from copy import deepcopy
from datetime import date
from typing import Any

from app.core.database import (
    delete_state_payload,
    get_state_payload,
    get_watchlist,
    set_state_payload,
)


APP_STATE_KEY = "trading_data_v1"

BALANCED_SETTINGS: dict[str, Any] = {
    "maMedium": 60,
    "maLong": 120,
    "maRisk": 200,
    "maShort": 20,
    "rsiPeriod": 14,
    "rsiMax": 72.0,
    "reduceRsi": 78.0,
    "takeProfitRsi": 82.0,
    "pullbackMin": 0.03,
    "pullbackMax": 0.10,
    "deeperPullbackMin": 0.10,
    "deeperPullbackMax": 0.18,
    "targetWeightDefault": 0.10,
    "singleAddAssetRatio": 0.05,
    "singleAddCashRatio": 0.20,
    "starterPositionRatio": 0.33,
    "starterAddAssetRatio": 0.03,
    "starterAddCashRatio": 0.12,
    "strongAddAssetRatio": 0.07,
    "strongAddCashRatio": 0.25,
    "trimToTargetBuffer": 0.03,
    "takeProfitTrimRatio": 0.20,
    "hardStopMaBreakRatio": 0.50,
    "maxEtfWeight": 0.60,
    "monthlyDcaAmount": 100.0,
    "recentEtfInvestmentAmount": 0.0,
    "recentEtfInvestmentStartDate": "",
    "etfRsiMax": 74.0,
    "etfReduceRsi": 80.0,
    "etfTakeProfitRsi": 84.0,
    "etfPullbackMin": 0.02,
    "etfPullbackMax": 0.08,
    "etfDeeperPullbackMin": 0.08,
    "etfDeeperPullbackMax": 0.15,
    "etfStarterPositionRatio": 0.40,
    "etfStarterAddAssetRatio": 0.04,
    "etfStarterAddCashRatio": 0.15,
    "etfStrongAddAssetRatio": 0.08,
    "etfStrongAddCashRatio": 0.28,
    "etfTrimToTargetBuffer": 0.04,
    "stockRsiMax": 70.0,
    "stockReduceRsi": 76.0,
    "stockTakeProfitRsi": 80.0,
    "stockPullbackMin": 0.04,
    "stockPullbackMax": 0.12,
    "stockDeeperPullbackMin": 0.12,
    "stockDeeperPullbackMax": 0.20,
    "stockStarterPositionRatio": 0.25,
    "stockStarterAddAssetRatio": 0.025,
    "stockStarterAddCashRatio": 0.10,
    "stockStrongAddAssetRatio": 0.06,
    "stockStrongAddCashRatio": 0.22,
    "stockTrimToTargetBuffer": 0.02,
    "coreRsiMax": 72.0,
    "coreReduceRsi": 78.0,
    "coreTakeProfitRsi": 82.0,
    "corePullbackMin": 0.03,
    "corePullbackMax": 0.10,
    "coreDeeperPullbackMin": 0.10,
    "coreDeeperPullbackMax": 0.18,
    "coreStarterPositionRatio": 0.33,
    "coreStarterAddAssetRatio": 0.035,
    "coreStarterAddCashRatio": 0.13,
    "coreStrongAddAssetRatio": 0.07,
    "coreStrongAddCashRatio": 0.25,
    "coreTrimToTargetBuffer": 0.03,
    "satelliteRsiMax": 68.0,
    "satelliteReduceRsi": 74.0,
    "satelliteTakeProfitRsi": 78.0,
    "satellitePullbackMin": 0.05,
    "satellitePullbackMax": 0.14,
    "satelliteDeeperPullbackMin": 0.14,
    "satelliteDeeperPullbackMax": 0.24,
    "satelliteStarterPositionRatio": 0.20,
    "satelliteStarterAddAssetRatio": 0.02,
    "satelliteStarterAddCashRatio": 0.08,
    "satelliteStrongAddAssetRatio": 0.05,
    "satelliteStrongAddCashRatio": 0.18,
    "satelliteTrimToTargetBuffer": 0.015,
    "layeredPlanAmount": 200.0,
    "layeredPullbacks": [
        {"min": 0.03, "max": 0.05, "ratio": 0.20},
        {"min": 0.05, "max": 0.08, "ratio": 0.30},
        {"min": 0.08, "max": 0.12, "ratio": 0.50},
    ],
    "coreHoldings": {},
    "satelliteSymbols": [],
}

STRATEGY_ENGINE_KEY_MAP = {
    "maMedium": "ma_medium",
    "maLong": "ma_long",
    "maRisk": "ma_risk",
    "maShort": "ma_short",
    "rsiPeriod": "rsi_period",
    "rsiMax": "rsi_max",
    "reduceRsi": "reduce_rsi",
    "takeProfitRsi": "take_profit_rsi",
    "pullbackMin": "pullback_min",
    "pullbackMax": "pullback_max",
    "deeperPullbackMin": "deeper_pullback_min",
    "deeperPullbackMax": "deeper_pullback_max",
    "targetWeightDefault": "target_weight_default",
    "singleAddAssetRatio": "single_add_asset_ratio",
    "singleAddCashRatio": "single_add_cash_ratio",
    "starterPositionRatio": "starter_position_ratio",
    "starterAddAssetRatio": "starter_add_asset_ratio",
    "starterAddCashRatio": "starter_add_cash_ratio",
    "strongAddAssetRatio": "strong_add_asset_ratio",
    "strongAddCashRatio": "strong_add_cash_ratio",
    "trimToTargetBuffer": "trim_to_target_buffer",
    "takeProfitTrimRatio": "take_profit_trim_ratio",
    "hardStopMaBreakRatio": "hard_stop_ma_break_ratio",
    "monthlyDcaAmount": "monthly_dca_amount",
    "recentEtfInvestmentAmount": "recent_etf_investment_amount",
    "etfRsiMax": "etf_rsi_max",
    "etfReduceRsi": "etf_reduce_rsi",
    "etfTakeProfitRsi": "etf_take_profit_rsi",
    "etfPullbackMin": "etf_pullback_min",
    "etfPullbackMax": "etf_pullback_max",
    "etfDeeperPullbackMin": "etf_deeper_pullback_min",
    "etfDeeperPullbackMax": "etf_deeper_pullback_max",
    "etfStarterPositionRatio": "etf_starter_position_ratio",
    "etfStarterAddAssetRatio": "etf_starter_add_asset_ratio",
    "etfStarterAddCashRatio": "etf_starter_add_cash_ratio",
    "etfStrongAddAssetRatio": "etf_strong_add_asset_ratio",
    "etfStrongAddCashRatio": "etf_strong_add_cash_ratio",
    "etfTrimToTargetBuffer": "etf_trim_to_target_buffer",
    "stockRsiMax": "stock_rsi_max",
    "stockReduceRsi": "stock_reduce_rsi",
    "stockTakeProfitRsi": "stock_take_profit_rsi",
    "stockPullbackMin": "stock_pullback_min",
    "stockPullbackMax": "stock_pullback_max",
    "stockDeeperPullbackMin": "stock_deeper_pullback_min",
    "stockDeeperPullbackMax": "stock_deeper_pullback_max",
    "stockStarterPositionRatio": "stock_starter_position_ratio",
    "stockStarterAddAssetRatio": "stock_starter_add_asset_ratio",
    "stockStarterAddCashRatio": "stock_starter_add_cash_ratio",
    "stockStrongAddAssetRatio": "stock_strong_add_asset_ratio",
    "stockStrongAddCashRatio": "stock_strong_add_cash_ratio",
    "stockTrimToTargetBuffer": "stock_trim_to_target_buffer",
    "coreRsiMax": "core_rsi_max",
    "coreReduceRsi": "core_reduce_rsi",
    "coreTakeProfitRsi": "core_take_profit_rsi",
    "corePullbackMin": "core_pullback_min",
    "corePullbackMax": "core_pullback_max",
    "coreDeeperPullbackMin": "core_deeper_pullback_min",
    "coreDeeperPullbackMax": "core_deeper_pullback_max",
    "coreStarterPositionRatio": "core_starter_position_ratio",
    "coreStarterAddAssetRatio": "core_starter_add_asset_ratio",
    "coreStarterAddCashRatio": "core_starter_add_cash_ratio",
    "coreStrongAddAssetRatio": "core_strong_add_asset_ratio",
    "coreStrongAddCashRatio": "core_strong_add_cash_ratio",
    "coreTrimToTargetBuffer": "core_trim_to_target_buffer",
    "satelliteRsiMax": "satellite_rsi_max",
    "satelliteReduceRsi": "satellite_reduce_rsi",
    "satelliteTakeProfitRsi": "satellite_take_profit_rsi",
    "satellitePullbackMin": "satellite_pullback_min",
    "satellitePullbackMax": "satellite_pullback_max",
    "satelliteDeeperPullbackMin": "satellite_deeper_pullback_min",
    "satelliteDeeperPullbackMax": "satellite_deeper_pullback_max",
    "satelliteStarterPositionRatio": "satellite_starter_position_ratio",
    "satelliteStarterAddAssetRatio": "satellite_starter_add_asset_ratio",
    "satelliteStarterAddCashRatio": "satellite_starter_add_cash_ratio",
    "satelliteStrongAddAssetRatio": "satellite_strong_add_asset_ratio",
    "satelliteStrongAddCashRatio": "satellite_strong_add_cash_ratio",
    "satelliteTrimToTargetBuffer": "satellite_trim_to_target_buffer",
    "layeredPlanAmount": "layered_plan_amount",
    "layeredPullbacks": "layered_pullbacks",
    "coreHoldings": "core_holdings",
    "satelliteSymbols": "satellite_symbols",
}

DEFAULT_TRADING_DATA: dict[str, Any] = {
    "schemaVersion": 1,
    "account": {
        "totalAssets": 12000.0,
        "baseCurrency": "USD",
    },
    "stockPool": ["VOO", "QQQM", "NVDA", "MSFT"],
    "positions": [
        {
            "ticker": "QQQM",
            "targetWeight": 0.35,
            "assetType": "ETF",
            "takeProfitPct": 0.0,
            "stopLossPct": 0.0,
            "purchaseDate": "2026-06-05",
        },
        {
            "ticker": "MSFT",
            "targetWeight": 0.16,
            "assetType": "STOCK",
            "takeProfitPct": 0.20,
            "stopLossPct": 0.08,
            "purchaseDate": "",
        },
    ],
    "trades": [
        {
            "id": "sample-qqqm-buy",
            "date": "2026-06-05",
            "ticker": "QQQM",
            "action": "买入",
            "shares": 8.0,
            "unitPrice": 220.0,
            "amount": 1760.0,
            "note": "样例 ETF 底仓",
        },
    ],
    "activeStrategyProfile": "balanced",
    "strategyProfiles": [
        {
            "id": "conservative",
            "name": "保守型",
            "description": "更严格的追高限制，更小的单次加仓比例。",
            "settings": {
                **BALANCED_SETTINGS,
                "rsiMax": 68.0,
                "reduceRsi": 74.0,
                "takeProfitRsi": 78.0,
                "singleAddAssetRatio": 0.03,
                "singleAddCashRatio": 0.12,
                "hardStopMaBreakRatio": 0.40,
                "maxEtfWeight": 0.50,
            },
        },
        {
            "id": "balanced",
            "name": "平衡型",
            "description": "默认策略参数，适合多数手动加减仓场景。",
            "settings": deepcopy(BALANCED_SETTINGS),
        },
        {
            "id": "aggressive",
            "name": "进取型",
            "description": "允许更高 RSI 和更大单次加仓比例。",
            "settings": {
                **BALANCED_SETTINGS,
                "rsiMax": 78.0,
                "reduceRsi": 84.0,
                "takeProfitRsi": 88.0,
                "pullbackMin": 0.02,
                "singleAddAssetRatio": 0.08,
                "singleAddCashRatio": 0.30,
                "hardStopMaBreakRatio": 0.60,
                "maxEtfWeight": 0.70,
            },
        },
        {
            "id": "custom",
            "name": "自定义",
            "description": "从当前策略复制而来，可按自己的交易风格调整。",
            "settings": deepcopy(BALANCED_SETTINGS),
        },
    ],
    "privacyMode": "external-ai-ready",
}


def load_trading_state() -> dict[str, Any]:
    payload = get_state_payload(APP_STATE_KEY)
    if not payload:
        state = sanitize_trading_state(DEFAULT_TRADING_DATA)
        save_trading_state(state)
        return state

    try:
        return sanitize_trading_state(json.loads(payload))
    except (json.JSONDecodeError, TypeError):
        return sanitize_trading_state(DEFAULT_TRADING_DATA)


def save_trading_state(state: dict[str, Any]) -> dict[str, Any]:
    sanitized = sanitize_trading_state(state)
    set_state_payload(APP_STATE_KEY, json.dumps(sanitized, ensure_ascii=False))
    return sanitized


def reset_trading_state() -> dict[str, Any]:
    delete_state_payload(APP_STATE_KEY)
    return load_trading_state()


def get_effective_watchlist() -> list[dict[str, Any]]:
    state = load_trading_state()
    saved_rows = {row["ticker"].upper(): row for row in get_watchlist()}
    items: list[dict[str, Any]] = []
    for ticker in state["stockPool"]:
        saved = saved_rows.get(ticker, {})
        items.append(
            {
                "ticker": ticker,
                "name": saved.get("name") or ticker,
                "market": saved.get("market") or infer_market(ticker),
            }
        )
    return items


def derive_positions(state: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    current = state or load_trading_state()
    target_by_ticker = {
        normalize_ticker(position.get("ticker", "")): position
        for position in current.get("positions", [])
    }
    derived: list[dict[str, Any]] = []

    for ticker in current.get("stockPool", []):
        shares = 0.0
        lots: list[dict[str, float]] = []
        first_buy_date = ""
        ticker_trades = sorted(
            [
                trade
                for trade in current.get("trades", [])
                if normalize_ticker(trade.get("ticker", "")) == ticker
            ],
            key=lambda item: str(item.get("date", "")),
        )
        for trade in ticker_trades:
            quantity = max(number(trade.get("shares")), 0.0)
            price = max(number(trade.get("unitPrice")), 0.0)
            if quantity <= 0 or price <= 0:
                continue
            if trade.get("action") == "卖出":
                sell_quantity = min(quantity, shares)
                shares -= sell_quantity
                remaining_sell = sell_quantity
                while remaining_sell > 1e-9 and lots:
                    lot = lots[0]
                    lot_shares = lot["shares"]
                    consumed = min(remaining_sell, lot_shares)
                    unit_cost = lot["cost"] / lot_shares if lot_shares > 0 else 0.0
                    lot["shares"] -= consumed
                    lot["cost"] -= consumed * unit_cost
                    remaining_sell -= consumed
                    if lot["shares"] <= 1e-9:
                        lots.pop(0)
            else:
                trade_cost = number(trade.get("amount"))
                if trade_cost <= 0:
                    trade_cost = quantity * price
                shares += quantity
                lots.append({"shares": quantity, "cost": trade_cost})
                if not first_buy_date:
                    first_buy_date = str(trade.get("date", ""))

        plan = target_by_ticker.get(ticker, {})
        cost_value = sum(lot["cost"] for lot in lots)
        cost_basis = cost_value / shares if shares > 0 else 0.0
        derived.append(
            {
                "ticker": ticker,
                "targetWeight": number(
                    plan.get("targetWeight"),
                    BALANCED_SETTINGS["targetWeightDefault"],
                ),
                "assetType": "ETF" if plan.get("assetType") == "ETF" else "STOCK",
                "takeProfitPct": number(plan.get("takeProfitPct")),
                "stopLossPct": number(plan.get("stopLossPct")),
                "purchaseDate": str(plan.get("purchaseDate") or first_buy_date),
                "shares": round(max(shares, 0.0), 6),
                "costBasis": round(cost_basis, 4),
                "holdingCost": round(max(cost_value, 0.0), 2),
            }
        )
    return derived


def account_summary(state: dict[str, Any] | None = None) -> dict[str, float]:
    current = state or load_trading_state()
    total_assets = number(current.get("account", {}).get("totalAssets"))
    holding_cost = sum(position["holdingCost"] for position in derive_positions(current))
    return {
        "totalAssets": total_assets,
        "holdingCost": round(holding_cost, 2),
        "cash": round(max(total_assets - holding_cost, 0.0), 2),
    }


def active_strategy_settings(state: dict[str, Any] | None = None) -> dict[str, Any]:
    current = state or load_trading_state()
    active_id = current.get("activeStrategyProfile", "balanced")
    profiles = current.get("strategyProfiles", [])
    active = next((profile for profile in profiles if profile.get("id") == active_id), None)
    return deepcopy((active or profiles[0]).get("settings", BALANCED_SETTINGS))


def strategy_settings_to_engine_config(settings: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    cleaned = sanitize_strategy_settings(settings)
    strategy: dict[str, Any] = {}
    for source_key, engine_key in STRATEGY_ENGINE_KEY_MAP.items():
        if source_key == "coreHoldings":
            strategy[engine_key] = cleaned.get(source_key, {})
        elif source_key == "satelliteSymbols":
            strategy[engine_key] = cleaned.get(source_key, [])
        elif source_key == "layeredPullbacks":
            strategy["layered_pullbacks"] = [
                {
                    "min": item["min"],
                    "max": item["max"],
                    "ratio": item["ratio"],
                }
                for item in cleaned.get(source_key, [])
            ]
        else:
            default = BALANCED_SETTINGS.get(source_key, 0.0)
            strategy[engine_key] = number(cleaned.get(source_key), number(default))
    risk = {"max_etf_weight": number(cleaned.get("maxEtfWeight"), 0.60)}
    return strategy, risk


def etf_investment_pool(state: dict[str, Any], settings: dict[str, Any]) -> dict[str, float]:
    """Derive the shared recent ETF funding pool from recorded trades."""
    total = max(number(settings.get("recentEtfInvestmentAmount")), 0.0)
    start_date = str(settings.get("recentEtfInvestmentStartDate") or "")
    etf_symbols = {
        normalize_ticker(position.get("ticker"))
        for position in state.get("positions", [])
        if position.get("assetType") == "ETF"
    }
    invested = sum(
        max(number(trade.get("amount")), 0.0)
        for trade in state.get("trades", [])
        if trade.get("action") == "买入"
        and normalize_ticker(trade.get("ticker")) in etf_symbols
        and (not start_date or str(trade.get("date") or "") >= start_date)
    )
    invested = round(invested, 2)
    return {
        "total": round(total, 2),
        "invested": invested,
        "remaining": round(max(total - invested, 0.0), 2),
    }


def validate_trading_state(state: dict[str, Any] | None = None) -> list[str]:
    current = state or load_trading_state()
    errors: list[str] = []
    pool = [normalize_ticker(ticker) for ticker in current.get("stockPool", [])]
    pool_set = set(pool)
    duplicates = duplicate_tickers(pool)
    summary = account_summary(current)

    if not pool:
        errors.append("股票池至少需要保留一个标的。")
    if duplicates:
        errors.append(f"股票池存在重复标的：{', '.join(duplicates)}。")
    if summary["totalAssets"] + 1e-9 < summary["holdingCost"]:
        errors.append(f"总资产不能低于当前持仓成本 {summary['holdingCost']:.2f}。")

    positions = current.get("positions", [])
    position_tickers = [normalize_ticker(position.get("ticker", "")) for position in positions]
    for ticker in duplicate_tickers(position_tickers):
        errors.append(f"持仓表存在重复标的：{ticker}。")
    for position in positions:
        ticker = normalize_ticker(position.get("ticker", ""))
        if ticker and ticker not in pool_set:
            errors.append(f"持仓表标的 {ticker} 不在股票池中。")
        for key, label in [
            ("targetWeight", "目标仓位"),
            ("takeProfitPct", "止盈线"),
            ("stopLossPct", "止损线"),
        ]:
            value = number(position.get(key))
            if value < 0 or value > 1:
                errors.append(f"{ticker or '持仓'} 的{label}必须在 0 到 1 之间。")

    target_weight_total = sum(number(position.get("targetWeight")) for position in positions)
    if target_weight_total > 1 + 1e-9:
        errors.append(f"目标仓位总和不能超过 100%，当前为 {target_weight_total:.2%}。")

    running_shares: dict[str, float] = {}
    for index, trade in enumerate(current.get("trades", []), start=1):
        ticker = normalize_ticker(trade.get("ticker", ""))
        amount = number(trade.get("amount"))
        unit_price = number(trade.get("unitPrice"))
        shares = number(trade.get("shares"))
        if not ticker and amount <= 0 and unit_price <= 0:
            continue
        row_label = f"交易记录第 {index} 行"
        if ticker not in pool_set:
            errors.append(f"{row_label}：{ticker or '空标的'} 不在股票池中。")
            continue
        try:
            date.fromisoformat(str(trade.get("date", "")))
        except ValueError:
            errors.append(f"{row_label}：日期必须使用 YYYY-MM-DD 格式。")
        if amount <= 0:
            errors.append(f"{row_label}：交易金额必须大于 0。")
        if unit_price <= 0:
            errors.append(f"{row_label}：单支成本必须大于 0。")
        if shares <= 0:
            errors.append(f"{row_label}：交易金额和单支成本无法计算出有效股数。")

        current_shares = running_shares.get(ticker, 0.0)
        if trade.get("action") == "卖出":
            if shares > current_shares + 1e-9:
                errors.append(
                    f"{row_label}：卖出 {shares:g} 股 {ticker} 超过此前持仓 {current_shares:g} 股。"
                )
            running_shares[ticker] = max(current_shares - shares, 0.0)
        else:
            running_shares[ticker] = current_shares + shares
    return errors


def sanitize_trading_state(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return deepcopy(DEFAULT_TRADING_DATA)

    default = deepcopy(DEFAULT_TRADING_DATA)
    stock_pool = unique_tickers(value.get("stockPool") or default["stockPool"])
    profiles = value.get("strategyProfiles")
    if not isinstance(profiles, list) or not profiles:
        profiles = default["strategyProfiles"]
    sanitized_profiles = [sanitize_strategy_profile(profile) for profile in profiles]
    profile_ids = {profile["id"] for profile in sanitized_profiles}
    active_profile = str(value.get("activeStrategyProfile") or default["activeStrategyProfile"])
    if active_profile not in profile_ids:
        active_profile = default["activeStrategyProfile"]

    return {
        "schemaVersion": 1,
        "account": sanitize_account(value.get("account")),
        "stockPool": stock_pool,
        "positions": [
            position
            for position in [sanitize_position(item) for item in value.get("positions", [])]
            if position["ticker"]
        ],
        "trades": [
            trade
            for trade in [sanitize_trade(item) for item in value.get("trades", [])]
            if trade["ticker"]
        ],
        "activeStrategyProfile": active_profile,
        "strategyProfiles": sanitized_profiles,
        "privacyMode": (
            "local-only"
            if value.get("privacyMode") == "local-only"
            else "external-ai-ready"
        ),
    }


def sanitize_account(value: Any) -> dict[str, Any]:
    account = value if isinstance(value, dict) else {}
    currency = str(account.get("baseCurrency") or "USD")
    if currency not in {"USD", "HKD", "CNY"}:
        currency = "USD"
    return {
        "totalAssets": number(account.get("totalAssets"), 0.0),
        "baseCurrency": currency,
    }


def sanitize_position(value: Any) -> dict[str, Any]:
    position = value if isinstance(value, dict) else {}
    return {
        "ticker": normalize_ticker(position.get("ticker", "")),
        "targetWeight": clamp_ratio(position.get("targetWeight")),
        "assetType": "ETF" if position.get("assetType") == "ETF" else "STOCK",
        "takeProfitPct": clamp_ratio(position.get("takeProfitPct")),
        "stopLossPct": clamp_ratio(position.get("stopLossPct")),
        "purchaseDate": str(position.get("purchaseDate") or ""),
    }


def sanitize_trade(value: Any) -> dict[str, Any]:
    trade = value if isinstance(value, dict) else {}
    amount = number(trade.get("amount"))
    unit_price = number(trade.get("unitPrice"))
    shares = number(trade.get("shares"))
    if shares <= 0 and unit_price > 0:
        shares = amount / unit_price
    if amount <= 0 and shares > 0 and unit_price > 0:
        amount = shares * unit_price
    return {
        "id": str(trade.get("id") or f"trade-{uuid.uuid4()}"),
        "date": str(trade.get("date") or date.today().isoformat()),
        "ticker": normalize_ticker(trade.get("ticker", "")),
        "action": "卖出" if trade.get("action") == "卖出" else "买入",
        "shares": round(max(shares, 0.0), 6),
        "unitPrice": round(max(unit_price, 0.0), 4),
        "amount": round(max(amount, 0.0), 2),
        "note": str(trade.get("note") or "").strip(),
    }


def sanitize_strategy_profile(value: Any) -> dict[str, Any]:
    profile = value if isinstance(value, dict) else {}
    profile_id = str(profile.get("id") or "custom")
    if profile_id not in {"conservative", "balanced", "aggressive", "custom"}:
        profile_id = "custom"
    settings = deepcopy(BALANCED_SETTINGS)
    if isinstance(profile.get("settings"), dict):
        settings.update(profile["settings"])
    return {
        "id": profile_id,
        "name": str(profile.get("name") or profile_id),
        "description": str(profile.get("description") or ""),
        "settings": sanitize_strategy_settings(settings),
    }


def sanitize_strategy_settings(settings: dict[str, Any]) -> dict[str, Any]:
    cleaned = deepcopy(BALANCED_SETTINGS)
    cleaned.update(settings)
    for key in [
        "maMedium",
        "maLong",
        "maRisk",
        "maShort",
        "rsiPeriod",
    ]:
        cleaned[key] = int(max(number(cleaned.get(key), BALANCED_SETTINGS[key]), 1))
    for key in [
        "pullbackMin",
        "pullbackMax",
        "deeperPullbackMin",
        "deeperPullbackMax",
        "targetWeightDefault",
        "singleAddAssetRatio",
        "singleAddCashRatio",
        "starterPositionRatio",
        "starterAddAssetRatio",
        "starterAddCashRatio",
        "strongAddAssetRatio",
        "strongAddCashRatio",
        "trimToTargetBuffer",
        "takeProfitTrimRatio",
        "hardStopMaBreakRatio",
        "maxEtfWeight",
        "etfPullbackMin",
        "etfPullbackMax",
        "etfDeeperPullbackMin",
        "etfDeeperPullbackMax",
        "etfStarterPositionRatio",
        "etfStarterAddAssetRatio",
        "etfStarterAddCashRatio",
        "etfStrongAddAssetRatio",
        "etfStrongAddCashRatio",
        "etfTrimToTargetBuffer",
        "stockPullbackMin",
        "stockPullbackMax",
        "stockDeeperPullbackMin",
        "stockDeeperPullbackMax",
        "stockStarterPositionRatio",
        "stockStarterAddAssetRatio",
        "stockStarterAddCashRatio",
        "stockStrongAddAssetRatio",
        "stockStrongAddCashRatio",
        "stockTrimToTargetBuffer",
        "corePullbackMin",
        "corePullbackMax",
        "coreDeeperPullbackMin",
        "coreDeeperPullbackMax",
        "coreStarterPositionRatio",
        "coreStarterAddAssetRatio",
        "coreStarterAddCashRatio",
        "coreStrongAddAssetRatio",
        "coreStrongAddCashRatio",
        "coreTrimToTargetBuffer",
        "satellitePullbackMin",
        "satellitePullbackMax",
        "satelliteDeeperPullbackMin",
        "satelliteDeeperPullbackMax",
        "satelliteStarterPositionRatio",
        "satelliteStarterAddAssetRatio",
        "satelliteStarterAddCashRatio",
        "satelliteStrongAddAssetRatio",
        "satelliteStrongAddCashRatio",
        "satelliteTrimToTargetBuffer",
    ]:
        cleaned[key] = clamp_ratio(cleaned.get(key))
    for key in [
        "rsiMax",
        "reduceRsi",
        "takeProfitRsi",
        "etfRsiMax",
        "etfReduceRsi",
        "etfTakeProfitRsi",
        "stockRsiMax",
        "stockReduceRsi",
        "stockTakeProfitRsi",
        "coreRsiMax",
        "coreReduceRsi",
        "coreTakeProfitRsi",
        "satelliteRsiMax",
        "satelliteReduceRsi",
        "satelliteTakeProfitRsi",
    ]:
        cleaned[key] = min(max(number(cleaned.get(key), BALANCED_SETTINGS[key]), 0.0), 100.0)
    cleaned["monthlyDcaAmount"] = max(number(cleaned.get("monthlyDcaAmount"), 0.0), 0.0)
    cleaned["recentEtfInvestmentAmount"] = max(
        number(cleaned.get("recentEtfInvestmentAmount"), 0.0), 0.0
    )
    start_date = str(cleaned.get("recentEtfInvestmentStartDate") or "")
    try:
        date.fromisoformat(start_date)
    except ValueError:
        start_date = ""
    cleaned["recentEtfInvestmentStartDate"] = start_date
    cleaned["layeredPlanAmount"] = max(number(cleaned.get("layeredPlanAmount"), 0.0), 0.0)
    cleaned["layeredPullbacks"] = sanitize_layered_pullbacks(cleaned.get("layeredPullbacks"))
    cleaned["coreHoldings"] = sanitize_core_holdings(cleaned.get("coreHoldings"))
    cleaned["satelliteSymbols"] = unique_tickers(cleaned.get("satelliteSymbols"))
    return cleaned


def sanitize_layered_pullbacks(value: Any) -> list[dict[str, float]]:
    source = value if isinstance(value, list) else BALANCED_SETTINGS["layeredPullbacks"]
    layers: list[dict[str, float]] = []
    for item in source:
        if not isinstance(item, dict):
            continue
        minimum = clamp_ratio(item.get("min"))
        maximum = clamp_ratio(item.get("max"))
        ratio = clamp_ratio(item.get("ratio"))
        if maximum < minimum:
            minimum, maximum = maximum, minimum
        if maximum > 0 and ratio > 0:
            layers.append({"min": minimum, "max": maximum, "ratio": ratio})
    return layers or deepcopy(BALANCED_SETTINGS["layeredPullbacks"])


def sanitize_core_holdings(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, str] = {}
    for key, role in value.items():
        ticker = normalize_ticker(key)
        role_value = str(role).strip().lower()
        if ticker and role_value in {"core", "satellite"}:
            output[ticker] = role_value
    return output


def normalize_ticker(value: Any) -> str:
    return str(value or "").strip().upper()


def unique_tickers(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    seen: set[str] = set()
    tickers: list[str] = []
    for value in values:
        ticker = normalize_ticker(value)
        if ticker and ticker not in seen:
            tickers.append(ticker)
            seen.add(ticker)
    return tickers


def duplicate_tickers(values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: list[str] = []
    for value in values:
        ticker = normalize_ticker(value)
        if ticker in seen and ticker not in duplicates:
            duplicates.append(ticker)
        seen.add(ticker)
    return duplicates


def infer_market(ticker: str) -> str:
    if ticker.endswith(".HK"):
        return "HKEX"
    if ticker.endswith(".SS") or ticker.endswith(".SZ"):
        return "CN"
    return "US"


def number(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(parsed) or math.isinf(parsed):
        return default
    return parsed


def clamp_ratio(value: Any) -> float:
    return min(max(number(value), 0.0), 1.0)
