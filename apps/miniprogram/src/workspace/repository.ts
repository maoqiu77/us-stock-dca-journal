import { z } from 'zod';
import { sha256 } from '@portfolio/ai-context';
import { idSchema, policySchema, timestampSchema, type Policy } from '@portfolio/domain';
import { type Runtime, type Snapshot, utf8Size } from '../model.ts';
import { type StoragePort } from '../repository.ts';
import {
  analysisRunSchema,
  conversationSchema,
  journalEntrySchema,
  legacyAnalysisRunSchema,
  legacyMessageSchema,
  legacySourceSnapshotSchema,
  messageSchema,
  migrationStateSchema,
  outboxTurnSchema,
  sourceSnapshotSchema,
  workspaceStateSchema,
  type AnalysisRun,
  type Conversation,
  type JournalEntry,
  type Message,
  type OutboxTurn,
  type SourceSnapshot,
  type WorkspaceState,
} from '../journal/model.ts';

export const WORKSPACE_PREFIX = 'portfolio.wechat.workspace.v2';
export const LEGACY_WORKSPACE_PREFIX = 'portfolio.wechat.workspace.v1';
export const WORKSPACE_ROOT_KEY = `${WORKSPACE_PREFIX}.root`;
export const WORKSPACE_PREVIOUS_KEY = `${WORKSPACE_PREFIX}.previous`;
export const WORKSPACE_PENDING_KEY = `${WORKSPACE_PREFIX}.pending-v2`;
export const WORKSPACE_PENDING_BEFORE_KEY = `${WORKSPACE_PENDING_KEY}.before`;
export const WORKSPACE_PENDING_NEXT_KEY = `${WORKSPACE_PENDING_KEY}.next`;

const partitionRefSchema = z.strictObject({ key: z.string().min(1).max(300), checksum: z.string().regex(/^[0-9a-f]{8}$/), bytes: z.number().int().nonnegative() });
const manifestSchema = z.strictObject({
  version: z.literal(2), instance_id: idSchema, portfolio_id: idSchema, generation: z.number().int().nonnegative(), created_at: timestampSchema,
  migration: migrationStateSchema,
  partitions: z.strictObject({ journal: partitionRefSchema, chat: partitionRefSchema, run: partitionRefSchema, source: partitionRefSchema, policy: partitionRefSchema, outbox: partitionRefSchema }),
});
const rootSchema = z.strictObject({ version: z.literal(2), active_instance_id: idSchema, portfolio_id: idSchema, generation: z.number().int().nonnegative(), manifest_key: z.string().min(1).max(300), switched_at: timestampSchema });
const pendingSchema = z.strictObject({ version: z.literal(2), replacement: z.boolean() });
const journalPartitionSchema = z.strictObject({ version: z.literal(2), entries: z.array(journalEntrySchema).max(10000) });
const chatPartitionSchema = z.strictObject({ version: z.literal(2), conversations: z.array(conversationSchema).max(1000), messages: z.array(messageSchema).max(20000) });
const runPartitionSchema = z.strictObject({ version: z.literal(2), runs: z.array(analysisRunSchema).max(5000) });
const interimAnalysisRunSchema = analysisRunSchema.omit({ source_ids: true }).extend({ source_ids: analysisRunSchema.shape.source_ids.optional() });
const interimRunPartitionSchema = z.strictObject({ version: z.literal(2), runs: z.array(interimAnalysisRunSchema).max(5000) });
const sourcePartitionSchema = z.strictObject({ version: z.literal(2), sources: z.array(sourceSnapshotSchema).max(10000) });
const policyPartitionSchema = z.strictObject({ version: z.literal(2), policies: workspaceStateSchema.shape.policies });
const outboxPartitionSchema = z.strictObject({ version: z.literal(2), turns: z.array(outboxTurnSchema).max(2000) });
const legacyManifestSchema = z.strictObject({ version: z.literal(1), instance_id: idSchema, portfolio_id: idSchema, generation: z.number().int().nonnegative(), created_at: timestampSchema, migration: migrationStateSchema, partitions: z.strictObject({ journal: partitionRefSchema, chat: partitionRefSchema, run: partitionRefSchema, source: partitionRefSchema, policy: partitionRefSchema }) });
const legacyRootSchema = z.strictObject({ version: z.literal(1), active_instance_id: idSchema, portfolio_id: idSchema, generation: z.number().int().nonnegative(), manifest_key: z.string().min(1).max(300), switched_at: timestampSchema });
const legacyJournalPartitionSchema = z.strictObject({ version: z.literal(1), entries: z.array(journalEntrySchema).max(10000) });
const legacyChatPartitionSchema = z.strictObject({ version: z.literal(1), conversations: z.array(conversationSchema).max(1000), messages: z.array(legacyMessageSchema).max(20000) });
const interimLegacyRunSchema = legacyAnalysisRunSchema.omit({ source_ids: true }).extend({ source_ids: legacyAnalysisRunSchema.shape.source_ids.optional() });
const legacyRunPartitionSchema = z.strictObject({ version: z.literal(1), runs: z.array(interimLegacyRunSchema).max(5000) });
const legacySourcePartitionSchema = z.strictObject({ version: z.literal(1), sources: z.array(legacySourceSnapshotSchema).max(10000) });
const legacyPolicyPartitionSchema = z.strictObject({ version: z.literal(1), policies: z.array(policySchema).max(1000) });
type Root = z.infer<typeof rootSchema>;

export class WorkspacePersistenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'WorkspacePersistenceError'; this.code = code; }
}

function parse(text: string, message: string): unknown { try { return JSON.parse(text); } catch { throw Error(message); } }
export function contentHash(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function setVerified(storage: StoragePort, key: string, value: string, message: string) {
  try { storage.set(key, value); } catch { /* readback determines the result */ }
  let actual = '';
  try { actual = storage.get(key); } catch { throw Error(`${message}；无法回读核验。`); }
  if (actual !== value) throw Error(`${message}；回读核验未通过。`);
}
function unique(runtime: Runtime, used: Set<string>) {
  for (let attempt = 0; attempt < 100; attempt++) { const id = runtime.id(); if (!used.has(id)) { used.add(id); return id; } }
  throw Error('无法生成唯一的工作区记录编号。');
}
function heads(entries: JournalEntry[]) {
  const parents = new Set(entries.map(item => item.parent_revision).filter(Boolean));
  return entries.filter(item => !parents.has(item.revision_id));
}
function storedCitationIds(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  const value = result as Record<string, unknown>, ids: string[] = [];
  for (const field of ['evidence', 'counterarguments', 'candidates']) {
    const items = value[field];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const sourceIds = (item as Record<string, unknown>).source_ids;
      if (Array.isArray(sourceIds)) ids.push(...sourceIds.filter((id): id is string => typeof id === 'string'));
    }
  }
  return [...new Set(ids)];
}

export type WorkspaceDependencies = { readFinancial(): Snapshot; ledgerPending(): boolean };
export function createWorkspaceRepository(storage: StoragePort, runtime: Runtime, dependencies: WorkspaceDependencies) {
  let generation = 0;
  function raw(key: string, message: string) { try { return storage.get(key); } catch { throw Error(message); } }
  function readRoot(): Root | undefined {
    const text = raw(WORKSPACE_ROOT_KEY, '无法读取工作区根指针。');
    if (!text) return undefined;
    const parsed = rootSchema.safeParse(parse(text, '工作区根指针损坏。'));
    if (!parsed.success) throw Error('工作区根指针损坏或版本不兼容。');
    return parsed.data;
  }
  function pending() {
    const text = raw(WORKSPACE_PENDING_KEY, '工作区保存状态无法回读核验。');
    if (!text) return undefined;
    const marker = pendingSchema.safeParse(parse(text, '工作区待核验状态损坏。'));
    if (!marker.success) throw new WorkspacePersistenceError('WORKSPACE_CONFLICT', '工作区待核验状态损坏或版本不兼容。');
    const before = raw(WORKSPACE_PENDING_BEFORE_KEY, '工作区待核验原指针无法读取。');
    const next = raw(WORKSPACE_PENDING_NEXT_KEY, '工作区待核验新指针无法读取。');
    if (before) rootSchema.parse(parse(before, '工作区原指针损坏。'));
    rootSchema.parse(parse(next, '工作区新指针损坏。'));
    return { before, next, replacement: marker.data.replacement };
  }
  function pendingOutcome(op: NonNullable<ReturnType<typeof pending>>) {
    let current: string;
    try { current = storage.get(WORKSPACE_ROOT_KEY); }
    catch { throw new WorkspacePersistenceError('WORKSPACE_UNKNOWN', '工作区保存结果待核验；请恢复存储后核验，不要重复生成。'); }
    if (current === op.next) return 'confirmed' as const;
    if (current === op.before) return 'retryable' as const;
    throw new WorkspacePersistenceError('WORKSPACE_CONFLICT', '工作区根指针与待核验提交冲突，已停止写入。');
  }
  function clearPending() {
    try { setVerified(storage, WORKSPACE_PENDING_KEY, '', '工作区提交已确认，但状态清理失败'); } catch { return; }
    for (const key of [WORKSPACE_PENDING_BEFORE_KEY, WORKSPACE_PENDING_NEXT_KEY]) try { storage.set(key, ''); } catch { /* orphan staging is inert */ }
  }
  function cleanupCommittedRoot(text: string) {
    if (!text) return;
    try {
      const root = rootSchema.parse(JSON.parse(text)), manifestText = storage.get(root.manifest_key), manifest = manifestSchema.parse(JSON.parse(manifestText));
      for (const ref of Object.values(manifest.partitions)) try { storage.set(ref.key, ''); } catch { /* unreferenced data may be retried by later housekeeping */ }
      try { storage.set(root.manifest_key, ''); } catch { /* inert unreferenced manifest */ }
    } catch { /* never turn a confirmed new root into an unknown outcome */ }
  }
  function verifyPending() {
    const op = pending(); if (!op) return 'none' as const;
    const result = pendingOutcome(op); if (result === 'confirmed') clearPending();
    return result;
  }
  function retryPending() {
    const op = pending(); if (!op) return 'none' as const;
    if (pendingOutcome(op) === 'confirmed') { clearPending(); return 'confirmed' as const; }
    try { storage.set(WORKSPACE_ROOT_KEY, op.next); } catch { /* readback decides */ }
    if (pendingOutcome(op) !== 'confirmed') throw new WorkspacePersistenceError('WORKSPACE_NOT_WRITTEN', '工作区原提交重试未写入。');
    clearPending(); generation++; return 'confirmed' as const;
  }
  function commitRoot(next: Root, replacement = false) {
    if (pending()) throw new WorkspacePersistenceError('WORKSPACE_PENDING', '有一笔工作区保存待核验，已暂停新写入。');
    const before = raw(WORKSPACE_ROOT_KEY, '无法读取工作区根指针。'), nextText = JSON.stringify(rootSchema.parse(next));
    setVerified(storage, WORKSPACE_PENDING_BEFORE_KEY, before, '工作区原指针暂存失败');
    setVerified(storage, WORKSPACE_PENDING_NEXT_KEY, nextText, '工作区新指针暂存失败');
    setVerified(storage, WORKSPACE_PENDING_KEY, JSON.stringify({ version: 2, replacement }), '工作区提交屏障保存失败');
    try { storage.set(WORKSPACE_ROOT_KEY, nextText); } catch { /* readback decides */ }
    const op = pending();
    if (!op) throw new WorkspacePersistenceError('WORKSPACE_UNKNOWN', '工作区保存状态丢失，已停止写入。');
    let result: 'confirmed' | 'retryable';
    try { result = pendingOutcome(op); }
    catch (error) { if (error instanceof WorkspacePersistenceError) throw error; throw new WorkspacePersistenceError('WORKSPACE_UNKNOWN', '工作区保存结果待核验。'); }
    if (result === 'retryable') throw new WorkspacePersistenceError('WORKSPACE_NOT_WRITTEN', '工作区保存已确认未写入，可安全重试原提交。');
    clearPending(); if (!replacement) cleanupCommittedRoot(before); generation++;
  }
  function readPartition<T>(ref: z.infer<typeof partitionRefSchema>, schema: z.ZodType<T>, label: string): T {
    const text = raw(ref.key, `无法读取工作区${label}分区。`);
    if (utf8Size(text) !== ref.bytes || contentHash(text) !== ref.checksum) throw Error(`工作区${label}分区损坏或不完整。`);
    const result = schema.safeParse(parse(text, `工作区${label}分区损坏。`));
    if (!result.success) throw Error(`工作区${label}分区损坏或版本不兼容。`);
    return result.data;
  }
  function readAt(root: Root): WorkspaceState {
    const text = raw(root.manifest_key, '无法读取工作区清单。');
    const parsed = manifestSchema.safeParse(parse(text, '工作区清单损坏。'));
    if (!parsed.success) throw Error('工作区清单损坏或版本不兼容。');
    const manifest = parsed.data;
    if (manifest.instance_id !== root.active_instance_id || manifest.portfolio_id !== root.portfolio_id || manifest.generation !== root.generation) throw Error('工作区清单与根指针不一致。');
    const journal = readPartition(manifest.partitions.journal, journalPartitionSchema, '日记').entries;
    const chat = readPartition(manifest.partitions.chat, chatPartitionSchema, '会话');
    const storedRuns = readPartition(manifest.partitions.run, interimRunPartitionSchema, '分析').runs;
    const runs = storedRuns.map(run => analysisRunSchema.parse({ ...run, source_ids: run.source_ids ?? storedCitationIds(run.result) }));
    const sources = readPartition(manifest.partitions.source, sourcePartitionSchema, '来源').sources;
    const policies = readPartition(manifest.partitions.policy, policyPartitionSchema, '计划').policies;
    const outbox = readPartition(manifest.partitions.outbox, outboxPartitionSchema, '待处理请求').turns;
    const state = workspaceStateSchema.safeParse({ version: 2, instance_id: manifest.instance_id, portfolio_id: manifest.portfolio_id, root_generation: manifest.generation, migration: manifest.migration, journal, conversations: chat.conversations, messages: chat.messages, runs, sources, policies, outbox });
    if (!state.success) throw Error('工作区引用损坏或版本不兼容。');
    validateWorkspaceReferences(state.data);
    return state.data;
  }
  function stageState(state: WorkspaceState) {
    const valid = workspaceStateSchema.parse(state), revision = runtime.id();
    const base = `${WORKSPACE_PREFIX}.instance.${valid.instance_id}.${revision}`;
    const payloads = {
      journal: JSON.stringify(journalPartitionSchema.parse({ version: 2, entries: valid.journal })),
      chat: JSON.stringify(chatPartitionSchema.parse({ version: 2, conversations: valid.conversations, messages: valid.messages })),
      run: JSON.stringify(runPartitionSchema.parse({ version: 2, runs: valid.runs })),
      source: JSON.stringify(sourcePartitionSchema.parse({ version: 2, sources: valid.sources })),
      policy: JSON.stringify(policyPartitionSchema.parse({ version: 2, policies: valid.policies })),
      outbox: JSON.stringify(outboxPartitionSchema.parse({ version: 2, turns: valid.outbox })),
    };
    if (Object.values(payloads).some(text => utf8Size(text) > 800 * 1024)) throw Error('工作区单个分区超过 800 KiB，请先导出完整备份并整理旧内容。');
    if (storage.info) {
      try { const info = storage.info(), extra = Object.values(payloads).reduce((sum, text) => sum + utf8Size(text), 4096); if (info.currentSize * 1024 + extra > info.limitSize * 1024) throw Error('工作区本地空间不足，请先导出完整备份。'); } catch (error) { if (error instanceof Error && error.message.includes('空间不足')) throw error; }
    }
    const partitions = {} as Record<keyof typeof payloads, z.infer<typeof partitionRefSchema>>;
    for (const name of Object.keys(payloads) as Array<keyof typeof payloads>) {
      const key = `${base}.${name}`, text = payloads[name]; setVerified(storage, key, text, `工作区${name}分区保存失败`);
      partitions[name] = { key, checksum: contentHash(text), bytes: utf8Size(text) };
    }
    const nextGeneration = valid.root_generation;
    const manifestKey = `${base}.manifest`;
    setVerified(storage, manifestKey, JSON.stringify(manifestSchema.parse({ version: 2, instance_id: valid.instance_id, portfolio_id: valid.portfolio_id, generation: nextGeneration, created_at: runtime.now(), migration: valid.migration, partitions })), '工作区清单保存失败');
    const root: Root = { version: 2, active_instance_id: valid.instance_id, portfolio_id: valid.portfolio_id, generation: nextGeneration, manifest_key: manifestKey, switched_at: runtime.now() };
    return { root, state: valid, bytes: Object.values(payloads).reduce((sum, text) => sum + utf8Size(text), utf8Size(JSON.stringify(root))) };
  }
  function writeState(state: WorkspaceState, replacement = false) {
    const staged = stageState(state);
    commitRoot(staged.root, replacement);
    return readAt(rootSchema.parse(JSON.parse(storage.get(WORKSPACE_ROOT_KEY))));
  }
  function readLegacyPartition<T>(ref: z.infer<typeof partitionRefSchema>, schema: z.ZodType<T>, label: string): T {
    const text = raw(ref.key, `无法读取旧工作区${label}分区。`);
    if (utf8Size(text) !== ref.bytes || contentHash(text) !== ref.checksum) throw Error(`旧工作区${label}分区损坏或不完整。`);
    return schema.parse(parse(text, `旧工作区${label}分区损坏。`));
  }
  function readLegacyState(): WorkspaceState | undefined {
    const rootText = raw(`${LEGACY_WORKSPACE_PREFIX}.root`, '无法读取旧工作区根指针。');
    if (!rootText) return undefined;
    const root = legacyRootSchema.parse(parse(rootText, '旧工作区根指针损坏。'));
    const manifest = legacyManifestSchema.parse(parse(raw(root.manifest_key, '无法读取旧工作区清单。'), '旧工作区清单损坏。'));
    const journal = readLegacyPartition(manifest.partitions.journal, legacyJournalPartitionSchema, '日记').entries;
    const chat = readLegacyPartition(manifest.partitions.chat, legacyChatPartitionSchema, '会话');
    const oldRuns = readLegacyPartition(manifest.partitions.run, legacyRunPartitionSchema, '分析').runs
      .map(run => legacyAnalysisRunSchema.parse({ ...run, source_ids: run.source_ids ?? storedCitationIds(run.result) }));
    const oldSources = readLegacyPartition(manifest.partitions.source, legacySourcePartitionSchema, '来源').sources;
    const policies = readLegacyPartition(manifest.partitions.policy, legacyPolicyPartitionSchema, '计划').policies;
    const sources = oldSources.map(source => sourceSnapshotSchema.parse({ id: source.id, origin_entity_id: source.id, origin_revision: source.revision, type: source.type, as_of: source.as_of, available_at: source.available_at, content_digest: sha256(source.content), content: source.content }));
    const runs = oldRuns.map(run => analysisRunSchema.parse({ schema_version: 2, id: run.id, request_id: run.request_id, conversation_id: run.conversation_id, parent_run_id: run.parent_run_id, mode: run.mode, journal_date: run.journal_date, state: run.state, output_validated: run.output_validated, local_saved: run.local_saved, execution_kind: 'fake', data_mode: 'demo', provider_id: 'legacy-fake', source_integrity: 'legacy_unverified', source_ids: run.source_ids, final_manifest: { legacy_workspace_version: 1, source_ids: run.source_ids }, provider_metadata: { protocol: 'legacy-local', model: 'deterministic-fake', credential_mode: 'not_applicable', input_units: 0, output_units: 0 }, result: run.result, created_at: run.created_at, completed_at: run.completed_at }));
    return workspaceStateSchema.parse({ version: 2, instance_id: manifest.instance_id, portfolio_id: manifest.portfolio_id, root_generation: manifest.generation + 1, migration: manifest.migration, journal, conversations: chat.conversations, messages: chat.messages.map(message => messageSchema.parse({ ...message, execution_kind: message.role === 'assistant' ? 'fake' : null })), runs, sources, policies, outbox: [] });
  }
  function replacementState(input: WorkspaceState, financial: Snapshot) {
    validateWorkspaceReferences(input);
    if (input.portfolio_id !== financial.portfolio.id) throw Error('完整备份的账本与工作区不匹配。');
    const instance = runtime.id();
    const conversations = input.conversations.map(item => ({ ...item, workspace_instance_id: instance }));
    const outbox = input.outbox.map(turn => outboxTurnSchema.parse({ ...turn, status: 'detached', updated_at: runtime.now(), detached_reason: '备份导入后已隔离，不会自动重发。' }));
    return workspaceStateSchema.parse({ ...input, instance_id: instance, portfolio_id: financial.portfolio.id, root_generation: 1, conversations, outbox });
  }
  function legacyState(financial: Snapshot) {
    const used = new Set<string>(), instance = unique(runtime, used), map: Record<string, string> = {};
    const journal = financial.reviews.map(review => {
      const id = unique(runtime, used); map[review.date] = id;
      return journalEntrySchema.parse({ id, revision_id: unique(runtime, used), parent_revision: null, journal_date: review.date, type: 'personal_note', ref_id: null, body: review.text, classification: 'user_original', created_at: review.updated_at, updated_at: review.updated_at });
    });
    return workspaceStateSchema.parse({ version: 2, instance_id: instance, portfolio_id: financial.portfolio.id, root_generation: 1, migration: { source: 'legacy_reviews', completed_at: runtime.now(), legacy_review_map: map }, journal, conversations: [], messages: [], runs: [], sources: [], policies: [{ portfolio_id: financial.portfolio.id, status: 'unknown' }], outbox: [] });
  }
  function prepareReplacement(input: WorkspaceState | undefined, financial: Snapshot) {
    if (pending()) throw new WorkspacePersistenceError('WORKSPACE_PENDING', '有一笔工作区保存待核验，已暂停恢复。');
    const state = input ? replacementState(input, financial) : legacyState(financial);
    const staged = stageState(state);
    if (storage.info) {
      let info: { currentSize: number; limitSize: number } | undefined;
      try { info = storage.info(); } catch { /* host quota unavailable */ }
      if (info && info.currentSize * 1024 + staged.bytes > info.limitSize * 1024) throw Error('完整恢复失败：本地空间不足以准备新工作区。');
    }
    return { state: staged.state, commit() { const before = storage.get(WORKSPACE_ROOT_KEY); if (before) setVerified(storage, WORKSPACE_PREVIOUS_KEY, before, '工作区恢复点保存失败'); commitRoot(staged.root, true); } };
  }
  function migrate(financial: Snapshot) {
    if (dependencies.ledgerPending()) throw new WorkspacePersistenceError('LEDGER_PENDING', '账本有提交待核验，解决后才能迁移工作区。');
    return writeState(legacyState(financial), true);
  }
  function read() {
    const op = pending();
    if (op) {
      const outcome = pendingOutcome(op);
      if (outcome === 'confirmed') clearPending();
      else throw new WorkspacePersistenceError('WORKSPACE_PENDING', '工作区保存已确认未写入，请安全重试原提交。');
    }
    const financial = dependencies.readFinancial(), root = readRoot();
    if (!root) {
      const legacy = readLegacyState();
      if (legacy) return writeState(legacy, true);
      return migrate(financial);
    }
    if (root.portfolio_id !== financial.portfolio.id) throw Error('工作区与当前账本不匹配，已停止写入。');
    generation = Math.max(generation, root.generation);
    return readAt(root);
  }
  function mutate(change: (state: WorkspaceState) => WorkspaceState) {
    const state = read(); return writeState(workspaceStateSchema.parse(change(state)));
  }
  function savePersonalNote(date: string, text: string, id?: string, expectedRevision?: string) {
    const body = String(text).trim(); if (!body || body.length > 4000) throw Error('请填写 1–4000 字的个人记录。');
    let saved!: JournalEntry;
    mutate(state => {
      const current = id ? heads(state.journal).find(item => item.id === id) : undefined;
      if (id && !current) throw Error('个人记录不存在。');
      if (current && current.revision_id !== expectedRevision) throw Error('个人记录已在其他页面修订，请刷新后重试。');
      const used = new Set(state.journal.flatMap(item => [item.id, item.revision_id]));
      saved = journalEntrySchema.parse({ id: current?.id ?? unique(runtime, used), revision_id: unique(runtime, used), parent_revision: current?.revision_id ?? null, journal_date: date, type: 'personal_note', ref_id: null, body, classification: 'user_original', created_at: current?.created_at ?? runtime.now(), updated_at: runtime.now() });
      return { ...state, root_generation: state.root_generation + 1, journal: [...state.journal, saved] };
    });
    return saved;
  }
  function createConversation(input: Pick<Conversation, 'origin' | 'anchor_id' | 'context_mode'>) {
    let conversation!: Conversation;
    mutate(state => {
      conversation = conversationSchema.parse({ ...input, id: runtime.id(), workspace_instance_id: state.instance_id, created_at: runtime.now(), updated_at: runtime.now() });
      return { ...state, root_generation: state.root_generation + 1, conversations: [...state.conversations, conversation] };
    });
    return conversation;
  }
  function archiveAnalysis(input: { conversation: Conversation; user_message: any; assistant_message: any; run: any; sources?: SourceSnapshot[] }) {
    let journal!: JournalEntry;
    mutate(state => {
      const existing = state.runs.find(item => item.id === input.run.id || item.request_id === input.run.request_id);
      if (existing) {
        if (existing.id !== input.run.id || JSON.stringify(existing.result) !== JSON.stringify(input.run.result) || JSON.stringify(existing.source_ids) !== JSON.stringify(input.run.source_ids)) throw Error('分析幂等冲突：同一请求对应不同结果。');
        journal = heads(state.journal).find(item => item.type === 'analysis_ref' && item.ref_id === existing.id)!;
        return state;
      }
      if (!state.conversations.some(item => item.id === input.conversation.id)) throw Error('分析会话不存在。');
      const run = analysisRunSchema.parse(input.run);
      const user = messageSchema.parse(input.user_message), assistant = messageSchema.parse(input.assistant_message);
      const used = new Set(state.journal.flatMap(item => [item.id, item.revision_id]));
      journal = journalEntrySchema.parse({ id: unique(runtime, used), revision_id: unique(runtime, used), parent_revision: null, journal_date: run.journal_date, type: 'analysis_ref', ref_id: run.id, body: null, classification: 'ai_reference', created_at: run.completed_at, updated_at: run.completed_at });
      const knownSources = new Map(state.sources.map(item => [item.id, item]));
      const parsedSources = (input.sources ?? []).map(item => sourceSnapshotSchema.parse(item));
      for (const source of parsedSources) {
        const known = knownSources.get(source.id);
        if (known && JSON.stringify(known) !== JSON.stringify(source)) throw Error('来源快照冲突：同一快照编号对应不同内容。');
      }
      const sources = parsedSources.filter(item => !knownSources.has(item.id));
      return { ...state, root_generation: state.root_generation + 1, messages: [...state.messages, user, assistant], runs: [...state.runs, run], sources: [...state.sources, ...sources], journal: [...state.journal, journal] };
    });
    return { journal, run: input.run };
  }
  function saveOutbox(turn: OutboxTurn) {
    let saved!: OutboxTurn;
    mutate(state => {
      const parsed = outboxTurnSchema.parse(turn);
      const existing = state.outbox.find(item => item.request_id === parsed.request_id || (item.workspace_instance_id === parsed.workspace_instance_id && item.client_turn_id === parsed.client_turn_id));
      if (existing) {
        if (existing.payload_digest !== parsed.payload_digest || existing.request_id !== parsed.request_id) throw Error('待处理请求幂等冲突。');
        saved = existing; return state;
      }
      saved = parsed;
      return { ...state, root_generation: state.root_generation + 1, outbox: [...state.outbox, parsed] };
    });
    return saved;
  }
  function updateOutbox(requestId: string, expectedDigest: string, change: (turn: OutboxTurn) => OutboxTurn) {
    let saved!: OutboxTurn;
    mutate(state => {
      const index = state.outbox.findIndex(item => item.request_id === requestId);
      if (index < 0) throw Error('待处理请求不存在。');
      if (state.outbox[index].payload_digest !== expectedDigest) throw Error('待处理请求摘要冲突。');
      saved = outboxTurnSchema.parse(change(state.outbox[index]));
      const outbox = state.outbox.slice(); outbox[index] = saved;
      return { ...state, root_generation: state.root_generation + 1, outbox };
    });
    return saved;
  }
  function timeline(date: string) {
    return heads(read().journal).filter(item => item.journal_date === date).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
  }
  function conversation(id: string) {
    const state = read(), item = state.conversations.find(candidate => candidate.id === id);
    if (!item) throw Error('会话不存在。');
    return { conversation: item, messages: state.messages.filter(message => message.conversation_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)), runs: state.runs.filter(run => run.conversation_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) };
  }
  function readPrevious() {
    const text = raw(WORKSPACE_PREVIOUS_KEY, '无法读取工作区恢复点。');
    if (!text) throw Error('还没有可用的完整工作区恢复点。');
    const root = rootSchema.safeParse(parse(text, '工作区恢复点损坏。'));
    if (!root.success) throw Error('工作区恢复点损坏或不兼容。');
    return readAt(root.data);
  }
  function readPreviousOptional() {
    const text = raw(WORKSPACE_PREVIOUS_KEY, '无法读取工作区恢复点。');
    if (!text) return undefined;
    const root = rootSchema.safeParse(parse(text, '工作区恢复点损坏。'));
    if (!root.success) throw Error('工作区恢复点损坏或不兼容。');
    return readAt(root.data);
  }
  function confirmPolicy(input: { effective_from: string; horizon: string | null; max_single_weight: string | null; targets?: Array<{ instrument_id: string; weight: string }> }) {
    let policy!: Policy;
    mutate(state => {
      const previous = state.policies.at(-1);
      policy = policySchema.parse({ portfolio_id: state.portfolio_id, status: 'confirmed', id: previous?.status === 'confirmed' ? previous.id : runtime.id(), revision_id: runtime.id(), confirmed_at: runtime.now(), effective_from: input.effective_from, max_single_weight: input.max_single_weight, horizon: input.horizon, targets: input.targets ?? [] });
      return { ...state, root_generation: state.root_generation + 1, policies: [...state.policies, policy] };
    });
    return policy;
  }
  return { read, readPrevious, readPreviousOptional, pendingSave: () => !!pending(), verifyPending, retryPending, generation: () => generation, prepareReplacement, savePersonalNote, createConversation, archiveAnalysis, saveOutbox, updateOutbox, timeline, conversation, confirmPolicy };
}

export function validateWorkspaceReferences(state: WorkspaceState) {
  const conversations = new Set(state.conversations.map(item => item.id));
  const runs = new Set(state.runs.map(item => item.id));
  const sourceIds = new Set(state.sources.map(item => item.id));
  if (state.conversations.some(item => item.workspace_instance_id !== state.instance_id)) throw Error('工作区会话引用了其他实例。');
  if (state.messages.some(item => !conversations.has(item.conversation_id) || (item.run_id && !runs.has(item.run_id)))) throw Error('工作区消息引用损坏。');
  if (state.runs.some(item => !conversations.has(item.conversation_id))) throw Error('工作区分析引用损坏。');
  if (state.outbox.some(item => item.envelope.request.workspace_instance_id !== item.workspace_instance_id || item.envelope.payload_digest !== item.payload_digest || (item.status !== 'detached' && (item.workspace_instance_id !== state.instance_id || !conversations.has(item.conversation_id))))) throw Error('工作区待处理请求引用损坏。');
  for (const run of state.runs) {
    const manifestSources = new Set(run.source_ids);
    if (run.source_ids.some(id => !sourceIds.has(id))) throw Error('工作区分析来源引用损坏。');
    const result = run.result as { evidence?: Array<{ source_ids?: string[] }>; counterarguments?: Array<{ source_ids?: string[] }>; candidates?: Array<{ source_ids?: string[] }> };
    const citations = [...(result.evidence ?? []), ...(result.counterarguments ?? []), ...(result.candidates ?? [])].flatMap(item => item.source_ids ?? []);
    if (citations.some(id => !manifestSources.has(id))) throw Error('工作区分析结果引用不属于本次来源清单。');
  }
  if (heads(state.journal).some(item => item.type === 'analysis_ref' && (!item.ref_id || !runs.has(item.ref_id)))) throw Error('工作区日记分析引用损坏。');
  if (state.sources.some(item => item.type === 'ai_output' && !sourceIds.has(item.id))) throw Error('工作区来源引用损坏。');
}
