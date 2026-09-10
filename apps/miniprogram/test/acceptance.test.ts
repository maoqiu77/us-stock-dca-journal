import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createService } from '../src/service.ts';

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

test('MP0/MP1 fixed v1 fixture imports as v2; duplicate revisions and collisions preserve financial counts and bytes', () => {
  const f = setup(); const s = f.service;
  assert.equal(s.previewBackup(v1).trades, 1); assert.equal(f.values.size, 0);
  s.restoreBackup(v1);
  assert.equal(s.snapshot().version, 2);
  const backup = JSON.parse(s.exportBackup()); assert.equal(backup.version, 2);
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
