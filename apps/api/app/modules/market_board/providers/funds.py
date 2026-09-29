from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from ..models import FundHoldings, Instrument, Nav, ObservationMeta, ObservationStatus, PurchaseLimit
from .fund_parsers import parse_purchase_state


class FundProvider:
    def __init__(self, http=None):
        self.http = http

    def nav(self, instrument: Instrument, now: datetime) -> Nav:
        return Nav(value=None, meta=ObservationMeta(source="fund", fetched_at=now, status=ObservationStatus.MISSING, reason="未取得正式净值"))

    def purchase_limit(self, instrument: Instrument, now: datetime) -> PurchaseLimit:
        state, amount = parse_purchase_state(None)
        return PurchaseLimit(state=state, amount=Decimal(amount) if amount else None, channel="eastmoney", meta=ObservationMeta(source="fund", fetched_at=now, status=ObservationStatus.MISSING, reason="渠道信息不可用"))

    def holdings(self, instrument: Instrument, now: datetime) -> FundHoldings:
        return FundHoldings(instrument_key=instrument.key, meta=ObservationMeta(source="fund", fetched_at=now, status=ObservationStatus.MISSING, reason="披露信息不可用"))

