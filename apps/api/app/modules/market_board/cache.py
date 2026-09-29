from __future__ import annotations

from datetime import datetime, timedelta, timezone


TTL_SECONDS = {
    "quote": 30,
    "bars": 60,
    "catalog": 24 * 60 * 60,
    "nav": 15 * 60,
    "purchase_limit": 15 * 60,
    "holdings": 6 * 60 * 60,
    "shares": 6 * 60 * 60,
    "trading_dates": 6 * 60 * 60,
}
RETAIN_SECONDS = {
    "quote": 7 * 24 * 60 * 60,
    "bars": 7 * 24 * 60 * 60,
    "nav": 7 * 24 * 60 * 60,
    "purchase_limit": 7 * 24 * 60 * 60,
    "holdings": 30 * 24 * 60 * 60,
    "shares": 30 * 24 * 60 * 60,
    "trading_dates": 30 * 24 * 60 * 60,
}


def cache_window(kind: str, now: datetime | None = None) -> tuple[str, str]:
    current = now or datetime.now(timezone.utc)
    return (current + timedelta(seconds=TTL_SECONDS[kind])).isoformat(), (current + timedelta(seconds=RETAIN_SECONDS.get(kind, TTL_SECONDS[kind]))).isoformat()


def cache_key(provider: str, identity: str, data_kind: str, period: str = "", range_: str = "", adjustment: str = "raw", schema_version: int = 1) -> str:
    return ":".join((provider, identity, data_kind, period, range_, adjustment, str(schema_version)))

