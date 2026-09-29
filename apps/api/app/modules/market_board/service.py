from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .catalog import InstrumentCatalog
from .models import BoardResponse, Capabilities, DetailResponse, Segment, Series
from .sample import holdings_for, row_for, series_for
from .store import BoardStore
from .providers.bars import BarsProvider


class BoardService:
    def __init__(self, store: BoardStore, catalog: InstrumentCatalog, now=None):
        self.store, self.catalog = store, catalog
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.bars = BarsProvider(None)

    def board(self, segment: Segment, refresh: bool = False) -> BoardResponse:
        selection = self.store.get_selection(segment)
        return BoardResponse(segment=segment, rows=[row_for(item) for item in selection.items], revision=selection.revision, fetched_at=self.now(), warnings=["当前显示确定性示例数据，非真实行情"])

    def detail(self, key: str, refresh: bool = False) -> DetailResponse:
        item = self.catalog.resolve(key)
        if item is None:
            raise KeyError(key)
        return DetailResponse(row=row_for(item), holdings=holdings_for(item) if item.asset_type.value == "FUND" else None)

    def capabilities(self, key: str) -> Capabilities:
        item = self.catalog.resolve(key)
        if item is None:
            raise KeyError(key)
        return Capabilities(instrument_key=key, quote=True, nav=item.asset_type.value == "FUND", periods=["1d"] if item.market.value == "US" else [], ranges=["1mo", "3mo", "1y"] if item.market.value == "US" else [])

    def series(self, key: str, period: str, range_: str, refresh: bool = False):
        item = self.catalog.resolve(key)
        if item is None:
            raise KeyError(key)
        if item.market.value == "US" and period == "1d" and range_ in {"1mo", "3mo", "1y"}:
            return series_for(item, period, range_)
        return self.bars.series(item, period, range_, self.now())
