from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Optional

from .models import AssetType, Instrument, Market, Segment
from .store import BoardStore


def default_instruments() -> dict[Segment, list[Instrument]]:
    now = datetime.now(timezone.utc)
    us_symbols = [("AAPL", "Apple Inc.", "XNAS", "STOCK"), ("MSFT", "Microsoft", "XNAS", "STOCK"), ("NVDA", "NVIDIA", "XNAS", "STOCK"), ("AMZN", "Amazon", "XNAS", "STOCK"), ("GOOGL", "Alphabet", "XNAS", "STOCK"), ("TSLA", "Tesla", "XNAS", "STOCK"), ("SPY", "SPDR S&P 500 ETF", "ARCX", "ETF"), ("QQQ", "Invesco QQQ", "XNAS", "ETF"), ("DIA", "SPDR Dow Jones ETF", "ARCX", "ETF"), ("IWM", "iShares Russell 2000", "ARCX", "ETF")]
    us_symbols += [(f"DEMO{i:02d}", f"Demo US {i:02d}", "XNAS", "STOCK") for i in range(1, 22)]
    us = [_instrument(Market.US, symbol, name, exchange, AssetType(asset), "USD", "America/New_York", now) for symbol, name, exchange, asset in us_symbols]
    etf = [_instrument(Market.CN, "513100", "纳指ETF国泰", "XSHG", AssetType.ETF, "CNY", "Asia/Shanghai", now), _instrument(Market.CN, "159501", "纳指100ETF", "XSHE", AssetType.ETF, "CNY", "Asia/Shanghai", now), _instrument(Market.CN, "510300", "沪深300ETF", "XSHG", AssetType.ETF, "CNY", "Asia/Shanghai", now)]
    fund = [_instrument(Market.CN, "016701", "华夏纳斯达克100ETF联接人民币", "FUND", AssetType.FUND, "CNY", "Asia/Shanghai", now), _instrument(Market.CN, "000001", "华夏成长混合", "FUND", AssetType.FUND, "CNY", "Asia/Shanghai", now)]
    return {Segment.US: us, Segment.ETF: etf, Segment.FUND: fund}


def _instrument(market: Market, symbol: str, name: str, exchange: str, asset_type: AssetType, currency: str, timezone_name: str, verified_at: datetime) -> Instrument:
    return Instrument(key=f"{market.value}:{exchange}:{symbol}:{asset_type.value}", symbol=symbol, name=name, market=market, exchange=exchange, asset_type=asset_type, currency=currency, timezone=timezone_name, provider_symbols={}, verified_at=verified_at)


class InstrumentCatalog:
    def __init__(self, store: BoardStore, http: Optional[object] = None):
        self.store = store
        self.http = http
        self.defaults = default_instruments()
        self.store.save_instruments([item for items in self.defaults.values() for item in items])
        self.store.ensure_initialized(self.defaults)

    def resolve(self, key: str) -> Instrument | None:
        return self.store.get_instrument(key)

    def search(self, query: str, market: str, asset_type: str | None = None, limit: int = 20) -> list[Instrument]:
        needle = query.strip().lower()
        rows = [item for items in self.defaults.values() for item in items]
        rows += []
        return [item for item in rows if item and item.market.value == market.upper() and (not asset_type or item.asset_type.value == asset_type.upper()) and (needle in item.symbol.lower() or needle in item.name.lower())][:limit]
