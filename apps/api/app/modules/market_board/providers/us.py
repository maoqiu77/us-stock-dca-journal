from __future__ import annotations
from datetime import datetime
import json
from decimal import Decimal
from ..models import Instrument, Quote, ObservationMeta, ObservationStatus

class USProvider:
    def __init__(self, http): self.http = http
    def quotes(self, instruments: list[Instrument], now: datetime) -> list[Quote]:
        rows = []
        for item in instruments:
            if item.symbol.startswith("DEMO"):
                rows.append(Quote(instrument_key=item.key, meta=ObservationMeta(source="Yahoo Finance", fetched_at=now, status=ObservationStatus.MISSING, reason="模板标的无外部报价")))
                continue
            try:
                payload = json.loads(self.http.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{item.symbol}?range=5d&interval=1d", referer="https://finance.yahoo.com/").decode("utf-8"))
                meta = payload["chart"]["result"][0]["meta"]
                price = meta.get("regularMarketPrice")
                previous = meta.get("previousClose")
                observed = datetime.fromtimestamp(meta["regularMarketTime"], tz=now.tzinfo) if isinstance(meta.get("regularMarketTime"), (int, float)) else None
                valid = meta.get("symbol") == item.symbol and meta.get("currency") == "USD" and isinstance(price, (int, float)) and price > 0 and observed is not None and observed <= now.replace(tzinfo=now.tzinfo) + __import__("datetime").timedelta(seconds=60)
                rows.append(Quote(instrument_key=item.key, price=Decimal(str(price)) if valid else None, previous_close=Decimal(str(previous)) if valid and isinstance(previous, (int, float)) and previous > 0 else None, change=Decimal(str(price - previous)) if valid and isinstance(previous, (int, float)) else None, change_pct=Decimal(str((price - previous) / previous * 100)) if valid and isinstance(previous, (int, float)) and previous > 0 else None, volume=Decimal(str(meta["regularMarketVolume"])) if valid and isinstance(meta.get("regularMarketVolume"), int) and meta["regularMarketVolume"] >= 0 else None, trading_date=observed.date() if valid else None, session="unknown", meta=ObservationMeta(source="Yahoo Finance", fetched_at=now, as_of=observed, status=ObservationStatus.AVAILABLE if valid else ObservationStatus.MISSING, timeliness="delayed" if valid else "unknown", reason=None if valid else "供应商身份或时间校验失败")))
            except Exception:
                rows.append(Quote(instrument_key=item.key, meta=ObservationMeta(source="Yahoo Finance", fetched_at=now, status=ObservationStatus.MISSING, reason="公开源暂不可用")))
        return rows
