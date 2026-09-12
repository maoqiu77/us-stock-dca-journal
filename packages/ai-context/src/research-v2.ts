import { z } from 'zod';
import { dateSchema, idSchema, timestampSchema } from '@portfolio/domain';

export const researchModeSchema = z.enum(['portfolio_review', 'instrument_research', 'candidate_screen', 'daily_review', 'follow_up']);
export const researchSourceTypeSchema = z.enum(['ledger', 'policy', 'quote', 'journal', 'user_statement', 'ai_output', 'imported_excerpt', 'instrument_catalog', 'fundamentals', 'news', 'candidate_pool']);
export const researchSourceV2Schema = z.strictObject({
  id: idSchema, revision: idSchema, type: researchSourceTypeSchema, as_of: timestampSchema, available_at: timestampSchema,
  content_hash: z.string().regex(/^[0-9a-f]{8,128}$/), quality: z.enum(['client_computed', 'user_reported', 'provider_observed', 'ai_generated']),
}).superRefine((source, context) => {
  if ((source.type === 'ai_output') !== (source.quality === 'ai_generated')) context.addIssue({ code: 'custom', message: 'ai_source_quality_mismatch' });
});
export const researchFactV2Schema = z.strictObject({
  id: idSchema, name: z.string().min(1).max(120), value: z.union([z.string().max(2000), z.boolean(), z.null()]), source_ids: z.array(idSchema).min(1).max(100),
  freshness: z.enum(['current', 'stale', 'unknown']), completeness: z.enum(['complete', 'partial', 'unknown']),
});
export const researchExcerptV2Schema = z.strictObject({ id: idSchema, text: z.string().min(1).max(8000), source_id: idSchema, classification: z.enum(['user_original', 'imported_original', 'ai_generated']) });
export const analysisRequestV2Schema = z.strictObject({
  schema_version: z.literal(2), request_id: idSchema, workspace_instance_id: idSchema, portfolio_id: idSchema, conversation_id: idSchema, client_turn_id: idSchema,
  mode: researchModeSchema, journal_date: dateSchema, personal_snapshot_at: timestampSchema, question: z.string().trim().min(1).max(10000),
  facts: z.array(researchFactV2Schema).max(300), excerpts: z.array(researchExcerptV2Schema).max(100), excluded_source_ids: z.array(idSchema).max(500),
});
export const finalManifestV2Schema = z.strictObject({
  schema_version: z.literal(2), request_id: idSchema, workspace_instance_id: idSchema, portfolio_id: idSchema, built_at: timestampSchema, known_at: timestampSchema, personal_snapshot_at: timestampSchema,
  sources: z.array(researchSourceV2Schema).max(500), omissions: z.array(z.strictObject({ reason: z.enum(['missing', 'stale', 'budget', 'not_authorized', 'conflict']), description: z.string().min(1).max(500) })).max(100),
}).superRefine((manifest, context) => {
  if (Date.parse(manifest.known_at) > Date.parse(manifest.built_at)) context.addIssue({ code: 'custom', message: 'known_after_built' });
  if (manifest.sources.some(source => Date.parse(source.available_at) > Date.parse(manifest.known_at))) context.addIssue({ code: 'custom', message: 'source_after_known_at' });
  if (new Set(manifest.sources.map(source => source.id)).size !== manifest.sources.length) context.addIssue({ code: 'custom', message: 'duplicate_source_id' });
});
const citedStatementSchema = z.strictObject({ statement: z.string().min(1).max(4000), source_ids: z.array(idSchema).min(1).max(100) });
export const analysisResultV2Schema = z.strictObject({
  schema_version: z.literal(2), request_id: idSchema, classification: z.literal('ai_generated'), mode: researchModeSchema,
  summary: z.string().min(1).max(4000), stance: z.enum(['consider_increase', 'consider_reduce', 'maintain', 'observe', 'insufficient_data', 'not_applicable']),
  evidence: z.array(citedStatementSchema).max(100), counterarguments: z.array(citedStatementSchema).max(100),
  conditions: z.array(z.strictObject({ text: z.string().min(1).max(1000), basis: z.enum(['observed', 'user_assumption']) })).max(100),
  missing_information: z.array(z.string().min(1).max(500)).max(100), candidates: z.array(z.strictObject({ instrument_ref: idSchema, reason: z.string().min(1).max(2000), source_ids: z.array(idSchema).min(1).max(100) })).max(20),
  next_questions: z.array(z.string().min(1).max(500)).max(20),
});
export const instrumentCatalogEntrySchema = z.strictObject({ instrument_ref: idSchema, symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,14}$/), market: z.literal('US'), asset_type: z.enum(['STOCK', 'ETF']), confirmed_at: timestampSchema, source: z.enum(['ledger_confirmed', 'user_confirmed', 'provider_catalog']) });

export type AnalysisRequestV2 = z.infer<typeof analysisRequestV2Schema>;
export type FinalManifestV2 = z.infer<typeof finalManifestV2Schema>;
export type AnalysisResultV2 = z.infer<typeof analysisResultV2Schema>;
export function validateAnalysisResultV2(value: unknown, requestInput: unknown, manifestInput: unknown) {
  const request = analysisRequestV2Schema.parse(requestInput), manifest = finalManifestV2Schema.parse(manifestInput), result = analysisResultV2Schema.parse(value);
  if (result.request_id !== request.request_id || manifest.request_id !== request.request_id) throw Error('request_id_mismatch');
  if (manifest.workspace_instance_id !== request.workspace_instance_id || manifest.portfolio_id !== request.portfolio_id) throw Error('request_context_mismatch');
  if (result.mode !== request.mode) throw Error('request_mode_mismatch');
  const sources = new Map(manifest.sources.map(source => [source.id, source]));
  const cited = [...result.evidence, ...result.counterarguments, ...result.candidates].flatMap(item => item.source_ids);
  if (cited.some(id => !sources.has(id))) throw Error('source_not_in_manifest');
  if (cited.some(id => sources.get(id)?.type === 'ai_output')) throw Error('ai_output_cannot_ground_evidence');
  if (request.excluded_source_ids.some(id => cited.includes(id))) throw Error('excluded_source_cited');
  return result;
}

