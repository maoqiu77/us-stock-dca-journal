import { z } from 'zod';
import { dateSchema, idSchema, timestampSchema } from '@portfolio/domain';
import { analysisRequestV2Schema, analysisResultV2Schema, finalManifestV2Schema, instrumentCatalogEntrySchema, researchSourceTypeSchema } from './research-v2.ts';
import { payloadDigest, sha256 } from './digest.ts';

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const researchTargetV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('portfolio'), portfolio_id: idSchema }),
  z.strictObject({ kind: z.literal('instrument'), portfolio_id: idSchema, instrument: instrumentCatalogEntrySchema }),
  z.strictObject({ kind: z.literal('daily_review'), portfolio_id: idSchema, journal_date: dateSchema }),
]);
export const historyMessageV1Schema = z.strictObject({
  id: idSchema, role: z.enum(['user', 'assistant']), content: z.string().min(1).max(12000), parent_message_id: idSchema.nullable(),
  client_turn_id: idSchema, classification: z.enum(['user_original', 'ai_generated']), execution_kind: z.enum(['fake', 'real']).nullable(), created_at: timestampSchema,
});
export const sourceSnapshotV1Schema = z.strictObject({
  id: idSchema, origin_entity_id: idSchema, origin_revision: z.string().min(1).max(200), type: researchSourceTypeSchema,
  as_of: timestampSchema, available_at: timestampSchema, content_digest: digestSchema, content: z.string().max(20000),
}).superRefine((source, context) => { if (sha256(source.content) !== source.content_digest) context.addIssue({ code: 'custom', message: 'source_digest_mismatch' }); });
export const consentV1Schema = z.strictObject({
  scope_version: z.literal(1), confirmed_at: timestampSchema, include_positions: z.boolean(), include_journal: z.boolean(), include_trade_reasons: z.boolean(), include_policy: z.boolean(), include_history: z.boolean(),
});
const envelopePayloadSchema = z.strictObject({
  transport_version: z.literal(1), request: analysisRequestV2Schema, target: researchTargetV1Schema,
  history: z.array(historyMessageV1Schema).max(12), history_omitted_count: z.number().int().nonnegative(), source_snapshots: z.array(sourceSnapshotV1Schema).max(500),
  consent: consentV1Schema, prepared_at: timestampSchema, expires_at: timestampSchema,
});
export const researchTurnEnvelopeV1Schema = envelopePayloadSchema.extend({ payload_digest: digestSchema }).strict().superRefine((envelope, context) => {
  const { payload_digest, ...payload } = envelope;
  if (payloadDigest(payload) !== payload_digest) context.addIssue({ code: 'custom', message: 'payload_digest_mismatch' });
  if (Date.parse(envelope.expires_at) <= Date.parse(envelope.prepared_at)) context.addIssue({ code: 'custom', message: 'invalid_expiry' });
  if (envelope.target.portfolio_id !== envelope.request.portfolio_id) context.addIssue({ code: 'custom', message: 'target_portfolio_mismatch' });
  if (envelope.target.kind === 'daily_review' && envelope.target.journal_date !== envelope.request.journal_date) context.addIssue({ code: 'custom', message: 'target_date_mismatch' });
  const sources = new Map(envelope.source_snapshots.map(source => [source.id, source]));
  const refs = [...envelope.request.facts.flatMap(fact => fact.source_ids), ...envelope.request.excerpts.map(excerpt => excerpt.source_id)];
  if (refs.some(id => !sources.has(id))) context.addIssue({ code: 'custom', message: 'request_source_missing' });
  if (envelope.request.excluded_source_ids.some(id => sources.has(id))) context.addIssue({ code: 'custom', message: 'excluded_source_in_payload' });
  for (const excerpt of envelope.request.excerpts) if (sources.get(excerpt.source_id)?.content !== excerpt.text) context.addIssue({ code: 'custom', message: 'excerpt_content_mismatch' });
});

export const providerExecutionV1Schema = z.strictObject({ provider_id: z.string().min(1).max(80), protocol: z.string().min(1).max(80), model: z.string().min(1).max(160), credential_mode: z.enum(['sponsored', 'byok']), started_at: timestampSchema, completed_at: timestampSchema, input_units: z.number().int().nonnegative(), output_units: z.number().int().nonnegative() });
export const researchTurnResponseV1Schema = z.strictObject({
  transport_version: z.literal(1), request_id: idSchema, workspace_instance_id: idSchema, status: z.enum(['succeeded']), run_id: idSchema,
  manifest: finalManifestV2Schema, result: analysisResultV2Schema, execution: providerExecutionV1Schema, response_digest: digestSchema,
}).superRefine((response, context) => {
  if (response.request_id !== response.result.request_id || response.request_id !== response.manifest.request_id) context.addIssue({ code: 'custom', message: 'response_request_mismatch' });
  const { response_digest, ...payload } = response;
  if (payloadDigest(payload) !== response_digest) context.addIssue({ code: 'custom', message: 'response_digest_mismatch' });
});

export type ResearchTurnEnvelopeV1 = z.infer<typeof researchTurnEnvelopeV1Schema>;
export type ResearchTurnResponseV1 = z.infer<typeof researchTurnResponseV1Schema>;
export function sealResearchTurnV1(payload: z.input<typeof envelopePayloadSchema>): ResearchTurnEnvelopeV1 {
  const valid = envelopePayloadSchema.parse(payload);
  return researchTurnEnvelopeV1Schema.parse({ ...valid, payload_digest: payloadDigest(valid) });
}
export function sealResearchResponseV1(payload: Omit<z.input<typeof researchTurnResponseV1Schema>, 'response_digest'>): ResearchTurnResponseV1 {
  return researchTurnResponseV1Schema.parse({ ...payload, response_digest: payloadDigest(payload) });
}
