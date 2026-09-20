import { sha256 } from '@portfolio/ai-context';
import { z } from 'zod';

export type VisionContext = { appId: string; openId: string; source: 'wechat-miniprogram' };
export type HoldingVisionConfig = {
  expectedAppId: string;
  enabled: boolean;
  maxBytes: number;
  maxPixels: number;
  maxRows: number;
  timeoutMs: number;
  taskTtlMs: number;
  dailyLimit: number | null;
  maxInflight: number;
};

const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
export const holdingVisionRowSchema = z.strictObject({
  name: nullableText(120),
  code: nullableText(32),
  quantityText: nullableText(40),
  unitCostText: nullableText(40),
  costBasis: z.enum(['average_cost', 'breakeven', 'unknown']),
  currency: z.enum(['CNY', 'USD']).nullable(),
  accountLabel: nullableText(80), marketValueText: z.string().max(40).nullable().optional(), holdingPnlText: z.string().max(40).nullable().optional(), holdingReturnRateText: z.string().max(40).nullable().optional(), dailyChangeRateText: z.string().max(40).nullable().optional(), navText: z.string().max(40).nullable().optional(), navDateText: z.string().max(40).nullable().optional(),
});
export const holdingVisionOutputSchema = z.strictObject({ rows: z.array(holdingVisionRowSchema).max(20), truncated: z.literal(false) });
export type HoldingVisionOutput = z.infer<typeof holdingVisionOutputSchema>;
export interface HoldingVisionProvider {
  configured(): boolean;
  recognize(input: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; requestId: string }): Promise<unknown>;
}
export interface VisionObjectStore {
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}
export type VisionTask = {
  id: string;
  owner: string;
  uploadRequestId: string;
  recognitionRequestId: string | null;
  cloudPath: string;
  objectRef: string | null;
  expectedMime: 'image/png' | 'image/jpeg';
  expectedBytes: number;
  createdAt: string;
  expiresAt: string;
  state: 'created' | 'processing' | 'completed' | 'failed' | 'cancelled';
  response: { requestId: string; status: 'review_required'; rows: HoldingVisionOutput['rows'] } | null;
  errorCode: string | null;
  cleanupPending: boolean;
  objectCleaned: boolean;
};
type Claim = { kind: 'claimed'; task: VisionTask } | { kind: 'existing'; task: VisionTask } | { kind: 'conflict' | 'quota' | 'inflight' | 'cancelled' | 'expired' };
export interface VisionTaskStore {
  create(task: VisionTask): Promise<{ kind: 'created' | 'existing' | 'conflict'; task: VisionTask }>;
  get(owner: string, taskId: string): Promise<VisionTask | undefined>;
  bindObject(owner: string, taskId: string, objectRef: string): Promise<VisionTask | undefined>;
  claim(owner: string, taskId: string, requestId: string, now: string, dailyLimit: number | null, maxInflight: number): Promise<Claim>;
  complete(owner: string, taskId: string, requestId: string, response: NonNullable<VisionTask['response']>): Promise<VisionTask>;
  fail(owner: string, taskId: string, requestId: string, code: string): Promise<VisionTask>;
  cancel(owner: string, taskId: string): Promise<VisionTask | undefined>;
  markCleanup(owner: string, taskId: string, pending: boolean): Promise<void>;
  cleanupCandidates(now: string): Promise<VisionTask[]>;
}

export function createMemoryVisionTaskStore(): VisionTaskStore {
  const tasks = new Map<string, VisionTask>();
  const key = (owner: string, id: string) => `${owner}:${id}`;
  return {
    async create(task) {
      const duplicate = [...tasks.values()].find(item => item.owner === task.owner && item.uploadRequestId === task.uploadRequestId);
      if (duplicate) return { kind: duplicate.expectedMime === task.expectedMime && duplicate.expectedBytes === task.expectedBytes ? 'existing' : 'conflict', task: duplicate };
      tasks.set(key(task.owner, task.id), task); return { kind: 'created', task };
    },
    async get(owner, taskId) { return tasks.get(key(owner, taskId)); },
    async bindObject(owner, taskId, objectRef) { const task = tasks.get(key(owner, taskId)); if (!task || task.state !== 'created') return undefined; const next = { ...task, objectRef }; tasks.set(key(owner, taskId), next); return next; },
    async claim(owner, taskId, requestId, now, dailyLimit, maxInflight) {
      const task = tasks.get(key(owner, taskId));
      if (!task) return { kind: 'conflict' };
      if (Date.parse(task.expiresAt) <= Date.parse(now)) return { kind: 'expired' };
      if (task.state === 'cancelled') return { kind: 'cancelled' };
      if (task.recognitionRequestId) return task.recognitionRequestId === requestId ? { kind: 'existing', task } : { kind: 'conflict' };
      const day = now.slice(0, 10), ownerTasks = [...tasks.values()].filter(item => item.owner === owner);
      if (dailyLimit !== null && ownerTasks.filter(item => item.recognitionRequestId && item.createdAt.slice(0, 10) === day).length >= dailyLimit) return { kind: 'quota' };
      if (ownerTasks.filter(item => item.state === 'processing').length >= maxInflight) return { kind: 'inflight' };
      const claimed = { ...task, recognitionRequestId: requestId, state: 'processing' as const };
      tasks.set(key(owner, taskId), claimed); return { kind: 'claimed', task: claimed };
    },
    async complete(owner, taskId, requestId, response) {
      const task = tasks.get(key(owner, taskId)); if (!task || task.recognitionRequestId !== requestId || task.state !== 'processing') throw Error('VISION_TASK_CONFLICT');
      const next = { ...task, state: 'completed' as const, response, errorCode: null }; tasks.set(key(owner, taskId), next); return next;
    },
    async fail(owner, taskId, requestId, code) {
      const task = tasks.get(key(owner, taskId)); if (!task || task.recognitionRequestId !== requestId) throw Error('VISION_TASK_CONFLICT');
      const next = { ...task, state: 'failed' as const, errorCode: code }; tasks.set(key(owner, taskId), next); return next;
    },
    async cancel(owner, taskId) {
      const task = tasks.get(key(owner, taskId)); if (!task) return undefined;
      if (task.state === 'completed' || task.state === 'failed') return task;
      const next = { ...task, state: 'cancelled' as const }; tasks.set(key(owner, taskId), next); return next;
    },
    async markCleanup(owner, taskId, pending) { const task = tasks.get(key(owner, taskId)); if (task) tasks.set(key(owner, taskId), { ...task, cleanupPending: pending, objectCleaned: !pending }); },
    async cleanupCandidates(now) { return [...tasks.values()].filter(item => !item.objectCleaned && (item.cleanupPending || Date.parse(item.expiresAt) <= Date.parse(now))); },
  };
}

function imageInfo(bytes: Uint8Array): { mimeType: 'image/png' | 'image/jpeg'; width: number; height: number } {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (png && bytes.length >= 32) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    const ending = [73, 69, 78, 68, 174, 66, 96, 130];
    const hasEnd = bytes.length >= 12 && ending.every((value, index) => bytes[bytes.length - 8 + index] === value);
    if (width && height && hasEnd) return { mimeType: 'image/png', width, height };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1], length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { mimeType: 'image/jpeg', height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8] };
      if (!length || offset + 2 + length > bytes.length) break;
      offset += 2 + length;
    }
  }
  throw Error('VISION_IMAGE_INVALID');
}

const ok = (data: unknown) => ({ ok: true as const, data });
const failure = (code: string, message: string) => ({ ok: false as const, error: { code, message } });
function errorMessage(code: string) {
  const messages: Record<string, string> = {
    VISION_NOT_CONFIGURED: '截图识别暂不可用，可先手动添加。',
    VISION_IMAGE_INVALID: '图片无法读取，请重新选择清晰截图。',
    VISION_RATE_LIMITED: '当前识别次数已达限制，请稍后再试。',
    VISION_TIMEOUT: '识别超时，已保留你的操作，可重新尝试。',
    VISION_OUTPUT_INVALID: '这张截图未能完整识别，请裁剪或手动填写。',
    VISION_OUTPUT_EMPTY: '截图中未识别出可审核的持仓，请裁剪或手动填写。',
    VISION_OUTPUT_SCHEMA_INVALID: '识别结果格式不符合要求，请裁剪或手动填写。',
    VISION_PROVIDER_NETWORK: '识别服务连接失败，请稍后重试。',
    VISION_OBJECT_READ_FAILED: '截图上传后暂时无法读取，请重新选择。',
    VISION_TASK_STORE_FAILED: '识别任务保存失败，请稍后重试。',
    VISION_TASK_RESPONSE_WRITE_FAILED: '识别草稿保存失败，请稍后重试。',
    VISION_USAGE_RELEASE_FAILED: '识别额度更新失败，请稍后重试。',
    VISION_ROWS_TRUNCATED: '截图内容过多或不完整，请分张导入。',
    VISION_TASK_NOT_FOUND: '识别任务不存在、已过期或不属于当前用户。',
    VISION_REQUEST_CONFLICT: '本次识别请求与已有内容冲突。',
    VISION_CANCELLED: '已取消本次识别。',
  };
  return messages[code] ?? '截图识别未完成，请稍后重试。';
}

async function removeTaskObject(store: VisionTaskStore, objects: VisionObjectStore, task: VisionTask) {
  if (!task.objectRef) return;
  try { await objects.remove(task.objectRef); await store.markCleanup(task.owner, task.id, false); }
  catch { await store.markCleanup(task.owner, task.id, true); }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('VISION_TIMEOUT')), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export function createHoldingVisionHandler(deps: { config: HoldingVisionConfig; store: VisionTaskStore; objectStore: VisionObjectStore; provider: HoldingVisionProvider; now(): string; id(): string }) {
  return async function handle(event: any, context: VisionContext) {
    if (context.source !== 'wechat-miniprogram' || context.appId !== deps.config.expectedAppId || !context.openId) return failure('UNAUTHORIZED_SOURCE', '调用来源未通过验证。');
    const owner = context.openId, action = event?.action;
    if (action === 'visionCapabilities') return ok({ enabled: deps.config.enabled, providerConfigured: deps.provider.configured(), maxBytes: deps.config.maxBytes, maxRows: deps.config.maxRows });
    if (!deps.config.enabled || !deps.provider.configured()) return failure('VISION_NOT_CONFIGURED', errorMessage('VISION_NOT_CONFIGURED'));
    if (action === 'createHoldingUpload') {
      const request = requestIdSchema.safeParse(event?.requestId), bytes = Number(event?.contentLength), mime = event?.mimeType;
      if (!request.success || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > deps.config.maxBytes || !['image/png', 'image/jpeg'].includes(mime)) return failure('VISION_IMAGE_INVALID', errorMessage('VISION_IMAGE_INVALID'));
      const taskId = deps.id(), now = deps.now();
      const task: VisionTask = { id: taskId, owner, uploadRequestId: request.data, recognitionRequestId: null, cloudPath: `holding-imports/${sha256(owner)}/${taskId}.${mime === 'image/png' ? 'png' : 'jpg'}`, objectRef: null, expectedMime: mime, expectedBytes: bytes, createdAt: now, expiresAt: new Date(Date.parse(now) + deps.config.taskTtlMs).toISOString(), state: 'created', response: null, errorCode: null, cleanupPending: false, objectCleaned: false };
      const created = await deps.store.create(task);
      if (created.kind === 'conflict') return failure('VISION_REQUEST_CONFLICT', errorMessage('VISION_REQUEST_CONFLICT'));
      return ok({ uploadTaskId: created.task.id, cloudPath: created.task.cloudPath, expiresAt: created.task.expiresAt, maxBytes: deps.config.maxBytes });
    }
    if (action === 'completeHoldingUpload') {
      const taskId = String(event?.uploadTaskId ?? ''), fileId = String(event?.fileId ?? ''), task = await deps.store.get(owner, taskId);
      if (!task) return failure('VISION_TASK_NOT_FOUND', errorMessage('VISION_TASK_NOT_FOUND'));
      let path = '';
      try { const url = new URL(fileId); path = url.pathname.replace(/^\//, ''); } catch { /* invalid cloud file id */ }
      if (!fileId.startsWith('cloud://') || path !== task.cloudPath) return failure('VISION_REQUEST_CONFLICT', errorMessage('VISION_REQUEST_CONFLICT'));
      const bound = await deps.store.bindObject(owner, taskId, fileId);
      return bound ? ok({ uploaded: true }) : failure('VISION_REQUEST_CONFLICT', errorMessage('VISION_REQUEST_CONFLICT'));
    }
    if (action === 'cancelHoldingUpload') {
      const task = await deps.store.cancel(owner, String(event?.uploadTaskId ?? ''));
      if (!task) return failure('VISION_TASK_NOT_FOUND', errorMessage('VISION_TASK_NOT_FOUND'));
      await removeTaskObject(deps.store, deps.objectStore, task);
      return ok({ cancelled: true });
    }
    if (action !== 'recognizeHoldings') return failure('UNKNOWN_ACTION', '不支持的截图识别 action。');
    const request = requestIdSchema.safeParse(event?.requestId), taskId = String(event?.uploadTaskId ?? '');
    if (!request.success) return failure('VISION_REQUEST_CONFLICT', errorMessage('VISION_REQUEST_CONFLICT'));
    const owned = await deps.store.get(owner, taskId);
    if (!owned || !owned.objectRef) return failure('VISION_TASK_NOT_FOUND', errorMessage('VISION_TASK_NOT_FOUND'));
    const claim = await deps.store.claim(owner, taskId, request.data, deps.now(), deps.config.dailyLimit, deps.config.maxInflight);
    if (claim.kind === 'existing') {
      if (claim.task.response) return ok(claim.task.response);
      const code = claim.task.errorCode ?? (claim.task.state === 'cancelled' ? 'VISION_CANCELLED' : 'VISION_REQUEST_CONFLICT');
      return failure(code, errorMessage(code));
    }
    if (claim.kind !== 'claimed') {
      const code = claim.kind === 'quota' || claim.kind === 'inflight' ? 'VISION_RATE_LIMITED' : claim.kind === 'cancelled' ? 'VISION_CANCELLED' : claim.kind === 'expired' ? 'VISION_TASK_NOT_FOUND' : 'VISION_REQUEST_CONFLICT';
      return failure(code, errorMessage(code));
    }
    let code = 'VISION_OUTPUT_INVALID';
    let stage: 'read' | 'provider' | 'persist' = 'read';
    try {
      const bytes = await deps.objectStore.read(claim.task.objectRef!);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== claim.task.expectedBytes || bytes.byteLength > deps.config.maxBytes) throw Error('VISION_IMAGE_INVALID');
      const image = imageInfo(bytes);
      if (image.mimeType !== claim.task.expectedMime || image.width * image.height > deps.config.maxPixels) throw Error('VISION_IMAGE_INVALID');
      stage = 'provider';
      const value = await withTimeout(deps.provider.recognize({ bytes, mimeType: image.mimeType, requestId: request.data }), deps.config.timeoutMs);
      if ((value as any)?.truncated === true || Array.isArray((value as any)?.rows) && (value as any).rows.length > deps.config.maxRows) throw Error('VISION_ROWS_TRUNCATED');
      const parsed = holdingVisionOutputSchema.safeParse(value);
      if (!parsed.success) throw Error('VISION_OUTPUT_SCHEMA_INVALID');
      if (parsed.data.rows.length < 1) throw Error('VISION_OUTPUT_EMPTY');
      const response = { requestId: request.data, status: 'review_required' as const, rows: parsed.data.rows };
      stage = 'persist';
      await deps.store.complete(owner, taskId, request.data, response);
      return ok(response);
    } catch (error) {
      code = error instanceof Error && /^VISION_[A-Z_]+$/.test(error.message) ? error.message : stage === 'read' ? 'VISION_OBJECT_READ_FAILED' : stage === 'persist' ? 'VISION_TASK_STORE_FAILED' : 'VISION_PROVIDER_NETWORK';
      await deps.store.fail(owner, taskId, request.data, code);
      return failure(code, errorMessage(code));
    } finally {
      await removeTaskObject(deps.store, deps.objectStore, claim.task);
    }
  };
}

export async function cleanupExpiredVisionTasks(store: VisionTaskStore, objects: Pick<VisionObjectStore, 'remove'>, now: string) {
  const candidates = await store.cleanupCandidates(now); let cleaned = 0, failed = 0;
  for (const task of candidates) {
    if (!task.objectRef) { await store.markCleanup(task.owner, task.id, false); cleaned++; continue; }
    try { await objects.remove(task.objectRef); await store.markCleanup(task.owner, task.id, false); cleaned++; }
    catch { await store.markCleanup(task.owner, task.id, true); failed++; }
  }
  return { inspected: candidates.length, cleaned, failed };
}
