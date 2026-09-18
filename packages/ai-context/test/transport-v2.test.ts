import assert from 'node:assert/strict';
import test from 'node:test';
import { payloadDigest, researchTurnEnvelopeV2Schema, researchTurnResponseV2Schema, sealResearchResponseV2, sealResearchTurnV2, sha256 } from '../src/index.ts';

const id = (n: number) => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-13T10:00:00.000Z';
const personal = { id: id(8), origin_entity_id: id(9), origin_revision: 'ledger:1', type: 'ledger' as const, as_of: at, available_at: at, content_digest: sha256('{"positions":[]}'), content: '{"positions":[]}' };
const request = { schema_version: 2 as const, request_id: id(1), workspace_instance_id: id(2), portfolio_id: id(3), conversation_id: id(4), client_turn_id: id(5), mode: 'portfolio_review' as const, journal_date: '2026-09-13', personal_snapshot_at: at, question: '请分析', facts: [{ id: id(6), name: '持仓', value: '无', source_ids: [personal.id], freshness: 'current' as const, completeness: 'complete' as const }], excerpts: [], excluded_source_ids: [] };

test('V2 envelope protects the selected market receipt inside its payload digest', () => {
  const envelope = sealResearchTurnV2({ transport_version: 2, request, target: { kind: 'portfolio', portfolio_id: id(3) }, history: [], history_omitted_count: 0, source_snapshots: [personal], consent: { scope_version: 1, confirmed_at: at, include_positions: true, include_journal: false, include_trade_reasons: false, include_policy: false, include_history: false }, market: { use_market_data: true, receipt_id: id(10), receipt_digest: sha256('receipt') }, prepared_at: at, expires_at: '2026-09-13T10:10:00.000Z' });
  assert.equal(researchTurnEnvelopeV2Schema.parse(envelope).market.use_market_data, true);
  assert.equal(researchTurnEnvelopeV2Schema.safeParse({ ...envelope, market: { ...envelope.market, receipt_digest: sha256('forged') } }).success, false);
});

test('V2 response validates external source bodies, manifest membership and digest', () => {
  const quoteContent = '{"instrument_key":"US:XNAS:AAPL","price":"221.10"}';
  const external = { id: id(11), origin_entity_id: id(10), origin_revision: id(10), type: 'quote' as const, as_of: at, available_at: at, content_digest: sha256(quoteContent), content: quoteContent };
  const manifest = { schema_version: 2 as const, request_id: id(1), workspace_instance_id: id(2), portfolio_id: id(3), built_at: at, known_at: at, personal_snapshot_at: at, sources: [{ id: personal.id, revision: personal.id, type: 'ledger' as const, as_of: at, available_at: at, content_hash: personal.content_digest, quality: 'client_computed' as const }, { id: external.id, revision: external.origin_revision, type: 'quote' as const, as_of: at, available_at: at, content_hash: external.content_digest, quality: 'provider_observed' as const }], omissions: [] };
  const result = { schema_version: 2 as const, request_id: id(1), classification: 'ai_generated' as const, mode: 'portfolio_review' as const, summary: '保持观察', stance: 'observe' as const, evidence: [{ statement: '当前报价 221.10', source_ids: [external.id] }], counterarguments: [], conditions: [], missing_information: [], candidates: [], next_questions: [] };
  const response = sealResearchResponseV2({ transport_version: 2, request_id: id(1), workspace_instance_id: id(2), portfolio_id: id(3), status: 'succeeded', run_id: id(12), receipt: { receipt_id: id(10), receipt_digest: sha256('receipt') }, manifest, external_source_snapshots: [external], result, execution: { provider_id: 'deepseek', protocol: 'openai-compatible', model: 'model', credential_mode: 'sponsored', started_at: at, completed_at: at, input_units: 1, output_units: 1 } });
  assert.equal(researchTurnResponseV2Schema.parse(response).external_source_snapshots[0].content, quoteContent);
  assert.equal(researchTurnResponseV2Schema.safeParse({ ...response, external_source_snapshots: [{ ...external, content: '{}'}] }).success, false);
  const unsigned = { ...response, external_source_snapshots: [] } as any; delete unsigned.response_digest;
  assert.equal(researchTurnResponseV2Schema.safeParse({ ...unsigned, response_digest: payloadDigest(unsigned) }).success, false);
});
