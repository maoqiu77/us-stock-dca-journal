from __future__ import annotations

from datetime import date, timedelta


def normalize_us_trading_date(value: str | date) -> str:
    candidate = date.fromisoformat(value) if isinstance(value, str) else value
    while not is_us_trading_day(candidate):
        candidate -= timedelta(days=1)
    return candidate.isoformat()


def add_us_trading_days(value: str | date, count: int) -> str:
    candidate = date.fromisoformat(value) if isinstance(value, str) else value
    remaining = max(0, int(count))
    while remaining:
        candidate += timedelta(days=1)
        if is_us_trading_day(candidate):
            remaining -= 1
    return candidate.isoformat()


def reflection_eligible(effective_date: str, today: str | None = None) -> bool:
    current = date.fromisoformat(today) if today else date.today()
    unlock_date = date.fromisoformat(add_us_trading_days(effective_date, 5))
    return current >= unlock_date


def is_us_trading_day(value: date) -> bool:
    return value.weekday() < 5 and value not in _market_holidays(value.year)


def _market_holidays(year: int) -> set[date]:
    holidays = {
        _observed(date(year, 1, 1)),
        _nth_weekday(year, 1, 0, 3),
        _nth_weekday(year, 2, 0, 3),
        _easter_sunday(year) - timedelta(days=2),
        _last_weekday(year, 5, 0),
        _observed(date(year, 7, 4)),
        _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 11, 3, 4),
        _observed(date(year, 12, 25)),
    }
    if year >= 2022:
        holidays.add(_observed(date(year, 6, 19)))
    return holidays


def _observed(value: date) -> date:
    if value.weekday() == 5:
        return value - timedelta(days=1)
    if value.weekday() == 6:
        return value + timedelta(days=1)
    return value


def _nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> date:
    value = date(year, month, 1)
    value += timedelta(days=(weekday - value.weekday()) % 7)
    return value + timedelta(days=7 * (occurrence - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    if month == 12:
        value = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        value = date(year, month + 1, 1) - timedelta(days=1)
    return value - timedelta(days=(value.weekday() - weekday) % 7)


def _easter_sunday(year: int) -> date:
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    month_offset = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * month_offset) // 451
    month = (h + month_offset - 7 * m + 114) // 31
    day = (h + month_offset - 7 * m + 114) % 31 + 1
    return date(year, month, day)
