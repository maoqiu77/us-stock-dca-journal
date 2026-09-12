import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analysisRequestV2Schema,
  analysisResultV2Schema,
  finalManifestV2Schema,
  instrumentCatalogEntrySchema,
  validateAnalysisResultV2,
} from '../src/index.ts';

const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = { id: id(7), revision: id(8), type: 'ledger' as const, as_of: '2026-09-10T12:00:00.000Z', available_at: '2026-09-10T12:00:00.000Z', content_hash: '1234abcd', quality: 'client_computed' as const };
const request = {
  schema_version: 2 as const, request_id: id(1), workspace_instance_id: id(2), portfolio_id: id(3), conversation_id: id(4), client_turn_id: id(5),
  mode: 'portfolio_review' as const, journal_date: '2026-09-10', personal_snapshot_at: '2026-09-10T12:00:00.000Z', question: '我的持仓有哪些需要注意？',
  facts: [{ id: id(6), name: '持仓 QQQ', value: '2 股，剩余成本 21.00 USD', source_ids: [source.id], freshness: 'current' as const, completeness: 'partial' as const }],
  excerpts: [], excluded_source_ids: [],
};
const manifest = { schema_version: 2 as const, request_id: request.request_id, workspace_instance_id: request.workspace_instance_id, portfolio_id: request.portfolio_id, built_at: '2026-09-10T12:00:00.000Z', known_at: '2026-09-10T12:00:00.000Z', personal_snapshot_at: request.personal_snapshot_at, sources: [source], omissions: [{ reason: 'missing' as const, description: '缺少实时报价' }] };
const result = { schema_version: 2 as const, request_id: request.request_id, classification: 'ai_generated' as const, mode: request.mode, summary: '这是离线合成分析。', stance: 'insufficient_data' as const, evidence: [{ statement: '账本显示 QQQ 2 股。', source_ids: [source.id] }], counterarguments: [], conditions: [{ text: '如果取得有时点的报价，再评估估值。', basis: 'observed' as const }], missing_information: ['实时报价', '现金余额'], candidates: [], next_questions: ['是否要回看最近的买入理由？'] };

test('v2 research request and result are strict and remain separate from v1 contracts', () => {
  assert.equal(analysisRequestV2Schema.parse(request).schema_version, 2);
  assert.equal(analysisResultV2Schema.parse(result).classification, 'ai_generated');
  assert.equal(finalManifestV2Schema.parse(manifest).sources[0].quality, 'client_computed');
  assert.equal(analysisRequestV2Schema.safeParse({ ...request, secret: 'never' }).success, false);
  assert.equal(analysisResultV2Schema.safeParse({ ...result, order: { side: 'buy' } }).success, false);
});

test('result validation rejects wrong request ids, unknown citations and AI self-citations', () => {
  assert.deepEqual(validateAnalysisResultV2(result, request, manifest), result);
  assert.throws(() => validateAnalysisResultV2({ ...result, request_id: id(99) }, request, manifest), /request_id/);
  assert.throws(() => validateAnalysisResultV2({ ...result, evidence: [{ statement: 'x', source_ids: [id(99)] }] }, request, manifest), /source_not_in_manifest/);
  const aiSource = { ...source, id: id(9), type: 'ai_output' as const, quality: 'ai_generated' as const };
  assert.throws(() => validateAnalysisResultV2({ ...result, evidence: [{ statement: 'x', source_ids: [aiSource.id] }] }, request, { ...manifest, sources: [source, aiSource] }), /ai_output_cannot_ground_evidence/);
});

test('unheld instrument research requires an independently confirmed catalog identity', () => {
  assert.equal(instrumentCatalogEntrySchema.safeParse({ instrument_ref: id(20), symbol: 'AAPL', market: 'US', asset_type: 'STOCK', confirmed_at: '2026-09-10T12:00:00.000Z', source: 'user_confirmed' }).success, true);
  assert.equal(instrumentCatalogEntrySchema.safeParse({ instrument_ref: id(20), symbol: 'AAPL', market: 'US', asset_type: 'STOCK', confirmed_at: '2026-09-10T12:00:00.000Z', source: 'guessed_by_model' }).success, false);
});
