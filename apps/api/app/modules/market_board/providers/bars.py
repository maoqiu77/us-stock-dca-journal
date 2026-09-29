from __future__ import annotations

from datetime import datetime, timezone
from . import __doc__
from ..models import Bar, Instrument, ObservationMeta, ObservationStatus, Series


class BarsProvider:
    def __init__(self, http): self.http = http
    def series(self, instrument: Instrument, period: str, range_: str, now: datetime) -> Series:
        if instrument.market.value != "US" or period != "1d" or range_ not in {"1mo", "3mo", "1y"}:
            return Series(instrument_key=instrument.key, currency=instrument.currency, period=period, range=range_, timezone=instrument.timezone, bars=[], meta=ObservationMeta(source="bars", fetched_at=now, status=ObservationStatus.MISSING, reason="该周期暂不支持"))
        return Series(instrument_key=instrument.key, currency=instrument.currency, period=period, range=range_, timezone=instrument.timezone, bars=[], meta=ObservationMeta(source="bars", fetched_at=now, status=ObservationStatus.MISSING, reason="公开源暂不可用"))

