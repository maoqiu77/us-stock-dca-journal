import { assertSize, backupSchema, backupV1Schema, clockState, emptySnapshot, migrateV1Snapshot, snapshotV1Schema, utf8Size, validateSnapshot, type Runtime, type Snapshot } from './model.ts';

export interface StoragePort {
  get(key: string): string;
  set(key: string, value: string): void;
  /** WeChat reports both values in KiB. */
  info?(): { currentSize: number; limitSize: number };
}
export const STORAGE_KEY = 'portfolio.wechat.v1';
export const RECOVERY_KEY = `${STORAGE_KEY}.previous`;
export const MIGRATION_KEY = `${STORAGE_KEY}.migration-v1`;
export const PENDING_KEY = `${STORAGE_KEY}.pending-v1`;
export const PENDING_BEFORE_KEY = `${PENDING_KEY}.before`;
export const PENDING_NEXT_KEY = `${PENDING_KEY}.next`;
type Pending = { version: 1; before: string; next: string; replacement: boolean };
export class PersistenceError extends Error {
  readonly code: string;
  submissionIdentity?: string;
  constructor(code: string, message: string, submissionIdentity?: string) { super(message); this.name = 'PersistenceError'; this.code = code; this.submissionIdentity = submissionIdentity; }
}


function json(text: string, message: string): unknown { try { return JSON.parse(text); } catch { throw Error(message); } }
function setVerified(storage: StoragePort, key: string, value: string, message: string) {
  try { storage.set(key, value); } catch { /* Some hosts throw after committing. Verification decides the result. */ }
  let actual = '';
  try { actual = storage.get(key); } catch { throw Error(`${message}；无法回读核验。`); }
  if (actual !== value) throw Error(`${message}；回读核验未通过。`);
}
function decodeSnapshot(raw: string, runtime: Runtime): { data: Snapshot; v1: boolean } {
  const input = json(raw, '账本不是有效 JSON。');
  const current = validateSnapshotSafely(input, runtime);
  if (current) return { data: current, v1: false };
  const legacy = snapshotV1Schema.safeParse(input);
  if (!legacy.success) throw Error('账本格式不正确或版本不受支持。');
  return { data: validateSnapshot(migrateV1Snapshot(legacy.data), runtime), v1: true };
}
function validateSnapshotSafely(input: unknown, runtime: Runtime) { try { return validateSnapshot(input, runtime); } catch { return undefined; } }

export function createRepository(storage: StoragePort, runtime: Runtime) {
  let initial: Snapshot | undefined;
  let currentGeneration = 0;
  function rawPrimary() { try { return storage.get(STORAGE_KEY); } catch { throw Error('无法读取本地数据，请重试；没有覆盖现有账本。'); } }
  function encode(data: Snapshot) {
    const valid = validateSnapshot(data, runtime); const text = JSON.stringify(valid);
    assertSize(JSON.stringify({ format: 'portfolio-wechat-backup', version: 2, data: valid })); return text;
  }
  function migratePrimary(raw: string, data: Snapshot) {
    const migrated = encode(data);
    try {
      const protectedRaw = storage.get(MIGRATION_KEY);
      if (protectedRaw !== raw) setVerified(storage, MIGRATION_KEY, raw, '账本升级失败，旧版原文未能安全保留');
      setVerified(storage, STORAGE_KEY, migrated, '账本升级失败，主数据未通过核验');
    } catch (error) { throw error instanceof Error && error.message.includes('升级') ? error : Error('账本升级失败，旧版原文仍保留在主数据中。'); }
  }
  function read(): Snapshot {
    const raw = rawPrimary(); if (raw === '') return initial ??= emptySnapshot(runtime);
    try { assertSize(raw); const decoded = decodeSnapshot(raw, runtime); if (decoded.v1) migratePrimary(raw, decoded.data); return decoded.data; }
    catch (error) {
      if (error instanceof Error && error.message.includes('升级')) throw error;
      throw Error('本地账本损坏或不兼容，已停止写入；可导出原始故障数据或恢复有效备份。');
    }
  }
  function pending(): Pending | undefined {
    let raw: string;
    try { raw = storage.get(PENDING_KEY); } catch { throw new PersistenceError('SAVE_UNKNOWN', '保存状态无法回读核验，请恢复存储后到设置核验保存结果。'); }
    if (!raw) return;
    try {
      assertSize(raw); const value = JSON.parse(raw);
      if (value.version !== 1 || typeof value.replacement !== 'boolean' || Object.keys(value).sort().join() !== 'replacement,version') throw Error();
      let before: string, next: string;
      try { before = storage.get(PENDING_BEFORE_KEY); next = storage.get(PENDING_NEXT_KEY); }
      catch { throw new PersistenceError('SAVE_UNKNOWN', '待核验提交无法回读核验，请恢复存储后重试。'); }
      assertSize(next); assertSize(before); decodeSnapshot(next, runtime);
      if (!value.replacement && before) decodeSnapshot(before, runtime);
      return { ...value, before, next };
    } catch (error) { if (error instanceof PersistenceError) throw error; throw new PersistenceError('SAVE_CONFLICT', '待核验提交损坏或版本不兼容；已停止写入，请保留原始数据并检查记录，不能自动重放。'); }
  }
  function assertWritable() { if (pending()) throw new PersistenceError('SAVE_PENDING', '有一笔提交尚待核验，请先核验保存结果，不要重新录入。'); }
  function clearPending() {
    try { setVerified(storage, PENDING_KEY, '', '提交已核验，但保存状态清理失败'); }
    catch { return; } // Primary is already confirmed: housekeeping cannot turn success into an unknown save.
    // The manifest is the commit barrier. Orphan staging is never replayed;
    // best-effort cleanup after its verified removal is safe even on a crash.
    for (const key of [PENDING_BEFORE_KEY, PENDING_NEXT_KEY]) { try { storage.set(key, ''); } catch { /* Next submission overwrites unused staging. */ } }
  }
  function outcome(op: Pending): 'confirmed' | 'retryable' {
    let raw: string;
    try { raw = storage.get(STORAGE_KEY); } catch { throw new PersistenceError('SAVE_UNKNOWN', '保存结果待核验；无法回读核验。请使用“核验保存结果”，不要重新录入。'); }
    if (raw === op.next) return 'confirmed';
    if (raw === op.before) return 'retryable';
    // Append operations are identified by their exact immutable revisions, not
    // by matching trade fields or requiring the entire ledger to stay unchanged.
    if (!op.replacement && raw) {
      try {
        const actual = decodeSnapshot(raw, runtime).data, next = decodeSnapshot(op.next, runtime).data;
        const before = op.before ? decodeSnapshot(op.before, runtime).data : undefined;
        const additions = next.events.filter(e => !before?.events.some(old => old.revision_id === e.revision_id));
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        const reviews = next.reviews.filter(r => !before?.reviews.some(old => same(old, r)));
        if ((additions.length || reviews.length) && actual.portfolio.id === next.portfolio.id && actual.device_id === next.device_id && actual.mode === next.mode &&
          reviews.every(r => actual.reviews.some(item => same(item, r))) &&
          additions.every(e => actual.events.some(item => item.revision_id === e.revision_id && same(item, e))) &&
          next.instruments.every(i => actual.instruments.some(item => item.id === i.id && same(item, i)))) return 'confirmed';
      } catch { /* Missing or conflicting identity is never a retry authorization. */ }
    }
    throw new PersistenceError('SAVE_CONFLICT', '账本与待核验提交有冲突，已保留提交并停止写入。请导出备份、检查记录后处理，不能自动重放。');
  }
  function verifyPending(): 'none' | 'confirmed' | 'retryable' {
    const op = pending(); if (!op) return 'none';
    const result = outcome(op);
    if (result === 'confirmed') { if (op.replacement) currentGeneration++; clearPending(); }
    return result;
  }
  function commitPending(op: Pending) {
    if (op.replacement) currentGeneration++; // Invalidate pages even when readback fails.
    try { storage.set(STORAGE_KEY, op.next); } catch { /* Readback determines certainty. */ }
    let result: 'confirmed' | 'retryable';
    try { result = outcome(op); } catch (error) { if (error instanceof PersistenceError) error.submissionIdentity = op.next; throw error; }
    if (result === 'retryable') throw new PersistenceError('SAVE_NOT_WRITTEN', '保存失败，已核验本次未写入。输入已保留，请核验后安全重试原提交。', op.next);
    clearPending(); return 'confirmed' as const;
  }
  function retryPending() {
    const op = pending(); if (!op) return 'none' as const;
    if (outcome(op) === 'confirmed') { clearPending(); return 'confirmed' as const; }
    return commitPending(op);
  }
  function begin(data: Snapshot, replacement: boolean, before = rawPrimary()) {
    assertWritable(); const op: Pending = { version: 1, before, next: encode(data), replacement };
    // Each staged snapshot retains the existing per-value size limit; keeping
    // them separate avoids halving usable ledger capacity. No primary write
    // occurs before all staging AND the versioned manifest are read-verified.
    assertSize(before);
    try {
      setVerified(storage, PENDING_BEFORE_KEY, before, '保存失败，待核验原账本未能安全保存');
      setVerified(storage, PENDING_NEXT_KEY, op.next, '保存失败，待核验结果未能安全保存');
      setVerified(storage, PENDING_KEY, JSON.stringify({ version: 1, replacement }), '保存失败，待核验提交未能安全保存');
    } catch { throw new PersistenceError('SAVE_NOT_WRITTEN', '保存失败，待核验提交未通过回读核验；主账本尚未写入。请核验保存结果后再操作。', op.next); }
    return commitPending(op);
  }
  function write(data: Snapshot) { begin(data, false); }
  function parseBackup(text: string) {
    assertSize(text); const parsed = json(text, '备份不是有效 JSON 文件。');
    const current = backupSchema.safeParse(parsed);
    if (current.success) return validateSnapshot(current.data.data, runtime, { external: true });
    const legacy = backupV1Schema.safeParse(parsed);
    if (legacy.success) return validateSnapshot(migrateV1Snapshot(legacy.data.data), runtime, { external: true });
    throw Error('备份格式不正确；仅支持严格的 v1 或 v2 小程序备份，v1 不支持期初持仓交易类型。');
  }
  function ensureReplaceCapacity(previous: string, next: string) {
    if (!storage.info) return;
    let info: { currentSize: number; limitSize: number };
    try { info = storage.info(); } catch { return; }
    const extra = utf8Size(previous) + Math.max(0, utf8Size(next) - utf8Size(previous));
    if (info.currentSize * 1024 + extra > info.limitSize * 1024) throw Error('恢复保存失败：本地空间不足以同时保留当前账本和恢复点。');
  }
  function replace(data: Snapshot) {
    assertWritable(); const text = encode(data); const previous = rawPrimary();
    let previousValid = false;
    if (previous !== '') { try { decodeSnapshot(previous, runtime); previousValid = true; } catch { /* Existing recovery stays untouched. */ } }
    ensureReplaceCapacity(previousValid ? previous : '', text);
    if (previousValid) setVerified(storage, RECOVERY_KEY, previous, '恢复保存失败，替换前恢复点未通过核验');
    begin(data, true, previous);
  }
  function decodeTrusted(raw: string) { assertSize(raw); return decodeSnapshot(raw, runtime).data; }
  return {
    read, write, parseBackup, replace, assertWritable, pendingSave: () => !!pending(), pendingIdentity: () => pending()?.next ?? '', verifyPending, retryPending, generation: () => currentGeneration,
    ensurePersisted() { const data = read(); if (!rawPrimary()) write(data); return data; },
    readState() { const data = read(); return { data, ...clockState(data, runtime) }; },
    exportRaw() { return rawPrimary(); },
    readPrevious() {
      let raw: string; try { raw = storage.get(RECOVERY_KEY); } catch { throw Error('无法读取恢复点。'); }
      if (!raw) throw Error('还没有可用的恢复点。');
      try { return decodeTrusted(raw); } catch { throw Error('恢复点损坏或不兼容，请选择其他备份。'); }
    },
    recoverPrevious() {
      let raw: string; try { raw = storage.get(RECOVERY_KEY); } catch { throw Error('无法读取恢复点。'); }
      if (!raw) throw Error('还没有可用的恢复点。');
      let data: Snapshot; try { data = decodeTrusted(raw); } catch { throw Error('恢复点损坏或不兼容，请选择其他备份。'); }
      begin(data, true);
    },
    exportBackup() { const text = JSON.stringify({ format: 'portfolio-wechat-backup', version: 2, data: read() }); assertSize(text); return text; },
  };
}
