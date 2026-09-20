import { sha256 } from '@portfolio/ai-context';
import { utf8Size } from '../model.ts';
import type { StoragePort } from '../repository.ts';

export const RESTORE_TRANSACTION_KEY = 'portfolio.wechat.restore.v1';
const prefix = `${RESTORE_TRANSACTION_KEY}.stage.`;
type Entry = { key: string; stage: string; digest: string };

/** The marker is the durable commit decision. Before it: old data. After it:
 * finish the approved local replacement before exposing any repository reads.
 * Staging uses separate values so it does not halve the ledger's size limit.
 * No network operation or AI request is part of recovery. */
export function createRestoreStorage(base: StoragePort) {
  let draft: Map<string, string> | undefined;
  function verified(key: string, text: string) {
    try { base.set(key, text); } catch { /* A host may throw after writing. */ }
    if (base.get(key) !== text) throw Error('完整恢复写入未完成，请恢复本地存储后重新打开；不要重复导入。');
  }
  function recover() {
    const raw = base.get(RESTORE_TRANSACTION_KEY);
    if (!raw) return;
    let entries: Entry[];
    try {
      const marker = JSON.parse(raw);
      if (marker.version !== 1 || !Array.isArray(marker.entries) || !marker.entries.length || marker.entries.length > 200) throw Error();
      entries = marker.entries;
      const keys = new Set<string>();
      for (const [index, item] of entries.entries()) {
        if (typeof item.key !== 'string' || !item.key.startsWith('portfolio.wechat.') || item.key.startsWith(RESTORE_TRANSACTION_KEY) || item.stage !== `${prefix}${index}` || !/^[a-f0-9]{64}$/.test(item.digest) || keys.has(item.key)) throw Error();
        keys.add(item.key);
      }
    } catch { throw Error('完整恢复事务损坏或版本不兼容，已停止读写，请保留本地数据。'); }
    // Validate every staged value before touching any primary value.
    const values = entries.map(item => {
      const text = base.get(item.stage);
      if (sha256(text) !== item.digest) throw Error('完整恢复暂存数据损坏，已停止读写，请保留本地数据。');
      return text;
    });
    entries.forEach((item, index) => verified(item.key, values[index]));
    verified(RESTORE_TRANSACTION_KEY, '');
    // Stale staging is inert once the marker is gone.
    for (const item of entries) try { base.set(item.stage, ''); } catch { /* best effort */ }
  }
  const storage: StoragePort = {
    get(key) { if (draft) return draft.has(key) ? draft.get(key)! : base.get(key); recover(); return base.get(key); },
    set(key, value) { if (draft) { draft.set(key, value); return; } recover(); base.set(key, value); },
    ...(base.keys ? { keys: () => { if (!draft) recover(); return [...new Set([...base.keys!(), ...(draft?.keys() ?? [])])]; } } : {}),
    ...(base.info ? { info: () => base.info!() } : {}),
  };
  function atomic<T>(operation: () => T): T {
    recover();
    if (draft) throw Error('完整恢复不能嵌套执行。');
    draft = new Map();
    let result: T, writes: Map<string, string>;
    try { result = operation(); writes = draft; } finally { draft = undefined; }
    const entries: Entry[] = [...writes].map(([key, value], index) => ({ key, stage: `${prefix}${index}`, digest: sha256(value) }));
    const marker = JSON.stringify({ version: 1, entries });
    if (base.info) {
      const info = base.info();
      // Conservatively reserve staging + final values, while retaining recovery points.
      const bytes = [...writes.values()].reduce((n, text) => n + utf8Size(text) * 2, utf8Size(marker) + 4096);
      if (info.currentSize * 1024 + bytes > info.limitSize * 1024) throw Error('完整恢复本地空间不足，当前数据未替换；请先保存外部备份。');
    }
    entries.forEach(item => verified(item.stage, writes.get(item.key)!));
    verified(RESTORE_TRANSACTION_KEY, marker);
    recover();
    return result;
  }
  return { storage, atomic };
}
