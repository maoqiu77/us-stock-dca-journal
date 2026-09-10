import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createService } from '../src/service.ts';

function fixture() {
  const values = new Map<string, string>(); let counter = 0; let fail = false;
  const storage = { get: (key: string) => values.get(key) ?? '', set: (key: string, value: string) => { if (fail) throw Error('disk full'); values.set(key, value); } };
  const runtime = { now: () => '2026-09-10T12:00:00.000Z', today: () => '2026-09-10', id: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` };
  return { values, storage, runtime, service: createService(storage, runtime), failWrites: () => { fail = true; } };
}
const buy = { kind: 'buy' as const, symbol: 'qqq', assetType: 'ETF' as const, date: '2026-09-09', quantity: '2.00', price: '10.0', fee: '1', note: '长期记录' };
test('FIFO fractional sale includes fees and survives restart without inventing cash or market value', () => {
  const f = fixture(); f.service.saveTrade(buy);
  f.service.saveTrade({ ...buy, kind: 'sell', date: '2026-09-10', quantity: '0.5', price: '14', fee: '0.2' });
  const view = createService(f.storage, f.runtime).overview();
  assert.equal(view.positions[0].quantity, '1.5'); assert.equal(view.positions[0].cost, '15.75');
  assert.equal(view.realized, '1.55'); assert.equal(view.cash, null); assert.equal(view.marketValue, null);
  assert.equal(view.positions[0].symbol, 'QQQ');
});
test('oversell and voiding an earlier purchase cannot corrupt subsequent history', () => {
  const f = fixture(); f.service.saveTrade(buy);
  const buyId = f.service.records()[0].id;
  f.service.saveTrade({ ...buy, kind: 'sell', date: '2026-09-10', quantity: '1' });
  const before = f.service.exportBackup();
  assert.throws(() => f.service.saveTrade({ ...buy, kind: 'sell', date: '2026-09-10', quantity: '2' }), /持仓/);
  assert.throws(() => f.service.voidTrade(buyId), /持仓/);
  assert.equal(f.service.exportBackup(), before);
});
test('void appends history and removes holding without deleting audit records', () => {
  const f = fixture(); f.service.saveTrade(buy); const id = f.service.records()[0].id;
  f.service.voidTrade(id);
  assert.equal(f.service.overview().positions.length, 0);
  assert.equal(f.service.records()[0].voided, true);
  assert.equal(f.service.snapshot().events.length, 2);
  assert.throws(() => f.service.voidTrade(id));
});
test('invalid decimals, tiny rounded zero, invalid date and future date are rejected', () => {
  const f = fixture();
  for (const quantity of ['0', '-1', '1e3', 'NaN', '1.0000000000001']) assert.throws(() => f.service.saveTrade({ ...buy, quantity }));
  for (const date of ['2026-02-30', '2026-09-11']) assert.throws(() => f.service.saveTrade({ ...buy, date }));
  assert.throws(() => f.service.saveTrade({ ...buy, quantity: '0.000000000001', price: '0.000000000001' }));
  assert.equal(f.service.records().length, 0);
});
test('storage failure never returns a saved trade or replaces last persisted state', () => {
  const f = fixture(); f.service.saveTrade(buy); const before = f.service.exportBackup(); f.failWrites();
  assert.throws(() => f.service.saveTrade({ ...buy, date: '2026-09-10' }), /保存/);
  assert.equal(f.service.exportBackup(), before);
});
test('corrupted persisted data fails closed without silently overwriting it', () => {
  const f = fixture(); f.service.saveTrade(buy);
  const key = [...f.values.keys()][0]; f.values.set(key, '{bad');
  const reopened = createService(f.storage, f.runtime);
  assert.throws(() => reopened.overview(), /损坏/); assert.throws(() => reopened.saveTrade(buy));
  assert.equal(f.values.get(key), '{bad');
});
test('backup preview is readonly, rejects foreign fields, restores with a recovery point', () => {
  const f = fixture(); f.service.saveTrade(buy); const backup = f.service.exportBackup();
  f.service.saveReview('2026-09-10', '耐心等待，不追涨');
  assert.equal(f.service.previewBackup(backup).trades, 1);
  assert.equal(f.service.snapshot().reviews.length, 1);
  const invalid = JSON.parse(backup); invalid.unexpectedField = 'synthetic';
  assert.throws(() => f.service.previewBackup(JSON.stringify(invalid)));
  f.service.restoreBackup(backup); assert.equal(f.service.snapshot().reviews.length, 0);
  f.service.recoverPrevious(); assert.equal(f.service.snapshot().reviews[0].text, '耐心等待，不追涨');
});
test('restoring a backup cannot reuse a prior revision id on the same runtime', () => {
  const f = fixture(); f.service.saveTrade(buy); const backup = f.service.exportBackup();
  const g = fixture(); g.service.restoreBackup(backup); g.service.saveTrade({ ...buy, date: '2026-09-10' });
  assert.equal(g.service.overview().positions[0].quantity, '4');
  assert.equal(new Set(g.service.snapshot().events.map(e => e.revision_id)).size, 2);
});
test('oversized restore is rejected before parsing or writing and notes roundtrip Unicode', () => {
  const f = fixture(); f.service.saveReview('2026-09-10', '复盘 🐻：按计划');
  const before = f.service.exportBackup();
  assert.throws(() => f.service.restoreBackup(' '.repeat(820 * 1024)), /过大/);
  assert.equal(createService(f.storage, f.runtime).snapshot().reviews[0].text, '复盘 🐻：按计划');
  assert.equal(f.service.exportBackup(), before);
});
test('demo is explicit and never overwrites an existing ledger', () => {
  const f = fixture(); assert.equal(f.service.records().length, 0);
  f.service.loadDemo(); assert.equal(f.service.snapshot().mode, 'demo'); assert.ok(f.service.records().length > 0);
  const before = f.service.exportBackup(); assert.throws(() => f.service.loadDemo()); assert.equal(f.service.exportBackup(), before);
});
test('a nearly full snapshot is rejected if its backup envelope would exceed the size limit', async () => {
  const { createRepository } = await import('../src/repository.ts');
  const { MAX_BYTES, utf8Size } = await import('../src/model.ts');
  const f = fixture(); const data = f.service.snapshot();
  for (let i = 0; i < 201; i++) data.reviews.push({ date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), text: 'x'.repeat(4000), updated_at: f.runtime.now() });
  data.reviews.push({ date: '2021-01-01', text: 'x', updated_at: f.runtime.now() });
  const available = MAX_BYTES - 10 - utf8Size(JSON.stringify(data));
  data.reviews[data.reviews.length - 1].text += 'x'.repeat(available);
  assert.equal(utf8Size(JSON.stringify(data)), MAX_BYTES - 10);
  assert.throws(() => createRepository(f.storage, f.runtime).write(data), /过大/);
  assert.equal(f.values.size, 0);
});
test('failed restore leaves the current ledger intact even after creating a recovery point', () => {
  const f = fixture(); f.service.saveTrade(buy); const backup = f.service.exportBackup(); f.service.saveReview('2026-09-10', '恢复前');
  const previous = f.service.exportBackup(); let writes = 0;
  const storage = { get: f.storage.get, set(key: string, value: string) { if (++writes === 2) throw Error('full'); f.storage.set(key, value); } };
  assert.throws(() => createService(storage, f.runtime).restoreBackup(backup), /恢复/);
  assert.equal(f.service.exportBackup(), previous);
});
test('recovery failure preserves a valid recovery point when current bytes are corrupted', async () => {
  const { STORAGE_KEY } = await import('../src/repository.ts'); const f = fixture();
  f.service.saveReview('2026-09-10', '唯一恢复笔记'); f.service.startEmpty();
  const previous = f.values.get(`${STORAGE_KEY}.previous`); f.values.set(STORAGE_KEY, '{broken');
  const storage = { get: f.storage.get, set(key: string, value: string) { if (key === STORAGE_KEY) throw Error('quota'); f.storage.set(key, value); } };
  assert.throws(() => createService(storage, f.runtime).recoverPrevious());
  assert.equal(f.values.get(`${STORAGE_KEY}.previous`), previous);
  f.service.recoverPrevious(); assert.equal(f.service.snapshot().reviews[0].text, '唯一恢复笔记');
});
test('import refuses dangling instrument references even on voided historical revisions', () => {
  const f = fixture(); f.service.saveTrade(buy); f.service.voidTrade(f.service.records()[0].id);
  const backup = JSON.parse(f.service.exportBackup()); backup.data.instruments = [];
  assert.throws(() => f.service.previewBackup(JSON.stringify(backup)), /标的/);
});
test('failed external restore cannot replace a valid recovery point with corrupt primary bytes', async () => {
  const { STORAGE_KEY } = await import('../src/repository.ts'); const f = fixture(); f.service.saveTrade(buy);
  const backup = f.service.exportBackup(); f.service.startEmpty();
  const previous = f.values.get(`${STORAGE_KEY}.previous`); f.values.set(STORAGE_KEY, '{broken');
  const storage = { get: f.storage.get, set(key: string, value: string) { if (key === STORAGE_KEY) throw Error('quota'); f.storage.set(key, value); } };
  assert.throws(() => createService(storage, f.runtime).restoreBackup(backup));
  assert.equal(f.values.get(`${STORAGE_KEY}.previous`), previous);
});
