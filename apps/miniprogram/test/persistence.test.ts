import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { activeEvents, clockState, emptySnapshot, projection, validateSnapshot } from '../src/model.ts';
import { createRepository, MIGRATION_KEY, STORAGE_KEY, type StoragePort } from '../src/repository.ts';

const v1BackupText = readFileSync(new URL('./fixtures/v1-backup.json', import.meta.url), 'utf8');
const fixed = (now = '2026-09-10T12:00:00.000Z', today = '2026-09-10') => ({
  now: () => now, today: () => today, id: () => '20000000-0000-4000-8000-000000000001',
});
function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: StoragePort = { get: key => values.get(key) ?? '', set: (key, value) => { values.set(key, value); } };
  return { values, storage };
}

test('strict v1 parsing migrates deterministically to v2 and protects original bytes before switching', () => {
  const raw = JSON.stringify(JSON.parse(v1BackupText).data);
  const f = memory({ [STORAGE_KEY]: raw });
  const data = createRepository(f.storage, fixed()).read();
  assert.equal(data.version, 2);
  assert.equal(f.values.get(MIGRATION_KEY), raw);
  assert.equal(JSON.parse(f.values.get(STORAGE_KEY)!).version, 2);
  const again = memory({ [STORAGE_KEY]: raw });
  assert.deepEqual(createRepository(again.storage, fixed()).read(), data);
  assert.equal(again.values.get(STORAGE_KEY), f.values.get(STORAGE_KEY));
});

test('failed migration backup leaves the original v1 primary bytes untouched', () => {
  const raw = JSON.stringify(JSON.parse(v1BackupText).data);
  const f = memory({ [STORAGE_KEY]: raw });
  const storage: StoragePort = { get: f.storage.get, set(key, value) { if (key === MIGRATION_KEY) throw Error('quota'); f.storage.set(key, value); } };
  assert.throws(() => createRepository(storage, fixed()).read(), /升级/);
  assert.equal(f.values.get(STORAGE_KEY), raw);
});

test('v1 remains strict while v2 accepts opening positions', () => {
  const envelope = JSON.parse(v1BackupText);
  envelope.data.events[0] = { ...envelope.data.events[0], kind: 'opening_position', trade_date: '1970-01-01', quantity: '10', total_cost: '1000' };
  delete envelope.data.events[0].price; delete envelope.data.events[0].amount; delete envelope.data.events[0].fee;
  const repo = createRepository(memory().storage, fixed());
  assert.throws(() => repo.parseBackup(JSON.stringify(envelope)), /v1|交易类型/);
  envelope.version = 2; envelope.data.version = 2;
  assert.equal(repo.parseBackup(JSON.stringify(envelope)).events[0].kind, 'opening_position');
});

test('clock rollback keeps every saved fact in the current projection and exposes an anomaly cutoff', () => {
  const migrated = createRepository(memory().storage, fixed()).parseBackup(v1BackupText);
  const rolled = fixed('2026-09-09T11:59:59.000Z', '2026-09-09');
  const state = clockState(migrated, rolled);
  assert.deepEqual(state, { clock_anomaly: true, through_date: '2026-09-10', known_at: '2026-09-10T12:00:00.000Z' });
  assert.equal(projection(migrated, rolled).positions[0].quantity, '2');
  assert.equal(activeEvents(migrated, rolled).length, 1);
  assert.doesNotThrow(() => validateSnapshot(migrated, rolled));
});

test('explicit historical projection preserves known_at semantics', () => {
  const data = createRepository(memory().storage, fixed()).parseBackup(v1BackupText);
  const event = data.events[0];
  assert.equal(event.kind, 'buy');
  if (event.kind !== 'buy') throw Error('fixture must be a buy');
  data.events.push({ ...event, revision_id: '10000000-0000-4000-8000-000000000006', parent_revision: event.revision_id,
    recorded_at: '2026-09-11T12:00:00.000Z', provenance: { source: 'manual', confirmed_at: '2026-09-11T12:00:00.000Z' }, quantity: '3', amount: '30' });
  assert.equal(projection(data, fixed(), { through_date: '2026-09-10', known_at: '2026-09-10T23:59:59.000Z' }).positions[0].quantity, '2');
  assert.equal(projection(data, fixed()).positions[0].quantity, '3');
});

test('a reopened service can overview and export after the device clock moves backward', async () => {
  const { createService } = await import('../src/service.ts');
  const f = memory(); let now = '2026-09-10T12:00:00.000Z'; let today = '2026-09-10'; let counter = 10;
  const runtime = { now: () => now, today: () => today, id: () => `30000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` };
  const service = createService(f.storage, runtime);
  service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: today, quantity: '2', price: '10', fee: '1', note: '' });
  now = '2026-09-09T11:59:59.000Z'; today = '2026-09-09';
  const reopened = createService(f.storage, runtime);
  assert.equal(reopened.overview().positions[0].quantity, '2');
  assert.equal(JSON.parse(reopened.exportBackup()).data.events.length, 1);
});

test('external imports reject future facts but trusted recovery validates their complete revision chain', () => {
  const envelope = JSON.parse(v1BackupText); envelope.version = 2; envelope.data.version = 2;
  envelope.data.events[0].recorded_at = '2026-09-11T12:00:00.000Z';
  envelope.data.events[0].provenance.confirmed_at = '2026-09-11T12:00:00.000Z';
  const repo = createRepository(memory().storage, fixed());
  assert.throws(() => repo.parseBackup(JSON.stringify(envelope)), /2026-09-11.*QQQ/);
  assert.doesNotThrow(() => validateSnapshot(envelope.data, fixed()));
  envelope.data.events.push({ ...envelope.data.events[0], revision_id: '10000000-0000-4000-8000-000000000006', parent_revision: '10000000-0000-4000-8000-999999999999' });
  assert.throws(() => validateSnapshot(envelope.data, fixed()), /10000000-0000-4000-8000-000000000004/);
});

test('write verifies persisted bytes and accepts a host that throws after a successful write', () => {
  const f = memory(); const data = emptySnapshot(fixed());
  const storage: StoragePort = { get: f.storage.get, set(key, value) { f.storage.set(key, value); throw Error('late host error'); } };
  assert.doesNotThrow(() => createRepository(storage, fixed()).write(data));
  assert.equal(JSON.parse(f.values.get(STORAGE_KEY)!).version, 2);
  const broken = memory();
  const drops: StoragePort = { get: broken.storage.get, set() {} };
  assert.throws(() => createRepository(drops, fixed()).write(data), /核验/);
});

test('raw corrupt primary bytes remain exportable without parsing', () => {
  const f = memory({ [STORAGE_KEY]: '{broken-private-free-synthetic' });
  const repo = createRepository(f.storage, fixed());
  assert.equal(repo.exportRaw(), '{broken-private-free-synthetic');
  assert.throws(() => repo.read(), /损坏/);
});

test('Shanghai calendar date does not create a false timestamp anomaly before UTC midnight', () => {
  const runtime = fixed('2026-09-09T18:00:00.000Z', '2026-09-10');
  const data = emptySnapshot(runtime); data.portfolio.opening_date = '2026-09-10';
  assert.equal(clockState(data, runtime).clock_anomaly, false);
});

test('external backup rejects a future portfolio opening date even when it has no events', () => {
  const runtime = fixed(); const data = emptySnapshot(runtime); data.portfolio.opening_date = '2026-09-11';
  const envelope = JSON.stringify({ format: 'portfolio-wechat-backup', version: 2, data });
  assert.throws(() => createRepository(memory().storage, runtime).parseBackup(envelope), /2026-09-11/);
});

test('failed recovery-point verification prevents any primary replacement attempt', () => {
  const current = emptySnapshot(fixed()); current.reviews.push({ date: '2026-09-10', text: 'current', updated_at: fixed().now() });
  const f = memory({ [STORAGE_KEY]: JSON.stringify(current) }); const writes: string[] = [];
  const storage: StoragePort = { get(key) { if (key.endsWith('.previous')) return ''; return f.storage.get(key); }, set(key, value) { writes.push(key); if (key === STORAGE_KEY) f.storage.set(key, value); } };
  assert.throws(() => createRepository(storage, fixed()).replace(emptySnapshot(fixed())), /恢复点.*核验/);
  assert.deepEqual(writes, [`${STORAGE_KEY}.previous`]);
  assert.equal(JSON.parse(f.values.get(STORAGE_KEY)!).reviews[0].text, 'current');
});

test('unreadable storage blocks write before any primary attempt', () => {
  const data = emptySnapshot(fixed());
  const storage: StoragePort = { get() { throw Error('read unavailable'); }, set() {} };
  assert.throws(() => createRepository(storage, fixed()).write(data), /无法读取/);
});

test('insufficient capacity blocks restore before recovery or primary writes', () => {
  const current = emptySnapshot(fixed()); current.reviews.push({ date: '2026-09-10', text: 'current', updated_at: fixed().now() });
  const f = memory({ [STORAGE_KEY]: JSON.stringify(current) }); const writes: string[] = [];
  const storage: StoragePort = { ...f.storage, set(key, value) { writes.push(key); f.storage.set(key, value); }, info: () => ({ currentSize: 99, limitSize: 99 }) };
  assert.throws(() => createRepository(storage, fixed()).replace(emptySnapshot(fixed())), /空间不足/);
  assert.deepEqual(writes, []);
});
