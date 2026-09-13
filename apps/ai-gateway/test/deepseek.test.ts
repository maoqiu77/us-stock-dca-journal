import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeepSeekProvider } from '../src/providers/deepseek.ts';
import { createProviderResolver } from '../src/credentials.ts';
import { sealResearchTurnV1, sha256 } from '@portfolio/ai-context';

const rid = '84000000-0000-4000-8000-000000000001', sid = '84000000-0000-4000-8000-000000000008';
function envelope() { const content = '{}'; return sealResearchTurnV1({ transport_version: 1, request: { schema_version: 2, request_id: rid, workspace_instance_id: '84000000-0000-4000-8000-000000000002', portfolio_id: '84000000-0000-4000-8000-000000000003', conversation_id: '84000000-0000-4000-8000-000000000004', client_turn_id: '84000000-0000-4000-8000-000000000005', mode: 'portfolio_review', journal_date: '2026-09-12', personal_snapshot_at: '2026-09-12T10:00:00.000Z', question: '分析', facts: [{ id: '84000000-0000-4000-8000-000000000006', name: '持仓', value: '无', source_ids: [sid], freshness: 'current', completeness: 'partial' }], excerpts: [], excluded_source_ids: [] }, target: { kind: 'portfolio', portfolio_id: '84000000-0000-4000-8000-000000000003' }, history: [], history_omitted_count: 0, source_snapshots: [{ id: sid, origin_entity_id: '84000000-0000-4000-8000-000000000003', origin_revision: 'r1', type: 'ledger', as_of: '2026-09-12T10:00:00.000Z', available_at: '2026-09-12T10:00:00.000Z', content_digest: sha256(content), content }], consent: { scope_version: 1, confirmed_at: '2026-09-12T10:00:00.000Z', include_positions: true, include_journal: false, include_trade_reasons: false, include_policy: false, include_history: false }, prepared_at: '2026-09-12T10:00:00.000Z', expires_at: '2026-09-12T10:10:00.000Z' }); }

test('DeepSeek adapter uses Chat Completions fields and parses choices message JSON', async () => {
  let seen: any; const output = { schema_version: 99, request_id: 'spoofed', classification: 'user_original', mode: 'candidate_screen', summary: '合成', stance: 'insufficient_data', evidence: [], counterarguments: [], conditions: [], missing_information: [], candidates: [], next_questions: [] };
  const fetcher = async (url: any, init: any) => { seen = { url: String(url), init, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }) } as any; };
  const adapter = createDeepSeekProvider({ baseUrl: 'https://api.deepseek.com', apiKey: 'server-only', model: 'deepseek-flash', timeoutMs: 1000, maxOutputTokens: 1500, credentialMode: 'sponsored' }, fetcher as any);
  const result = await adapter.invoke(envelope(), 'execution-token');
  assert.equal(seen.url, 'https://api.deepseek.com/chat/completions'); assert.equal(seen.body.max_tokens, 1500); assert.equal(seen.body.max_output_tokens, undefined); assert.equal(seen.body.stream, false); assert.equal(seen.init.headers.authorization, 'Bearer server-only'); assert.match(seen.body.messages[0].content, /All array fields are required/); assert.equal(result.providerId, 'deepseek'); assert.equal(result.credentialMode, 'sponsored');
  assert.deepEqual({ schema_version: result.result.schema_version, request_id: result.result.request_id, classification: result.result.classification, mode: result.result.mode }, { schema_version: 2, request_id: rid, classification: 'ai_generated', mode: 'portfolio_review' });
});

test('DeepSeek adapter rejects malformed model-owned semantic fields', async () => {
  const fetcher = async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '缺字段' }) } }] }) }) as any;
  const adapter = createDeepSeekProvider({ baseUrl: 'https://api.deepseek.com', apiKey: 'server-only', model: 'deepseek-flash', timeoutMs: 1000, maxOutputTokens: 1500, credentialMode: 'sponsored' }, fetcher as any);
  await assert.rejects(() => adapter.invoke(envelope(), 'execution-token'), /PROVIDER_RESPONSE_INVALID/);
});

test('BYOK remains disabled without a credential vault and never falls back to sponsored', async () => {
  const resolver = createProviderResolver({ provider: 'deepseek', protocol: 'openai-compatible-chat-completions', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'secret', timeoutMs: 1000, maxOutputTokens: 100, byokEnabled: false });
  assert.equal(resolver.configured(), true); assert.equal(resolver.byokEnabled(), false); await assert.rejects(() => resolver.resolve('owner', 'byok'), /BYOK_DISABLED/);
});

test('provider readiness rejects an unapproved model identifier', () => {
  const resolver = createProviderResolver({ provider: 'deepseek', protocol: 'openai-compatible-chat-completions', baseUrl: 'https://api.deepseek.com', model: 'unverified-model' as any, apiKey: 'secret', timeoutMs: 1000, maxOutputTokens: 100, byokEnabled: false });
  assert.equal(resolver.configured(), false);
});
