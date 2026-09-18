import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketDiscovery, WATCHLIST_STORAGE_KEY } from '../src/market/discovery.ts';

const caps = { schema_version: 1 as const, enabled: true, provider_configured: true, authorized: true, access_mode: 'public' as const, quote_access: true, bars_access: true, search_access: true, ai_source_access: true, archive_access: true, provider: 'Twelve Data', feed: 'licensed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, attribution: 'Twelve Data', limits: { quote_batch: 30, search_results: 10, bars: 400 } };
const instrument = (symbol: string, asset_type: 'STOCK' | 'ETF' = 'STOCK') => ({ schema_version: 1 as const, instrument_key: `US:XNAS:${symbol}`, symbol, name: symbol, mic: 'XNAS', exchange: 'NASDAQ', market: 'US' as const, currency: 'USD' as const, asset_type, provider_symbol: symbol, provider_catalog_version: 'v1', status: 'active' as const });
const bars = (key: string, range: '1M' | '3M' | '1Y') => ({ schema_version: 1 as const, instrument_key: key, currency: 'USD' as const, interval: '1day' as const, range, adjustment: 'unadjusted' as const, provider: 'Twelve Data', feed: 'licensed', coverage: 'venue_subset' as const, timezone: 'America/New_York' as const, as_of: '2026-09-12T20:00:00.000Z', received_at: '2026-09-12T20:01:00.000Z', served_at: '2026-09-12T20:01:00.000Z', status: 'available' as const, reason: null, bars: [{ trading_date: '2026-09-10', starts_at: '2026-09-10T13:30:00.000Z', open: '100', high: '105', low: '99', close: '104', volume: '1', is_final: true }, { trading_date: '2026-09-12', starts_at: '2026-09-12T13:30:00.000Z', open: '104', high: '106', low: '102', close: '103', volume: '1', is_final: true }] });
function storage() { const values = new Map<string, string>(); return { values, port: { get: (key: string) => values.get(key) ?? '', set: (key: string, value: string) => values.set(key, value) } }; }

test('search requires two characters, caches results and drops a late response', async () => {
  const saved = storage(); let release!: () => void, calls = 0;
  const discovery = createMarketDiscovery(saved.port, { capabilities: async () => caps, search: async query => { calls++; if (query === 'AA') await new Promise<void>(resolve => { release = resolve; }); return [instrument(query)]; }, quotes: async () => [], bars: async (key, range) => bars(key, range) }, { now: () => '2026-09-13T10:00:00.000Z' });
  assert.deepEqual(await discovery.search('A'), []);
  const old = discovery.search('AA'); while (!release) await Promise.resolve();
  assert.deepEqual((await discovery.search('QQ')).map(item => item.symbol), ['QQ']); release(); await old;
  assert.deepEqual(discovery.view().results.map(item => item.symbol), ['QQ']);
  await discovery.search('QQ'); assert.equal(calls, 2);
});

test('watchlist is versioned, distinguishes ETFs, and removal cannot mutate a ledger', () => {
  const saved = storage(), discovery = createMarketDiscovery(saved.port, undefined, { now: () => '2026-09-13T10:00:00.000Z' });
  discovery.add(instrument('QQQ', 'ETF')); discovery.add(instrument('AAPL'));
  assert.deepEqual(discovery.view().watchlist.map(item => item.asset_type), ['ETF', 'STOCK']);
  discovery.remove('US:XNAS:QQQ');
  assert.equal(JSON.parse(saved.values.get(WATCHLIST_STORAGE_KEY)!).version, 1);
  assert.deepEqual(discovery.view().watchlist.map(item => item.symbol), ['AAPL']);
});

test('daily bars preserve trading gaps and expose line plus candle geometry without inventing empty data', async () => {
  const saved = storage(), discovery = createMarketDiscovery(saved.port, { capabilities: async () => caps, search: async () => [], quotes: async () => [], bars: async (key, range) => bars(key, range) }, { now: () => '2026-09-13T10:00:00.000Z' });
  const chart = await discovery.loadBars(instrument('AAPL'), '1M');
  assert.deepEqual(chart.bars.map(item => item.trading_date), ['2026-09-10', '2026-09-12']);
  assert.equal(chart.line.length, 2); assert.equal(chart.candles.length, 2); assert.equal(chart.adjustment, 'unadjusted');
  const unavailable = createMarketDiscovery(saved.port, undefined, { now: () => '2026-09-13T10:00:00.000Z' });
  assert.equal((await unavailable.loadBars(instrument('AAPL'), '1M')).status, 'unavailable');
});
