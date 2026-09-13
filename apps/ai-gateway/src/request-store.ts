import type { ResearchTurnEnvelopeV1, ResearchTurnResponseV1 } from '@portfolio/ai-context';

export type RequestState = 'running' | 'outcome_unknown' | 'succeeded' | 'failed' | 'expired' | 'acked';
export type RequestRecord = { owner: string; requestId: string; digest: string; workspaceId: string; clientTurnId: string; state: RequestState; executionToken: string; envelope?: ResearchTurnEnvelopeV1 | null; response?: ResearchTurnResponseV1 | null; responseDigest?: string; errorCode?: string; createdAt: string; updatedAt: string; acknowledgedAt?: string };
export type Claim = { kind: 'claimed'; record: RequestRecord } | { kind: 'existing'; record: RequestRecord } | { kind: 'conflict' } | { kind: 'quota' } | { kind: 'inflight' };
export interface RequestStore {
  claim(input: { owner: string; envelope: ResearchTurnEnvelopeV1; now: string; dailyLimit: number; maxInflight: number; executionToken: string }): Promise<Claim>;
  get(owner: string, requestId: string): Promise<RequestRecord | undefined>;
  finish(owner: string, requestId: string, token: string, response: ResearchTurnResponseV1): Promise<void>;
  fail(owner: string, requestId: string, token: string, state: 'failed' | 'outcome_unknown', code: string): Promise<void>;
  ack(owner: string, requestId: string, digest: string, responseDigest: string, now: string): Promise<void>;
}

export function createMemoryRequestStore(): RequestStore {
  const records = new Map<string, RequestRecord>(); let queue = Promise.resolve();
  async function serial<T>(fn: () => T | Promise<T>) { const prior = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; }); await prior; try { return await fn(); } finally { release(); } }
  const key = (owner: string, requestId: string) => `${owner}:${requestId}`;
  return {
    claim: input => serial(() => {
      const k = key(input.owner, input.envelope.request.request_id), existing = records.get(k);
      if (existing) return existing.digest === input.envelope.payload_digest ? { kind: 'existing', record: existing } : { kind: 'conflict' };
      const items = [...records.values()].filter(item => item.owner === input.owner);
      if (items.some(item => item.workspaceId === input.envelope.request.workspace_instance_id && item.clientTurnId === input.envelope.request.client_turn_id)) return { kind: 'conflict' };
      if (items.filter(item => item.createdAt.slice(0, 10) === input.now.slice(0, 10)).length >= input.dailyLimit) return { kind: 'quota' };
      if (items.filter(item => item.state === 'running').length >= input.maxInflight) return { kind: 'inflight' };
      const record: RequestRecord = { owner: input.owner, requestId: input.envelope.request.request_id, digest: input.envelope.payload_digest, workspaceId: input.envelope.request.workspace_instance_id, clientTurnId: input.envelope.request.client_turn_id, state: 'running', executionToken: input.executionToken, envelope: input.envelope, createdAt: input.now, updatedAt: input.now };
      records.set(k, record); return { kind: 'claimed', record };
    }),
    get: async (owner, requestId) => records.get(key(owner, requestId)),
    finish: (owner, requestId, token, response) => serial(() => { const record = records.get(key(owner, requestId)); if (!record || record.executionToken !== token || record.state !== 'running') throw Error('EXECUTION_TOKEN_CONFLICT'); record.state = 'succeeded'; record.response = response; record.updatedAt = response.execution.completed_at; }),
    fail: (owner, requestId, token, state, code) => serial(() => { const record = records.get(key(owner, requestId)); if (!record || record.executionToken !== token) throw Error('EXECUTION_TOKEN_CONFLICT'); record.state = state; record.errorCode = code; record.updatedAt = new Date().toISOString(); }),
    ack: (owner, requestId, digest, responseDigest, now) => serial(() => {
      const record = records.get(key(owner, requestId));
      if (!record) throw Error('NOT_FOUND');
      if (record.digest !== digest || (record.responseDigest ?? record.response?.response_digest) !== responseDigest) throw Error('DIGEST_CONFLICT');
      if (record.state === 'acked') return;
      record.state = 'acked'; record.responseDigest = responseDigest;
      record.acknowledgedAt = now; record.updatedAt = now;
      record.envelope = null; record.response = null;
    }),
  };
}
