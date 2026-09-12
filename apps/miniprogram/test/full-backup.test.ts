import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.ts';
import { STORAGE_KEY, type StoragePort } from '../src/repository.ts';
import { WORKSPACE_ROOT_KEY, contentHash } from '../src/workspace/repository.ts';

function fixture(capacity = 10240) {
  const values = new Map<string, string>(); let counter = 0;
  const runtime = { today: () => '2026-09-10', now: () => '2026-09-10T12:00:00.000Z', id: () => `71000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` };
  const storage: StoragePort = { get: key => values.get(key) ?? '', set: (key, value) => { values.set(key, value); }, info: () => ({ currentSize: 0, limitSize: capacity }) };
  return { values, runtime, storage, service: createService(storage, runtime) };
}

test('v3 full backup declares every included partition and keeps new notes out of financial v2', () => {
  const f = fixture();
  f.service.saveReview('2026-09-09', '旧复盘');
  f.service.journal().savePersonalNote('2026-09-10', '新记录');
  const backup = JSON.parse(f.service.exportFullBackup());
  assert.equal(backup.format, 'portfolio-wechat-backup');
  assert.equal(backup.version, 3);
  assert.deepEqual(backup.scope, { financial: true, journal: true, conversations: true, analysis_runs: true, sources: true, policies: true });
  assert.equal(backup.data.financial.version, 2);
  assert.deepEqual(backup.data.financial.reviews.map((item: { text: string }) => item.text), ['旧复盘']);
  assert.deepEqual(backup.data.workspace.journal.map((item: { body: string }) => item.body), ['旧复盘', '新记录']);
});

test('v3 restore validates all references and creates a fresh workspace with matching ledger', () => {
  const source = fixture(); source.service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-10', quantity: '2', price: '10', fee: '1' });
  source.service.journal().savePersonalNote('2026-09-10', '人工决定：观察');
  const text = source.service.exportFullBackup(), oldInstance = JSON.parse(text).data.workspace.instance_id;
  const target = fixture(); const preview = target.service.previewCompleteBackup(text);
  assert.deepEqual(preview, { version: 3, openings: 0, trades: 1, personalNotes: 1, conversations: 0, runs: 0, sources: 0, mode: 'personal', complete: true });
  target.service.restoreCompleteBackup(text);
  assert.equal(target.service.overview().totalCost, '21.00');
  assert.equal(target.service.journal().timeline('2026-09-10')[0].body, '人工决定：观察');
  assert.notEqual(target.service.journal().read().instance_id, oldInstance);

  const broken = JSON.parse(text);
  broken.data.workspace.journal.push({ ...broken.data.workspace.journal[0], id: '71000000-0000-4000-8000-999999999999', revision_id: '71000000-0000-4000-8000-999999999998', type: 'analysis_ref', ref_id: '71000000-0000-4000-8000-999999999997', body: null, classification: 'ai_reference' });
  assert.throws(() => target.service.previewCompleteBackup(JSON.stringify(broken)), /引用/);
});

test('v1/v2 import becomes a complete fresh workspace and never mixes current conversations', () => {
  const old = fixture(); old.service.saveReview('2026-09-10', '来自 v2');
  const v2 = old.service.exportBackup();
  const target = fixture(); target.service.journal().savePersonalNote('2026-09-09', '当前工作区内容');
  const prior = target.service.journal().read().instance_id;
  assert.equal(target.service.previewCompleteBackup(v2).version, 2);
  target.service.restoreCompleteBackup(v2);
  const restored = target.service.journal().read();
  assert.notEqual(restored.instance_id, prior);
  assert.deepEqual(target.service.journal().timeline('2026-09-10').map(item => item.body), ['来自 v2']);
  assert.equal(target.service.journal().timeline('2026-09-09').length, 0);
});

test('workspace staging or insufficient capacity fails before replacing the financial primary', () => {
  const source = fixture(); source.service.journal().savePersonalNote('2026-09-10', 'x'.repeat(100)); const backup = source.service.exportFullBackup();
  const target = fixture(0); target.service.saveReview('2026-09-09', '原数据');
  const before = target.values.get(STORAGE_KEY);
  assert.throws(() => target.service.restoreCompleteBackup(backup), /空间不足/);
  assert.equal(target.values.get(STORAGE_KEY), before);
});

test('unknown and corrupted backup versions fail without changing either current partition', () => {
  const f = fixture(); f.service.saveReview('2026-09-10', '保留'); f.service.journal().read();
  const financial = f.values.get(STORAGE_KEY), workspace = f.service.journal().read();
  assert.throws(() => f.service.restoreCompleteBackup('{bad'), /有效 JSON/);
  assert.throws(() => f.service.restoreCompleteBackup(JSON.stringify({ format: 'portfolio-wechat-backup', version: 99 })), /版本/);
  assert.equal(f.values.get(STORAGE_KEY), financial);
  assert.deepEqual(f.service.journal().read(), workspace);
});

test('v3 restore rejects a run whose evidence escapes its archived manifest sources', () => {
  const f = fixture();
  f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-10', question: '检查来源边界' });
  const backup = JSON.parse(f.service.exportFullBackup());
  assert.deepEqual(backup.data.workspace.runs[0].source_ids, backup.data.workspace.sources.map((item: { id: string }) => item.id));
  backup.data.workspace.runs[0].source_ids = ['71000000-0000-4000-8000-999999999999'];
  assert.throws(() => f.service.previewCompleteBackup(JSON.stringify(backup)), /分析来源引用损坏/);
});

test('local prerelease run partitions infer missing source lists once without weakening v3 imports', () => {
  const f = fixture();
  const archived = f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-10', question: '迁移旧开发数据' });
  const root = JSON.parse(f.values.get(WORKSPACE_ROOT_KEY)!);
  const manifest = JSON.parse(f.values.get(root.manifest_key)!);
  const runKey = manifest.partitions.run.key;
  const runPartition = JSON.parse(f.values.get(runKey)!);
  delete runPartition.runs[0].source_ids;
  const legacyText = JSON.stringify(runPartition);
  f.values.set(runKey, legacyText);
  manifest.partitions.run.bytes = new TextEncoder().encode(legacyText).length;
  manifest.partitions.run.checksum = contentHash(legacyText);
  f.values.set(root.manifest_key, JSON.stringify(manifest));

  const reopened = createService(f.storage, f.runtime).journal().read();
  assert.deepEqual(reopened.runs[0].source_ids, archived.manifest.sources.map(item => item.id));

  const external = JSON.parse(f.service.exportFullBackup());
  delete external.data.workspace.runs[0].source_ids;
  assert.throws(() => f.service.previewCompleteBackup(JSON.stringify(external)), /版本/);
});
