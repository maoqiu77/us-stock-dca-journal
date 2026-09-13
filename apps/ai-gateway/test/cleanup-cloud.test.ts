import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const now = '2026-09-13T12:00:00.000Z';
function fixture(retention = '86400000') {
  const rows = new Map<string, any>([
    ['ai_requests/old', { _id: 'old', owner: 'synthetic-a', state: 'succeeded', createdAt: '2026-09-12T11:00:00.000Z', envelope: { question: 'private fixture' }, response: { response_digest: 'digest', result: 'private fixture' } }],
    ['ai_payloads/old', { _id: 'old', expiresAt: '2026-09-12T11:10:00.000Z', envelope: 'private fixture' }],
    ['ai_requests/acked', { _id: 'acked', owner: 'synthetic-b', state: 'acked', createdAt: '2026-09-12T10:00:00.000Z', envelope: 'legacy input', response: null }],
    ['ai_requests/recent', { _id: 'recent', state: 'succeeded', createdAt: '2026-09-13T11:00:00.000Z', envelope: 'keep' }],
    ['ai_requests/running', { _id: 'running', state: 'running', createdAt: '2026-09-11T11:00:00.000Z', envelope: 'keep' }],
    ['ai_requests/unknown', { _id: 'unknown', state: 'outcome_unknown', createdAt: '2026-09-11T11:00:00.000Z', envelope: 'remove unknown body' }],
    ['ai_usage/counter', { count: 3, inflight: 1 }],
    ['ai_turn_keys/key', { digest: 'keep' }],
  ]);
  let reads = 0;
  const db = {
    command: { lt: (v: string) => (x: any) => x < v, gt: (v: string) => (x: any) => x > v, in: (v: string[]) => (x: any) => v.includes(x), exists: (v: boolean) => (x: any) => (x !== undefined) === v },
    collection(name: string) {
      return {
        doc(id: string) {
          const key = `${name}/${id}`;
          return {
            async get() { reads++; return { data: rows.has(key) ? structuredClone(rows.get(key)) : null }; },
            async update({ data }: { data: any }) { rows.set(key, { ...rows.get(key), ...data }); },
            async remove() { rows.delete(key); },
          };
        },
        where(filter: Record<string, any>) {
          let fields: Record<string, boolean> | undefined;
          let limit = 100;
          let orderField: string | undefined;
          const query = {
            orderBy(field: string, direction: string) { assert.equal(direction, 'asc'); orderField = field; return query; },
            field(value: Record<string, boolean>) { fields = value; return query; },
            limit(value: number) { limit = value; return query; },
            async get() {
              reads++;
              const data = [...rows.entries()].filter(([key, row]) => key.startsWith(`${name}/`) && Object.entries(filter).every(([k, v]) => typeof v === 'function' ? v(row[k]) : row[k] === v)).sort((a, b) => orderField ? String(a[1][orderField]).localeCompare(String(b[1][orderField])) : 0).slice(0, limit).map(([, row]) => fields ? Object.fromEntries(Object.keys(fields).filter(k => fields![k]).map(k => [k, row[k]])) : structuredClone(row));
              return { data };
            },
          };
          return query;
        },
      };
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>) { return fn(db); },
  };
  const exports: any = {};
  class Clock extends Date { static now() { return Date.parse(now); } }
  runInNewContext(readFileSync(new URL('../cloud/portfolioAiCleanup/index.js', import.meta.url), 'utf8'), {
    exports, require: (name: string) => { assert.equal(name, 'wx-server-sdk'); return { init() {}, DYNAMIC_CURRENT_ENV: 'test', database: () => db }; },
    process: { env: { CLEANUP_JOB_TOKEN: 'synthetic-test-token', AI_PAYLOAD_RETENTION_MS: retention } }, Date: Clock,
  });
  return { main: exports.main, rows, reads: () => reads };
}

test('cleanup accepts authenticated timer Message and purges both body copies, including legacy ACK input', async () => {
  const f = fixture();
  await f.main({ Type: 'Timer', Message: JSON.stringify({ token: 'synthetic-test-token' }) });
  assert.equal(f.rows.get('ai_requests/old').envelope, null);
  assert.equal(f.rows.get('ai_requests/old').response, null);
  assert.equal(f.rows.get('ai_requests/old').responseDigest, 'digest');
  assert.equal(f.rows.get('ai_requests/old').state, 'expired');
  assert.equal(f.rows.has('ai_payloads/old'), false);
  assert.equal(f.rows.get('ai_requests/acked').envelope, null);
  assert.equal(f.rows.get('ai_requests/acked').state, 'acked');
  assert.equal(f.rows.get('ai_requests/unknown').envelope, null);
  assert.equal(f.rows.get('ai_requests/unknown').state, 'outcome_unknown');
  assert.equal(f.rows.get('ai_requests/recent').envelope, 'keep');
  assert.equal(f.rows.get('ai_requests/running').envelope, 'keep');
  assert.deepEqual(f.rows.get('ai_usage/counter'), { count: 3, inflight: 1 });
  assert.deepEqual(f.rows.get('ai_turn_keys/key'), { digest: 'keep' });
  const after = JSON.stringify([...f.rows]);
  await f.main({ token: 'synthetic-test-token' });
  assert.equal(JSON.stringify([...f.rows]), after);
});

test('cleanup rejects missing/forged timer credentials before any database access', async () => {
  for (const event of [undefined, {}, { Type: 'Timer' }, { Type: 'Timer', Message: '{bad' }, { token: 'wrong' }]) {
    const f = fixture();
    await assert.rejects(() => f.main(event), /UNAUTHORIZED_CLEANUP/);
    assert.equal(f.reads(), 0);
  }
});

test('invalid retention cannot cause premature deletion', async () => {
  for (const retention of ['0', '-1', 'NaN', 'Infinity', '1.5']) {
    const f = fixture(retention), before = JSON.stringify([...f.rows]);
    await assert.rejects(() => f.main({ token: 'synthetic-test-token' }), /INVALID_AI_PAYLOAD_RETENTION_MS/);
    assert.equal(f.reads(), 0);
    assert.equal(JSON.stringify([...f.rows]), before);
  }
});


test('retained running payloads cannot starve orphan cleanup beyond the first page', async () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) {
    const id = `a-${String(i).padStart(3, '0')}`;
    f.rows.set(`ai_requests/${id}`, { _id: id, state: 'running', createdAt: '2026-09-11T00:00:00.000Z' });
    f.rows.set(`ai_payloads/${id}`, { _id: id, expiresAt: '2026-09-11T00:10:00.000Z', envelope: 'keep running' });
  }
  f.rows.set('ai_payloads/z-orphan', { _id: 'z-orphan', expiresAt: '2026-09-11T00:10:00.000Z', envelope: 'orphan' });
  await f.main({ token: 'synthetic-test-token' });
  assert.equal(f.rows.has('ai_payloads/z-orphan'), false);
  assert.equal(f.rows.get('ai_payloads/a-000').envelope, 'keep running');
});
