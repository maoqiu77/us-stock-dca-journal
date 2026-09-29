from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from .models import AssetType, BoardRow, EtfMetrics, FundHoldings, Instrument, Nav, ObservationMeta, ObservationStatus, PurchaseLimit, Quote, Bar, Series


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
    metrics = EtfMetrics(premium_pct=Decimal("-0.42"), premium_basis="vendor_reference", reference_value=Decimal("1.0277"), reference_date=date.today(), percentile60=None, sample_days=0, shares=None, meta=m) if item.asset_type is AssetType.ETF and item.market.value == "CN" else None
    return BoardRow(instrument=item, quote=quote, metrics=metrics, quality=ObservationStatus.SAMPLE)


def holdings_for(item: Instrument) -> FundHoldings:
    return FundHoldings(instrument_key=item.key, report_date=date.today().replace(day=1) - timedelta(days=1), allocation={"report_date": date.today().replace(day=1) - timedelta(days=1), "stocks_pct": "82.10", "bonds_pct": "2.30", "cash_pct": "15.60"}, stocks=[{"rank": 1, "symbol": "AAPL", "name": "Apple", "weight_pct": "8.20"}, {"rank": 2, "symbol": "MSFT", "name": "Microsoft", "weight_pct": "7.90"}], meta=meta())


def series_for(item: Instrument, period: str, range_: str) -> Series:
    count = {"1mo": 22, "3mo": 66, "1y": 252}.get(range_, 22)
    start = date.today() - timedelta(days=count + 8)
    bars = []
    for index in range(count):
        day = start + timedelta(days=index)
        if day.weekday() >= 5:
            continue
        base = Decimal("175") + Decimal(index) * Decimal("0.12")
        bars.append(Bar(time=datetime(day.year, day.month, day.day, 21, 0, tzinfo=timezone.utc), trading_date=day, open=base, high=base + Decimal("1.20"), low=base - Decimal("0.80"), close=base + Decimal("0.40"), volume=None, is_final=True))
    return Series(instrument_key=item.key, currency=item.currency, period=period, range=range_, timezone=item.timezone, adjustment="unadjusted", volume_unit="shares", bars=bars, meta=meta())
