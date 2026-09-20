import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupExpiredVisionTasks, createHoldingVisionHandler, createMemoryVisionTaskStore, type HoldingVisionProvider } from '../src/vision/handler.ts';

const context = { appId: 'wx-test', openId: 'owner-a', source: 'wechat-miniprogram' as const };
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

function fixture(output: unknown = { rows: [{ name: 'Invesco QQQ', code: 'QQQ', quantityText: '20', unitCostText: '10.5', costBasis: 'average_cost', currency: 'USD', accountLabel: null }], truncated: false }, removeFails = false, dailyLimit: number | null = 3) {
  let providerCalls = 0, removeCalls = 0, ids = 0;
  const objects = new Map<string, Uint8Array>();
  const store = createMemoryVisionTaskStore();
  const provider: HoldingVisionProvider = { configured: () => true, async recognize() { providerCalls++; if (output instanceof Error) throw output; return output; } };
  const objectStore = {
    async read(path: string) { const value = objects.get(path); if (!value) throw Error('OBJECT_NOT_FOUND'); return value; },
    async remove(path: string) { removeCalls++; if (removeFails && removeCalls === 1) throw Error('DELETE_FAILED'); objects.delete(path); },
  };
  const handler = createHoldingVisionHandler({
    config: { expectedAppId: 'wx-test', enabled: true, maxBytes: 4 * 1024 * 1024, maxPixels: 20_000_000, maxRows: 20, timeoutMs: 30_000, taskTtlMs: 60_000, dailyLimit, maxInflight: 1 },
    store, objectStore, provider, now: () => '2026-09-20T04:00:00.000Z', id: () => `93000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  async function create(requestId = `upload_${ids + 1}`, bytes = png) {
    const result = await handler({ action: 'createHoldingUpload', requestId, contentLength: bytes.length, mimeType: 'image/png' }, context);
    assert.equal(result.ok, true);
    const task = (result as any).data;
    const fileId = `cloud://test.env/${task.cloudPath}`;
    objects.set(fileId, bytes);
    const bound = await handler({ action: 'completeHoldingUpload', uploadTaskId: task.uploadTaskId, fileId }, context);
    assert.equal(bound.ok, true);
    return task;
  }
  return { handler, store, objects, objectStore, create, counts: () => ({ providerCalls, removeCalls }) };
}

test('trusted upload ownership is required and another user cannot recognize a task', async () => {
  const f = fixture(), task = await f.create();
  const forged = await f.handler({ action: 'recognizeHoldings', requestId: 'recognize_1', uploadTaskId: task.uploadTaskId }, { ...context, openId: 'owner-b' });
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.error.code, 'VISION_TASK_NOT_FOUND');
  assert.deepEqual(f.counts(), { providerCalls: 0, removeCalls: 0 });
  const badApp = await f.handler({ action: 'recognizeHoldings', requestId: 'recognize_1', uploadTaskId: task.uploadTaskId }, { ...context, appId: 'forged' });
  assert.equal(badApp.ok, false);
});

test('actual image bytes and pixel dimensions are checked before the provider and always enter cleanup', async () => {
  const disguised = fixture(), disguisedTask = await disguised.create('upload_bad', Uint8Array.from([1, 2, 3, 4]));
  const invalid = await disguised.handler({ action: 'recognizeHoldings', requestId: 'recognize_bad', uploadTaskId: disguisedTask.uploadTaskId }, context);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'VISION_IMAGE_INVALID');
  assert.deepEqual(disguised.counts(), { providerCalls: 0, removeCalls: 1 });

  const huge = fixture();
  const bytes = png.slice();
  bytes[16] = 0x7f; bytes[17] = 0xff; bytes[18] = 0xff; bytes[19] = 0xff;
  const hugeTask = await huge.create('upload_huge', bytes);
  const rejected = await huge.handler({ action: 'recognizeHoldings', requestId: 'recognize_huge', uploadTaskId: hugeTask.uploadTaskId }, context);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'VISION_IMAGE_INVALID');
  assert.deepEqual(huge.counts(), { providerCalls: 0, removeCalls: 1 });
});

test('model output is a strict review draft and never accepts IDs, numeric codes or silent truncation', async () => {
  for (const output of [
    { rows: [{ name: 'QQQ', code: 'QQQ', quantityText: '1', unitCostText: null, costBasis: 'unknown', currency: 'USD', accountLabel: null, instrumentId: 'forged' }], truncated: false },
    { rows: [{ name: 'fund', code: 1234, quantityText: '1', unitCostText: null, costBasis: 'unknown', currency: 'CNY', accountLabel: null }], truncated: false },
    { rows: Array.from({ length: 21 }, (_, index) => ({ name: `row ${index}`, code: String(index), quantityText: '1', unitCostText: null, costBasis: 'unknown', currency: 'USD', accountLabel: null })), truncated: false },
    { rows: [], truncated: true },
  ]) {
    const f = fixture(output), task = await f.create();
    const result = await f.handler({ action: 'recognizeHoldings', requestId: 'recognize_invalid', uploadTaskId: task.uploadTaskId }, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.code, /^VISION_OUTPUT_|VISION_ROWS_TRUNCATED$/);
    assert.equal(f.counts().removeCalls, 1);
  }
});

test('invalid schema and empty rows have distinct private diagnostics, with cleanup', async () => {
  for (const [output, expected] of [
    [{ rows: [], truncated: false }, 'VISION_OUTPUT_EMPTY'],
    [{ rows: [{ code: 123 }], truncated: false }, 'VISION_OUTPUT_SCHEMA_INVALID'],
  ] as const) {
    const f = fixture(output), task = await f.create();
    const result = await f.handler({ action: 'recognizeHoldings', requestId: 'recognize_diagnostic', uploadTaskId: task.uploadTaskId }, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, expected);
    assert.equal(f.counts().removeCalls, 1);
  }
});

test('read and provider failures use separate metadata-only diagnostics', async () => {
  const read = fixture(), readTask = await read.create('upload_read_failure');
  read.objectStore.read = async () => { throw Error('PRIVATE_OBJECT_ERROR'); };
  const readResult = await read.handler({ action: 'recognizeHoldings', requestId: 'recognize_read_failure', uploadTaskId: readTask.uploadTaskId }, context);
  assert.equal((readResult as any).error.code, 'VISION_OBJECT_READ_FAILED');
  assert.equal(read.counts().removeCalls, 1);
  const provider = fixture(Error('PRIVATE_NETWORK_ERROR')), providerTask = await provider.create('upload_provider_failure');
  const providerResult = await provider.handler({ action: 'recognizeHoldings', requestId: 'recognize_provider_failure', uploadTaskId: providerTask.uploadTaskId }, context);
  assert.equal((providerResult as any).error.code, 'VISION_PROVIDER_NETWORK');
  assert.equal(provider.counts().removeCalls, 1);
});

test('same recognition request returns one review draft and invokes the provider once', async () => {
  const f = fixture(), task = await f.create();
  const event = { action: 'recognizeHoldings', requestId: 'recognize_same', uploadTaskId: task.uploadTaskId };
  const first = await f.handler(event, context);
  const second = await f.handler(event, context);
  assert.deepEqual(second, first);
  assert.equal((first as any).data.status, 'review_required');
  assert.equal((first as any).data.rows[0].code, 'QQQ');
  assert.deepEqual(f.counts(), { providerCalls: 1, removeCalls: 1 });
});

test('null daily limit allows repeated sequential recognition while retaining inflight control', async () => {
  const f = fixture(undefined, false, null);
  for (let index = 0; index < 5; index++) {
    const task = await f.create(`upload_unlimited_${index}`);
    const result = await f.handler({ action: 'recognizeHoldings', requestId: `recognize_unlimited_${index}`, uploadTaskId: task.uploadTaskId }, context);
    assert.equal(result.ok, true);
  }
  assert.equal(f.counts().providerCalls, 5);
});

test('cancel prevents recognition and failed deletion is recoverable by expiry cleanup', async () => {
  const cancelled = fixture(), cancelTask = await cancelled.create();
  assert.equal((await cancelled.handler({ action: 'cancelHoldingUpload', uploadTaskId: cancelTask.uploadTaskId }, context)).ok, true);
  const late = await cancelled.handler({ action: 'recognizeHoldings', requestId: 'recognize_late', uploadTaskId: cancelTask.uploadTaskId }, context);
  assert.equal(late.ok, false);
  assert.equal(cancelled.counts().providerCalls, 0);

  const retry = fixture(undefined, true), retryTask = await retry.create();
  const completed = await retry.handler({ action: 'recognizeHoldings', requestId: 'recognize_cleanup', uploadTaskId: retryTask.uploadTaskId }, context);
  assert.equal(completed.ok, true);
  assert.equal((await retry.store.get('owner-a', retryTask.uploadTaskId))?.cleanupPending, true);
  const swept = await cleanupExpiredVisionTasks(retry.store, retry.objectStore, '2026-09-20T04:02:00.000Z');
  assert.equal(swept.cleaned, 1);
  assert.equal((await retry.store.get('owner-a', retryTask.uploadTaskId))?.cleanupPending, false);
  assert.equal(retry.counts().removeCalls, 2);
});

test('vision response preserves screenshot returns and NAV date as distinct fields', async () => {
  const row = { name: 'Example fund', code: '012345', quantityText: '1000', unitCostText: '2', costBasis: 'average_cost', currency: 'CNY', accountLabel: null, marketValueText: '2,040.00', holdingPnlText: '+40.00', holdingReturnRateText: '+2.00%', dailyChangeRateText: '-0.50%', navText: '2.0400', navDateText: '09-18' };
  const f = fixture({ rows: [row], truncated: false }), task = await f.create();
  const result = await f.handler({ action: 'recognizeHoldings', requestId: 'recognize_metrics', uploadTaskId: task.uploadTaskId }, context);
  assert.equal(result.ok, true);
  assert.deepEqual((result as any).data.rows[0], row);
});
