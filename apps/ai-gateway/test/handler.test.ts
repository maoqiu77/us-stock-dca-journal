import assert from 'node:assert/strict';
import test from 'node:test';
import { sealResearchTurnV1, sha256 } from '@portfolio/ai-context';
import { createPortfolioAiHandler } from '../src/handler.ts';
import { createMemoryRequestStore } from '../src/request-store.ts';
import type { ModelProvider } from '../src/providers/deepseek.ts';

const id = (n: number) => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function envelope(requestId = id(1), turnId = id(5), question = '分析') {
  const content = '{"positions":[]}'; const source = { id: id(8), origin_entity_id: id(3), origin_revision: id(9), type: 'ledger' as const, as_of: '2026-09-12T10:00:00.000Z', available_at: '2026-09-12T10:00:00.000Z', content_digest: sha256(content), content };
  return sealResearchTurnV1({ transport_version: 1, request: { schema_version: 2, request_id: requestId, workspace_instance_id: id(2), portfolio_id: id(3), conversation_id: id(4), client_turn_id: turnId, mode: 'portfolio_review', journal_date: '2026-09-12', personal_snapshot_at: '2026-09-12T10:00:00.000Z', question, facts: [{ id: id(6), name: '持仓', value: '无', source_ids: [source.id], freshness: 'current', completeness: 'partial' }], excerpts: [], excluded_source_ids: [] }, target: { kind: 'portfolio', portfolio_id: id(3) }, history: [], history_omitted_count: 0, source_snapshots: [source], consent: { scope_version: 1, confirmed_at: '2026-09-12T10:00:00.000Z', include_positions: true, include_journal: false, include_trade_reasons: false, include_policy: false, include_history: false }, prepared_at: '2026-09-12T10:00:00.000Z', expires_at: '2026-09-12T10:10:00.000Z' });
}
function provider(counter: { value: number }, fail = false): ModelProvider { return { async invoke(e) { counter.value++; if (fail) throw Error('UPSTREAM_TIMEOUT'); const source = e.source_snapshots[0].id; return { providerId: 'test-provider', protocol: 'injected-test-v1', model: 'synthetic-model', credentialMode: 'sponsored', inputUnits: 10, outputUnits: 5, result: { schema_version: 2, request_id: e.request.request_id, classification: 'ai_generated', mode: e.request.mode, summary: '合成结果', stance: 'insufficient_data', evidence: [{ statement: '仅有账本', source_ids: [source] }], counterarguments: [], conditions: [], missing_information: ['报价'], candidates: [], next_questions: [] } }; } }; }
function fixture(options: { limit?: number; fail?: boolean } = {}) { const calls = { value: 0 }; let ids = 100; const store = createMemoryRequestStore(), model = provider(calls, options.fail); const providerResolver = { configured: () => true, byokEnabled: () => false, resolve: async () => ({ provider: model, credentialMode: 'sponsored' as const, selection: { provider: 'deepseek' as const, protocol: 'openai-compatible-chat-completions' as const, baseUrl: 'https://api.deepseek.com' as const, model: 'deepseek-flash' as const } }) }; const handler = createPortfolioAiHandler({ config: { expectedAppId: 'wx-test', enabled: true, consentVersion: 1, dailyLimit: options.limit ?? 10, maxInflight: 1, maxInputBytes: 200000, maxOutputTokens: 1500, maxExpiryMs: 600000, providerConfigured: true }, store, providerResolver, access: { allowed: async owner => owner === 'owner-a' }, now: () => '2026-09-12T10:01:00.000Z', id: () => id(++ids) }); return { handler, calls, store }; }
const context = { appId: 'wx-test', openId: 'owner-a', source: 'wechat-miniprogram' as const };

test('capabilities exposes only a hashed trusted principal for allow-list setup', async () => {
  const result = await fixture().handler({ action: 'capabilities' }, context);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((result.data as any).principalHash, sha256(context.openId));
    assert.equal(JSON.stringify(result.data).includes(context.openId), false);
  }
});

test('trusted identity is mandatory and another owner cannot read or ack results', async () => {
  const f = fixture(), e = envelope();
  assert.equal((await f.handler({ action: 'analyze', envelope: e }, { ...context, appId: 'forged' })).ok, false);
  assert.equal((await f.handler({ action: 'analyze', envelope: e }, context)).ok, true);
  const foreign = await f.handler({ action: 'result', request_id: e.request.request_id, payload_digest: e.payload_digest }, { ...context, openId: 'owner-b' });
  assert.equal(foreign.ok, false); assert.equal(f.calls.value, 1);
});

test('concurrent duplicate analyze claims once, reserves once and calls provider once', async () => {
  const f = fixture(), e = envelope(); const [a, b] = await Promise.all([f.handler({ action: 'analyze', envelope: e }, context), f.handler({ action: 'analyze', envelope: e }, context)]);
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(f.calls.value, 1);
});

test('same request or client turn with different payload is an idempotency conflict', async () => {
  const f = fixture(), first = envelope(); await f.handler({ action: 'analyze', envelope: first }, context);
  const changed = envelope(first.request.request_id, id(55), '不同内容');
  const result = await f.handler({ action: 'analyze', envelope: changed }, context);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(f.calls.value, 1);
});

test('daily quota is atomic and provider failure remains outcome_unknown without retry', async () => {
  const quota = fixture({ limit: 1 }); await quota.handler({ action: 'analyze', envelope: envelope() }, context);
  const denied = await quota.handler({ action: 'analyze', envelope: envelope(id(20), id(21)) }, context); assert.equal(denied.ok, false); assert.equal(quota.calls.value, 1);
  const failed = fixture({ fail: true }), e = envelope(); const first = await failed.handler({ action: 'analyze', envelope: e }, context); const second = await failed.handler({ action: 'analyze', envelope: e }, context);
  assert.equal(first.ok, false); assert.equal(second.ok, true); assert.equal(failed.calls.value, 1);
  const status = await failed.handler({ action: 'status', request_id: e.request.request_id, payload_digest: e.payload_digest }, context); assert.equal((status as any).data.status, 'outcome_unknown');
});

test('result and ack require exact digests and repeated ack is idempotent metadata access', async () => {
  const f = fixture(), e = envelope(); const started = await f.handler({ action: 'analyze', envelope: e }, context); const responseDigest = (started as any).data.responseDigest;
  const result = await f.handler({ action: 'result', request_id: e.request.request_id, payload_digest: e.payload_digest }, context); assert.equal(result.ok, true);
  assert.equal((await f.handler({ action: 'ack', request_id: e.request.request_id, payload_digest: e.payload_digest, response_digest: '0'.repeat(64) }, context)).ok, false);
  assert.equal((await f.handler({ action: 'ack', request_id: e.request.request_id, payload_digest: e.payload_digest, response_digest: responseDigest }, context)).ok, true);
  const after = await f.handler({ action: 'status', request_id: e.request.request_id, payload_digest: e.payload_digest }, context); assert.equal((after as any).data.status, 'succeeded');
});


test('ACK makes result unavailable and retains the digest for safe repeat acknowledgement', async () => {
  const f = fixture(), e = envelope();
  const started = await f.handler({ action: 'analyze', envelope: e }, context);
  const responseDigest = (started as any).data.responseDigest;
  const identity = { request_id: e.request.request_id, payload_digest: e.payload_digest, response_digest: responseDigest };
  await f.handler({ action: 'ack', ...identity }, context);
  const result = await f.handler({ action: 'result', ...identity }, context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'RESULT_ACKED');
  const status = await f.handler({ action: 'status', ...identity }, context);
  assert.equal((status as any).data.responseDigest, responseDigest);
  assert.equal((await f.handler({ action: 'ack', ...identity }, context)).ok, true);
  assert.equal(f.calls.value, 1);
});
