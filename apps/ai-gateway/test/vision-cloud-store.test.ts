import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudbaseVisionTaskStore } from '../src/vision/cloudbase-store.ts';
import type { VisionTask } from '../src/vision/handler.ts';

function database() {
  const collections = new Map<string, Map<string, any>>();
  const collection = (name: string) => {
    const rows = collections.get(name) ?? new Map<string, any>(); collections.set(name, rows);
    return {
      doc(id: string) { return { async get() { const value = rows.get(id); return { data: value ? { _id: id, ...value } : undefined }; }, async set({ data }: any) { if ('_id' in data) throw Error('CANNOT_UPDATE_ID'); rows.set(id, { ...data }); }, async update({ data }: any) { const value = rows.get(id); if (!value) throw Error('NOT_FOUND'); rows.set(id, { ...value, ...data }); } }; },
      where(query: any) { return { limit() { return { async get() { return { data: [...rows.values()].filter(row => Object.entries(query).every(([key, expected]: any) => expected?.$lte !== undefined ? row[key] <= expected.$lte : row[key] === expected)) }; } }; } }; },
    };
  };
  return { collection, runTransaction: async (fn: any) => fn({ collection }), command: { lte: (value: string) => ({ $lte: value }) } };
}

const task = (id: string, uploadRequestId = 'upload_req_1'): VisionTask => ({ id, owner: 'owner-a', uploadRequestId, recognitionRequestId: null, cloudPath: `private/${id}.png`, objectRef: null, expectedMime: 'image/png', expectedBytes: 10, createdAt: '2026-09-20T04:00:00.000Z', expiresAt: '2026-09-20T04:10:00.000Z', state: 'created', response: null, errorCode: null, cleanupPending: false, objectCleaned: false });

test('CloudBase vision store atomically owns upload and recognition identities', async () => {
  const store = createCloudbaseVisionTaskStore(database() as any), original = task('task-1');
  assert.equal((await store.create(original)).kind, 'created');
  assert.equal((await store.create({ ...original, id: 'task-2' })).kind, 'existing');
  assert.equal((await store.create({ ...original, id: 'task-3', expectedBytes: 11 })).kind, 'conflict');
  assert.equal(await store.get('owner-b', original.id), undefined);
  assert.equal((await store.bindObject('owner-a', original.id, 'cloud://test.env/private/task-1.png'))?.objectRef, 'cloud://test.env/private/task-1.png');
  assert.equal((await store.claim('owner-a', original.id, 'recognize_1', '2026-09-20T04:01:00.000Z', 2, 1)).kind, 'claimed');
  assert.equal((await store.claim('owner-a', original.id, 'recognize_1', '2026-09-20T04:01:00.000Z', 2, 1)).kind, 'existing');
  assert.equal((await store.claim('owner-a', original.id, 'recognize_2', '2026-09-20T04:01:00.000Z', 2, 1)).kind, 'conflict');
  const response = { requestId: 'recognize_1', status: 'review_required' as const, rows: [] };
  assert.equal((await store.complete('owner-a', original.id, 'recognize_1', response)).state, 'completed');
  const second = task('task-2', 'upload_req_2');
  assert.equal((await store.create(second)).kind, 'created');
  assert.equal((await store.claim('owner-a', second.id, 'recognize_2', '2026-09-20T04:02:00.000Z', 2, 1)).kind, 'claimed');
  await store.complete('owner-a', second.id, 'recognize_2', { ...response, requestId: 'recognize_2' });
  const third = task('task-3', 'upload_req_3');
  assert.equal((await store.create(third)).kind, 'created');
  assert.equal((await store.claim('owner-a', third.id, 'recognize_3', '2026-09-20T04:03:00.000Z', null, 1)).kind, 'claimed');
});

test('CloudBase vision cleanup index retains no image bytes and supports retry candidates', async () => {
  const db = database(), store = createCloudbaseVisionTaskStore(db as any), original = task('task-4', 'upload_req_4');
  await store.create(original);
  await store.markCleanup('owner-a', original.id, true);
  const candidates = await store.cleanupCandidates('2026-09-20T04:02:00.000Z');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].cloudPath, original.cloudPath);
  assert.equal(JSON.stringify(candidates).includes('base64'), false);
  await store.markCleanup('owner-a', original.id, false);
  assert.deepEqual(await store.cleanupCandidates('2026-09-20T04:02:00.000Z'), []);
});
