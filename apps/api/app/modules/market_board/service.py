from __future__ import annotations

from datetime import datetime, timezone, timedelta
import json
from pathlib import Path

from .catalog import InstrumentCatalog
from .models import BoardResponse, Capabilities, DetailResponse, Segment, Series, ObservationStatus
from .sample import holdings_for, row_for, series_for
from .store import BoardStore
from .providers.bars import BarsProvider
from .providers.us import USProvider
from .providers.cn import CNProvider
from .providers.funds import FundProvider
from .providers.etf import EtfProvider
from .http import PublicHttp
from .cache import cache_window


class BoardService:
    def __init__(self, store: BoardStore, catalog: InstrumentCatalog, now=None, http=None):
        self.store, self.catalog = store, catalog
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.http = http or PublicHttp()
        self.bars = BarsProvider(self.http)
        self.us_provider = USProvider(self.http)
        self.cn_provider = CNProvider(self.http)
        self.fund_provider = FundProvider(self.http)
        self.etf_provider = EtfProvider(self.http)

    def board(self, segment: Segment, refresh: bool = False) -> BoardResponse:
        selection = self.store.get_selection(segment)
        now = self.now()
        rows = [row_for(item) for item in selection.items]
        pending = []
        for index, row in enumerate(rows):
            cached = self.store.read_cache(f"board:v1:{row.instrument.key}:row") if not refresh else None
            if cached and cached.get("expires_at"):
                try:
                    if datetime.fromisoformat(cached["expires_at"]) >= now:
                        cached_row = {key: value for key, value in cached.items() if key not in {"expires_at", "retain_until", "cooldown_until"}}
                        rows[index] = type(row).model_validate(cached_row)
                        continue
                except (ValueError, TypeError):
                    pass
            pending.append(index)
        warnings = []
        if segment is Segment.US:
            live = self.us_provider.quotes([selection.items[index] for index in pending], now)
            for index, quote in zip(pending, live):
                rows[index].quote = quote if quote.price is not None else rows[index].quote
                rows[index].quality = quote.meta.status if quote.price is not None else rows[index].quality
                if quote.price is not None:
                    self._write_row_cache(rows[index], now, refresh)
        elif segment is Segment.ETF:
            pending_items = [selection.items[index] for index in pending]
            live = self.cn_provider.quotes(pending_items, now)
            metrics = self.etf_provider.metrics(pending_items, now)
            for index, quote in zip(pending, live):
                rows[index].quote = quote if quote.price is not None else rows[index].quote
                rows[index].metrics = metrics.get(selection.items[index].key, rows[index].metrics)
                rows[index].quality = quote.meta.status if quote.price is not None else rows[index].quality
                if quote.price is not None:
                    self._write_row_cache(rows[index], now, refresh)
        else:
            for index in pending:
                item = selection.items[index]
                nav = self.fund_provider.nav(item, now)
                limit = self.fund_provider.purchase_limit(item, now)
                rows[index].nav = nav if nav.value is not None else rows[index].nav
                rows[index].purchase_limit = limit
                if nav.value is not None:
                    rows[index].quality = nav.meta.status
                    self._write_row_cache(rows[index], now, refresh)
        for index in pending:
            if rows[index].quality is not ObservationStatus.SAMPLE:
                continue
            cached = self.store.read_cache(f"board:v1:{rows[index].instrument.key}:row")
            if not cached or not cached.get("retain_until"):
                continue
            try:
                if datetime.fromisoformat(cached["retain_until"]) >= now:
                    stale = {key: value for key, value in cached.items() if key not in {"expires_at", "retain_until", "cooldown_until"}}
                    rows[index] = type(rows[index]).model_validate(stale)
                    rows[index].quality = ObservationStatus.STALE
                    for field in ("quote", "nav", "purchase_limit", "metrics"):
                        value = getattr(rows[index], field)
                        if value is not None and hasattr(value, "meta"):
                            value.meta.status = ObservationStatus.STALE
            except (ValueError, TypeError):
                continue
        if any(row.quality is ObservationStatus.SAMPLE for row in rows):
            warnings.append("部分数据为确定性示例，非真实行情")
        return BoardResponse(segment=segment, rows=rows, revision=selection.revision, fetched_at=now, warnings=warnings)

    def _write_row_cache(self, row, now: datetime, refresh: bool) -> None:
        key = f"board:v1:{row.instrument.key}:row"
        cached = self.store.read_cache(key)
        if refresh and cached and cached.get("cooldown_until") and cached["cooldown_until"] > now.isoformat():
            return
        expires_at, retain_until = cache_window("quote", now)
        payload = row.model_dump(mode="json")
        payload["cooldown_until"] = (now + timedelta(seconds=10)).isoformat()
        self.store.write_cache(key, payload, expires_at, retain_until)

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
