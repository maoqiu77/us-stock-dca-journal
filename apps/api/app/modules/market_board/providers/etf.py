from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal

from ..models import EtfMetrics, Instrument, ObservationMeta, ObservationStatus


class EtfProvider:
    def __init__(self, http):
        self.http = http

    def metrics(self, instruments: list[Instrument], now: datetime) -> dict[str, EtfMetrics]:
        result: dict[str, EtfMetrics] = {}
        for item in instruments:
            try:
                market = 1 if item.exchange == "XSHG" else 0
                fields = "f12,f13,f14,f2,f3,f38,f124,f441,f402"
                url = f"https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids={market}.{item.symbol}&fltt=2&fields={fields}"
                payload = json.loads(self.http.get(url, referer="https://quote.eastmoney.com/").decode("utf-8"))
                rows = payload.get("data", {}).get("diff", [])
                row = next((value for value in rows if value.get("f12") == item.symbol and value.get("f13") == market and value.get("f14") == item.name), None)
                as_of = datetime.fromtimestamp(row["f124"], timezone.utc) if row and isinstance(row.get("f124"), (int, float)) else None
                valid = row is not None and as_of is not None and as_of <= now.replace(tzinfo=timezone.utc) + __import__("datetime").timedelta(seconds=60) and isinstance(row.get("f2"), (int, float)) and row["f2"] > 0
                result[item.key] = EtfMetrics(
                    premium_pct=Decimal(str(-row["f402"])) if valid and isinstance(row.get("f402"), (int, float)) else None,
                    premium_basis="vendor_reference" if valid and row.get("f402") is not None else "unknown",
                    reference_value=Decimal(str(row["f441"])) if valid and isinstance(row.get("f441"), (int, float)) and row["f441"] > 0 else None,
                    reference_date=as_of.date() if valid and as_of else None,
                    shares=Decimal(str(row["f38"])) if valid and isinstance(row.get("f38"), (int, float)) and row["f38"] >= 0 else None,
                    shares_date=as_of.date() if valid and as_of else None,
                    meta=ObservationMeta(source="东方财富 ETF 行情", fetched_at=now, as_of=as_of, status=ObservationStatus.AVAILABLE if valid else ObservationStatus.MISSING, timeliness="delayed" if valid else "unknown", reason=None if valid else "未取得可核实参考值"),
                )
            except Exception as exc:
                result[item.key] = EtfMetrics(meta=ObservationMeta(source="东方财富 ETF 行情", fetched_at=now, status=ObservationStatus.MISSING, reason="公开源暂不可用"))
        return result

    def benchmarks(self, now: datetime) -> list[dict]:
        return []

