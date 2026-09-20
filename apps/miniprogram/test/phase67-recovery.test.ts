import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.ts';
import { fakeAiProvider } from '../src/ai/fake-provider.ts';
import { RESTORE_TRANSACTION_KEY } from '../src/workspace/restore-transaction.ts';
import { STORAGE_KEY } from '../src/repository.ts';

function fixture(seed = 0, initial = new Map<string, string>()) {
  let id = seed, writes = 0, failure = Infinity, after = false, broken = false;
  const values = new Map(initial);
  const runtime = { today: () => '2026-09-21', now: () => '2026-09-21T04:00:00.000Z', id: () => `96000000-0000-4000-8000-${String(++id).padStart(12, '0')}` };
  const storage = { get: (key: string) => values.get(key) ?? '', set(key: string, value: string) {
    writes++;
    if (writes >= failure) { broken = true; if (after) values.set(key, value); throw Error('simulated power loss / quota'); }
    values.set(key, value);
  }, keys: () => [...values.keys()], info: () => ({ currentSize: 0, limitSize: 10240 }) };
  return { values, runtime, storage, service: createService(storage, runtime, { fakeProvider: fakeAiProvider }),
    failAt(n: number, late = false) { writes = 0; failure = n; after = late; },
    resume() { failure = Infinity; }, count: () => writes, broken: () => broken };
}
function populate(f: ReturnType<typeof fixture>, text: string) {
  f.service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-21', quantity: '2', price: '10', fee: '1' });
  f.service.journal().savePersonalNote('2026-09-21', text);
  f.service.addWatchlist({ schema_version: 1, instrument_key: 'US:XNAS:QQQ', symbol: 'QQQ', name: 'Invesco QQQ Trust', mic: 'XNAS', exchange: 'NASDAQ', market: 'US', currency: 'USD', asset_type: 'ETF', provider_symbol: 'QQQ', provider_catalog_version: 'v1', status: 'active' });
}
function facts(service: ReturnType<typeof createService>) {
  const backup = JSON.parse(service.exportFullBackup());
  return { financial: backup.data.financial, journal: backup.data.workspace.journal, watchlist: backup.data.watchlist };
}

test('P6 D02 every full-restore write interruption restarts as a complete old or complete new workspace', () => {
  const source = fixture(10000); populate(source, 'new synthetic note'); const backup = source.service.exportFullBackup(), expected = facts(source.service);
  const original = fixture(); populate(original, 'old synthetic note'); const previous = facts(original.service);
  const probe = fixture(20000, original.values); probe.failAt(Infinity); probe.service.restoreCompleteBackup(backup); const total = probe.count();
  assert.ok(total > 20);
  for (const late of [false, true]) for (let point = 1; point <= total; point++) {
    const f = fixture(20000, original.values); f.failAt(point, late);
    try { f.service.restoreCompleteBackup(backup); } catch { /* restart after simulated power loss */ }
    f.resume();
    const reopened = createService(f.storage, f.runtime);
    const actual = facts(reopened);
    assert.ok(JSON.stringify(actual) === JSON.stringify(previous) || JSON.stringify(actual) === JSON.stringify(expected), `mixed state at ${point}, late=${late}`);
    assert.equal(f.values.get(RESTORE_TRANSACTION_KEY) || '', '');
  }
});

test('P6 D03 corrupted staged restore fails closed without overwriting the original ledger', () => {
  const source = fixture(10000); populate(source, 'source'); const target = fixture(); populate(target, 'target');
  const before = target.values.get(STORAGE_KEY);
  // Find the durable marker write, then lose power before the first primary write.
  const baseSet = target.storage.set;
  let committed = false;
  target.storage.set = (key, value) => { if (committed) throw Error('power loss'); baseSet(key, value); if (key === RESTORE_TRANSACTION_KEY && value) committed = true; };
  assert.throws(() => target.service.restoreCompleteBackup(source.service.exportFullBackup()));
  const marker = JSON.parse(target.values.get(RESTORE_TRANSACTION_KEY)!);
  target.values.set(marker.entries[0].stage, 'tampered');
  target.storage.set = baseSet;
  assert.throws(() => createService(target.storage, target.runtime).snapshot(), /损坏/);
  assert.equal(target.values.get(STORAGE_KEY), before);
});

test('P6 integrated reviewed screenshot → analysis → edited note → calendar → deletion → restore preview', () => {
  const f = fixture();
  const input = { batchId: 'phase6_synthetic_import', expectedRevision: 0, observedAt: f.runtime.now(), rows: [{ rowId: 'row_1', instrument: { symbol: 'QQQ', name: 'Synthetic QQQ', market: 'US', currency: 'USD', assetType: 'ETF' as const, status: 'unverified' as const }, quantity: '20', unitCost: '10' }] };
  f.service.saveHoldingImport({ ...input, contentToken: f.service.previewHoldingImport(input).contentToken });
  const financial = f.service.exportBackup();
  const run = f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-21', question: 'phase6 private synthetic question' });
  const assistant = f.service.journal().conversation(run.conversation.id).messages.find(m => m.role === 'assistant')!;
  f.service.journal().saveAiMessageAsNote(assistant.id, '2026-09-21', 'Edited personal conclusion');
  assert.deepEqual(f.service.journal().calendarMonth('2026-09').days, ['2026-09-21']);
  const oldBackup = f.service.exportFullBackup();
  const pending = f.service.ai().prepare({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-21', question: 'late question', conversationId: run.conversation.id });
  f.service.journal().deleteConversation(run.conversation.id);
  assert.throws(() => f.service.ai().runPreparedFake(pending), /删除|迟到|隐私/);
  assert.equal(f.service.exportBackup(), financial);
  const clean = f.service.exportFullBackup();
  assert.ok(!clean.includes('phase6 private synthetic question'));
  assert.equal(f.service.previewCompleteBackup(clean).conversations, 0);
  assert.equal(f.service.previewCompleteBackup(clean).checkpoints, 1);
  assert.equal(f.service.previewCompleteBackup(clean).importReceipts, 1);
  assert.equal(f.service.previewCompleteBackup(oldBackup).conversations, 1);
  const beforePreview = f.service.exportFullBackup(); f.service.previewCompleteBackup(oldBackup); assert.equal(f.service.exportFullBackup(), beforePreview);
  const target = fixture(20000); target.service.restoreCompleteBackup(clean);
  const reopened = createService(target.storage, target.runtime);
  assert.equal(reopened.exportBackup(), financial);
  assert.equal(reopened.journal().history('2026-09-21')[0].text, 'Edited personal conclusion');
  assert.equal(reopened.saveHoldingImport(input).kind, 'already_applied');
  const first = facts(reopened); reopened.restoreCompleteBackup(clean); assert.deepEqual(facts(reopened), first);
});

test('P6 recovery point restores personal notes and exact watchlist, including deliberately empty lists', () => {
  for (const empty of [false, true]) {
    const f = fixture(); populate(f, 'retained note'); if (empty) f.service.removeWatchlist('US:XNAS:QQQ');
    const before = facts(f.service); f.service.startEmpty(); f.service.recoverPrevious();
    assert.deepEqual(facts(f.service), before);
  }
});

test('P6 D01 v4 and v5 complete backup migration preserves financial facts, originals and watchlist through v7', () => {
  for (const version of [4, 5]) {
    const f = fixture(); populate(f, `legacy v${version} 原文`);
    const backup = JSON.parse(f.service.exportFullBackup());
    backup.version = version;
    delete backup.scope.holding_checkpoints; delete backup.scope.import_receipts; delete backup.scope.privacy_deletions;
    delete backup.excludes.original_images; delete backup.excludes.vision_tasks;
    const financial = backup.data.financial;
    financial.version = 2; delete financial.revision; delete financial.holding_assets; delete financial.holding_checkpoints; delete financial.import_receipts;
    if (version === 4) {
      delete backup.scope.watchlist; delete backup.data.watchlist; delete backup.excludes.market_cache; delete backup.excludes.live_receipts;
      backup.data.workspace.version = 2; delete backup.data.workspace.privacy_epoch; delete backup.data.workspace.deletions;
    }
    const target = fixture(20000); const text = JSON.stringify(backup);
    assert.equal(target.service.previewCompleteBackup(text).version, version);
    target.service.restoreCompleteBackup(text);
    assert.equal(target.service.overview().totalCost, '21.00');
    assert.equal(target.service.journal().history('2026-09-21')[0].text, `legacy v${version} 原文`);
    const expected = facts(target.service), v7 = target.service.exportFullBackup();
    target.service.restoreCompleteBackup(v7); assert.deepEqual(facts(target.service), expected);
    assert.equal(target.service.marketDiscovery().watchlist.length, version === 5 ? 1 : 0);
  }
});
