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

test('CloudBase public consent is server-recorded without exposing the owner identity', async () => {
  const owner = 'trusted-openid', rows = new Map<string, any>();
  const db = { collection() { return { doc(id: string) { return { async get() { return { data: rows.get(id) ?? [] }; }, async set({ data }: { data: any }) { rows.set(id, [data]); } }; } }; } };
  const access = createCloudbaseAccess(db as never);
  assert.deepEqual(await access.status(owner, 'public', 1), { enrolled: true, consented: false, allowed: false });
  await access.accept(owner, 'public', 1, '2026-09-13T00:00:00.000Z');
  assert.deepEqual(await access.status(owner, 'public', 1), { enrolled: true, consented: true, allowed: true });
  assert.equal(JSON.stringify([...rows.values()]).includes(owner), false);
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

test('existing beta consent updates fields without writing immutable SDK document id', async () => {
 const owner='synthetic-beta';let row:any={_id:sha256(owner),enabled:true,owner,consentVersion:1};
 const db={collection:()=>({doc:()=>({get:async()=>({data:[row]}),set:async()=>{throw Error('existing document must update');},update:async({data}:any)=>{assert.equal('_id' in data,false);row={...row,...data};}})})};
 const access=createCloudbaseAccess(db as never);
 assert.equal((await access.status(owner,'closed_beta',1)).enrolled,true);
 await access.accept(owner,'closed_beta',1,'2026-09-20T15:00:00.000Z');
 assert.equal((await access.status(owner,'closed_beta',1)).allowed,true);assert.equal(row.owner,owner);
 await assert.rejects(()=>access.accept('different-owner','closed_beta',1,'2026-09-20T15:00:00.000Z'),/ACCESS_DENIED/);
});

test('durable lifetime quota seeds historical audit rows and atomically enforces the last credit', async () => {
  const owner = 'synthetic-quota-owner', rows = new Map<string, any>();
  let queue = Promise.resolve();
  const db: any = {
    collection(name: string) { return {
      where(query: any) { return { count: async () => ({ total: [...rows].filter(([key, value]) => key.startsWith(name + '/') && value.owner === query.owner).length }) }; },
      doc(id: string) { const key = `${name}/${id}`; return {
        get: async () => ({ data: rows.has(key) ? [structuredClone(rows.get(key))] : [] }),
        set: async ({ data }: any) => { rows.set(key, structuredClone(data)); },
        update: async ({ data }: any) => { rows.set(key, { ...rows.get(key), ...data }); },
      }; },
    }; },
    async runTransaction(fn: any) { const previous = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; }); await previous; try { return await fn(db); } finally { release(); } },
  };
  for (let n = 0; n < 19; n++) rows.set(`ai_requests/old-${n}`, { owner, state: 'acked' });
  const store = createCloudbaseRequestStore(db);
  assert.equal((await store.usage(owner, '2026-09-21T00:00:00Z', true)).totalUsed, 19);
  const input = (n: number) => ({ owner, envelope: { payload_digest: `digest-${n}`, request: { request_id: `request-${n}`, workspace_instance_id: `workspace-${n}`, client_turn_id: `turn-${n}` }, expires_at: '2026-09-22T00:00:00Z' } as any, now: '2026-09-21T00:00:00Z', dailyLimit: 10, lifetimeLimit: 20, maxInflight: 5, executionToken: `token-${n}` });
  const results = await Promise.all([store.claim(input(1)), store.claim(input(2))]);
  assert.equal(results.filter(item => item.kind === 'claimed').length, 1);
  assert.equal(results.filter(item => item.kind === 'quota').length, 1);
  assert.equal((await store.claim(input(1))).kind, 'existing');
  assert.equal((await store.usage(owner, '2026-10-01T00:00:00Z', true)).totalUsed, 20);
  // Payload / local data removal cannot recreate free credits.
  rows.delete('ai_payloads/' + sha256(`${owner}:request-1`));
  assert.equal((await store.claim({ ...input(3), now: '2026-10-01T00:00:00Z' })).kind, 'quota');
  assert.equal((await store.claim({ ...input(4), lifetimeLimit: null })).kind, 'claimed');
  assert.equal((await store.usage(owner, '2026-10-01T00:00:00Z', true)).totalUsed, 21);
});

test('unreadable lifetime counter fails closed instead of resetting credits', async () => {
  const db: any = { collection: () => ({ doc: () => ({ get: async () => { throw Error('NETWORK_FAILURE'); } }) }) };
  await assert.rejects(createCloudbaseRequestStore(db).usage('owner', '2026-09-21', true), /NETWORK_FAILURE/);
});
