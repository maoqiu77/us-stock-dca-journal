import { barsV1Schema, canonicalInstrumentSchema, quoteV1Schema, type BarsV1, type CanonicalInstrument, type QuoteV1 } from '@portfolio/market-data';
import type { MarketBudgetPort, MarketCachePort, MarketLeasePort, MarketProvider } from './ports.ts';
import { MarketProviderError } from './twelve-data-provider.ts';

type Infrastructure = { cache: MarketCachePort; leases: MarketLeasePort; budget: MarketBudgetPort };
type Options = { scope: string; quoteTtlMs: number; staleRetentionMs: number; dailyUnits: number; minuteUnits: number; now(): string; wait?: (ms: number) => Promise<void> };
const plus = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();
const minute = (now: string) => now.slice(0, 16);
const cloneQuote = (quote: QuoteV1, now: string, state: 'fresh_hit' | 'stale_hit') => quoteV1Schema.parse({ ...quote, served_at: now, cache_state: state, freshness: state === 'stale_hit' ? 'stale' : quote.freshness });

export function createCachedMarketProvider(inner: MarketProvider, infrastructure: Infrastructure, options: Options): MarketProvider {
  const inflight = new Map<string, Promise<QuoteV1[]>>(), wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  async function reserve(units: number, now: string) {
    if (!await infrastructure.budget.reserve(`${options.scope}:minute:${minute(now)}`, units, options.minuteUnits, now)) return false;
    return await infrastructure.budget.reserve(`${options.scope}:day`, units, options.dailyUnits, now);
  }
  async function readQuotes(keys: string[], now: string) {
    const rows = await Promise.all(keys.map(key => infrastructure.cache.get(`quote:v1:${options.scope}:${key}`)));
    const fresh = new Map<string, QuoteV1>(), stale = new Map<string, QuoteV1>();
    for (let index = 0; index < keys.length; index++) {
      const row = rows[index]; if (!row) continue;
      const parsed = quoteV1Schema.safeParse(row.value); if (!parsed.success) continue;
      if (row.expiresAt > now) fresh.set(keys[index], cloneQuote(parsed.data, now, 'fresh_hit')); else stale.set(keys[index], cloneQuote(parsed.data, now, 'stale_hit'));
    }
    return { fresh, stale };
  }
  async function loadQuotes(keys: string[]) {
    const now = options.now(), cached = await readQuotes(keys, now), missing = keys.filter(key => !cached.fresh.has(key));
    if (!missing.length) return keys.map(key => cached.fresh.get(key)!);
    const leaseKey = `quote:v1:${options.scope}:${[...missing].sort().join(',')}`, holder = `${now}:${Math.random()}`;
    if (!await infrastructure.leases.acquire(leaseKey, holder, plus(now, 10_000))) {
      for (let attempt = 0; attempt < 20; attempt++) { await wait(10); const latest = await readQuotes(keys, options.now()); if (missing.every(key => latest.fresh.has(key))) return keys.flatMap(key => latest.fresh.get(key) ?? cached.stale.get(key) ?? []); }
      return keys.flatMap(key => cached.fresh.get(key) ?? cached.stale.get(key) ?? []);
    }
    try {
      if (!await reserve(missing.length, now)) { const fallback = keys.flatMap(key => cached.fresh.get(key) ?? cached.stale.get(key) ?? []); if (fallback.length) return fallback; throw new MarketProviderError('PROVIDER_RATE_LIMIT', 'Market data budget exhausted.'); }
      try {
        const received = await inner.quotes(missing), map = new Map(received.map(item => [item.instrument_key, quoteV1Schema.parse(item)]));
        await Promise.all([...map].map(([key, value]) => infrastructure.cache.put(`quote:v1:${options.scope}:${key}`, value, plus(now, options.quoteTtlMs), plus(now, options.staleRetentionMs))));
        return keys.flatMap(key => cached.fresh.get(key) ?? map.get(key) ?? cached.stale.get(key) ?? []);
      } catch (error) { const fallback = keys.flatMap(key => cached.fresh.get(key) ?? cached.stale.get(key) ?? []); if (fallback.length) return fallback; throw error; }
    } finally { await infrastructure.leases.release(leaseKey, holder); }
  }
  return {
    async search(query, limit): Promise<CanonicalInstrument[]> {
      const now = options.now(), key = `search:v1:${options.scope}:${query.toUpperCase()}:${limit}`, cached = await infrastructure.cache.get(key);
      if (cached?.expiresAt && cached.expiresAt > now) { const parsed = canonicalInstrumentSchema.array().safeParse(cached.value); if (parsed.success) return parsed.data; }
      if (!await reserve(1, now)) throw new MarketProviderError('PROVIDER_RATE_LIMIT', 'Market data budget exhausted.');
      const result = await inner.search(query, limit); await infrastructure.cache.put(key, result, plus(now, 3_600_000), plus(now, 3_600_000)); return result;
    },
    quotes(keys) {
      const identity = [...keys].sort().join(','); const existing = inflight.get(identity); if (existing) return existing;
      const promise = loadQuotes(keys).finally(() => inflight.delete(identity)); inflight.set(identity, promise); return promise;
    },
    async bars(key, range, interval): Promise<BarsV1> {
      const now = options.now(), cacheKey = `bars:v1:${options.scope}:${key}:${range}:${interval}:unadjusted`, cached = await infrastructure.cache.get(cacheKey);
      if (cached) { const parsed = barsV1Schema.safeParse(cached.value); if (parsed.success && cached.expiresAt > now) return barsV1Schema.parse({ ...parsed.data, served_at: now }); }
      if (!await reserve(1, now)) throw new MarketProviderError('PROVIDER_RATE_LIMIT', 'Market data budget exhausted.');
      try { const value = await inner.bars(key, range, interval); await infrastructure.cache.put(cacheKey, value, plus(now, 86_400_000), plus(now, options.staleRetentionMs)); return value; }
      catch (error) { if (cached) { const parsed = barsV1Schema.safeParse(cached.value); if (parsed.success) return barsV1Schema.parse({ ...parsed.data, served_at: now, reason: null }); } throw error; }
    },
  };
}
