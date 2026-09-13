import { sha256, type ResearchTurnEnvelopeV1, type ResearchTurnResponseV1 } from '@portfolio/ai-context';
import type { Claim, RequestRecord, RequestStore } from './request-store.ts';

type Doc = { get(): Promise<{ data?: any | any[] }>; set(input: { data: any }): Promise<any>; update(input: { data: any }): Promise<any>; remove(): Promise<any> };
type Collection = { doc(id: string): Doc };
type Database = { collection(name: string): Collection; runTransaction<T>(fn: (tx: { collection(name: string): Collection }) => Promise<T>): Promise<T> };
const requestKey = (owner: string, requestId: string) => sha256(`${owner}:${requestId}`);
const turnKey = (owner: string, workspace: string, turn: string) => sha256(`${owner}:${workspace}:${turn}`);
const usageKey = (owner: string, date: string) => sha256(`${owner}:${date}`);
async function data(doc: Doc) {
  try {
    const value = (await doc.get()).data;
    return Array.isArray(value) ? value[0] : value;
  } catch {
    return undefined;
  }
}

export function createCloudbaseRequestStore(db: Database): RequestStore {
  return {
    claim: input => db.runTransaction<Claim>(async tx => {
      const requests = tx.collection('ai_requests'), payloads = tx.collection('ai_payloads'), usage = tx.collection('ai_usage'), turns = tx.collection('ai_turn_keys');
      const id = requestKey(input.owner, input.envelope.request.request_id), existing = await data(requests.doc(id));
      if (existing) return existing.digest === input.envelope.payload_digest ? { kind: 'existing', record: existing as RequestRecord } : { kind: 'conflict' };
      const turnId = turnKey(input.owner, input.envelope.request.workspace_instance_id, input.envelope.request.client_turn_id);
      if (await data(turns.doc(turnId))) return { kind: 'conflict' };
      const day = input.now.slice(0, 10), usageId = usageKey(input.owner, day), counter = await data(usage.doc(usageId)) ?? { count: 0, inflight: 0 };
      if (counter.count >= input.dailyLimit) return { kind: 'quota' };
      if (counter.inflight >= input.maxInflight) return { kind: 'inflight' };
      const record: RequestRecord = { owner: input.owner, requestId: input.envelope.request.request_id, digest: input.envelope.payload_digest, workspaceId: input.envelope.request.workspace_instance_id, clientTurnId: input.envelope.request.client_turn_id, state: 'running', executionToken: input.executionToken, envelope: input.envelope, createdAt: input.now, updatedAt: input.now };
      await requests.doc(id).set({ data: record }); await payloads.doc(id).set({ data: { owner: input.owner, envelope: input.envelope, expiresAt: input.envelope.expires_at } });
      await turns.doc(turnId).set({ data: { owner: input.owner, requestId: record.requestId, digest: record.digest } });
      await usage.doc(usageId).set({ data: { owner: input.owner, date: day, count: counter.count + 1, inflight: counter.inflight + 1, updatedAt: input.now } });
      return { kind: 'claimed', record };
    }),
    get: async (owner, requestId) => { const value = await data(db.collection('ai_requests').doc(requestKey(owner, requestId))); return value?.owner === owner ? value as RequestRecord : undefined; },
    finish: (owner, requestId, token, response) => db.runTransaction(async tx => {
      const id = requestKey(owner, requestId), doc = tx.collection('ai_requests').doc(id), record = await data(doc);
      if (!record || record.owner !== owner || record.executionToken !== token || record.state !== 'running') throw Error('EXECUTION_TOKEN_CONFLICT');
      await doc.update({ data: { state: 'succeeded', response, updatedAt: response.execution.completed_at } });
      const usage = tx.collection('ai_usage').doc(usageKey(owner, record.createdAt.slice(0, 10))), counter = await data(usage); if (counter) await usage.update({ data: { inflight: Math.max(0, counter.inflight - 1), updatedAt: response.execution.completed_at } });
    }),
    fail: (owner, requestId, token, state, code) => db.runTransaction(async tx => {
      const id = requestKey(owner, requestId), doc = tx.collection('ai_requests').doc(id), record = await data(doc); if (!record || record.owner !== owner || record.executionToken !== token) throw Error('EXECUTION_TOKEN_CONFLICT');
      const now = new Date().toISOString(); await doc.update({ data: { state, errorCode: code, updatedAt: now } });
      const usage = tx.collection('ai_usage').doc(usageKey(owner, record.createdAt.slice(0, 10))), counter = await data(usage); if (counter) await usage.update({ data: { inflight: Math.max(0, counter.inflight - 1), uncertain: state === 'outcome_unknown', updatedAt: now } });
    }),
    ack: (owner, requestId, digest, responseDigest, now) => db.runTransaction(async tx => {
      const id = requestKey(owner, requestId), doc = tx.collection('ai_requests').doc(id), record = await data(doc);
      if (!record || record.owner !== owner) throw Error('NOT_FOUND');
      if (record.digest !== digest || (record.responseDigest ?? record.response?.response_digest) !== responseDigest) throw Error('DIGEST_CONFLICT');
      if (record.state === 'acked') return;
      await doc.update({ data: { state: 'acked', envelope: null, response: null, responseDigest, acknowledgedAt: now, updatedAt: now } });
      await tx.collection('ai_payloads').doc(id).remove();
    }),
  };
}

export function createCloudbaseAccess(db: Database) {
  return {
    async allowed(owner: string) {
      const value = await data(db.collection('ai_access').doc(sha256(owner)));
      return value?.enabled === true && value?.consentVersion === 1 && (value.owner === undefined || value.owner === owner);
    },
  };
}
