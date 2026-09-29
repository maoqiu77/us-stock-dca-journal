from __future__ import annotations
from datetime import date

def fetch_cn_trading_dates(http, through: date, count: int = 60) -> list[str]:
    return []

def classify_observation(instrument, as_of, now, exchange_status=None):
    return "unknown", "partial" if as_of is not None else "missing"

