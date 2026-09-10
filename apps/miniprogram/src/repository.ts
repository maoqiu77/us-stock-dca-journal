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
  function write(data: Snapshot) {
    const text = encode(data);
    setVerified(storage, STORAGE_KEY, text, '保存失败，本地空间不足、存储不可用或保存结果待核验');
  }
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
    const text = encode(data); const previous = rawPrimary();
    let previousValid = false;
    if (previous !== '') { try { decodeSnapshot(previous, runtime); previousValid = true; } catch { /* Existing recovery stays untouched. */ } }
    ensureReplaceCapacity(previousValid ? previous : '', text);
    if (previousValid) setVerified(storage, RECOVERY_KEY, previous, '恢复保存失败，替换前恢复点未通过核验');
    setVerified(storage, STORAGE_KEY, text, '恢复保存失败，主数据未通过核验');
    currentGeneration++;
  }
  function decodeTrusted(raw: string) { assertSize(raw); return decodeSnapshot(raw, runtime).data; }
  return {
    read, write, parseBackup, replace, generation: () => currentGeneration,
    readState() { const data = read(); return { data, ...clockState(data, runtime) }; },
    exportRaw() { return rawPrimary(); },
    recoverPrevious() {
      let raw: string; try { raw = storage.get(RECOVERY_KEY); } catch { throw Error('无法读取恢复点。'); }
      if (!raw) throw Error('还没有可用的恢复点。');
      let data: Snapshot; try { data = decodeTrusted(raw); } catch { throw Error('恢复点损坏或不兼容，请选择其他备份。'); }
      write(data); currentGeneration++;
    },
    exportBackup() { const text = JSON.stringify({ format: 'portfolio-wechat-backup', version: 2, data: read() }); assertSize(text); return text; },
  };
}
