from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import re

from ..models import FundHoldings, Instrument, Nav, ObservationMeta, ObservationStatus, PurchaseLimit
from .fund_parsers import parse_nav_trend, parse_purchase_state, parse_holdings


class FundProvider:
    def __init__(self, http=None):
        self.http = http

    def nav(self, instrument: Instrument, now: datetime) -> Nav:
        try:
            text = self.http.get(f"https://fund.eastmoney.com/pingzhongdata/{instrument.symbol}.js", referer="https://fund.eastmoney.com/").decode("utf-8-sig", "replace")
            row = parse_nav_trend(text, now)
            if row:
                return Nav(value=Decimal(row["nav"]), change_pct=Decimal(row["change_pct"]) if row.get("change_pct") is not None else None, nav_date=row["date"], meta=ObservationMeta(source="东方财富基金档案", fetched_at=now, as_of=datetime.fromisoformat(row["date"]).replace(tzinfo=timezone.utc), status=ObservationStatus.AVAILABLE, timeliness="eod"))
        except Exception:
            pass
        return Nav(value=None, meta=ObservationMeta(source="东方财富基金档案", fetched_at=now, status=ObservationStatus.MISSING, reason="未取得正式净值"))

    def purchase_limit(self, instrument: Instrument, now: datetime) -> PurchaseLimit:
        try:
            text = self.http.get(f"https://fund.eastmoney.com/{instrument.symbol}.html", referer="https://fund.eastmoney.com/").decode("utf-8-sig", "replace")
            match = re.search(r"(?:限额|申购状态)[^<]{0,80}", text)
            state, amount = parse_purchase_state(match.group(0) if match else text[:1000])
            return PurchaseLimit(state=state, amount=Decimal(amount) if amount else None, channel="eastmoney", meta=ObservationMeta(source="天天基金销售页", fetched_at=now, status=ObservationStatus.AVAILABLE if state != "unknown" else ObservationStatus.PARTIAL, timeliness="delayed"))
        except Exception:
            return PurchaseLimit(state="unknown", channel="eastmoney", meta=ObservationMeta(source="天天基金销售页", fetched_at=now, status=ObservationStatus.MISSING, reason="渠道信息不可用"))

    def holdings(self, instrument: Instrument, now: datetime) -> FundHoldings:
        try:
            text = self.http.get(f"https://fundf10.eastmoney.com/ccmx_{instrument.symbol}.html", referer="https://fundf10.eastmoney.com/").decode("utf-8-sig", "replace")
            parsed = parse_holdings(text, now, instrument.key)
            return FundHoldings(**parsed, meta=ObservationMeta(source="天天基金基金档案", fetched_at=now, status=ObservationStatus.AVAILABLE if parsed["stocks"] or parsed["allocation"] else ObservationStatus.PARTIAL, timeliness="eod"))
        except Exception:
            return FundHoldings(instrument_key=instrument.key, meta=ObservationMeta(source="天天基金基金档案", fetched_at=now, status=ObservationStatus.MISSING, reason="披露信息不可用"))
