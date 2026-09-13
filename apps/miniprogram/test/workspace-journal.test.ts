import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySnapshot } from '../src/model.ts';
import { PENDING_KEY as LEDGER_PENDING_KEY, STORAGE_KEY, type StoragePort } from '../src/repository.ts';
import {
  WORKSPACE_PENDING_KEY,
  WORKSPACE_ROOT_KEY,
  contentHash,
  createWorkspaceRepository,
} from '../src/workspace/repository.ts';

function fixture() {
  const values = new Map<string, string>();
  let counter = 0;
  let now = '2026-09-10T12:00:00.000Z';
  const runtime = {
    now: () => now,
    today: () => now.slice(0, 10),
    id: () => `70000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  };
  const storage: StoragePort = {
    get: key => values.get(key) ?? '',
    set: (key, value) => { values.set(key, value); },
    info: () => ({ currentSize: 0, limitSize: 10240 }),
  };
  const ledger = emptySnapshot(runtime);
  ledger.reviews.push({ date: '2026-09-09', text: '原有复盘 🐻', updated_at: now });
  values.set(STORAGE_KEY, JSON.stringify(ledger));
  const open = () => createWorkspaceRepository(storage, runtime, {
    readFinancial: () => JSON.parse(values.get(STORAGE_KEY)!),
    ledgerPending: () => !!values.get(LEDGER_PENDING_KEY),
  });
  return { values, runtime, storage, ledger, open, time(value: string) { now = value; } };
}

test('legacy reviews migrate once into personal notes and reruns reuse the workspace', () => {
  const f = fixture();
  const first = f.open().read();
  assert.equal(first.journal.length, 1);
  assert.equal(first.journal[0].type, 'personal_note');
  assert.equal(first.journal[0].body, '原有复盘 🐻');
  assert.equal(first.journal[0].journal_date, '2026-09-09');
  assert.equal(first.migration.legacy_review_map['2026-09-09'], first.journal[0].id);
  const root = f.values.get(WORKSPACE_ROOT_KEY);
  const reopened = f.open().read();
  assert.equal(f.values.get(WORKSPACE_ROOT_KEY), root);
  assert.deepEqual(reopened.journal, first.journal);
});

test('an unresolved ledger save blocks first workspace migration without writing a root', () => {
  const f = fixture();
  f.values.set(LEDGER_PENDING_KEY, JSON.stringify({ version: 1, replacement: false }));
  assert.throws(() => f.open().read(), /账本.*待核验/);
  assert.equal(f.values.get(WORKSPACE_ROOT_KEY), undefined);
});

test('root switch with an unreadable outcome remains pending and reconciles without duplicate notes', () => {
  const f = fixture();
  let unreadable = false;
  const storage: StoragePort = {
    ...f.storage,
    get(key) { if (key === WORKSPACE_ROOT_KEY && unreadable) throw Error('readback'); return f.storage.get(key); },
    set(key, value) { f.storage.set(key, value); if (key === WORKSPACE_ROOT_KEY) unreadable = true; },
  };
  const repo = createWorkspaceRepository(storage, f.runtime, {
    readFinancial: () => f.ledger,
    ledgerPending: () => false,
  });
  assert.throws(() => repo.read(), /工作区.*待核验/);
  assert.ok(f.values.get(WORKSPACE_PENDING_KEY));
  unreadable = false;
  const reopened = createWorkspaceRepository(storage, f.runtime, { readFinancial: () => f.ledger, ledgerPending: () => false });
  assert.equal(reopened.verifyPending(), 'confirmed');
  assert.equal(reopened.read().journal.length, 1);
});

test('personal notes append and edits create revisions without touching legacy financial reviews', () => {
  const f = fixture(); const repo = f.open(); repo.read();
  const first = repo.savePersonalNote('2026-09-10', '第一条');
  const second = repo.savePersonalNote('2026-09-10', '第二条');
  f.time('2026-09-10T13:00:00.000Z');
  const edited = repo.savePersonalNote('2026-09-10', '第一条已修订', first.id, first.revision_id);
  const timeline = repo.timeline('2026-09-10');
  assert.equal(timeline.length, 2);
  assert.equal(timeline.find(item => item.id === first.id)?.body, '第一条已修订');
  assert.equal(edited.parent_revision, first.revision_id);
  assert.notEqual(edited.revision_id, first.revision_id);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(JSON.parse(f.values.get(STORAGE_KEY)!).reviews, f.ledger.reviews);
});

test('a logical AI archive commit stores one run, messages and one reference idempotently', () => {
  const f = fixture(); const repo = f.open(); repo.read();
  const conversation = repo.createConversation({ origin: 'portfolio', anchor_id: f.ledger.portfolio.id, context_mode: 'current' });
  const source = { id: f.runtime.id(), origin_entity_id: f.ledger.portfolio.id, origin_revision: 'ledger-r1', type: 'ledger' as const, as_of: f.runtime.now(), available_at: f.runtime.now(), content_digest: '0'.repeat(64), content: '' };
  const archive = {
    conversation,
    user_message: { id: f.runtime.id(), conversation_id: conversation.id, role: 'user' as const, content: '分析持仓', parent_message_id: null, client_turn_id: f.runtime.id(), run_id: null, status: 'saved' as const, classification: 'user_original' as const, execution_kind: null, created_at: f.runtime.now() },
    assistant_message: { id: f.runtime.id(), conversation_id: conversation.id, role: 'assistant' as const, content: '仅离线合成分析', parent_message_id: null, client_turn_id: f.runtime.id(), run_id: f.runtime.id(), status: 'saved' as const, classification: 'ai_generated' as const, execution_kind: 'fake' as const, created_at: f.runtime.now() },
    run: { schema_version: 2 as const, id: '', request_id: f.runtime.id(), conversation_id: conversation.id, parent_run_id: null, mode: 'portfolio_review' as const, journal_date: '2026-09-10', state: 'succeeded' as const, output_validated: true as const, local_saved: true as const, execution_kind: 'fake' as const, data_mode: 'demo' as const, provider_id: 'test-fake', source_integrity: 'verified' as const, source_ids: [source.id], final_manifest: {}, provider_metadata: { protocol: 'test', model: 'fake', credential_mode: 'not_applicable' as const, input_units: 0, output_units: 0 }, result: { summary: '仅离线合成分析', evidence: [{ statement: '仅有账本', source_ids: [source.id] }] }, created_at: f.runtime.now(), completed_at: f.runtime.now() },
    sources: [source],
  };
  archive.run.id = archive.assistant_message.run_id!;
  const saved = repo.archiveAnalysis(archive);
  const duplicate = repo.archiveAnalysis(archive);
  const state = repo.read();
  assert.equal(saved.journal.id, duplicate.journal.id);
  assert.equal(state.runs.length, 1);
  assert.equal(state.messages.length, 2);
  assert.equal(state.journal.filter(item => item.type === 'analysis_ref').length, 1);
  assert.equal(JSON.parse(f.values.get(STORAGE_KEY)!).reviews.length, 1);

  const root = JSON.parse(f.values.get(WORKSPACE_ROOT_KEY)!);
  const manifest = JSON.parse(f.values.get(root.manifest_key)!);
  const runPartition = JSON.parse(f.values.get(manifest.partitions.run.key)!);
  delete runPartition.runs[0].source_ids;
  const runText = JSON.stringify(runPartition);
  f.values.set(manifest.partitions.run.key, runText);
  manifest.partitions.run = { ...manifest.partitions.run, checksum: contentHash(runText), bytes: new TextEncoder().encode(runText).length };
  f.values.set(root.manifest_key, JSON.stringify(manifest));
  assert.deepEqual(f.open().read().runs[0].source_ids, [source.id]);
});

test('partition corruption fails closed while the previous root stays available', () => {
  const f = fixture(); const repo = f.open(); repo.read();
  const root = JSON.parse(f.values.get(WORKSPACE_ROOT_KEY)!);
  const manifest = JSON.parse(f.values.get(root.manifest_key)!);
  f.values.set(manifest.partitions.journal.key, '{broken');
  assert.throws(() => f.open().read(), /工作区.*损坏/);
  assert.equal(f.values.get(WORKSPACE_ROOT_KEY), JSON.stringify(root));
});

test('successful ordinary commits clear unreferenced immutable generations', () => {
  const f = fixture(), repo = f.open(); repo.read();
  repo.savePersonalNote('2026-09-10', '一'); repo.savePersonalNote('2026-09-10', '二');
  const manifests = [...f.values.entries()].filter(([key, value]) => key.includes('.instance.') && key.endsWith('.manifest') && value);
  assert.equal(manifests.length, 1);
});
