import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createService } from '../src/service.ts';
import type { MarketTransport } from '../src/market/transport.ts';

const v1 = readFileSync(new URL('./fixtures/v1-backup.json', import.meta.url), 'utf8');
const hand = JSON.parse(readFileSync(new URL('./fixtures/mp1-hand-calculation.json', import.meta.url), 'utf8'));
function setup() {
  const values = new Map<string, string>(); let id = 100; let now = '2026-09-10T12:00:00.000Z';
  const storage = { get: (key: string) => values.get(key) ?? '', set: (key: string, value: string) => { values.set(key, value); } };
  const runtime = { now: () => now, today: () => '2026-09-10', id: () => `20000000-0000-4000-8000-${String(++id).padStart(12, '0')}` };
  return { storage, runtime, values, service: createService(storage, runtime), advance: () => { now = '2026-09-10T12:01:00.000Z'; } };
}
test('MP1 independent hand-calculation fixture survives corrections, restart and backup replacement', () => {
  const f = setup(); const s = f.service;
  const opening = { symbol: hand.symbol, assetType: 'ETF' as const, ...hand.opening, note: '已确认的合成期初成本' };
  const inspect = (index: number) => {
    const actual = s.overview(), expected = hand.expected[index];
    assert.equal(actual.positions[0].quantity, expected.quantity);
    assert.equal(actual.totalCost, expected.cost);
    assert.equal(actual.realized, expected.realized);
    assert.equal(actual.tradeCount, expected.tradeCount);
    assert.equal(actual.cash, null); assert.equal(actual.marketValue, null);
  };
  s.saveOpening({ ...opening, contentToken: s.previewOpening(opening).contentToken }); inspect(0);
  const buy = { kind: 'buy' as const, symbol: hand.symbol, assetType: 'ETF' as const, ...hand.buy, note: '合成买入理由' };
  s.saveTrade({ ...buy, contentToken: s.previewTrade(buy).contentToken }); inspect(1);
  const purchase = s.records().find(row => row.kind === 'buy')!;
  const sell = { kind: 'sell' as const, symbol: hand.symbol, assetType: 'ETF' as const, ...hand.sell, note: '合成减仓理由' };
  s.saveTrade({ ...sell, contentToken: s.previewTrade(sell).contentToken }); inspect(2);
  f.advance();
  const corrected = { ...buy, ...hand.correction, recordId: purchase.id, expectedRevision: purchase.revisionId };
  const beforePreview = s.exportBackup();
  const preview = s.previewTrade(corrected);
  assert.equal(s.exportBackup(), beforePreview, 'financial preview never persists an edit');
  s.saveTrade({ ...corrected, contentToken: preview.contentToken }); inspect(3);
  assert.equal(s.snapshot().events.filter(row => row.record_id === purchase.id).length, 2);
  const restarted = createService(f.storage, f.runtime);
  assert.equal(restarted.overview().totalCost, '951.00');
  const backup = restarted.exportBackup();
  const other = setup(); other.advance(); other.service.restoreBackup(backup);
  assert.equal(other.service.overview().totalCost, '951.00');
  assert.equal(other.service.overview().realized, '89.00');
  assert.equal(other.service.snapshot().events.length, restarted.snapshot().events.length);
});

test('MP0/MP1 fixed v1 fixture imports as v3; duplicate revisions and collisions preserve financial counts and bytes', () => {
  const f = setup(); const s = f.service;
  assert.equal(s.previewBackup(v1).trades, 1); assert.equal(f.values.size, 0);
  s.restoreBackup(v1);
  assert.equal(s.snapshot().version, 3);
  const backup = JSON.parse(s.exportBackup()); assert.equal(backup.version, 3);
  backup.data.events.push(structuredClone(backup.data.events[0]));
  s.restoreBackup(JSON.stringify(backup));
  assert.equal(s.records().length, 1); assert.equal(s.overview().tradeCount, 1);
  assert.equal(s.overview().totalCost, '21.00');
  const before = s.exportBackup();
  backup.data.events[1].note = '相同 revision 的冲突内容';
  assert.throws(() => s.restoreBackup(JSON.stringify(backup)));
  assert.equal(s.exportBackup(), before);
  assert.equal(createService(f.storage, f.runtime).snapshot().reviews[0].text, '仅用于测试的复盘。');
});

test('Phase 5 market refresh adds exact reference valuation without changing the ledger or inventing cash', async () => {
  const f = setup();
  const transport: MarketTransport = {
    capabilities: async () => ({ schema_version: 1, enabled: true, provider_configured: true, authorized: true, access_mode: 'public', quote_access: true, bars_access: false, search_access: true, ai_source_access: false, archive_access: false, provider: 'Twelve Data', feed: 'licensed-feed', coverage: 'venue_subset', timeliness: 'delayed', delay_seconds: 900, attribution: 'Twelve Data', limits: { quote_batch: 30, search_results: 10, bars: 400 } }),
    search: async query => [{ schema_version: 1, instrument_key: `US:XNAS:${query}`, symbol: query, name: query, mic: 'XNAS', exchange: 'NASDAQ', market: 'US', currency: 'USD', asset_type: query === 'QQQ' ? 'ETF' : 'STOCK', provider_symbol: query, provider_catalog_version: 'v1', status: 'active' }],
    quotes: async keys => keys.map(key => ({ schema_version: 1, instrument_key: key, symbol: key.split(':')[2], currency: 'USD', price: '50', price_kind: 'last_trade', previous_close: '49', previous_close_date: '2026-09-09', change: '1', change_percent: '2.0408163265', volume: '100', volume_scope: 'feed_only', session: 'regular', market_status: 'open', trading_date: '2026-09-10', exchange_timezone: 'America/New_York', provider: 'Twelve Data', feed: 'licensed-feed', coverage: 'venue_subset', timeliness: 'delayed', delay_seconds: 900, as_of: '2026-09-10T11:59:00.000Z', received_at: '2026-09-10T12:00:00.000Z', served_at: '2026-09-10T12:00:00.000Z', freshness: 'current', cache_state: 'miss', status: 'available', reason: null, adjustment: 'unadjusted', attribution: 'Twelve Data' })),
  };
  const service = createService(f.storage, f.runtime, { marketTransport: transport });
  service.saveOpening({ date: '2026-09-10', symbol: 'QQQ', assetType: 'ETF', quantity: '2', totalCost: '80' });
  const ledgerBefore = service.exportBackup(); await service.refreshMarket();
  const view = service.overview();
  assert.equal(service.exportBackup(), ledgerBefore);
  assert.equal(view.cash, null); assert.equal(view.netValue, null);
  assert.equal(view.marketValue, '100.00'); assert.equal(view.coveredMarketValue, '100.00');
  assert.equal(view.positions[0].marketPrice, '50'); assert.equal(view.positions[0].unrealized, '20.00'); assert.equal(view.positions[0].weightExCash, '100.00%');
  assert.equal(view.market.attribution, 'Twelve Data');
});
