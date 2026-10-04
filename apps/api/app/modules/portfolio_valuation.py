"""Shared portfolio valuation semantics for local API consumers.

An observation is usable only when it has a positive price and is explicitly
real/cache-backed. Missing observations stay unknown; they are never replaced
with historical cost or a deterministic sample value.
"""

from __future__ import annotations

from math import isfinite
from typing import Any


def value_positions(
    positions: list[dict[str, Any]],
    observations: list[dict[str, Any]] | dict[str, dict[str, Any]],
    *,
    base_currency: str | None = None,
) -> dict[str, Any]:
    observation_map = (
        observations
        if isinstance(observations, dict)
        else {
            str(row.get("ticker") or row.get("instrument_key") or "").upper(): row
            for row in observations
            if isinstance(row, dict)
        }
    )
    held = [row for row in positions if _number(row.get("shares")) > 0]
    market_value = 0.0
    unrealized_pnl = 0.0
    day_change = 0.0
    market_covered = unrealized_covered = day_covered = 0
    missing: list[str] = []
    incompatible: list[str] = []

    for position in held:
        ticker = str(position.get("ticker") or "").upper()
        observation = observation_map.get(ticker) or {}
        if (
            base_currency
            and observation.get("currency")
            and observation.get("currency") != base_currency
        ):
            incompatible.append(ticker)
            continue
        price = _positive(observation.get("price"))
        if (
            price is None
            or observation.get("source") == "sample"
            or observation.get("status") in {"missing", "unavailable"}
        ):
            missing.append(ticker)
            continue
        shares = _number(position.get("shares"))
        cost = _number(position.get("holdingCost"))
        market_value += shares * price
        market_covered += 1
        if cost >= 0:
            unrealized_pnl += shares * price - cost
            unrealized_covered += 1
        previous_close = _positive(observation.get("previous_close"))
        if previous_close is not None:
            day_change += shares * (price - previous_close)
            day_covered += 1

    return {
        "market_value": round(market_value, 2) if market_covered else None,
        "market_value_covered": market_covered,
        "market_value_total": len(held),
        "unrealized_pnl": round(unrealized_pnl, 2) if unrealized_covered else None,
        "unrealized_covered": unrealized_covered,
        "unrealized_total": len(held),
        "day_change": round(day_change, 2) if day_covered else None,
        "day_change_covered": day_covered,
        "day_change_total": len(held),
        "missing_tickers": missing,
        "incompatible_tickers": incompatible,
    }


def _number(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return parsed if isfinite(parsed) else 0.0


def _positive(value: Any) -> float | None:
    parsed = _number(value)
    return parsed if parsed > 0 else None
