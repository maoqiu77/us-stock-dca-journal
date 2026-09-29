from __future__ import annotations
from datetime import datetime
import json
from decimal import Decimal
from ..models import Instrument, Quote, ObservationMeta, ObservationStatus

class CNProvider:
    def __init__(self, http): self.http = http
    def quotes(self, instruments: list[Instrument], now: datetime) -> list[Quote]:
        if not instruments:
            return []
        secids = ",".join(f"{1 if item.exchange == 'XSHG' else 0}.{item.symbol}" for item in instruments)
        try:
            payload = json.loads(self.http.get(f"https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids={secids}&fltt=2&fields=f12,f13,f14,f2,f3,f4,f124", referer="https://quote.eastmoney.com/").decode("utf-8"))
            values = payload.get("data", {}).get("diff", [])
        except Exception:
            values = []
        result = []
        for item in instruments:
            row = next((value for value in values if value.get("f12") == item.symbol and value.get("f13") == (1 if item.exchange == "XSHG" else 0) and value.get("f14") == item.name), None)
            observed = datetime.fromtimestamp(row["f124"], tz=now.tzinfo) if row and isinstance(row.get("f124"), (int, float)) else None
            valid = row is not None and observed is not None and observed <= now.replace(tzinfo=now.tzinfo) + __import__("datetime").timedelta(seconds=60) and isinstance(row.get("f2"), (int, float)) and row["f2"] > 0
            result.append(Quote(instrument_key=item.key, price=Decimal(str(row["f2"])) if valid else None, change=Decimal(str(row["f4"])) if valid and isinstance(row.get("f4"), (int, float)) else None, change_pct=Decimal(str(row["f3"])) if valid and isinstance(row.get("f3"), (int, float)) else None, trading_date=observed.date() if valid else None, session="unknown", meta=ObservationMeta(source="东方财富公开行情", fetched_at=now, as_of=observed, status=ObservationStatus.AVAILABLE if valid else ObservationStatus.MISSING, timeliness="delayed" if valid else "unknown", reason=None if valid else "未取得可核实报价")))
        return result
