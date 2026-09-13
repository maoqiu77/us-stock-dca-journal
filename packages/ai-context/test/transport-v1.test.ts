import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { payloadDigest, researchTurnEnvelopeV1Schema, sealResearchTurnV1, sha256 } from '../src/index.ts';

const id = (n: number) => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const content = JSON.stringify({ symbol: 'AAPL', quantity: '0' });
  const source = { id: id(8), origin_entity_id: id(9), origin_revision: 'ledger:17', type: 'ledger' as const, as_of: '2026-09-12T10:00:00.000Z', available_at: '2026-09-12T10:00:00.000Z', content_digest: sha256(content), content };
  return sealResearchTurnV1({
    transport_version: 1, request: { schema_version: 2, request_id: id(1), workspace_instance_id: id(2), portfolio_id: id(3), conversation_id: id(4), client_turn_id: id(5), mode: 'instrument_research', journal_date: '2026-09-12', personal_snapshot_at: '2026-09-12T10:00:00.000Z', question: '请研究这个标的', facts: [{ id: id(6), name: '持仓状态', value: '未持有 AAPL', source_ids: [source.id], freshness: 'current', completeness: 'partial' }], excerpts: [], excluded_source_ids: [] },
    target: { kind: 'instrument', portfolio_id: id(3), instrument: { instrument_ref: id(9), symbol: 'AAPL', market: 'US', asset_type: 'STOCK', confirmed_at: '2026-09-12T10:00:00.000Z', source: 'user_confirmed' } },
    history: [], history_omitted_count: 0, source_snapshots: [source], consent: { scope_version: 1, confirmed_at: '2026-09-12T10:00:00.000Z', include_positions: true, include_journal: false, include_trade_reasons: false, include_policy: false, include_history: false }, prepared_at: '2026-09-12T10:00:00.000Z', expires_at: '2026-09-12T10:10:00.000Z',
  });
}

test('SHA-256 and canonical payload digest are deterministic', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(payloadDigest({ b: 2, a: 1 }), payloadDigest({ a: 1, b: 2 }));
});

test('SHA-256 supports UTF-8 without host TextEncoder, including unmatched surrogates', () => {
  const original = globalThis.TextEncoder;
  try {
    Object.defineProperty(globalThis, 'TextEncoder', { value: undefined, configurable: true, writable: true });
    for (const value of ['', 'abc', '中文é😀', '\ud800x\udfff', '😀中'.repeat(100)]) {
      assert.equal(sha256(value), createHash('sha256').update(value, 'utf8').digest('hex'));
    }
  } finally { globalThis.TextEncoder = original; }
});

test('turn envelope rejects mutation, unknown fields, missing sources and excluded source bodies', () => {
  const envelope = fixture();
  assert.equal(researchTurnEnvelopeV1Schema.parse(envelope).target.kind, 'instrument');
  assert.equal(researchTurnEnvelopeV1Schema.safeParse({ ...envelope, extra: true }).success, false);
  assert.equal(researchTurnEnvelopeV1Schema.safeParse({ ...envelope, request: { ...envelope.request, question: '被替换' } }).success, false);
  const payload = { ...envelope, source_snapshots: [] };
  const { payload_digest: _, ...unsigned } = payload;
  assert.equal(researchTurnEnvelopeV1Schema.safeParse({ ...payload, payload_digest: payloadDigest(unsigned) }).success, false);
  const excluded = { ...envelope, request: { ...envelope.request, excluded_source_ids: [envelope.source_snapshots[0].id] } };
  const { payload_digest: __, ...excludedUnsigned } = excluded;
  assert.equal(researchTurnEnvelopeV1Schema.safeParse({ ...excluded, payload_digest: payloadDigest(excludedUnsigned) }).success, false);
});
