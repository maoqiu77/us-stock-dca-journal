import { z } from 'zod';
import { sha256 } from '@portfolio/ai-context';
import { activeEvents, backupSchema, backupV1Schema, migrateV1Snapshot, snapshotSchema, validateSnapshot, type Runtime, type Snapshot } from '../model.ts';
import { legacyWorkspaceStateSchema, workspaceStateSchema, type WorkspaceState } from '../journal/model.ts';
import { validateWorkspaceReferences } from './repository.ts';

export const fullBackupV3Schema = z.strictObject({
  format: z.literal('portfolio-wechat-backup'),
  version: z.literal(3),
  exported_at: z.string().datetime({ offset: true }),
  scope: z.strictObject({ financial: z.literal(true), journal: z.literal(true), conversations: z.literal(true), analysis_runs: z.literal(true), sources: z.literal(true), policies: z.literal(true) }),
  data: z.strictObject({ financial: snapshotSchema, workspace: legacyWorkspaceStateSchema }),
});
export const fullBackupSchema = z.strictObject({
  format: z.literal('portfolio-wechat-backup'), version: z.literal(4), exported_at: z.string().datetime({ offset: true }),
  scope: z.strictObject({ financial: z.literal(true), journal: z.literal(true), conversations: z.literal(true), analysis_runs: z.literal(true), sources: z.literal(true), policies: z.literal(true), outbox: z.literal(true) }),
  excludes: z.strictObject({ credentials: z.literal(true), cloud_identity: z.literal(true), server_access_config: z.literal(true) }),
  data: z.strictObject({ financial: snapshotSchema, workspace: workspaceStateSchema }),
});

export type CompleteBackup = { version: 1 | 2 | 3 | 4; financial: Snapshot; workspace?: WorkspaceState };
function json(text: string) { try { return JSON.parse(text); } catch { throw Error('备份不是有效 JSON 文件。'); } }
export function encodeFullBackup(financial: Snapshot, workspace: WorkspaceState, runtime: Runtime) {
  validateWorkspaceReferences(workspace);
  if (workspace.portfolio_id !== financial.portfolio.id) throw Error('完整备份的账本与工作区不匹配。');
  return JSON.stringify(fullBackupSchema.parse({ format: 'portfolio-wechat-backup', version: 4, exported_at: runtime.now(), scope: { financial: true, journal: true, conversations: true, analysis_runs: true, sources: true, policies: true, outbox: true }, excludes: { credentials: true, cloud_identity: true, server_access_config: true }, data: { financial, workspace } }));
}
export function parseCompleteBackup(text: string, runtime: Runtime): CompleteBackup {
  const input = json(text);
  const full = fullBackupSchema.safeParse(input);
  if (full.success) {
    const financial = validateSnapshot(full.data.data.financial, runtime, { external: true }), workspace = full.data.data.workspace;
    validateWorkspaceReferences(workspace);
    if (workspace.portfolio_id !== financial.portfolio.id) throw Error('完整备份的账本与工作区引用不一致。');
    return { version: 4, financial, workspace };
  }
  const oldFull = fullBackupV3Schema.safeParse(input);
  if (oldFull.success) {
    const financial = validateSnapshot(oldFull.data.data.financial, runtime, { external: true }), old = oldFull.data.data.workspace;
    const workspace = workspaceStateSchema.parse({ version: 2, instance_id: old.instance_id, portfolio_id: old.portfolio_id, root_generation: old.root_generation, migration: old.migration, journal: old.journal, conversations: old.conversations, messages: old.messages.map(message => ({ ...message, execution_kind: message.role === 'assistant' ? 'fake' : null })), runs: old.runs.map(run => ({ schema_version: 2, id: run.id, request_id: run.request_id, conversation_id: run.conversation_id, parent_run_id: run.parent_run_id, mode: run.mode, journal_date: run.journal_date, state: run.state, output_validated: run.output_validated, local_saved: run.local_saved, execution_kind: 'fake', data_mode: 'demo', provider_id: 'legacy-fake', source_integrity: 'legacy_unverified', source_ids: run.source_ids, final_manifest: { legacy_backup_version: 3, source_ids: run.source_ids }, provider_metadata: { protocol: 'legacy-local', model: 'deterministic-fake', credential_mode: 'not_applicable', input_units: 0, output_units: 0 }, result: run.result, created_at: run.created_at, completed_at: run.completed_at })), sources: old.sources.map(source => ({ id: source.id, origin_entity_id: source.id, origin_revision: source.revision, type: source.type, as_of: source.as_of, available_at: source.available_at, content_digest: sha256(source.content), content: source.content })), policies: old.policies, outbox: [] });
    validateWorkspaceReferences(workspace);
    if (workspace.portfolio_id !== financial.portfolio.id) throw Error('完整备份的账本与工作区引用不一致。');
    return { version: 3, financial, workspace };
  }
  const v2 = backupSchema.safeParse(input);
  if (v2.success) return { version: 2, financial: validateSnapshot(v2.data.data, runtime, { external: true }) };
  const v1 = backupV1Schema.safeParse(input);
  if (v1.success) return { version: 1, financial: validateSnapshot(migrateV1Snapshot(v1.data.data), runtime, { external: true }) };
  throw Error('备份格式不正确或版本不受支持；仅支持严格的 v1、v2、v3 或 v4 小程序备份。');
}
export function backupPreview(backup: CompleteBackup, runtime: Runtime) {
  const financial = backup.financial, active = activeEvents(financial, runtime);
  const heads = backup.workspace ? (() => { const parents = new Set(backup.workspace!.journal.map(item => item.parent_revision).filter(Boolean)); return backup.workspace!.journal.filter(item => !parents.has(item.revision_id)); })() : financial.reviews;
  return { version: backup.version, openings: active.filter(item => !item.voided && item.kind === 'opening_position').length, trades: active.filter(item => !item.voided && (item.kind === 'buy' || item.kind === 'sell')).length, personalNotes: backup.workspace ? heads.filter(item => 'type' in item && item.type === 'personal_note').length : financial.reviews.length, conversations: backup.workspace?.conversations.length ?? 0, runs: backup.workspace?.runs.length ?? 0, sources: backup.workspace?.sources.length ?? 0, mode: financial.mode, complete: backup.version === 3 || backup.version === 4 };
}
