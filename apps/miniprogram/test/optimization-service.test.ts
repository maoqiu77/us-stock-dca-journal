import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createService, ServiceError } from '../src/service.ts';

function fixture() {
  const values = new Map<string, string>();
  let counter = 0;
  let now = '2026-09-10T12:00:00.000Z';
  const storage = {
    get: (key: string) => values.get(key) ?? '',
    set: (key: string, value: string) => values.set(key, value),
  };
  const runtime = {
    now: () => now,
    today: () => now.slice(0, 10),
    id: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  };
  return { values, storage, runtime, service: createService(storage, runtime), setNow: (value: string) => { now = value; } };
}

const opening = { date: '2026-09-01', symbol: 'QQQ', assetType: 'ETF' as const, quantity: '10', totalCost: '1000', note: '期初确认' };
const buy = { kind: 'buy' as const, symbol: 'QQQ', date: '2026-09-02', quantity: '2', price: '120', fee: '1', note: '加仓理由' };

function savePreviewedTrade(service: ReturnType<typeof createService>, input: Parameters<ReturnType<typeof createService>['previewTrade']>[0]) {
  const preview = service.previewTrade(input);
  service.saveTrade({ ...input, contentToken: preview.contentToken });
  return preview;
}

test('opening positions establish one opening date and do not count as trades', () => {
  const f = fixture();
  const preview = f.service.previewOpening(opening);
  f.service.saveOpening({ ...opening, contentToken: preview.contentToken });
  assert.deepEqual(f.service.firstUse(), { isEmpty: false, openingDate: '2026-09-01', hasOpeningPositions: true });
  assert.equal(f.service.overview().positions[0].quantity, '10');
  assert.equal(f.service.overview().positions[0].cost, '1000.00');
  assert.equal(f.service.overview().tradeCount, 0);
  assert.equal(f.service.records()[0].isOpening, true);
  assert.throws(() => f.service.saveOpening({ ...opening, symbol: 'AAPL', date: '2026-08-31' }), (error: unknown) => error instanceof ServiceError && error.code === 'OPENING_DATE_CONFLICT');
});

test('hand-calculated opening, buy, sell and buy correction replay the complete ledger', () => {
  const f = fixture();
  f.service.saveOpening(opening);
  savePreviewedTrade(f.service, buy);
  savePreviewedTrade(f.service, { ...buy, kind: 'sell', date: '2026-09-03', quantity: '3', price: '130' });
  let view = f.service.overview();
  assert.deepEqual({ quantity: view.positions[0].quantity, cost: view.positions[0].cost, realized: view.realized }, { quantity: '9', cost: '941.00', realized: '89.00' });

  const original = f.service.records().find(record => record.kind === 'buy')!;
  const correction = { ...buy, price: '125', recordId: original.id, expectedRevision: original.revisionId };
  const preview = f.service.previewTrade(correction);
  assert.deepEqual(preview.after, { quantity: '9', cost: '951.00', realized: '89.00' });
  f.service.saveTrade({ ...correction, contentToken: preview.contentToken });
  view = f.service.overview();
  assert.deepEqual({ quantity: view.positions[0].quantity, cost: view.positions[0].cost, realized: view.realized }, { quantity: '9', cost: '951.00', realized: '89.00' });
  assert.equal(f.service.revisionHistory(original.id).length, 2);
  assert.equal(f.service.records().find(record => record.id === original.id)!.parentRevision, original.revisionId);
});

test('a correction that makes later history oversell is rejected without writing', () => {
  const f = fixture();
  f.service.saveOpening(opening);
  savePreviewedTrade(f.service, buy);
  savePreviewedTrade(f.service, { ...buy, kind: 'sell', date: '2026-09-03', quantity: '11', price: '130' });
  const original = f.service.records().find(record => record.kind === 'buy')!;
  const before = f.service.exportBackup();
  assert.throws(() => f.service.previewTrade({ ...buy, quantity: '0.5', recordId: original.id, expectedRevision: original.revisionId }), /持仓/);
  assert.equal(f.service.exportBackup(), before);
});

test('same-day insertion previews order and commits all required reorder revisions atomically', () => {
  const f = fixture();
  f.service.saveOpening(opening);
  savePreviewedTrade(f.service, { ...buy, quantity: '1', price: '100' });
  savePreviewedTrade(f.service, { ...buy, kind: 'sell', quantity: '1', price: '110' });
  const beforeCount = f.service.snapshot().events.length;
  const inserted = { ...buy, quantity: '2', price: '105', position: 0 };
  const preview = f.service.previewTrade(inserted);
  assert.deepEqual(preview.order, { date: '2026-09-02', position: 0, maxPosition: 2 });
  f.service.saveTrade({ ...inserted, contentToken: preview.contentToken });
  const day = f.service.records().filter(record => record.date === '2026-09-02' && !record.voided);
  assert.deepEqual(day.map(record => record.sequence), [2, 1, 0]);
  assert.equal(f.service.snapshot().events.length, beforeCount + 3);
});

test('edits preserve their position unless position is explicitly supplied', () => {
  const f = fixture(); f.service.saveOpening(opening);
  savePreviewedTrade(f.service, { ...buy, quantity: '1', price: '100' });
  savePreviewedTrade(f.service, { ...buy, quantity: '1', price: '110' });
  const target = f.service.records().find(record => record.kind === 'buy' && record.price === '100')!;
  const edit = { ...buy, quantity: '1', price: '101', recordId: target.id, expectedRevision: target.revisionId };
  const preview = f.service.previewTrade(edit);
  assert.equal(preview.order.position, target.sequence);
  f.service.saveTrade({ ...edit, contentToken: preview.contentToken });
  assert.equal(f.service.records().find(record => record.id === target.id)!.sequence, target.sequence);
});

test('stale revisions and stale preview tokens reject old page drafts', () => {
  const f = fixture(); f.service.saveOpening(opening); savePreviewedTrade(f.service, buy);
  const record = f.service.records().find(item => item.kind === 'buy')!;
  const edit = { ...buy, price: '121', recordId: record.id, expectedRevision: record.revisionId };
  const preview = f.service.previewTrade(edit);
  savePreviewedTrade(f.service, { ...buy, date: '2026-09-04', quantity: '1' });
  assert.throws(() => f.service.saveTrade({ ...edit, contentToken: preview.contentToken }), (error: unknown) => error instanceof ServiceError && error.code === 'STALE_PREVIEW');
  const current = f.service.records().find(item => item.id === record.id)!;
  const nextPreview = f.service.previewTrade({ ...edit, expectedRevision: current.revisionId });
  f.service.saveTrade({ ...edit, expectedRevision: current.revisionId, contentToken: nextPreview.contentToken });
  assert.throws(() => f.service.previewTrade(edit), (error: unknown) => error instanceof ServiceError && error.code === 'STALE_REVISION');
});

test('preview uses decimal money and historical quantity at selected date and order', () => {
  const f = fixture(); f.service.saveOpening(opening);
  savePreviewedTrade(f.service, { ...buy, date: '2026-09-02', quantity: '2', price: '120.10', fee: '0.30' });
  savePreviewedTrade(f.service, { ...buy, kind: 'sell', date: '2026-09-03', quantity: '5', price: '130', fee: '1' });
  const preview = f.service.previewTrade({ ...buy, kind: 'sell', date: '2026-09-02', position: 0, quantity: '1.5', price: '10.20', fee: '0.10' });
  assert.equal(preview.amount, '15.30');
  assert.equal(preview.fee, '0.10');
  assert.equal(preview.net, '15.20');
  assert.equal(preview.availableQuantity, '10');
  assert.equal(f.service.availableQuantity({ symbol: 'QQQ', date: '2026-09-02', position: 0 }), '10');
});

test('existing symbols auto-detect type and position detail remains available after clearing', () => {
  const f = fixture();
  f.service.saveOpening({ ...opening, symbol: 'AAPL', assetType: 'STOCK', quantity: '2', totalCost: '200' });
  savePreviewedTrade(f.service, { ...buy, kind: 'sell', symbol: 'AAPL', quantity: '2', price: '120' });
  const detail = f.service.positionDetail('AAPL');
  assert.equal(detail.assetType, 'STOCK');
  assert.equal(detail.quantity, '0');
  assert.equal(detail.records.length, 2);
  assert.deepEqual(new Set(detail.reasons), new Set(['期初确认', '加仓理由']));
});

test('opening correction and void append revisions and remain concurrency guarded', () => {
  const f = fixture(); f.service.saveOpening(opening);
  const record = f.service.records()[0];
  const correction = { ...opening, totalCost: '900', recordId: record.id, expectedRevision: record.revisionId };
  const preview = f.service.previewOpening(correction);
  f.service.saveOpening({ ...correction, contentToken: preview.contentToken });
  assert.equal(f.service.overview().positions[0].cost, '900.00');
  const current = f.service.records()[0];
  f.service.voidTrade(current.id, current.revisionId);
  assert.equal(f.service.overview().positions.length, 0);
  assert.equal(f.service.revisionHistory(record.id).length, 3);
});

test('invalid direction and cross-symbol correction have no persistence side effects', () => {
  const f = fixture(); f.service.saveOpening(opening); savePreviewedTrade(f.service, buy);
  const record = f.service.records().find(item => item.kind === 'buy')!;
  const before = f.service.exportBackup();
  assert.throws(() => f.service.previewTrade({ ...buy, kind: 'deposit' as 'buy', recordId: record.id, expectedRevision: record.revisionId }));
  assert.throws(() => f.service.previewTrade({ ...buy, symbol: 'AAPL', recordId: record.id, expectedRevision: record.revisionId }));
  assert.equal(f.service.exportBackup(), before);
});

test('clock rollback stays readable and reports the safe current cutoff', () => {
  const f = fixture(); f.service.saveOpening(opening); savePreviewedTrade(f.service, buy);
  f.setNow('2026-09-09T11:59:59.000Z');
  const view = f.service.overview();
  assert.equal(view.clockAnomaly, true);
  assert.equal(view.positions[0].quantity, '12');
  assert.doesNotThrow(() => f.service.exportBackup());
});
