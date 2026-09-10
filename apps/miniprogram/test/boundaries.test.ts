import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.ts';
function setup() {
  let n = 0, now = '2026-09-10T12:00:00.000Z'; const values = new Map<string, string>();
  const storage = { get: (key: string) => values.get(key) ?? '', set: (key: string, value: string) => { values.set(key, value); } };
  const runtime = { now: () => now, today: () => now.slice(0, 10), id: () => `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
  return { service: createService(storage, runtime), time: (value: string) => { now = value; }, storage, runtime };
}
const buy = { kind: 'buy' as const, symbol: 'QQQ', assetType: 'ETF' as const, date: '2026-09-09', quantity: '2', price: '10', fee: '1', note: '' };
test('imported sparse sequence values use ordinal positions for edits and historical availability', () => {
  const f = setup(); f.service.saveTrade(buy);
  f.service.saveTrade({ ...buy, kind: 'sell', quantity: '1', price: '14' });
  const backup = JSON.parse(f.service.exportBackup()); backup.data.events[0].sequence = 10; backup.data.events[1].sequence = 20;
  f.service.restoreBackup(JSON.stringify(backup));
  assert.equal(f.service.availableQuantity({ symbol: 'QQQ', date: buy.date, position: 1 }), '2');
  const original = f.service.records().find(row => row.kind === 'buy')!;
  const input = { ...buy, note: '保留同日位置', recordId: original.id, expectedRevision: original.revisionId };
  const preview = f.service.previewTrade(input); assert.equal(preview.order.position, 0);
  f.service.saveTrade({ ...input, contentToken: preview.contentToken });
  assert.equal(f.service.overview().positions[0].quantity, '1');
});
test('adding another opening on a day with trades revises the order atomically', () => {
  const f = setup();
  f.service.saveOpening({ symbol: 'QQQ', assetType: 'ETF', date: buy.date, quantity: '10', totalCost: '1000' });
  f.service.saveTrade(buy);
  f.service.saveOpening({ symbol: 'AAPL', assetType: 'STOCK', date: buy.date, quantity: '1', totalCost: '100' });
  assert.equal(f.service.overview().positions.length, 2);
  assert.equal(f.service.overview().tradeCount, 1);
  assert.equal(f.service.previewBackup(f.service.exportBackup()).openings, 2);
});
test('historical overview counts only the revisions visible at its explicit cutoff', () => {
  const f = setup(); f.service.saveTrade(buy);
  f.time('2026-09-10T12:01:00.000Z'); f.service.saveTrade({ ...buy, date: '2026-09-10' });
  const view = f.service.overview({ throughDate: '2026-09-09', knownAt: '2026-09-10T12:00:00.000Z' });
  assert.equal(view.tradeCount, 1); assert.equal(view.totalCost, '21.00');
});
test('a clock anomaly caused by a later review also blocks voiding an older trade', () => {
  const f = setup(); f.time('2026-09-09T12:00:00.000Z'); f.service.saveTrade(buy);
  f.time('2026-09-10T12:00:00.000Z'); f.service.saveReview('2026-09-10', '合成观察');
  f.time('2026-09-09T13:00:00.000Z'); const before = f.service.exportBackup();
  assert.throws(() => f.service.voidTrade(f.service.records()[0].id), /时间/);
  assert.equal(f.service.exportBackup(), before);
});
test('restoring an identical snapshot invalidates an already confirmed preview', () => {
  const f = setup(); f.service.saveTrade(buy);
  const preview = f.service.previewTrade(buy); const backup = f.service.exportBackup();
  f.service.restoreBackup(backup);
  assert.throws(() => f.service.saveTrade({ ...buy, contentToken: preview.contentToken }), /预览/);
});
test('revision history follows parent links and ignores identical duplicate revisions', () => {
  const f = setup(); f.service.saveTrade(buy); const row = f.service.records()[0];
  f.service.saveTrade({ ...buy, price: '11', recordId: row.id, expectedRevision: row.revisionId });
  const backup = JSON.parse(f.service.exportBackup()); backup.data.events.reverse(); backup.data.events.push(structuredClone(backup.data.events[0]));
  f.service.restoreBackup(JSON.stringify(backup));
  const history = f.service.revisionHistory(row.id);
  assert.equal(history.length, 2); assert.equal(history[0].price, '10'); assert.equal(history[1].price, '11');
});

test('a symbol correction previews both instruments without renaming instrument identity', () => {
  const f = setup(); f.service.saveTrade(buy); const original = f.service.records()[0];
  const input = { ...buy, symbol: 'AAPL', assetType: 'STOCK' as const, recordId: original.id, expectedRevision: original.revisionId };
  const preview = f.service.previewTrade(input);
  assert.equal(preview.affectedPositions.find(row => row.symbol === 'QQQ')?.after.quantity, '0');
  assert.equal(preview.affectedPositions.find(row => row.symbol === 'AAPL')?.after.quantity, '2');
  f.service.saveTrade({ ...input, contentToken: preview.contentToken });
  assert.equal(f.service.positionDetail('QQQ').quantity, '0');
  assert.equal(f.service.positionDetail('AAPL').cost, '21.00');
  assert.equal(f.service.revisionHistory(original.id)[0].symbol, 'QQQ');
});
test('symbol or direction corrections that invalidate a later sale cannot persist', () => {
  const f = setup(); f.service.saveTrade(buy); const original = f.service.records()[0];
  f.service.saveTrade({ ...buy, kind: 'sell', quantity: '1' }); const before = f.service.exportBackup();
  for (const patch of [{ symbol: 'AAPL', assetType: 'STOCK' as const }, { kind: 'sell' as const }]) {
    assert.throws(() => f.service.previewTrade({ ...buy, ...patch, recordId: original.id, expectedRevision: original.revisionId }), /持仓/);
    assert.equal(f.service.exportBackup(), before);
  }
});
test('preview preserves sub-cent transaction and fee evidence', () => {
  const f = setup(); const preview = f.service.previewTrade({ ...buy, quantity: '0.1', price: '0.001', fee: '0.0001' });
  assert.equal(preview.amount, '0.0001'); assert.equal(preview.fee, '0.0001'); assert.equal(preview.net, '-0.0002');
});

test('clock calibration restores normal reads and new writes without changing saved dates', () => {
  const f = setup(); f.service.saveTrade(buy); const before = f.service.exportBackup();
  f.time('2026-09-10T11:59:59.000Z');
  assert.equal(f.service.overview().clockAnomaly, true); assert.equal(f.service.exportBackup(), before);
  assert.throws(() => f.service.saveTrade(buy), /时间/);
  f.time('2026-09-10T12:00:01.000Z'); assert.equal(f.service.overview().clockAnomaly, false);
  f.service.saveTrade(buy); assert.equal(f.service.overview().positions[0].quantity, '4');
});
test('closing an opening position and buying again retains realized history and starts new FIFO cost', () => {
  const f = setup(); f.service.saveOpening({ symbol: 'QQQ', assetType: 'ETF', date: '2026-09-01', quantity: '2', totalCost: '200' });
  f.service.saveTrade({ ...buy, kind: 'sell', price: '120' });
  assert.equal(f.service.positionDetail('QQQ').quantity, '0'); assert.equal(f.service.positionDetail('QQQ').realized, '39.00');
  f.service.saveTrade({ ...buy, quantity: '0.5', price: '110' });
  const detail = f.service.positionDetail('QQQ'); assert.equal(detail.quantity, '0.5'); assert.equal(detail.cost, '56.00'); assert.equal(detail.realized, '39.00');
});

test('history conflict diagnostics name the corrected date even when timestamps are equal', () => {
  const f = setup(); f.service.saveOpening({ symbol: 'QQQ', assetType: 'ETF', date: '2026-09-01', quantity: '2', totalCost: '200' });
  f.service.saveTrade(buy); const row = f.service.records().find(item => item.kind === 'buy')!;
  assert.throws(() => f.service.previewTrade({ ...buy, date: '2026-08-31', recordId: row.id, expectedRevision: row.revisionId }), /2026-08-31.*QQQ/);
});
