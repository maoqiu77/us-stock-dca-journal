import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteV1Schema } from '@portfolio/market-data';
import { createCachedMarketProvider } from '../src/market/cached-provider.ts';
import { createMemoryMarketInfrastructure } from '../src/market/ports.ts';

const now = '2026-09-14T14:31:05.000Z';
const quote = quoteV1Schema.parse({ schema_version: 1, instrument_key: 'US:XNAS:AAPL', symbol: 'AAPL', currency: 'USD', price: '250', price_kind: 'last_trade', previous_close: '248', previous_close_date: '2026-09-11', change: '2', change_percent: '0.8064516129', volume: '10', volume_scope: 'feed_only', session: 'regular', market_status: 'open', trading_date: '2026-09-14', exchange_timezone: 'America/New_York', provider: 'Twelve Data', feed: 'test-feed', coverage: 'venue_subset', timeliness: 'delayed', delay_seconds: 900, as_of: '2026-09-14T14:31:00.000Z', received_at: now, served_at: now, freshness: 'current', cache_state: 'miss', status: 'available', reason: null, adjustment: 'unadjusted', attribution: 'Twelve Data' });

test('concurrent equal quote requests share one upstream call and later cache hits preserve received_at', async () => {
  let calls = 0;
  const inner = { async search() { return []; }, async quotes() { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return [quote]; }, async bars() { throw Error('unused'); } };
  const infra = createMemoryMarketInfrastructure(() => now);
  const cached = createCachedMarketProvider(inner, infra, { scope: 'licensed-feed', quoteTtlMs: 60_000, staleRetentionMs: 86_400_000, dailyUnits: 10, minuteUnits: 10, now: () => now });
  const [a, b] = await Promise.all([cached.quotes(['US:XNAS:AAPL']), cached.quotes(['US:XNAS:AAPL'])]);
  const hit = await cached.quotes(['US:XNAS:AAPL']);
  assert.equal(calls, 1);
  assert.equal(a[0].received_at, now); assert.equal(b[0].received_at, now);
  assert.equal(hit[0].cache_state, 'fresh_hit'); assert.equal(hit[0].received_at, now);
});

test('expired last-good quote is served stale when upstream fails and budget is shared across instances', async () => {
  let clock = '2026-09-14T14:31:05.000Z', fail = false, calls = 0;
  const infra = createMemoryMarketInfrastructure(() => clock);
  const inner = { async search() { return []; }, async quotes() { calls++; if (fail) throw Error('offline'); return [{ ...quote, received_at: clock, served_at: clock }]; }, async bars() { throw Error('unused'); } };
  const options = { scope: 'licensed-feed', quoteTtlMs: 1_000, staleRetentionMs: 86_400_000, dailyUnits: 2, minuteUnits: 2, now: () => clock };
  const first = createCachedMarketProvider(inner, infra, options), second = createCachedMarketProvider(inner, infra, options);
  await first.quotes(['US:XNAS:AAPL']);
  clock = '2026-09-14T14:32:10.000Z'; fail = true;
  const stale = await second.quotes(['US:XNAS:AAPL']);
  assert.equal(stale[0].cache_state, 'stale_hit'); assert.equal(stale[0].freshness, 'stale'); assert.equal(stale[0].received_at, now);
  fail = false;
  await assert.rejects(() => second.quotes(['US:XNAS:QQQ']), /budget exhausted/i);
  assert.equal(calls, 2);
});
