import { assertSize, backupSchema, emptySnapshot, validateSnapshot, type Runtime, type Snapshot } from './model.ts';
export interface StoragePort { get(key: string): string; set(key: string, value: string): void }
export const STORAGE_KEY = 'portfolio.wechat.v1';
const RECOVERY_KEY = `${STORAGE_KEY}.previous`;
export function createRepository(storage: StoragePort, runtime: Runtime) {
  let initial: Snapshot | undefined;
  let generation = 0;
  function read(): Snapshot {
    let raw: string;
    try { raw = storage.get(STORAGE_KEY); } catch { throw Error('无法读取本地数据，请重试；没有覆盖现有账本。'); }
    if (raw === '') return initial ??= emptySnapshot(runtime);
    try { assertSize(raw); return validateSnapshot(JSON.parse(raw), runtime); }
    catch { throw Error('本地账本损坏或不兼容，已停止写入；请在设置中恢复有效备份。'); }
  }
  function encode(data: Snapshot) {
    const valid = validateSnapshot(data, runtime); const text = JSON.stringify(valid); assertSize(JSON.stringify({ format: 'portfolio-wechat-backup', version: 1, data: valid })); return text;
  }
  function write(data: Snapshot) {
    const text = encode(data);
    try { storage.set(STORAGE_KEY, text); } catch { throw Error('保存失败，本地空间不足或存储不可用；原账本未更新。'); }
  }
  function parseBackup(text: string) {
    assertSize(text);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw Error('备份不是有效 JSON 文件。'); }
    const backup = backupSchema.safeParse(parsed);
    if (!backup.success) throw Error('备份格式不正确；仅支持此小程序导出的 v1 备份。');
    return validateSnapshot(backup.data.data, runtime);
  }
  function replace(data: Snapshot) {
    const text = encode(data);
    // Never replace a valid recovery point with malformed current bytes.
    // A failed main write leaves the old main and any valid recovery readable.
    try {
      const previous = storage.get(STORAGE_KEY);
      let previousValid = false;
      if (previous !== '') { try { validateSnapshot(JSON.parse(previous), runtime); previousValid = true; } catch { /* Preserve the existing recovery point. */ } }
      if (previousValid) storage.set(RECOVERY_KEY, previous);
      storage.set(STORAGE_KEY, text);
      generation++;
    } catch { throw Error('恢复保存失败，未能完成备份恢复；请检查本地存储。'); }
  }
  return { read, write, parseBackup, replace, generation: () => generation,
    recoverPrevious() {
      const raw = storage.get(RECOVERY_KEY); if (!raw) throw Error('还没有可用的恢复点。');
      let data: Snapshot;
      try { data = validateSnapshot(JSON.parse(raw), runtime); } catch { throw Error('恢复点损坏或不兼容，请选择其他备份。'); }
      // Keep the known-good recovery point intact even when the primary write fails.
      write(data);
      generation++;
    },
    exportBackup() { const text = JSON.stringify({ format: 'portfolio-wechat-backup', version: 1, data: read() }); assertSize(text); return text; },
  };
}
