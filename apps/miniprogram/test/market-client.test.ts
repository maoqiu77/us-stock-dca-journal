import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketClient, MARKET_STORAGE_KEY } from '../src/market/client.ts';
import type { MarketTransport } from '../src/market/transport.ts';

const capabilities = { schema_version: 1 as const, enabled: true, provider_configured: true, authorized: true, access_mode: 'public' as const, quote_access: true, bars_access: false, search_access: true, ai_source_access: false, archive_access: false, provider: 'Twelve Data', feed: 'licensed-feed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, attribution: 'Twelve Data', limits: { quote_batch: 30, search_results: 10, bars: 400 } };
const instrument = (symbol: string, type: 'STOCK' | 'ETF' = 'STOCK') => ({ schema_version: 1 as const, instrument_key: `US:XNAS:${symbol}`, symbol, name: symbol, mic: 'XNAS', exchange: 'NASDAQ', market: 'US' as const, currency: 'USD' as const, asset_type: type, provider_symbol: symbol, provider_catalog_version: 'v1', status: 'active' as const });
const quote = (symbol: string, price: string, servedAt = '2026-09-14T14:31:05.000Z') => ({ schema_version: 1 as const, instrument_key: `US:XNAS:${symbol}`, symbol, currency: 'USD' as const, price, price_kind: 'last_trade' as const, previous_close: '100', previous_close_date: '2026-09-11', change: '1', change_percent: '1', volume: '10', volume_scope: 'feed_only' as const, session: 'regular' as const, market_status: 'open' as const, trading_date: '2026-09-14', exchange_timezone: 'America/New_York' as const, provider: 'Twelve Data', feed: 'licensed-feed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, as_of: '2026-09-14T14:31:00.000Z', received_at: '2026-09-14T14:31:05.000Z', served_at: servedAt, freshness: 'current' as const, cache_state: 'miss' as const, status: 'available' as const, reason: null, adjustment: 'unadjusted' as const, attribution: 'Twelve Data' });
const ledger = (symbol: string, type: 'STOCK' | 'ETF' = 'STOCK') => ({ id: `ledger-${symbol}`, symbol, asset_type: type, exchange: 'UNSPECIFIED' });
function storage() { const values = new Map<string, string>(); return { values, port: { get: (key: string) => values.get(key) ?? '', set: (key: string, value: string) => { values.set(key, value); } } }; }

test('market client resolves ledger identity, persists only separate clearable cache and exposes valuation observations', async () => {
  const saved = storage(); let quoteCalls = 0;
  const transport: MarketTransport = { capabilities: async () => capabilities, search: async query => [instrument(query, query === 'QQQ' ? 'ETF' : 'STOCK')], quotes: async keys => { quoteCalls++; return keys.map(key => quote(key.split(':')[2], '101')); } };
  const client = createMarketClient(saved.port, transport, { now: () => '2026-09-14T14:31:06.000Z' });
  await client.refresh([ledger('AAPL'), ledger('QQQ', 'ETF')]);
  const view = client.snapshot([ledger('AAPL'), ledger('QQQ', 'ETF')]);
  assert.equal(view.status, 'ready'); assert.equal(view.covered, 2); assert.equal(quoteCalls, 1);
  assert.deepEqual(view.observations.map(item => [item.instrument_id, item.price]), [['ledger-AAPL', '101'], ['ledger-QQQ', '101']]);
  assert.ok(saved.values.get(MARKET_STORAGE_KEY));
  assert.equal([...saved.values.keys()].some(key => key === 'portfolio.wechat.v1'), false);
  client.clear(); assert.equal(saved.values.get(MARKET_STORAGE_KEY), '');
});

test('known US ETF still resolves and requests a quote when catalog search is unavailable', async () => {
  const saved = storage(); let requested: string[] = [];
  const transport: MarketTransport = {
    capabilities: async () => capabilities,
    search: async () => [],
    quotes: async keys => { requested = keys; return keys.map(key => quote(key.split(':')[2], '295.10')); },
  };
  const client = createMarketClient(saved.port, transport, { now: () => '2026-09-14T14:31:06.000Z' });
  await client.refresh([ledger('QQQM', 'ETF')]);
  const view = client.snapshot([ledger('QQQM', 'ETF')]);
  assert.deepEqual(requested, ['US:XNAS:QQQM']);
  assert.equal(view.instruments[0].mapping, 'verified');
  assert.equal(view.instruments[0].quote?.price, '295.10');
});

test('late response from an old instrument selection cannot overwrite newer quotes', async () => {
  const saved = storage(); let releaseA!: () => void;
  const transport: MarketTransport = { capabilities: async () => capabilities, search: async query => [instrument(query)], quotes: async keys => {
    if (keys[0].endsWith(':AAPL')) await new Promise<void>(resolve => { releaseA = resolve; });
    return keys.map(key => quote(key.split(':')[2], key.endsWith(':AAPL') ? '100' : '200'));
  } };
  const client = createMarketClient(saved.port, transport, { now: () => '2026-09-14T14:31:06.000Z' });
  const old = client.refresh([ledger('AAPL')]);
  while (!releaseA) await Promise.resolve();
  await client.refresh([ledger('NVDA')]); releaseA(); await old;
  const view = client.snapshot([ledger('NVDA')]);
  assert.deepEqual(view.observations.map(item => item.price), ['200']);
  assert.equal(JSON.stringify(saved.values.get(MARKET_STORAGE_KEY)).includes('AAPL'), false);
});

test('offline refresh keeps last-good data as stale and unverified or ambiguous symbols never receive a quote', async () => {
  const saved = storage(); let offline = false;
  const transport: MarketTransport = { capabilities: async () => { if (offline) throw Error('offline'); return capabilities; }, search: async query => query === 'DUP' ? [instrument('DUP'), { ...instrument('DUP'), instrument_key: 'US:XNYS:DUP', mic: 'XNYS', exchange: 'NYSE' }] : [instrument(query)], quotes: async keys => keys.map(key => quote(key.split(':')[2], '101')) };
  let now = '2026-09-14T14:31:06.000Z'; const client = createMarketClient(saved.port, transport, { now: () => now });
  await client.refresh([ledger('AAPL')]); offline = true; now = '2026-09-14T14:31:07.000Z'; await client.refresh([ledger('AAPL')]);
  const stale = client.snapshot([ledger('AAPL')]); assert.equal(stale.status, 'stale'); assert.equal(stale.observations[0].quality, 'stale');
  offline = false; await client.refresh([ledger('DUP')]); const ambiguous = client.snapshot([ledger('DUP')]);
  assert.equal(ambiguous.covered, 0); assert.equal(ambiguous.instruments[0].mapping, 'ambiguous');
});

test('an available quote with unknown freshness remains visible but cannot become a valuation observation', async () => {
  const saved = storage();
  const transport: MarketTransport = { capabilities: async () => capabilities, search: async query => [instrument(query)], quotes: async keys => keys.map(key => ({ ...quote(key.split(':')[2], '101'), freshness: 'unknown' })) };
  const client = createMarketClient(saved.port, transport, { now: () => '2026-09-14T14:31:06.000Z' });
  await client.refresh([ledger('AAPL')]); const view = client.snapshot([ledger('AAPL')]);
  assert.equal(view.instruments[0].quote?.price, '101');
  assert.equal(view.observations.length, 0);
  assert.equal(view.status, 'unavailable');
});

test('server disablement immediately demotes a recent last-good quote to historical reference', async () => {
  const saved = storage(); let enabled = true;
  const transport: MarketTransport = { capabilities: async () => ({ ...capabilities, enabled }), search: async query => [instrument(query)], quotes: async keys => keys.map(key => quote(key.split(':')[2], '101')) };
  const client = createMarketClient(saved.port, transport, { now: () => '2026-09-14T14:31:06.000Z' });
  await client.refresh([ledger('AAPL')]); enabled = false; await client.refresh([ledger('AAPL')]);
  const view = client.snapshot([ledger('AAPL')]);
  assert.equal(view.status, 'stale'); assert.equal(view.observations[0].quality, 'stale');
});

test('canonical mapping is revalidated after its 24-hour catalog window', async () => {
  const saved = storage(); let now = '2026-09-14T14:31:06.000Z', searches = 0;
  const transport: MarketTransport = { capabilities: async () => capabilities, search: async query => { searches++; return [instrument(query)]; }, quotes: async keys => keys.map(key => quote(key.split(':')[2], '101', now)) };
  const client = createMarketClient(saved.port, transport, { now: () => now });
  await client.refresh([ledger('AAPL')]); now = '2026-09-15T15:31:07.000Z'; await client.refresh([ledger('AAPL')]);
  assert.equal(searches, 2);
});
