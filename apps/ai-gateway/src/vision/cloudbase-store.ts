import { sha256 } from '@portfolio/ai-context';
import type { VisionTask, VisionTaskStore } from './handler.ts';

type Doc = { get(): Promise<{ data?: any | any[] }>; set(input: { data: any }): Promise<any>; update(input: { data: any }): Promise<any> };
type Query = { limit(value: number): { get(): Promise<{ data?: any[] }> } };
type Collection = { doc(id: string): Doc; where(query: any): Query };
type Database = { collection(name: string): Collection; runTransaction<T>(fn: (tx: { collection(name: string): Collection }) => Promise<T>): Promise<T>; command: { lte(value: string): unknown } };

const taskKey = (owner: string, taskId: string) => sha256(`vision-task:${owner}:${taskId}`);
const uploadKey = (owner: string, requestId: string) => sha256(`vision-upload:${owner}:${requestId}`);
const usageKey = (owner: string, date: string) => sha256(`vision-usage:${owner}:${date}`);
async function data(doc: Doc) { try { const value = (await doc.get()).data; return Array.isArray(value) ? value[0] : value; } catch { return undefined; } }

export function createCloudbaseVisionTaskStore(db: Database): VisionTaskStore {
  async function updateInflight(tx: { collection(name: string): Collection }, task: VisionTask, delta: number) {
    const date = task.createdAt.slice(0, 10), ref = tx.collection('vision_usage').doc(usageKey(task.owner, date)), value = await data(ref);
    if (value) await ref.update({ data: { inflight: Math.max(0, (value.inflight ?? 0) + delta) } });
  }
  return {
    create: task => db.runTransaction(async tx => {
      const tasks = tx.collection('vision_tasks'), uploads = tx.collection('vision_upload_keys'), indexRef = uploads.doc(uploadKey(task.owner, task.uploadRequestId)), index = await data(indexRef);
      if (index) {
        const existing = await data(tasks.doc(index.taskKey));
        if (!existing || existing.owner !== task.owner) return { kind: 'conflict' as const, task };
        const same = existing.expectedMime === task.expectedMime && existing.expectedBytes === task.expectedBytes;
        return { kind: same ? 'existing' as const : 'conflict' as const, task: existing as VisionTask };
      }
      const key = taskKey(task.owner, task.id);
      await tasks.doc(key).set({ data: task });
      await indexRef.set({ data: { ownerHash: sha256(task.owner), taskKey: key, expectedMime: task.expectedMime, expectedBytes: task.expectedBytes, expiresAt: task.expiresAt } });
      return { kind: 'created' as const, task };
    }),
    async get(owner, taskId) { const value = await data(db.collection('vision_tasks').doc(taskKey(owner, taskId))); return value?.owner === owner ? value as VisionTask : undefined; },
    async bindObject(owner, taskId, objectRef) {
      const ref = db.collection('vision_tasks').doc(taskKey(owner, taskId)), task = await data(ref) as VisionTask | undefined;
      if (!task || task.owner !== owner || task.state !== 'created') return undefined;
      const next = { ...task, objectRef }; await ref.update({ data: { objectRef } }); return next;
    },
    claim: (owner, taskId, requestId, now, dailyLimit, maxInflight) => db.runTransaction(async tx => {
      const ref = tx.collection('vision_tasks').doc(taskKey(owner, taskId)), task = await data(ref) as VisionTask | undefined;
      if (!task || task.owner !== owner) return { kind: 'conflict' as const };
      if (Date.parse(task.expiresAt) <= Date.parse(now)) return { kind: 'expired' as const };
      if (task.state === 'cancelled') return { kind: 'cancelled' as const };
      if (task.recognitionRequestId) return task.recognitionRequestId === requestId ? { kind: 'existing' as const, task } : { kind: 'conflict' as const };
      const date = now.slice(0, 10), usageRef = tx.collection('vision_usage').doc(usageKey(owner, date)), usage = await data(usageRef) ?? { ownerHash: sha256(owner), date, count: 0, inflight: 0 };
      if (usage.count >= dailyLimit) return { kind: 'quota' as const };
      if (usage.inflight >= maxInflight) return { kind: 'inflight' as const };
      const claimed: VisionTask = { ...task, recognitionRequestId: requestId, state: 'processing' };
      await ref.update({ data: { recognitionRequestId: requestId, state: 'processing' } });
      await usageRef.set({ data: { ...usage, count: usage.count + 1, inflight: usage.inflight + 1, updatedAt: now } });
      return { kind: 'claimed' as const, task: claimed };
    }),
    complete: (owner, taskId, requestId, response) => db.runTransaction(async tx => {
      const ref = tx.collection('vision_tasks').doc(taskKey(owner, taskId)), task = await data(ref) as VisionTask | undefined;
      if (!task || task.owner !== owner || task.recognitionRequestId !== requestId || task.state !== 'processing') throw Error('VISION_TASK_CONFLICT');
      const next: VisionTask = { ...task, state: 'completed', response, errorCode: null };
      await ref.update({ data: { state: next.state, response, errorCode: null } }); await updateInflight(tx, task, -1); return next;
    }),
    fail: (owner, taskId, requestId, code) => db.runTransaction(async tx => {
      const ref = tx.collection('vision_tasks').doc(taskKey(owner, taskId)), task = await data(ref) as VisionTask | undefined;
      if (!task || task.owner !== owner || task.recognitionRequestId !== requestId) throw Error('VISION_TASK_CONFLICT');
      const next: VisionTask = { ...task, state: 'failed', errorCode: code };
      await ref.update({ data: { state: next.state, errorCode: code } }); if (task.state === 'processing') await updateInflight(tx, task, -1); return next;
    }),
    cancel: (owner, taskId) => db.runTransaction(async tx => {
      const ref = tx.collection('vision_tasks').doc(taskKey(owner, taskId)), task = await data(ref) as VisionTask | undefined;
      if (!task || task.owner !== owner) return undefined;
      if (task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled') return task;
      const next: VisionTask = { ...task, state: 'cancelled' }; await ref.update({ data: { state: 'cancelled' } }); if (task.state === 'processing') await updateInflight(tx, task, -1); return next;
    }),
    async markCleanup(owner, taskId, pending) {
      const ref = db.collection('vision_tasks').doc(taskKey(owner, taskId)), task = await data(ref);
      if (task?.owner === owner) await ref.update({ data: { cleanupPending: pending, objectCleaned: !pending } });
    },
    async cleanupCandidates(now) {
      const tasks = db.collection('vision_tasks');
      const [pending, expired] = await Promise.all([tasks.where({ cleanupPending: true }).limit(100).get(), tasks.where({ expiresAt: db.command.lte(now) }).limit(100).get()]);
      const unique = new Map<string, VisionTask>();
      for (const task of [...(pending.data ?? []), ...(expired.data ?? [])] as VisionTask[]) if (!task.objectCleaned) unique.set(`${task.owner}:${task.id}`, task);
      return [...unique.values()];
    },
  };
}
