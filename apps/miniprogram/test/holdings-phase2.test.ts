import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.ts';

function setup(failPrimary = false) {
  const values = new Map<string, string>();
  let id = 1200;
  const storage = {
    get: (key: string) => values.get(key) ?? '',
    set: (key: string, value: string) => {
      if (failPrimary && key === 'portfolio.wechat.v1') throw Error('quota');
      values.set(key, value);
    },
  };
  const runtime = {
    now: () => '2026-09-20T04:00:00.000Z',
    today: () => '2026-09-20',
    id: () => `92000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
  return { values, service: createService(storage, runtime) };
}

const asset = (symbol: string, currency = 'USD') => ({
  symbol,
  name: `${symbol} name`,
  market: currency === 'USD' ? 'US' : 'CN',
  currency,
  assetType: 'ETF' as const,
  status: 'unverified' as const,
});

test('screenshot rows commit as one checkpoint revision and leave omitted holdings untouched', () => {
  const f = setup();
  f.service.saveHolding({ batchId: 'manual_existing', expectedRevision: 0, observedAt: '2026-09-20T03:00:00.000Z', instrument: asset('KEEP'), quantity: '7', unitCost: '3' });
  const input = {
    batchId: 'screenshot_batch_1', expectedRevision: 1, observedAt: '2026-09-20T04:00:00.000Z',
    rows: [
      { rowId: 'row_a', instrument: asset('QQQ'), quantity: '20', unitCost: '10', replaceApproved: false, costRemovalApproved: false },
      { rowId: 'row_b', instrument: asset('SPY'), quantity: '5', unitCost: '', replaceApproved: false, costRemovalApproved: false },
    ],
  };
  const preview = f.service.previewHoldingImport(input);
  assert.equal(preview.createsTrade, false);
  assert.deepEqual(preview.rows.map(row => row.after.quantity), ['20', '5']);
  const saved = f.service.saveHoldingImport({ ...input, contentToken: preview.contentToken });
  assert.deepEqual(saved, { kind: 'committed', revision: 2, imported: 2 });
  assert.equal(f.service.snapshot().import_receipts.length, 2);
  assert.equal(f.service.snapshot().holding_checkpoints.filter(row => row.batch_id === input.batchId).length, 2);
  assert.equal(f.service.records().length, 0);
  assert.deepEqual(f.service.overview(undefined, 'USD').positions.map(row => [row.symbol, row.quantity]).sort(), [['KEEP', '7'], ['QQQ', '20'], ['SPY', '5']]);
  assert.deepEqual(f.service.saveHoldingImport({ ...input, contentToken: preview.contentToken }), { kind: 'already_applied', revision: 2, imported: 2 });
});

test('screenshot import rejects stale revision and duplicate instruments before writing', () => {
  const f = setup();
  const base = { batchId: 'screenshot_batch_2', expectedRevision: 0, observedAt: '2026-09-20T04:00:00.000Z' };
  assert.throws(() => f.service.previewHoldingImport({ ...base, rows: [
    { rowId: 'one', instrument: asset('QQQ'), quantity: '1', unitCost: '', replaceApproved: false, costRemovalApproved: false },
    { rowId: 'two', instrument: asset('QQQ'), quantity: '2', unitCost: '', replaceApproved: false, costRemovalApproved: false },
  ] }), /重复/);
  f.service.saveHolding({ batchId: 'manual_changed', expectedRevision: 0, observedAt: '2026-09-20T04:00:00.000Z', instrument: asset('KEEP'), quantity: '1', unitCost: '' });
  assert.throws(() => f.service.saveHoldingImport({ ...base, rows: [{ rowId: 'one', instrument: asset('QQQ'), quantity: '1', unitCost: '', replaceApproved: false, costRemovalApproved: false }] }), /变化|确认/);
  assert.equal(f.service.snapshot().holding_checkpoints.length, 1);
});

test('missing screenshot cost preserves an unchanged known cost and requires approval when quantity changes', () => {
  const f = setup();
  f.service.saveHolding({ batchId: 'manual_cost', expectedRevision: 0, observedAt: '2026-09-20T03:00:00.000Z', instrument: asset('QQQ'), quantity: '10', unitCost: '8' });
  const same = { batchId: 'same_quantity', expectedRevision: 1, observedAt: '2026-09-20T04:00:00.000Z', rows: [{ rowId: 'same', instrument: asset('QQQ'), quantity: '10', unitCost: '', replaceApproved: true, costRemovalApproved: false }] };
  const samePreview = f.service.previewHoldingImport(same);
  assert.equal(samePreview.rows[0].after.unitCost, '8');
  f.service.saveHoldingImport({ ...same, contentToken: samePreview.contentToken });

  const changed = { batchId: 'changed_quantity', expectedRevision: 2, observedAt: '2026-09-20T04:00:00.000Z', rows: [{ rowId: 'changed', instrument: asset('QQQ'), quantity: '12', unitCost: '', replaceApproved: true, costRemovalApproved: false }] };
  assert.throws(() => f.service.previewHoldingImport(changed), /成本.*未知|确认/);
  const approved = { ...changed, rows: [{ ...changed.rows[0], costRemovalApproved: true }] };
  const preview = f.service.previewHoldingImport(approved);
  assert.equal(preview.rows[0].before.unitCost, '8');
  assert.equal(preview.rows[0].after.unitCost, null);
});

test('storage failure cannot expose a half-imported screenshot batch', () => {
  const healthy = setup();
  const failing = setup(true);
  const input = { batchId: 'atomic_failure', expectedRevision: 0, observedAt: '2026-09-20T04:00:00.000Z', rows: [
    { rowId: 'one', instrument: asset('QQQ'), quantity: '1', unitCost: '10', replaceApproved: false, costRemovalApproved: false },
    { rowId: 'two', instrument: asset('SPY'), quantity: '2', unitCost: '20', replaceApproved: false, costRemovalApproved: false },
  ] };
  assert.equal(healthy.service.previewHoldingImport(input).rows.length, 2);
  assert.throws(() => failing.service.saveHoldingImport(input), /保存|quota|写入/);
  assert.equal(failing.service.snapshot().holding_checkpoints.length, 0);
  assert.equal(failing.service.snapshot().import_receipts.length, 0);
});
