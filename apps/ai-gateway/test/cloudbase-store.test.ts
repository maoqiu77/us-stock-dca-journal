import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@portfolio/ai-context';
import { createCloudbaseAccess, createCloudbaseRequestStore } from '../src/cloudbase-store.ts';

test('CloudBase access accepts the SDK single-document array response', async () => {
  const owner = 'trusted-openid';
  const db = {
    collection(name: string) {
      assert.equal(name, 'ai_access');
      return {
        doc(id: string) {
          assert.equal(id, sha256(owner));
          return {
            async get() { return { data: [{ owner, enabled: true, consentVersion: 1 }] }; },
          };
        },
      };
    },
  };

  assert.equal(await createCloudbaseAccess(db as never).allowed(owner), true);
});

test('CloudBase access still accepts an object response and rejects mismatched owners', async () => {
  const owner = 'trusted-openid';
  const db = {
    collection() {
      return {
        doc() {
          return {
            async get() { return { data: { owner: 'another-openid', enabled: true, consentVersion: 1 } }; },
          };
        },
      };
    },
  };

  assert.equal(await createCloudbaseAccess(db as never).allowed(owner), false);
});

test('CloudBase access can use only the hashed document identity', async () => {
  const owner = 'trusted-openid';
  const db = {
    collection() {
      return {
        doc(id: string) {
          assert.equal(id, sha256(owner));
          return { async get() { return { data: [{ enabled: true, consentVersion: 1 }] }; } };
        },
      };
    },
  };

  assert.equal(await createCloudbaseAccess(db as never).allowed(owner), true);
});

// The external SDK boundary is in-memory; production ACK logic executes unchanged.
function ackFixture() {
  const owner = 'synthetic-owner', requestId = 'synthetic-request';
  const id = sha256(`${owner}:${requestId}`);
  const rows = new Map<string, any>([
    [`ai_requests/${id}`, { owner, requestId, digest: 'input-digest', state: 'succeeded', envelope: { request: { question: 'synthetic private input' } }, response: { response_digest: 'output-digest', result: { summary: 'synthetic private output' } } }],
    [`ai_payloads/${id}`, { envelope: { request: { question: 'synthetic private input' } } }],
  ]);
  const db = {
    collection(name: string) { return { doc(key: string) {
      const path = `${name}/${key}`;
      return {
        async get() { return { data: rows.has(path) ? [structuredClone(rows.get(path))] : [] }; },
        async update({ data }: { data: any }) { rows.set(path, { ...rows.get(path), ...data }); },
        async remove() { rows.delete(path); },
      };
    } }; },
    async runTransaction<T>(fn: (tx: any) => Promise<T>) { return fn(db); },
  };
  return { store: createCloudbaseRequestStore(db as never), rows, owner, requestId, id };
}

test('CloudBase ACK erases both copies of input and the response, preserving audit metadata', async () => {
  const f = ackFixture();
  await f.store.ack(f.owner, f.requestId, 'input-digest', 'output-digest', '2026-09-13T00:00:00.000Z');
  const record = await f.store.get(f.owner, f.requestId);
  assert.equal(record?.state, 'acked');
  assert.equal(record?.digest, 'input-digest');
  assert.equal(record?.envelope == null, true);
  assert.equal(record?.response == null, true);
  assert.equal(JSON.stringify([...f.rows.values()]).includes('synthetic private'), false);
});

test('CloudBase repeated ACK validates retained digest and does not require deleted payload', async () => {
  const f = ackFixture();
  await f.store.ack(f.owner, f.requestId, 'input-digest', 'output-digest', '2026-09-13T00:00:00.000Z');
  await assert.doesNotReject(() => f.store.ack(f.owner, f.requestId, 'input-digest', 'output-digest', '2026-09-13T00:01:00.000Z'));
  await assert.rejects(() => f.store.ack(f.owner, f.requestId, 'input-digest', 'wrong-digest', '2026-09-13T00:01:00.000Z'), /DIGEST_CONFLICT/);
  await assert.rejects(() => f.store.ack('foreign-owner', f.requestId, 'input-digest', 'output-digest', '2026-09-13T00:01:00.000Z'), /NOT_FOUND/);
});
