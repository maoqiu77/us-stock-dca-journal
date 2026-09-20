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
  assert.deepEqual(discovery.view().watchlist.map(item => item.asset_type), ['STOCK', 'ETF']);
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

test('legacy watchlist is claimed by one workspace, scoped backup round trips and failed write preserves list', () => {
 const saved = storage(); let scope = 'one';
 const legacy = JSON.stringify({ version: 1, instruments: [instrument('QQQ', 'ETF')], updated_at: '' });
 saved.values.set(WATCHLIST_STORAGE_KEY, legacy);
 let fail = false;
 const port = { ...saved.port, set(key: string, value: string) { if (fail) throw Error('disk full'); saved.port.set(key, value); } };
 const discovery = createMarketDiscovery(port, undefined, { now: () => '2026-09-20T00:00:00Z', workspaceId: () => scope });
 assert.equal(discovery.view().watchlist.length, 1);
 fail = true; assert.throws(() => discovery.add(instrument('AAPL')), /disk full/); assert.equal(discovery.view().watchlist.length, 1); fail = false;
 scope = 'two'; assert.equal(discovery.view().watchlist.length, 0);
 discovery.add(instrument('AAPL')); const backup = discovery.exportWatchlist(); discovery.replaceWatchlist([]); discovery.replaceWatchlist(backup); assert.equal(discovery.view().watchlist[0].symbol, 'AAPL');
 scope = 'one'; assert.equal(discovery.view().watchlist[0].symbol, 'QQQ');
 assert.equal(saved.values.get(WATCHLIST_STORAGE_KEY), legacy);
});

test('same symbol on different exchanges remains distinct; unavailable board data is never zero', async () => {
 const saved = storage(), discovery = createMarketDiscovery(saved.port, undefined, { now: () => '2026-09-20T00:00:00Z' });
 discovery.add(instrument('TEST')); discovery.add({ ...instrument('TEST'), instrument_key: 'US:XNYS:TEST', mic: 'XNYS' });
 assert.equal(discovery.view().watchlist.length, 2);
 await discovery.refreshQuotes(); assert.equal(discovery.quoteView(instrument('TEST')).priceText, '--'); assert.equal(discovery.quoteView(instrument('TEST')).changeText, '--');
 assert.match(discovery.view().error, /暂不可用/);
});

const quote = (symbol: string, price: string, servedAt = '2026-09-14T14:31:05.000Z') => ({ schema_version: 1 as const, instrument_key: `US:XNAS:${symbol}`, symbol, currency: 'USD' as const, price, price_kind: 'last_trade' as const, previous_close: '100', previous_close_date: '2026-09-11', change: '1', change_percent: '1', volume: '10', volume_scope: 'feed_only' as const, session: 'regular' as const, market_status: 'open' as const, trading_date: '2026-09-14', exchange_timezone: 'America/New_York' as const, provider: 'Twelve Data', feed: 'licensed-feed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, as_of: '2026-09-14T14:31:00.000Z', received_at: '2026-09-14T14:31:05.000Z', served_at: servedAt, freshness: 'current' as const, cache_state: 'miss' as const, status: 'available' as const, reason: null, adjustment: 'unadjusted' as const, attribution: 'Twelve Data' });
test('board preserves actual zero change, dates and persistent stale fallback with refresh coalescing', async () => {
 const saved = storage(); let now = '2026-09-14T14:31:06.000Z', calls = 0, offline = false;
 const transport = { capabilities: async () => caps, search: async () => [], quotes: async () => { calls++; if (offline) throw Error('offline'); return [{ ...quote('QQQ', '101'), change_percent: '0' }]; } };
 const discovery = createMarketDiscovery(saved.port, transport, { now: () => now }); discovery.add(instrument('QQQ'));
 await Promise.all([discovery.refreshQuotes(), discovery.refreshQuotes()]); assert.equal(calls, 1);
 const current = discovery.quoteView(instrument('QQQ')); assert.equal(current.changeText, '0.00%'); assert.equal(current.asOf, quote('QQQ', '101').as_of);
 offline = true; now = '2026-09-14T14:33:06.000Z'; await discovery.refreshQuotes(); assert.equal(discovery.quoteView(instrument('QQQ')).qualityLabel, '缓存已过期');
 const restarted = createMarketDiscovery(saved.port, undefined, { now: () => now }); assert.equal(restarted.quoteView(instrument('QQQ')).priceText, '101'); assert.equal(restarted.quoteView(instrument('QQQ')).qualityLabel, '缓存已过期');
});

test('popular defaults seed once per workspace; deletion and order survive reload and backup', () => {
 const saved = storage(); let scope = 'new'; const defaults = [instrument('NVDA'), instrument('AMD'), instrument('AAPL')];
 const options = { now: () => '2026-09-20T00:00:00Z', workspaceId: () => scope, defaults };
 const first = createMarketDiscovery(saved.port, undefined, options);
 assert.deepEqual(first.view().watchlist.map(x => x.symbol), ['NVDA', 'AMD', 'AAPL']);
 first.move('US:XNAS:AAPL', -2); first.remove('US:XNAS:AMD');
 const reloaded = createMarketDiscovery(saved.port, undefined, options);
 assert.deepEqual(reloaded.view().watchlist.map(x => x.symbol), ['AAPL', 'NVDA']);
 const backup = reloaded.exportWatchlist(); reloaded.replaceWatchlist([]);
 assert.deepEqual(createMarketDiscovery(saved.port, undefined, options).view().watchlist, []);
 reloaded.replaceWatchlist(backup); assert.deepEqual(reloaded.exportWatchlist(), backup);
 scope = 'other'; assert.equal(reloaded.view().watchlist.length, 3);
 scope = 'new'; assert.equal(reloaded.view().watchlist.length, 2);
});
test('curated identities can be searched and readded without a remote search token', async () => {
 const saved = storage(); const d = createMarketDiscovery(saved.port, undefined, { now: () => '2026-09-20T00:00:00Z', defaults: [instrument('NVDA')] });
 d.remove('US:XNAS:NVDA'); const found = await d.search('NVDA'); assert.equal(found.length, 1); d.add(found[0]); assert.equal(d.view().watchlist.length, 1);
});
