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

test('screenshot performance survives persistence and backup without becoming a live quote or realized profit', () => {
  const f = setup();
  const screenshotMetrics = { marketValueText: '2,040.00', holdingPnlText: '+40.00', holdingReturnRateText: '+2.00%', dailyChangeRateText: '-0.50%', navText: '2.0400', navDateText: '09-18' };
  const input = { batchId: 'screenshot_metrics_1', expectedRevision: 0, observedAt: '2026-09-20T04:00:00.000Z', rows: [{ rowId: 'one', instrument: { ...asset('012345', 'CNY'), assetType: 'FUND' as const }, quantity: '1000', unitCost: '2', screenshotMetrics }] };
  const preview = f.service.previewHoldingImport(input);
  f.service.saveHoldingImport({ ...input, contentToken: preview.contentToken });
  assert.deepEqual(f.service.snapshot().holding_checkpoints[0].screenshot_metrics, screenshotMetrics);
  const detail = f.service.positionDetail('012345');
  assert.deepEqual(detail.screenshotMetrics, screenshotMetrics);
  assert.equal(detail.realized, null); assert.equal(detail.marketPrice, null);
  assert.equal(f.service.overview().marketValue, null);
  assert.equal(f.service.records().length, 0);
  assert.throws(() => f.service.saveHoldingImport({ ...input, rows: [{ ...input.rows[0], screenshotMetrics: { ...screenshotMetrics, holdingReturnRateText: '+3%' } }] }), /变化|检查/);
  const backup = f.service.exportFullBackup();
  assert.match(backup, /holdingReturnRateText/);
  const restored = setup();
  restored.service.restoreCompleteBackup(backup);
  assert.deepEqual(restored.service.positionDetail('012345').screenshotMetrics, screenshotMetrics);
});

test('invalid screenshot percentages are rejected before writing and zero is preserved', () => {
  const f = setup();
  const input = { batchId: 'screenshot_metrics_2', expectedRevision: 0, observedAt: '2026-09-20T04:00:00.000Z', rows: [{ rowId: 'one', instrument: asset('TEST'), quantity: '1', screenshotMetrics: { dailyChangeRateText: 'unknown' } }] };
  assert.throws(() => f.service.previewHoldingImport(input), /百分比/);
  assert.equal(f.service.snapshot().holding_checkpoints.length, 0);
  input.rows[0].screenshotMetrics.dailyChangeRateText = '0.00%';
  f.service.saveHoldingImport(input);
  assert.equal(f.service.positionDetail('TEST').screenshotMetrics?.dailyChangeRateText, '0.00%');
});

test('minimal fund screenshot imports without cost or performance fields', () => {
  const f = setup();
  const input = { batchId: 'minimal_fund_001', expectedRevision: 0, observedAt: '2026-09-20T04:00:00.000Z', rows: [{ rowId: 'fund', instrument: { ...asset('012345', 'CNY'), assetType: 'FUND' as const }, quantity: '12' }] };
  const preview = f.service.previewHoldingImport(input);
  f.service.saveHoldingImport({ ...input, contentToken: preview.contentToken });
  const detail = f.service.positionDetail('012345');
  assert.equal(detail.quantity, '12');
  assert.equal(detail.cost, null); assert.equal(detail.realized, null);
  assert.equal(detail.screenshotMetrics, null);
});

test('overview display totals include screenshot values with independent coverage and currency isolation', () => {
  const f = setup();
  f.service.saveHoldingImport({ batchId: 'display_totals_001', expectedRevision: 0, observedAt: '2026-09-20T04:00:00.000Z', rows: [
    { rowId: 'one', instrument: asset('012345', 'CNY'), quantity: '1', screenshotMetrics: { marketValueText: '1,200.10', holdingPnlText: '+100.20' } },
    { rowId: 'two', instrument: asset('012346', 'CNY'), quantity: '1', screenshotMetrics: { marketValueText: '200.20', holdingPnlText: '-100.20' } },
    { rowId: 'three', instrument: asset('012347', 'CNY'), quantity: '1' },
    { rowId: 'usd', instrument: asset('USDTEST'), quantity: '1', screenshotMetrics: { marketValueText: '30.00', holdingPnlText: '2.00' } },
  ] });
  const cny = f.service.overview(undefined, 'CNY');
  assert.deepEqual(cny.displayAmount, { value: '1400.30', covered: 2, screenshots: 2, partial: true });
  assert.equal(cny.displayPnl.value, '0.00');
  assert.equal(cny.displayIncludesScreenshots, true);
  assert.equal(cny.marketValue, null);
  const usd = f.service.overview(undefined, 'USD');
  assert.equal(usd.displayAmount.value, '30.00'); assert.equal(usd.displayPnl.value, '2.00'); assert.equal(usd.displayAmount.partial, false);
});

test('deleted funds can be reimported together without replacement approval or duplicate quantities', () => {
  const f = setup();
  const rows = ['012345', '012346'].map((symbol, index) => ({ rowId: `fund_${index}`, instrument: { ...asset(symbol, 'CNY'), assetType: 'FUND' as const }, quantity: String(index + 2), unitCost: '10', screenshotMetrics: { holdingPnlText: '+1.00' } }));
  const observedAt = '2026-09-20T04:00:00.000Z';
  f.service.saveHoldingImport({ batchId: 'initial_fund_batch', expectedRevision: 0, observedAt, rows });
  const originalIds = f.service.overview().positions.map(item => item.id).sort();
  for (const row of rows) f.service.saveHolding({ batchId: `delete_${row.rowId}`, expectedRevision: f.service.snapshot().revision, observedAt, instrument: row.instrument, quantity: '0', replaceApproved: true });
  assert.equal(f.service.overview().positions.length, 0);
  const input = { batchId: 'reimport_fund_batch', expectedRevision: f.service.snapshot().revision, observedAt, rows: rows.map(row => ({ ...row, unitCost: '', replaceApproved: false })) };
  const preview = f.service.previewHoldingImport(input);
  assert.deepEqual(preview.rows.map(row => row.before.quantity), ['0', '0']);
  f.service.saveHoldingImport({ ...input, contentToken: preview.contentToken });
  assert.deepEqual(f.service.overview().positions.map(item => item.id).sort(), originalIds);
  assert.deepEqual(f.service.overview().positions.map(item => item.quantity).sort(), ['2', '3']);
  assert.equal(f.service.positionDetail('012345').cost, null);
  assert.equal(f.service.records().length, 0);
  assert.equal(f.service.saveHoldingImport(input).kind, 'already_applied');
  assert.throws(() => f.service.previewHoldingImport({ ...input, batchId: 'active_fund_batch', expectedRevision: f.service.snapshot().revision }), /已有持仓/);
});

test('manual readdition after deletion needs no replacement approval', () => {
  const f = setup(), instrument = asset('012349', 'CNY'), observedAt = '2026-09-20T04:00:00.000Z';
  f.service.saveHolding({ batchId: 'manual_before_delete', expectedRevision: 0, observedAt, instrument, quantity: '4' });
  f.service.saveHolding({ batchId: 'manual_delete_zero', expectedRevision: 1, observedAt, instrument, quantity: '0', replaceApproved: true });
  f.service.saveHolding({ batchId: 'manual_after_delete', expectedRevision: 2, observedAt, instrument, quantity: '5' });
  assert.equal(f.service.overview().positions[0].quantity, '5');
});
