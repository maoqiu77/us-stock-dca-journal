import { z } from 'zod';
import { idSchema } from '@portfolio/domain';
import { analysisResultV2Schema, finalManifestV2Schema } from './research-v2.ts';
import { payloadDigest, sha256 } from './digest.ts';
import { consentV1Schema, historyMessageV1Schema, providerExecutionV1Schema, researchTargetV1Schema, sourceSnapshotV1Schema } from './transport-v1.ts';
import { analysisRequestV2Schema } from './research-v2.ts';

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const marketReceiptReferenceV1Schema = z.discriminatedUnion('use_market_data', [
  z.strictObject({ use_market_data: z.literal(false), receipt_id: z.null(), receipt_digest: z.null() }),
  z.strictObject({ use_market_data: z.literal(true), receipt_id: idSchema, receipt_digest: digestSchema }),
]);
const envelopePayloadV2Schema = z.strictObject({
  transport_version: z.literal(2), request: analysisRequestV2Schema, target: researchTargetV1Schema,
  history: z.array(historyMessageV1Schema).max(12), history_omitted_count: z.number().int().nonnegative(), source_snapshots: z.array(sourceSnapshotV1Schema).max(500),
  consent: consentV1Schema, market: marketReceiptReferenceV1Schema, prepared_at: z.string().datetime({ offset: true }), expires_at: z.string().datetime({ offset: true }),
});
export const researchTurnEnvelopeV2Schema = envelopePayloadV2Schema.extend({ payload_digest: digestSchema }).strict().superRefine((envelope, context) => {
  const { payload_digest, ...payload } = envelope;
  if (payloadDigest(payload) !== payload_digest) context.addIssue({ code: 'custom', message: 'payload_digest_mismatch' });
  if (Date.parse(envelope.expires_at) <= Date.parse(envelope.prepared_at)) context.addIssue({ code: 'custom', message: 'invalid_expiry' });
  if (envelope.target.portfolio_id !== envelope.request.portfolio_id) context.addIssue({ code: 'custom', message: 'target_portfolio_mismatch' });
  if (envelope.target.kind === 'daily_review' && envelope.target.journal_date !== envelope.request.journal_date) context.addIssue({ code: 'custom', message: 'target_date_mismatch' });
  const sources = new Map(envelope.source_snapshots.map(source => [source.id, source]));
  const refs = [...envelope.request.facts.flatMap(fact => fact.source_ids), ...envelope.request.excerpts.map(excerpt => excerpt.source_id)];
  if (refs.some(id => !sources.has(id))) context.addIssue({ code: 'custom', message: 'request_source_missing' });
  if (envelope.source_snapshots.some(source => ['quote', 'instrument_catalog', 'fundamentals', 'news'].includes(source.type))) context.addIssue({ code: 'custom', message: 'trusted_external_source_not_accepted_from_client' });
});

export const receiptResponseReferenceV1Schema = z.strictObject({ receipt_id: idSchema, receipt_digest: digestSchema });
export const researchTurnResponseV2Schema = z.strictObject({
  transport_version: z.literal(2), request_id: idSchema, workspace_instance_id: idSchema, portfolio_id: idSchema, status: z.literal('succeeded'), run_id: idSchema,
  receipt: receiptResponseReferenceV1Schema.nullable(), manifest: finalManifestV2Schema, external_source_snapshots: z.array(sourceSnapshotV1Schema).max(100), result: analysisResultV2Schema,
  execution: providerExecutionV1Schema, response_digest: digestSchema,
}).superRefine((response, context) => {
  if (response.request_id !== response.result.request_id || response.request_id !== response.manifest.request_id) context.addIssue({ code: 'custom', message: 'response_request_mismatch' });
  if (response.workspace_instance_id !== response.manifest.workspace_instance_id || response.portfolio_id !== response.manifest.portfolio_id) context.addIssue({ code: 'custom', message: 'response_context_mismatch' });
  const external = new Map(response.external_source_snapshots.map(source => [source.id, source]));
  const providerSources = response.manifest.sources.filter(source => source.quality === 'provider_observed');
  if (providerSources.some(source => { const body = external.get(source.id); return !body || body.content_digest !== source.content_hash || body.origin_revision !== source.revision || body.type !== source.type || sha256(body.content) !== body.content_digest; })) context.addIssue({ code: 'custom', message: 'external_source_manifest_mismatch' });
  if ([...external.keys()].some(id => !providerSources.some(source => source.id === id))) context.addIssue({ code: 'custom', message: 'external_source_not_in_manifest' });
  const cited = [...response.result.evidence, ...response.result.counterarguments, ...response.result.candidates].flatMap(item => item.source_ids);
  if (cited.some(id => !response.manifest.sources.some(source => source.id === id))) context.addIssue({ code: 'custom', message: 'citation_not_in_this_run' });
  const { response_digest, ...payload } = response;
  if (payloadDigest(payload) !== response_digest) context.addIssue({ code: 'custom', message: 'response_digest_mismatch' });
});

export type ResearchTurnEnvelopeV2 = z.infer<typeof researchTurnEnvelopeV2Schema>;
export type ResearchTurnResponseV2 = z.infer<typeof researchTurnResponseV2Schema>;
export function sealResearchTurnV2(payload: z.input<typeof envelopePayloadV2Schema>): ResearchTurnEnvelopeV2 {
  const valid = envelopePayloadV2Schema.parse(payload);
  return researchTurnEnvelopeV2Schema.parse({ ...valid, payload_digest: payloadDigest(valid) });
}
export function sealResearchResponseV2(payload: Omit<z.input<typeof researchTurnResponseV2Schema>, 'response_digest'>): ResearchTurnResponseV2 {
  return researchTurnResponseV2Schema.parse({ ...payload, response_digest: payloadDigest(payload) });
}
