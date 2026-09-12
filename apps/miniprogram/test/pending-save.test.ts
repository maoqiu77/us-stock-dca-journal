import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createService } from '../src/service.ts';
import { STORAGE_KEY, RECOVERY_KEY } from '../src/repository.ts';
function fixture() {
  const values = new Map<string, string>(); let counter = 0, fault = '', unreadable = false;
  const runtime = { today: () => '2026-09-10', now: () => '2026-09-10T12:00:00.000Z', id: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` };
  const storage = { get(key: string) { if (key === STORAGE_KEY && unreadable) throw Error('readback'); return values.get(key) ?? ''; }, set(key: string, value: string) { if (key === STORAGE_KEY && fault === 'before') throw Error('quota'); values.set(key, value); if (key === STORAGE_KEY && fault === 'read') unreadable = true; if (key === STORAGE_KEY && fault === 'after') throw Error('late'); } };
  return { values, storage, runtime, service: createService(storage, runtime), fault(value: string) { fault = value; unreadable = false; } };
}
const input = { kind: 'buy' as const, symbol: 'QQQ', assetType: 'ETF' as const, date: '2026-09-10', quantity: '2', price: '10', fee: '1' };
test('R1 unknown write blocks repreview and survives restart; verification confirms one identity', () => {
  const f = fixture(); f.fault('read');
  assert.throws(() => f.service.saveTrade(input), { code: 'SAVE_UNKNOWN' });
  assert.throws(() => f.service.previewTrade(input), { code: 'SAVE_PENDING' });
  assert.throws(() => f.service.verifyPending(), { code: 'SAVE_UNKNOWN' });
  f.fault(''); const reopened = createService(f.storage, f.runtime);
  assert.equal(reopened.pendingSave(), true);
  assert.equal(reopened.verifyPending(), 'confirmed');
  assert.equal(reopened.records().length, 1); assert.equal(reopened.overview().totalCost, '21.00');
  assert.equal(reopened.verifyPending(), 'none');
  reopened.saveTrade(input); assert.equal(reopened.records().length, 2);
});
test('definite non-write retries the identical revisions only on an unchanged base', () => {
  const f = fixture(); f.fault('before');
  assert.throws(() => f.service.saveTrade(input), { code: 'SAVE_NOT_WRITTEN' });
  f.fault(''); assert.equal(f.service.verifyPending(), 'retryable');
  assert.equal(f.service.retryPending(), 'confirmed');
  assert.equal(f.service.records().length, 1);
});
test('set throws after commit but readable data confirms success', () => {
  const f = fixture(); f.fault('after'); f.service.saveTrade(input);
  assert.equal(f.service.records().length, 1); assert.equal(f.service.pendingSave(), false);
});
test('verification accepts recorded revision after other valid writes but rejects same ID with different content', () => {
  for (const conflict of [false, true]) {
    const f = fixture(); f.fault('read'); assert.throws(() => f.service.saveTrade(input)); f.fault('');
    const data = JSON.parse(f.values.get(STORAGE_KEY)!);
    if (conflict) data.events[0].note = 'different';
    else data.reviews.push({ date: input.date, text: 'later valid write', updated_at: f.runtime.now() });
    f.values.set(STORAGE_KEY, JSON.stringify(data));
    if (conflict) assert.throws(() => f.service.verifyPending(), { code: 'SAVE_CONFLICT' });
    else assert.equal(f.service.verifyPending(), 'confirmed');
    assert.equal(f.service.records().length, 1);
  }
});
test('opening and correction unknown writes reconcile without duplicate revisions', () => {
  const f = fixture(); f.fault('read');
  assert.throws(() => f.service.saveOpening({ date: input.date, symbol: 'QQQ', assetType: 'ETF', quantity: '10', totalCost: '1000' }));
  f.fault(''); assert.equal(f.service.verifyPending(), 'confirmed');
  f.service.saveTrade(input); const row = f.service.records().find(r => !r.isOpening)!;
  f.fault('read'); assert.throws(() => f.service.saveTrade({ ...input, recordId: row.id, expectedRevision: row.revisionId, price: '12' }));
  f.fault(''); assert.equal(f.service.verifyPending(), 'confirmed');
  assert.equal(f.service.records().length, 2); assert.equal(f.service.revisionHistory(row.id).length, 2);
});
test('replacement unknown invalidates previews immediately and preserves original recovery on restart', () => {
  const f = fixture(); f.service.saveTrade(input); const original = f.values.get(STORAGE_KEY), generation = f.service.generation();
  f.fault('read'); assert.throws(() => f.service.startEmpty(), { code: 'SAVE_UNKNOWN' });
  assert.ok(f.service.generation() > generation); f.fault('');
  const reopened = createService(f.storage, f.runtime);
  assert.throws(() => reopened.startEmpty(), { code: 'SAVE_PENDING' });
  assert.equal(reopened.verifyPending(), 'confirmed');
  assert.equal(f.values.get(RECOVERY_KEY), original); assert.equal(reopened.records().length, 0);
});

test('durable journal does not halve the existing 800 KiB ledger capacity', async () => {
  const { createRepository } = await import('../src/repository.ts');
  const f = fixture(), repo = createRepository(f.storage, f.runtime), data = repo.read();
  for (let day = 0; day < 125; day++) data.reviews.push({ date: new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10), text: 'x'.repeat(3900), updated_at: f.runtime.now() });
  repo.write(data); data.reviews[0].text = 'y'.repeat(3900);
  repo.write(data); assert.equal(repo.read().reviews[0].text[0], 'y');
});

test('every journal staging failure precedes the primary write, and orphan staging never replays', async () => {
  const { PENDING_KEY, PENDING_BEFORE_KEY, PENDING_NEXT_KEY } = await import('../src/repository.ts');
  for (const keyToFail of [PENDING_BEFORE_KEY, PENDING_NEXT_KEY, PENDING_KEY]) {
    const f = fixture(); let enabled = true;
    const storage = { get: f.storage.get, set(key: string, value: string) { if (enabled && key === keyToFail) throw Error('quota'); f.storage.set(key, value); } };
    const service = createService(storage, f.runtime);
    // First operation has an empty before snapshot; use a nonempty base so a
    // dropped staging write is observable rather than already identical.
    f.service.saveReview(input.date, 'synthetic base'); const original = f.values.get(STORAGE_KEY);
    assert.throws(() => service.saveTrade(input), { code: 'SAVE_NOT_WRITTEN' });
    assert.equal(f.values.get(STORAGE_KEY), original); enabled = false;
    const reopened = createService(storage, f.runtime);
    assert.equal(reopened.verifyPending(), 'none'); assert.equal(reopened.records().length, 0);
    reopened.saveTrade(input); assert.equal(reopened.records().length, 1);
  }
});

test('a committed manifest with failed readback is verified as absent before explicit retry', async () => {
  const { PENDING_KEY } = await import('../src/repository.ts'); const f = fixture(); let unreadable = false;
  const storage = { get(key: string) { if (key === PENDING_KEY && unreadable) { unreadable = false; throw Error('readback'); } return f.storage.get(key); }, set(key: string, value: string) { f.storage.set(key, value); if (key === PENDING_KEY && value) unreadable = true; } };
  const service = createService(storage, f.runtime);
  assert.throws(() => service.saveTrade(input), { code: 'SAVE_NOT_WRITTEN' });
  assert.equal(f.values.get(STORAGE_KEY), undefined);
  assert.equal(service.verifyPending(), 'retryable'); service.retryPending();
  assert.equal(service.records().length, 1);
});

test('failed manifest cleanup cannot create another transaction and can be reconciled later', async () => {
  const { PENDING_KEY } = await import('../src/repository.ts'); const f = fixture(); let fail = true;
  const storage = { get: f.storage.get, set(key: string, value: string) { if (fail && key === PENDING_KEY && !value) throw Error('cleanup'); f.storage.set(key, value); } };
  const service = createService(storage, f.runtime);
  assert.doesNotThrow(() => service.saveTrade(input));
  assert.throws(() => service.saveTrade(input), { code: 'SAVE_PENDING' });
  fail = false; assert.equal(service.verifyPending(), 'confirmed'); assert.equal(service.records().length, 1);
});

test('safe retry refuses a changed ledger base even if its intended revision is absent', () => {
  const f = fixture(); f.service.saveReview(input.date, 'before'); f.fault('before'); assert.throws(() => f.service.saveTrade(input)); f.fault('');
  const data = JSON.parse(f.values.get(STORAGE_KEY)!); data.reviews[0].text = 'later valid edit'; f.values.set(STORAGE_KEY, JSON.stringify(data));
  assert.throws(() => f.service.retryPending(), { code: 'SAVE_CONFLICT' });
  assert.equal(f.service.records().length, 0); assert.equal(f.service.snapshot().reviews[0].text, 'later valid edit');
});

test('void and review unknown writes reconcile without repeating the mutation', () => {
  const f = fixture(); f.service.saveTrade(input); const id = f.service.records()[0].id;
  f.fault('read'); assert.throws(() => f.service.voidTrade(id)); f.fault(''); assert.equal(f.service.verifyPending(), 'confirmed');
  assert.equal(f.service.revisionHistory(id).length, 2); assert.equal(f.service.records()[0].voided, true);
  f.fault('read'); assert.throws(() => f.service.saveReview(input.date, '测试复盘 🐻')); f.fault('');
  assert.equal(f.service.verifyPending(), 'confirmed'); assert.equal(f.service.snapshot().reviews.length, 1);
});

test('successful primary commit stays successful if manifest removal commits but readback fails', async () => {
  const { PENDING_KEY } = await import('../src/repository.ts'); const f = fixture(); let failRead = false;
  const storage = { get(key: string) { if (key === PENDING_KEY && failRead) { failRead = false; throw Error('cleanup readback'); } return f.storage.get(key); }, set(key: string, value: string) { f.storage.set(key, value); if (key === PENDING_KEY && !value) failRead = true; } };
  const service = createService(storage, f.runtime);
  assert.doesNotThrow(() => service.saveTrade(input));
  assert.equal(service.records().length, 1);
});
test('review identity reconciles after another date is updated but rejects conflicting same-date content', () => {
  for (const conflict of [false, true]) {
    const f = fixture(); f.fault('read'); assert.throws(() => f.service.saveReview(input.date, '本次复盘')); f.fault('');
    const data = JSON.parse(f.values.get(STORAGE_KEY)!);
    if (conflict) data.reviews[0].text = '其他内容';
    else data.reviews.push({ date: '2026-09-09', text: '其他日期', updated_at: f.runtime.now() });
    f.values.set(STORAGE_KEY, JSON.stringify(data));
    if (conflict) assert.throws(() => f.service.verifyPending(), { code: 'SAVE_CONFLICT' });
    else assert.equal(f.service.verifyPending(), 'confirmed');
  }
});
