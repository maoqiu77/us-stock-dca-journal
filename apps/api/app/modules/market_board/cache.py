from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock
from collections import defaultdict
from contextlib import nullcontext
from .models import ObservationStatus


TTL_SECONDS = {
    "quote": 30,
    "bars": 60,
    "catalog": 24 * 60 * 60,
    "nav": 15 * 60,
    "purchase_limit": 15 * 60,
    "holdings": 6 * 60 * 60,
    "shares": 6 * 60 * 60,
    "trading_dates": 6 * 60 * 60,
    "metrics": 30,
    "allocation": 6 * 60 * 60,
}
RETAIN_SECONDS = {
    "quote": 7 * 24 * 60 * 60,
    "bars": 7 * 24 * 60 * 60,
    "nav": 7 * 24 * 60 * 60,
    "purchase_limit": 7 * 24 * 60 * 60,
    "holdings": 30 * 24 * 60 * 60,
    "shares": 30 * 24 * 60 * 60,
    "trading_dates": 30 * 24 * 60 * 60,
    "metrics": 7 * 24 * 60 * 60,
    "allocation": 30 * 24 * 60 * 60,
}


def cache_window(kind: str, now: datetime | None = None) -> tuple[str, str]:
    current = now or datetime.now(timezone.utc)
    return (current + timedelta(seconds=TTL_SECONDS[kind])).isoformat(), (current + timedelta(seconds=RETAIN_SECONDS.get(kind, TTL_SECONDS[kind]))).isoformat()


def cache_key(provider: str, identity: str, data_kind: str, period: str = "", range_: str = "", adjustment: str = "raw", schema_version: int = 1) -> str:
    return ":".join((provider, identity, data_kind, period, range_, adjustment, str(schema_version)))


class FieldCache:
    """Field-scoped real observations only; failures never replace retained facts."""
    def __init__(self, store, now):
        self.store, self.now = store, now
        self.locks = defaultdict(Lock)
        self.attempted = {}

    def get(self, provider, identity, kind, model, loader, *, refresh=False, period='', range_='', adjustment='raw', cached_only=False):
        key = cache_key(provider, identity, kind, period, range_, adjustment)
        with (nullcontext() if cached_only else self.locks[key]):
            now = self.now()
            raw = self.store.read_cache(key)
            cached = None
            if raw and datetime.fromisoformat(raw['retain_until']) > now:
                try:
                    cached = model.model_validate({k:v for k,v in raw.items() if k not in ('expires_at','retain_until')})
                    if cached.meta.status in (ObservationStatus.SAMPLE, ObservationStatus.MISSING):
                        cached = None
                except ValueError:
                    pass
            fresh = cached is not None and datetime.fromisoformat(raw['expires_at']) > now
            cooling = now.timestamp() - self.attempted.get(key, float('-inf')) < 10
            force = refresh and kind in ('quote','bars','metrics')
            if fresh and (not force or cooling or cached_only):
                cached.meta.cache_state = 'fresh_hit'
                return cached
            if not cooling and not cached_only:
                self.attempted[key] = now.timestamp()
                try:
                    value = loader()
                    if value is not None and value.meta.status in (ObservationStatus.AVAILABLE, ObservationStatus.PARTIAL, ObservationStatus.STALE):
                        # An unknown supplemental field is not a replacement for real evidence.
                        usable = not (kind == 'purchase_limit' and value.state == 'unknown')
                        if usable:
                            expires, retain = cache_window(kind, now)
                            self.store.write_cache(key, value.model_dump(mode='json'), expires, retain)
                            return value
                except Exception:
                    pass
            if cached is not None:
                cached.meta.status = ObservationStatus.STALE
                cached.meta.cache_state = 'stale_hit'
                cached.meta.reason = '上游不可用或刷新冷却；保留原观察时间'
            return cached
