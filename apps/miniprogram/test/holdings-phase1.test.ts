import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createService } from '../src/service.ts';
import type { MarketTransport } from '../src/market/transport.ts';

function setup(marketTransport?: MarketTransport) {
  const values = new Map<string, string>();
  let id = 900;
  let now = '2026-09-19T04:00:00.000Z';
  const storage = {
    get: (key: string) => values.get(key) ?? '',
    set: (key: string, value: string) => { values.set(key, value); },
  };
  const runtime = {
    now: () => now,
    today: () => '2026-09-19',
    id: () => `90000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
  return {
    values,
    runtime,
    service: createService(storage, runtime, { marketTransport }),
    advance: () => { now = '2026-09-19T04:01:00.000Z'; },
  };
}

const manualHolding = {
  batchId: 'manual_QQQ_001',
  expectedRevision: 0,
  observedAt: '2026-09-19T04:00:00.000Z',
  instrument: {
    symbol: 'QQQ', name: '纳斯达克 100 ETF', market: 'US', currency: 'USD',
    assetType: 'ETF' as const, status: 'unverified' as const,
  },
  quantity: '20',
  unitCost: '10',
};

test('manual current holding is a checkpoint, not a fabricated trade, and retry is idempotent', () => {
  const f = setup();
  const preview = f.service.previewHolding(manualHolding);
  assert.equal(preview.before.quantity, '0');
  assert.equal(preview.after.quantity, '20');
  assert.equal(preview.createsTrade, false);
  const first = f.service.saveHolding({ ...manualHolding, contentToken: preview.contentToken });
  assert.equal(first.kind, 'committed');
  assert.equal(f.service.records().length, 0);
  assert.equal(f.service.overview().positions[0].quantity, '20');
  const retry = f.service.saveHolding({ ...manualHolding, contentToken: preview.contentToken });
  assert.equal(retry.kind, 'already_applied');
  assert.equal(f.service.overview().positions[0].quantity, '20');
  assert.throws(() => f.service.saveHolding({ ...manualHolding, quantity: '21', contentToken: preview.contentToken }), /重复|冲突/);
});

test('a checkpoint replaces the included ledger quantity and later real trades add once', () => {
  const f = setup();
  f.service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-19', quantity: '10', price: '8', fee: '0' });
  f.advance();
  const request = { ...manualHolding, expectedRevision: f.service.snapshot().revision, observedAt: f.runtime.now(), replaceApproved: true };
  f.service.saveHolding(request);
  assert.equal(f.service.overview().positions[0].quantity, '20');
  f.service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-19', quantity: '2', price: '11', fee: '0' });
  assert.equal(f.service.overview().positions[0].quantity, '22');
  assert.equal(f.service.records().filter(row => row.kind === 'buy').length, 2);
  assert.equal(f.service.saveHolding(request).kind, 'already_applied');
  assert.equal(f.service.overview().positions[0].quantity, '22');
});

test('manual holding decimal validation accepts canonical thousands and rejects ambiguous or unsafe inputs', () => {
  const f = setup();
  const normalized = f.service.previewHolding({ ...manualHolding, quantity: '1,234.5000', unitCost: '' });
  assert.equal(normalized.after.quantity, '1234.5');
  assert.equal(normalized.after.unitCost, null);
  for (const quantity of ['1,23', '1e3', 'NaN', '-1', '10%']) {
    assert.throws(() => f.service.previewHolding({ ...manualHolding, quantity, unitCost: '' }), /数字|格式|数量/);
  }
});

test('unknown cost and missing quote remain unknown while currencies are never summed', async () => {
  const transport: MarketTransport = {
    capabilities: async () => ({ schema_version: 1, enabled: true, provider_configured: true, authorized: true, access_mode: 'public', quote_access: true, bars_access: false, search_access: true, ai_source_access: false, archive_access: false, provider: 'fixture', feed: 'fixture', coverage: 'venue_subset', timeliness: 'delayed', delay_seconds: 0, attribution: 'fixture', limits: { quote_batch: 30, search_results: 10, bars: 400 } }),
    search: async query => [{ schema_version: 1, instrument_key: `US:XNAS:${query}`, symbol: query, name: query, mic: 'XNAS', exchange: 'NASDAQ', market: 'US', currency: 'USD', asset_type: 'ETF', provider_symbol: query, provider_catalog_version: 'v1', status: 'active' }],
    quotes: async keys => keys.map(key => ({ schema_version: 1, instrument_key: key, symbol: 'QQQ', currency: 'USD', price: '13', price_kind: 'last_trade', previous_close: '12', previous_close_date: '2026-09-18', change: '1', change_percent: '8.3333333333', volume: null, volume_scope: 'unknown', session: 'regular', market_status: 'open', trading_date: '2026-09-19', exchange_timezone: 'America/New_York', provider: 'fixture', feed: 'fixture', coverage: 'venue_subset', timeliness: 'delayed', delay_seconds: 0, as_of: '2026-09-19T03:59:00.000Z', received_at: '2026-09-19T04:00:00.000Z', served_at: '2026-09-19T04:00:00.000Z', freshness: 'current', cache_state: 'miss', status: 'available', reason: null, adjustment: 'unadjusted', attribution: 'fixture' })),
  };
  const f = setup(transport);
  f.service.saveHolding({ ...manualHolding, unitCost: '', instrument: { ...manualHolding.instrument, status: 'verified' } });
  f.service.saveHolding({ ...manualHolding, batchId: 'manual_CNY_001', expectedRevision: 1, instrument: { symbol: '510300', name: '沪深300ETF', market: 'CN', currency: 'CNY', assetType: 'ETF', status: 'unverified' }, quantity: '5', unitCost: '4' });
  await f.service.refreshMarket();
  const usd = f.service.overview(undefined, 'USD');
  assert.deepEqual(usd.currencies, ['CNY', 'USD']);
  assert.equal(usd.selectedCurrency, 'USD');
  assert.equal(usd.marketValue, '260.00');
  assert.equal(usd.positions[0].unrealized, null);
  assert.equal(usd.unrealizedPnl, null);
  const cny = f.service.overview(undefined, 'CNY');
  assert.equal(cny.marketValue, null);
  assert.equal(cny.positions[0].marketValue, null);
  assert.equal(cny.market.covered, 0);
});

test('A-share holding refresh uses a timestamped CNY quote and recalculates its value', async () => {
  const transport: MarketTransport = {
    capabilities: async () => ({ schema_version: 1, enabled: false, provider_configured: false, authorized: true, access_mode: 'public', quote_access: false, bars_access: false, search_access: false, ai_source_access: false, archive_access: false, provider: null, feed: null, coverage: 'unknown', timeliness: 'unknown', delay_seconds: null, attribution: '', limits: { quote_batch: 30, search_results: 10, bars: 400 } }),
    search: async () => [], quotes: async () => [],
    domesticHoldingQuotes: async symbols => symbols.map(symbol => ({ symbol, price: '34.52', asOf: '2026-09-19T03:59:00.000Z', fetchedAt: '2026-09-19T04:00:00.000Z', source: 'fixture', status: 'available' as const })),
  };
  const f = setup(transport);
  f.service.saveHolding({ ...manualHolding, instrument: { symbol: '600009', name: '上海机场', market: 'CN', currency: 'CNY', assetType: 'STOCK', status: 'verified' }, quantity: '10', unitCost: '30' });
  assert.equal(f.service.overview().positions[0].marketValue, null);
  await f.service.refreshMarket();
  const row = f.service.overview().positions[0];
  assert.equal(row.marketPrice, '34.52');
  assert.equal(row.marketValue, '345.20');
  assert.equal(row.unrealized, '45.20');
  assert.equal(row.pnlPercent, '15.1%');
  assert.equal(row.quoteAsOf, '2026-09-19T03:59:00.000Z');
});

test('public US quote with unknown delay updates displayed holding value without claiming realtime freshness', async () => {
  const transport: MarketTransport = {
    capabilities: async () => ({ schema_version: 1, enabled: true, provider_configured: true, authorized: true, access_mode: 'public', quote_access: true, bars_access: false, search_access: true, ai_source_access: false, archive_access: false, provider: 'fixture', feed: 'public-reference', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, attribution: '延迟未知', limits: { quote_batch: 30, search_results: 10, bars: 400 } }),
    search: async query => [{ schema_version: 1, instrument_key: `US:XNAS:${query}`, symbol: query, name: query, mic: 'XNAS', exchange: 'NASDAQ', market: 'US', currency: 'USD', asset_type: 'STOCK', provider_symbol: query, provider_catalog_version: 'v1', status: 'active' }],
    quotes: async keys => keys.map(key => ({ schema_version: 1, instrument_key: key, symbol: 'TSLA', currency: 'USD', price: '378.90', price_kind: 'indicative', previous_close: null, previous_close_date: null, change: null, change_percent: null, volume: null, volume_scope: 'unknown', session: 'unknown', market_status: 'unknown', trading_date: '2026-09-18', exchange_timezone: 'America/New_York', provider: 'fixture', feed: 'public-reference', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, as_of: '2026-09-19T03:59:00.000Z', received_at: '2026-09-19T04:00:00.000Z', served_at: '2026-09-19T04:00:00.000Z', freshness: 'unknown', cache_state: 'miss', status: 'available', reason: null, adjustment: 'unadjusted', attribution: '延迟未知' })),
  };
  const f = setup(transport);
  f.service.saveHolding({ ...manualHolding, instrument: { symbol: 'TSLA', name: '特斯拉', market: 'US', currency: 'USD', assetType: 'STOCK', status: 'verified' }, quantity: '2', unitCost: '' });
  await f.service.refreshMarket();
  const row = f.service.overview().positions[0];
  assert.equal(row.marketPrice, '378.90');
  assert.equal(row.marketValue, '757.80');
  assert.equal(row.unrealized, null);
  assert.equal(row.quoteFreshness, 'unknown');
  assert.equal(row.quoteAsOf, '2026-09-19T03:59:00.000Z');
  assert.equal(f.service.positionDetail('TSLA').marketIdentity?.instrument_key, 'US:XNAS:TSLA');
  assert.equal(f.service.marketDiscovery().watchlist.some(item => item.instrument_key === 'US:XNAS:TSLA'), true);
  await f.service.refreshMarket();
  assert.equal(f.service.marketDiscovery().watchlist.filter(item => item.instrument_key === 'US:XNAS:TSLA').length, 1);
});

test('verified screenshot import appears on the board and opens its market identity immediately', async () => {
  const item = { schema_version: 1 as const, instrument_key: 'US:XNAS:NVDA', symbol: 'NVDA', name: 'Nvidia', mic: 'XNAS', exchange: 'NASDAQ', market: 'US' as const, currency: 'USD' as const, asset_type: 'STOCK' as const, provider_symbol: 'NVDA', provider_catalog_version: 'v1', status: 'active' as const };
  const transport: MarketTransport = {
    capabilities: async () => ({ schema_version: 1, enabled: true, provider_configured: true, authorized: true, access_mode: 'public', quote_access: true, bars_access: true, search_access: true, ai_source_access: false, archive_access: false, provider: 'fixture', feed: 'fixture', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, attribution: 'fixture', limits: { quote_batch: 30, search_results: 10, bars: 400 } }),
    search: async () => [item], quotes: async () => [],
  };
  const f = setup(transport);
  await f.service.searchMarket('NVDA');
  f.service.saveHoldingImport({ batchId: 'nvda_import_001', expectedRevision: 0, observedAt: f.runtime.now(), rows: [{ rowId: 'nvda', instrument: { symbol: 'NVDA', name: 'Nvidia', market: 'US', currency: 'USD', assetType: 'STOCK', status: 'verified', instrumentKey: item.instrument_key }, quantity: '2', unitCost: '100' }] });
  assert.equal(f.service.marketDiscovery().watchlist.some(row => row.instrument_key === item.instrument_key), true);
  assert.equal(f.service.positionDetail('NVDA').marketIdentity?.instrument_key, item.instrument_key);
});

test('legacy snapshots migrate without changing original events or review text', () => {
  const f = setup();
  f.service.saveTrade({ kind: 'buy', symbol: 'AAPL', assetType: 'STOCK', date: '2026-09-19', quantity: '2', price: '10', fee: '1', note: '原始理由' });
  f.service.saveReview('2026-09-19', '原始复盘');
  const snapshot = f.service.snapshot();
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].note, '原始理由');
  assert.equal(snapshot.reviews[0].text, '原始复盘');
  assert.deepEqual(snapshot.holding_checkpoints, []);
  assert.deepEqual(snapshot.import_receipts, []);
});

test('verified identity requires an exact catalog result and cannot be asserted by form data alone', async () => {
  const transport: MarketTransport = {
    capabilities: async () => ({ schema_version: 1, enabled: true, provider_configured: true, authorized: true, access_mode: 'public', quote_access: false, bars_access: false, search_access: true, ai_source_access: false, archive_access: false, provider: 'fixture', feed: 'fixture', coverage: 'venue_subset', timeliness: 'delayed', delay_seconds: 0, attribution: 'fixture', limits: { quote_batch: 30, search_results: 10, bars: 400 } }),
    search: async query => [{ schema_version: 1, instrument_key: `US:XNAS:${query}`, symbol: query, name: 'Invesco QQQ', mic: 'XNAS', exchange: 'NASDAQ', market: 'US', currency: 'USD', asset_type: 'ETF', provider_symbol: query, provider_catalog_version: 'v1', status: 'active' }],
    quotes: async () => [],
  };
  const untrusted = setup(transport);
  untrusted.service.saveHolding({ ...manualHolding, instrument: { ...manualHolding.instrument, status: 'verified' } });
  assert.equal(untrusted.service.snapshot().holding_assets[0].status, 'unverified');

  const trusted = setup(transport);
  const [match] = await trusted.service.searchMarket('QQQ');
  trusted.service.saveHolding({ ...manualHolding, instrument: { ...manualHolding.instrument, name: match.name, status: 'verified', instrumentKey: match.instrument_key } });
  assert.equal(trusted.service.snapshot().holding_assets[0].status, 'verified');
});

test('external v3 backup rejects dangling checkpoint heads and receipts without changing current data', () => {
  const f = setup(); f.service.saveHolding(manualHolding);
  const original = f.service.exportBackup();
  const brokenHead = JSON.parse(original);
  brokenHead.data.holding_checkpoints[0].baseline_heads.push({ record_id: '90000000-0000-4000-8000-000000009991', revision_id: '90000000-0000-4000-8000-000000009992' });
  assert.throws(() => f.service.restoreBackup(JSON.stringify(brokenHead)), /校准|引用/);
  const brokenReceipt = JSON.parse(original); brokenReceipt.data.import_receipts = [];
  assert.throws(() => f.service.restoreBackup(JSON.stringify(brokenReceipt)), /回执/);
  assert.equal(f.service.exportBackup(), original);
});

test('removing current holding keeps historical trades, persists across reload and allows readding', () => {
  const f = setup();
  f.service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-19', quantity: '2', price: '10', fee: '0' });
  f.advance();
  const records = f.service.records();
  const input = { ...manualHolding, batchId: 'remove_holding_001', expectedRevision: f.service.snapshot().revision, observedAt: f.runtime.now(), quantity: '0', replaceApproved: true };
  const preview = f.service.previewHolding(input);
  f.service.saveHolding({ ...input, contentToken: preview.contentToken });
  assert.equal(f.service.overview().positions.length, 0);
  assert.deepEqual(f.service.records(), records);
  const reloaded = createService({ get: key => f.values.get(key) ?? '', set: (key, value) => { f.values.set(key, value); } }, f.runtime);
  assert.equal(reloaded.overview().positions.length, 0);
  reloaded.saveHolding({ ...input, batchId: 'restore_holding_001', expectedRevision: reloaded.snapshot().revision, quantity: '2' });
  assert.equal(reloaded.overview().positions[0].quantity, '2');
  assert.deepEqual(reloaded.records(), records);
});

test('domestic provider catalog -> manual holding -> backup preserves exact identity without inventing trades', async () => {
 const instrument = { instrument_key: 'CN:FUND:000001', symbol: '000001', name: '测试 QDII A', market: 'CN' as const, currency: 'CNY' as const, asset_type: 'FUND' as const, exchange: 'FUND' as const, provider_symbol: '000001.OF', provider_catalog_version: '2026-09-19T04:00:00Z' };
 const f = setup({ capabilities: async () => { throw Error('not used'); }, search: async () => [], quotes: async () => [], domesticBoard: async () => ({ segment: 'fund', status: 'available', reason: '', rows: [{ instrument, price: null, tradeDate: null, changePct: null, nav: '1.1', navDate: '2026-09-18', announcementDate: '2026-09-19', premiumPct: null, premiumLabel: '', source: 'test fixture only', fetchedAt: '2026-09-19T04:00:00Z', quality: 'available' }] }) });
 await f.service.domesticBoard('fund');
 const input = { ...manualHolding, batchId: 'cn_test_0001', instrument: { symbol: instrument.symbol, name: instrument.name, market: instrument.market, currency: instrument.currency, assetType: instrument.asset_type, status: 'verified' as const, instrumentKey: instrument.instrument_key } };
 const preview = f.service.previewHolding(input); f.service.saveHolding({ ...input, contentToken: preview.contentToken });
 const position = f.service.overview(undefined, 'CNY').positions[0]; assert.equal(position.symbol, '000001'); assert.equal(position.status, 'verified'); assert.equal(f.service.records().length, 0);
 const ai = f.service.ai().previewContext({ mode: 'portfolio_review', journalDate: '2026-09-19', question: '研究此基金', domesticInstrument: instrument });
 assert.ok(ai.facts.some(fact => fact.value.includes('CN:FUND:000001'))); assert.ok(ai.missingInformation.some(text => text.includes('不外发价格或净值'))); assert.ok(!ai.sources.some(source => source.type === 'quote'));
 const backup = f.service.exportFullBackup(), restored = setup(); restored.service.restoreCompleteBackup(backup); assert.equal(restored.service.overview(undefined, 'CNY').positions[0].symbol, '000001');
});

test('held fund refresh uses the latest published NAV and keeps its actual NAV date', async () => {
 const instrument = { instrument_key: 'CN:FUND:000001', symbol: '000001', name: '测试基金', market: 'CN' as const, currency: 'CNY' as const, asset_type: 'FUND' as const, exchange: 'FUND' as const, provider_symbol: '000001.OF', provider_catalog_version: '2026-09-19T04:00:00Z' };
 const requested: string[][] = [];
 const f = setup({ capabilities: async () => { throw Error('not used'); }, search: async () => [], quotes: async () => [], domesticBoard: async (segment, symbols) => { assert.equal(segment, 'fund'); requested.push(symbols || []); return { segment, status: 'available', reason: '', rows: [{ instrument, price: null, tradeDate: null, changePct: 0.5, nav: '1.2500', navDate: '2026-09-18', announcementDate: null, premiumPct: null, premiumLabel: '', source: 'fixture', fetchedAt: '2026-09-19T04:00:00Z', quality: 'available' }] }; } });
 const input = { ...manualHolding, batchId: 'fund_nav_refresh_001', instrument: { symbol: instrument.symbol, name: instrument.name, market: instrument.market, currency: instrument.currency, assetType: instrument.asset_type, status: 'verified' as const, instrumentKey: instrument.instrument_key }, quantity: '20', unitCost: '1' };
 await f.service.domesticBoard('fund', [instrument.symbol]);
 f.service.saveHolding(input);
 await f.service.refreshMarket();
 const position = f.service.overview(undefined, 'CNY').positions[0];
 assert.deepEqual(requested.map(row => [...row]), [['000001'], ['000001']]);
 assert.equal(position.marketPrice, '1.2500');
 assert.equal(position.marketValue, '25.00');
 assert.equal(position.unrealized, '5.00');
 assert.equal(position.quoteAsOf, '2026-09-18');
 assert.equal(position.quoteFreshness, 'official_nav');
});
