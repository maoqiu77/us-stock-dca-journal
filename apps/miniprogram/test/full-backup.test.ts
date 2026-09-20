import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.ts';
import { STORAGE_KEY, type StoragePort } from '../src/repository.ts';
import { WORKSPACE_ROOT_KEY, LEGACY_WORKSPACE_PREFIX, contentHash } from '../src/workspace/repository.ts';
import { fakeAiProvider } from '../src/ai/fake-provider.ts';

function fixture(capacity = 10240) {
  const values = new Map<string, string>(); let counter = 0;
  const runtime = { today: () => '2026-09-10', now: () => '2026-09-10T12:00:00.000Z', id: () => `71000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` };
  const storage: StoragePort = { get: key => values.get(key) ?? '', set: (key, value) => { values.set(key, value); }, info: () => ({ currentSize: 0, limitSize: capacity }) };
  return { values, runtime, storage, service: createService(storage, runtime, { fakeProvider: fakeAiProvider }) };
}

test('v7 full backup declares privacy deletions and keeps new notes out of financial v3', () => {
  const f = fixture();
  f.service.saveReview('2026-09-09', '旧复盘');
  f.service.journal().savePersonalNote('2026-09-10', '新记录');
  const backup = JSON.parse(f.service.exportFullBackup());
  assert.equal(backup.format, 'portfolio-wechat-backup');
  assert.equal(backup.version, 7);
  assert.deepEqual(backup.scope, { financial: true, journal: true, conversations: true, analysis_runs: true, sources: true, policies: true, outbox: true, watchlist: true, holding_checkpoints: true, import_receipts: true, privacy_deletions: true });
  assert.equal(backup.excludes.original_images, true);
  assert.equal(backup.excludes.vision_tasks, true);
  assert.equal(backup.data.financial.version, 3);
  assert.deepEqual(backup.data.financial.reviews.map((item: { text: string }) => item.text), ['旧复盘']);
  assert.deepEqual(backup.data.workspace.journal.map((item: { body: string }) => item.body), ['旧复盘', '新记录']);
});

test('v7 restore validates all references and creates a fresh workspace with matching ledger', () => {
  const source = fixture(); source.service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-10', quantity: '2', price: '10', fee: '1' });
  source.service.journal().savePersonalNote('2026-09-10', '人工决定：观察');
  const text = source.service.exportFullBackup(), oldInstance = JSON.parse(text).data.workspace.instance_id;
  const target = fixture(); const preview = target.service.previewCompleteBackup(text);
  assert.deepEqual(preview, { version: 7, openings: 0, trades: 1, personalNotes: 1, conversations: 0, runs: 0, sources: 0, watchlist: 0, mode: 'personal', complete: true });
  target.service.restoreCompleteBackup(text);
  assert.equal(target.service.overview().totalCost, '21.00');
  assert.equal(target.service.journal().timeline('2026-09-10')[0].body, '人工决定：观察');
  assert.notEqual(target.service.journal().read().instance_id, oldInstance);

  const broken = JSON.parse(text);
  broken.data.workspace.journal.push({ ...broken.data.workspace.journal[0], id: '71000000-0000-4000-8000-999999999999', revision_id: '71000000-0000-4000-8000-999999999998', type: 'analysis_ref', ref_id: '71000000-0000-4000-8000-999999999997', body: null, classification: 'ai_reference' });
  assert.throws(() => target.service.previewCompleteBackup(JSON.stringify(broken)), /引用/);
});

test('strict v6 complete backups remain readable after the privacy backup upgrade', () => {
  const source = fixture(); source.service.journal().savePersonalNote('2026-09-10', '升级前记录');
  const backup = JSON.parse(source.service.exportFullBackup());
  backup.version = 6;
  delete backup.scope.privacy_deletions;
  delete backup.excludes.original_images;
  delete backup.excludes.vision_tasks;
  const target = fixture(), preview = target.service.previewCompleteBackup(JSON.stringify(backup));
  assert.equal(preview.version, 6);
  target.service.restoreCompleteBackup(JSON.stringify(backup));
  assert.equal(target.service.journal().timeline('2026-09-10')[0].body, '升级前记录');
});

test('v7 roundtrips versioned watchlist but excludes clearable market cache and live receipts', () => {
  const source = fixture();
  source.service.addWatchlist({ schema_version: 1, instrument_key: 'US:XNAS:QQQ', symbol: 'QQQ', name: 'Invesco QQQ Trust', mic: 'XNAS', exchange: 'NASDAQ', market: 'US', currency: 'USD', asset_type: 'ETF', provider_symbol: 'QQQ', provider_catalog_version: 'v1', status: 'active' });
  const text = source.service.exportFullBackup(), encoded = JSON.parse(text);
  assert.equal(encoded.excludes.market_cache, true); assert.equal(encoded.excludes.live_receipts, true);
  assert.deepEqual(encoded.data.watchlist.map((item: any) => [item.symbol, item.asset_type]), [['QQQ', 'ETF']]);
  assert.equal(JSON.stringify(encoded).includes('portfolio.wechat.market.v1'), false);
  const target = fixture(); target.service.restoreCompleteBackup(text);
  assert.deepEqual(target.service.marketDiscovery().watchlist.map((item: any) => item.symbol), ['QQQ']);
});

test('imported v7 outbox is detached and recovery never sends a model request', async () => {
  const source = fixture(); source.service.ai().prepare({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-10', question: '不应重放' });
  const text = source.service.exportFullBackup(); let calls = 0;
  const targetBase = fixture();
  const transport: any = { capabilities: async () => { throw Error('unused'); }, analyze: async () => { calls++; throw Error('must_not_run'); }, status: async () => { calls++; throw Error('must_not_run'); }, result: async () => { calls++; throw Error('must_not_run'); }, ack: async () => { calls++; } };
  const target = createService(targetBase.storage, targetBase.runtime, { aiTransport: transport }); target.restoreCompleteBackup(text);
  assert.equal(target.journal().read().outbox[0].status, 'detached');
  assert.deepEqual(await target.ai().recoverPending(), []); assert.equal(calls, 0);
});

test('standalone financial import becomes a complete fresh workspace and never mixes current conversations', () => {
  const old = fixture(); old.service.saveReview('2026-09-10', '来自 v2');
  const v3 = old.service.exportBackup();
  const target = fixture(); target.service.journal().savePersonalNote('2026-09-09', '当前工作区内容');
  const prior = target.service.journal().read().instance_id;
  assert.equal(target.service.previewCompleteBackup(v3).version, 3);
  target.service.restoreCompleteBackup(v3);
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

test('v4 restore rejects a run whose evidence escapes its archived manifest sources', () => {
  const f = fixture();
  f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-10', question: '检查来源边界' });
  const backup = JSON.parse(f.service.exportFullBackup());
  assert.deepEqual(backup.data.workspace.runs[0].source_ids, backup.data.workspace.sources.map((item: { id: string }) => item.id));
  backup.data.workspace.runs[0].source_ids = ['71000000-0000-4000-8000-999999999999'];
  assert.throws(() => f.service.previewCompleteBackup(JSON.stringify(backup)), /分析来源引用损坏/);
});

test('interim local v2 recovers stored citation IDs while external v4 stays strict', () => {
  const f = fixture();
  const archived = f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-10', question: '迁移旧开发数据' });
  const root = JSON.parse(f.values.get(WORKSPACE_ROOT_KEY)!);
  const manifest = JSON.parse(f.values.get(root.manifest_key)!);
  const runKey = manifest.partitions.run.key;
  const runPartition = JSON.parse(f.values.get(runKey)!);
  const expectedSourceIds = runPartition.runs[0].source_ids;
  delete runPartition.runs[0].source_ids;
  const legacyText = JSON.stringify(runPartition);
  f.values.set(runKey, legacyText);
  manifest.partitions.run.bytes = new TextEncoder().encode(legacyText).length;
  manifest.partitions.run.checksum = contentHash(legacyText);
  f.values.set(root.manifest_key, JSON.stringify(manifest));

  assert.deepEqual(createService(f.storage, f.runtime).journal().read().runs[0].source_ids, expectedSourceIds);

  const clean = fixture(); clean.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-10', question: '迁移旧开发数据' });
  const external = JSON.parse(clean.service.exportFullBackup());
  delete external.data.workspace.runs[0].source_ids;
  assert.throws(() => f.service.previewCompleteBackup(JSON.stringify(external)), /版本/);
});

test('pre-release local v1 recovers citations and migrates without changing old bytes; v3 remains strict', () => {
  const f = fixture();
  f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-10', question: '旧工作区来源' });
  const backup = JSON.parse(f.service.exportFullBackup()), state = backup.data.workspace;
  const root = JSON.parse(f.values.get(WORKSPACE_ROOT_KEY)!);
  const legacyRuns = state.runs.map((run: any) => ({ id: run.id, request_id: run.request_id, conversation_id: run.conversation_id, parent_run_id: run.parent_run_id, mode: run.mode, journal_date: run.journal_date, state: 'succeeded', output_validated: true, local_saved: true, provider: 'fake', demo: true, result: run.result, created_at: run.created_at, completed_at: run.completed_at }));
  const legacySources = state.sources.map((source: any) => ({ id: source.id, revision: source.id, type: source.type, as_of: source.as_of, available_at: source.available_at, content_hash: contentHash(source.content), content: source.content }));
  const legacyMessages = state.messages.map(({ execution_kind, ...message }: any) => message);
  const payloads: Record<string, unknown> = {
    journal: { version: 1, entries: state.journal }, chat: { version: 1, conversations: state.conversations, messages: legacyMessages },
    run: { version: 1, runs: legacyRuns }, source: { version: 1, sources: legacySources }, policy: { version: 1, policies: state.policies },
  };
  const oldBytes = new Map<string, string>(), partitions: Record<string, unknown> = {};
  for (const [name, payload] of Object.entries(payloads)) {
    const key = `${LEGACY_WORKSPACE_PREFIX}.instance.${state.instance_id}.fixture.${name}`, text = JSON.stringify(payload);
    f.values.set(key, text); oldBytes.set(key, text);
    partitions[name] = { key, bytes: new TextEncoder().encode(text).length, checksum: contentHash(text) };
  }
  const manifestKey = `${LEGACY_WORKSPACE_PREFIX}.fixture.manifest`;
  f.values.set(manifestKey, JSON.stringify({ version: 1, instance_id: state.instance_id, portfolio_id: state.portfolio_id, generation: root.generation, created_at: f.runtime.now(), migration: state.migration, partitions }));
  f.values.set(`${LEGACY_WORKSPACE_PREFIX}.root`, JSON.stringify({ ...root, version: 1, manifest_key: manifestKey }));
  f.values.delete(WORKSPACE_ROOT_KEY);
  const reopened = createService(f.storage, f.runtime), migrated = reopened.journal().read();
  assert.equal(migrated.version, 3);
  assert.equal(migrated.runs[0].id, state.runs[0].id);
  assert.deepEqual(migrated.runs[0].source_ids, state.runs[0].source_ids);
  assert.equal(migrated.runs[0].source_integrity, 'legacy_unverified');
  assert.equal(migrated.messages.length, 2);
  for (const [key, text] of oldBytes) assert.equal(f.values.get(key), text);

  const { outbox, privacy_epoch, deletions, ...legacyState } = state;
  const { outbox: scopeOutbox, watchlist: scopeWatchlist, holding_checkpoints: scopeCheckpoints, import_receipts: scopeReceipts, privacy_deletions: scopePrivacy, ...legacyScope } = backup.scope;
  const { excludes, ...legacyBackup } = backup;
  const { watchlist, ...legacyData } = backup.data;
  const { revision, holding_assets, holding_checkpoints, import_receipts, ...legacyFinancial } = legacyData.financial;
  const external = { ...legacyBackup, version: 3, scope: legacyScope, data: { ...legacyData, financial: { ...legacyFinancial, version: 2 }, workspace: { ...legacyState, version: 1, runs: legacyRuns, sources: legacySources, messages: legacyMessages } } };
  assert.throws(() => reopened.previewCompleteBackup(JSON.stringify(external)), /版本/);
  external.data.workspace.runs[0].source_ids = state.runs[0].source_ids;
  assert.equal(reopened.previewCompleteBackup(JSON.stringify(external)).version, 3);
});
