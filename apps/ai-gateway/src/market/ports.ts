import type { BarsV1, CanonicalInstrument, QuoteV1 } from '@portfolio/market-data';

export interface MarketProvider {
  search(query: string, limit: number): Promise<CanonicalInstrument[]>;
  quotes(instrumentKeys: string[]): Promise<QuoteV1[]>;
  bars(instrumentKey: string, range: '1M' | '3M' | '1Y', interval: '1day'): Promise<BarsV1>;
}
export type MarketCacheRecord = { value: unknown; expiresAt: string; staleExpiresAt: string };
export interface MarketCachePort { get(key: string): Promise<MarketCacheRecord | undefined>; put(key: string, value: unknown, expiresAt: string, staleExpiresAt: string): Promise<void> }
export interface MarketLeasePort { acquire(key: string, holder: string, expiresAt: string): Promise<boolean>; release(key: string, holder: string): Promise<void> }
export interface MarketBudgetPort { reserve(scope: string, units: number, limit: number, now: string): Promise<boolean> }

export function createMemoryMarketInfrastructure(now: () => string = () => new Date().toISOString()) {
  const cache = new Map<string, MarketCacheRecord>(), leases = new Map<string, { holder: string; expiresAt: string }>(), budgets = new Map<string, number>();
  const cachePort: MarketCachePort = { async get(key) { const row = cache.get(key); if (!row || row.staleExpiresAt <= now()) return undefined; return row; }, async put(key, value, expiresAt, staleExpiresAt) { cache.set(key, { value, expiresAt, staleExpiresAt }); } };
  const leasePort: MarketLeasePort = { async acquire(key, holder, expiresAt) { const row = leases.get(key); if (row && row.expiresAt > now()) return false; leases.set(key, { holder, expiresAt }); return true; }, async release(key, holder) { if (leases.get(key)?.holder === holder) leases.delete(key); } };
  const budgetPort: MarketBudgetPort = { async reserve(scope, units, limit, now) { const key = `${scope}:${now.slice(0, 10)}`, next = (budgets.get(key) ?? 0) + units; if (next > limit) return false; budgets.set(key, next); return true; } };
  return { cache: cachePort, leases: leasePort, budget: budgetPort };
}
