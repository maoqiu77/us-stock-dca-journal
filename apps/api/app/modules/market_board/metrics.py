from __future__ import annotations

from decimal import Decimal


def premium_percentile(observations: list[dict], trading_dates: list[str], current: str, basis: str) -> tuple[str | None, int]:
    dates = list(dict.fromkeys(trading_dates))
    if len(dates) < 60:
        return None, len(dates)
    allowed = set(dates[-60:])
    values = [Decimal(str(row["premium"])) for row in observations if row.get("basis") == basis and row.get("trade_date") in allowed and row.get("is_final")]
    if len(values) != 60:
        return None, len(values)
    current_value = Decimal(str(current))
    return str((sum(value <= current_value for value in values) * 100 // 60)), 60


def shares_delta(current: tuple[str, str], previous: tuple[str, str] | None, trading_dates: list[str]) -> str | None:
    if previous is None:
        return None
    try:
        current_date, current_value = current
        previous_date, previous_value = previous
        dates = list(dict.fromkeys(trading_dates))
        if current_date not in dates or previous_date not in dates or dates.index(current_date) - dates.index(previous_date) != 1:
            return None
        return str(Decimal(current_value) - Decimal(previous_value))
    except Exception:
        return None

