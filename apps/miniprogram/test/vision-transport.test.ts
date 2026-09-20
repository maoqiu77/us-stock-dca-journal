import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudVisionTransport } from '../src/vision/cloud-transport.ts';

test('vision transport uploads only to the server-issued private path before requesting a review draft', async () => {
  const calls: any[] = [];
  const callFunction = async ({ data }: any) => {
    calls.push(data);
    if (data.action === 'visionCapabilities') return { result: { ok: true, data: { enabled: true, providerConfigured: true, maxBytes: 4194304, maxRows: 20 } } };
    if (data.action === 'createHoldingUpload') return { result: { ok: true, data: { uploadTaskId: 'task_12345678', cloudPath: 'holding-imports/hash/task.png', expiresAt: '2026-09-20T05:00:00.000Z', maxBytes: 4194304 } } };
    if (data.action === 'completeHoldingUpload') return { result: { ok: true, data: { uploaded: true } } };
    if (data.action === 'recognizeHoldings') return { result: { ok: true, data: { requestId: data.requestId, status: 'review_required', rows: [{ name: 'QQQ', code: 'QQQ', quantityText: '20', unitCostText: null, costBasis: 'unknown', currency: 'USD', accountLabel: null }] } } };
    throw Error('unexpected action');
  };
  const uploads: any[] = [];
  const transport = createCloudVisionTransport(callFunction, async input => { uploads.push(input); return { fileID: `cloud://env/${input.cloudPath}` }; }, 'portfolioAi');
  assert.equal((await transport.capabilities()).providerConfigured, true);
  const result = await transport.recognizeFile({ uploadRequestId: 'upload_12345678', recognitionRequestId: 'recognize_12345678', tempFilePath: '/tmp/private.png', size: 123, mimeType: 'image/png' });
  assert.equal(result.rows[0].code, 'QQQ');
  assert.deepEqual(uploads, [{ cloudPath: 'holding-imports/hash/task.png', filePath: '/tmp/private.png' }]);
  assert.deepEqual(calls.map(call => call.action), ['visionCapabilities', 'createHoldingUpload', 'completeHoldingUpload', 'recognizeHoldings']);
  assert.equal(JSON.stringify(calls).includes('/tmp/private.png'), false);
  assert.equal(JSON.stringify(calls).includes('base64'), false);
});

test('vision transport cancels the server task when private upload fails', async () => {
  const actions: string[] = [];
  const callFunction = async ({ data }: any) => {
    actions.push(data.action);
    if (data.action === 'createHoldingUpload') return { result: { ok: true, data: { uploadTaskId: 'task_12345678', cloudPath: 'holding-imports/hash/task.png', expiresAt: '2026-09-20T05:00:00.000Z', maxBytes: 4194304 } } };
    if (data.action === 'cancelHoldingUpload') return { result: { ok: true, data: { cancelled: true } } };
    throw Error('unexpected action');
  };
  const transport = createCloudVisionTransport(callFunction, async () => { throw Error('upload failed'); }, 'portfolioAi');
  await assert.rejects(() => transport.recognizeFile({ uploadRequestId: 'upload_12345678', recognitionRequestId: 'recognize_12345678', tempFilePath: '/tmp/private.png', size: 123, mimeType: 'image/png' }), /upload failed|VISION_UPLOAD_FAILED/);
  assert.deepEqual(actions, ['createHoldingUpload', 'cancelHoldingUpload']);
});
