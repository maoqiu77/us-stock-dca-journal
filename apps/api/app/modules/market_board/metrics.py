from __future__ import annotations

from decimal import Decimal


def premium_percentile(observations: list[dict], trading_dates: list[str], current: str, basis: str) -> tuple[str | None, int]:
    dates = list(dict.fromkeys(trading_dates))
    allowed = set(dates[-60:])
    unique = {}
    conflicts = set()
    for row in observations:
        if row.get('basis') != basis or row.get('trade_date') not in allowed or not row.get('is_final') or row.get('status', 'available') not in ('available', 'stale'):
            continue
        try:
            value = Decimal(str(row['premium']))
            if not value.is_finite():
                continue
        except Exception:
            continue
        day = row['trade_date']
        if day in unique and unique[day] != value:
            conflicts.add(day)
        unique[day] = value
    values = [value for day,value in unique.items() if day not in conflicts]
    if len(allowed) != 60 or len(values) != 60:
        return None, len(values)
    current_value = Decimal(str(current))
    return format((Decimal(sum(value <= current_value for value in values)) * 100 / 60).normalize(), 'f'), 60


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
