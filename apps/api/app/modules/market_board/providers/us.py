from __future__ import annotations
from datetime import datetime
from ..models import Instrument, Quote, ObservationMeta, ObservationStatus

class USProvider:
    def __init__(self, http): self.http = http
    def quotes(self, instruments: list[Instrument], now: datetime) -> list[Quote]:
        return [Quote(instrument_key=item.key, meta=ObservationMeta(source="us", fetched_at=now, status=ObservationStatus.MISSING, reason="公开源暂不可用")) for item in instruments]

