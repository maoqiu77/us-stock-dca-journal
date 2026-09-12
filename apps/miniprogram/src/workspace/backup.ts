import { z } from 'zod';
import { activeEvents, backupSchema, backupV1Schema, migrateV1Snapshot, snapshotSchema, validateSnapshot, type Runtime, type Snapshot } from '../model.ts';
import { workspaceStateSchema, type WorkspaceState } from '../journal/model.ts';
import { validateWorkspaceReferences } from './repository.ts';

export const fullBackupSchema = z.strictObject({
  format: z.literal('portfolio-wechat-backup'),
  version: z.literal(3),
  exported_at: z.string().datetime({ offset: true }),
  scope: z.strictObject({ financial: z.literal(true), journal: z.literal(true), conversations: z.literal(true), analysis_runs: z.literal(true), sources: z.literal(true), policies: z.literal(true) }),
  data: z.strictObject({ financial: snapshotSchema, workspace: workspaceStateSchema }),
});

export type CompleteBackup = { version: 1 | 2 | 3; financial: Snapshot; workspace?: WorkspaceState };
function json(text: string) { try { return JSON.parse(text); } catch { throw Error('备份不是有效 JSON 文件。'); } }
export function encodeFullBackup(financial: Snapshot, workspace: WorkspaceState, runtime: Runtime) {
  validateWorkspaceReferences(workspace);
  if (workspace.portfolio_id !== financial.portfolio.id) throw Error('完整备份的账本与工作区不匹配。');
  return JSON.stringify(fullBackupSchema.parse({ format: 'portfolio-wechat-backup', version: 3, exported_at: runtime.now(), scope: { financial: true, journal: true, conversations: true, analysis_runs: true, sources: true, policies: true }, data: { financial, workspace } }));
}
export function parseCompleteBackup(text: string, runtime: Runtime): CompleteBackup {
  const input = json(text);
  const full = fullBackupSchema.safeParse(input);
  if (full.success) {
    const financial = validateSnapshot(full.data.data.financial, runtime, { external: true }), workspace = full.data.data.workspace;
    validateWorkspaceReferences(workspace);
    if (workspace.portfolio_id !== financial.portfolio.id) throw Error('完整备份的账本与工作区引用不一致。');
    return { version: 3, financial, workspace };
  }
  const v2 = backupSchema.safeParse(input);
  if (v2.success) return { version: 2, financial: validateSnapshot(v2.data.data, runtime, { external: true }) };
  const v1 = backupV1Schema.safeParse(input);
  if (v1.success) return { version: 1, financial: validateSnapshot(migrateV1Snapshot(v1.data.data), runtime, { external: true }) };
  throw Error('备份格式不正确或版本不受支持；仅支持严格的 v1、v2 或 v3 小程序备份。');
}
export function backupPreview(backup: CompleteBackup, runtime: Runtime) {
  const financial = backup.financial, active = activeEvents(financial, runtime);
  const heads = backup.workspace ? (() => { const parents = new Set(backup.workspace!.journal.map(item => item.parent_revision).filter(Boolean)); return backup.workspace!.journal.filter(item => !parents.has(item.revision_id)); })() : financial.reviews;
  return { version: backup.version, openings: active.filter(item => !item.voided && item.kind === 'opening_position').length, trades: active.filter(item => !item.voided && (item.kind === 'buy' || item.kind === 'sell')).length, personalNotes: backup.workspace ? heads.filter(item => 'type' in item && item.type === 'personal_note').length : financial.reviews.length, conversations: backup.workspace?.conversations.length ?? 0, runs: backup.workspace?.runs.length ?? 0, sources: backup.workspace?.sources.length ?? 0, mode: financial.mode, complete: backup.version === 3 };
}

