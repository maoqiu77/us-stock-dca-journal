from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from .models import AssetType, BoardRow, EtfMetrics, Instrument, Nav, ObservationMeta, ObservationStatus, PurchaseLimit, Quote


def meta(reason: str = "确定性示例数据") -> ObservationMeta:
    now = datetime.now(timezone.utc)
    return ObservationMeta(source="template", fetched_at=now, as_of=now, status=ObservationStatus.SAMPLE, timeliness="unknown", cache_state="miss", reason=reason)


def row_for(item: Instrument) -> BoardRow:
    m = meta()
    if item.asset_type is AssetType.FUND:
        nav = Nav(value=Decimal("1.2345"), change_pct=Decimal("0.42"), nav_date=date.today(), meta=m)
        limit = PurchaseLimit(state="unknown", meta=m)
        return BoardRow(instrument=item, nav=nav, purchase_limit=limit, quality=ObservationStatus.SAMPLE)
    price = Decimal("185.32") if item.currency == "USD" else Decimal("1.0234")
    quote = Quote(instrument_key=item.key, price=price, previous_close=price - Decimal("1.12"), change=Decimal("1.12"), change_pct=Decimal("0.61"), volume=None, trading_date=date.today(), session="closed", meta=m)
    metrics = EtfMetrics(premium_pct=None, premium_basis="unknown", sample_days=0, meta=m) if item.asset_type is AssetType.ETF and item.market.value == "CN" else None
    return BoardRow(instrument=item, quote=quote, metrics=metrics, quality=ObservationStatus.SAMPLE)

