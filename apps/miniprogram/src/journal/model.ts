import { z } from 'zod';
import { researchTurnEnvelopeV1Schema } from '@portfolio/ai-context';
import { dateSchema, idSchema, policySchema, timestampSchema } from '@portfolio/domain';

export const journalEntrySchema = z.strictObject({
  id: idSchema, revision_id: idSchema, parent_revision: idSchema.nullable(), journal_date: dateSchema,
  type: z.enum(['personal_note', 'user_decision', 'trade_ref', 'analysis_ref', 'conversation_ref']), ref_id: idSchema.nullable(),
  body: z.string().max(4000).nullable(), classification: z.enum(['user_original', 'ai_reference', 'ledger_reference']), created_at: timestampSchema, updated_at: timestampSchema,
});
export const conversationSchema = z.strictObject({ id: idSchema, workspace_instance_id: idSchema, origin: z.enum(['portfolio', 'instrument', 'daily_review']), anchor_id: z.string().min(1).max(120).nullable(), context_mode: z.enum(['current', 'historical']), created_at: timestampSchema, updated_at: timestampSchema });
export const messageSchema = z.strictObject({ id: idSchema, conversation_id: idSchema, role: z.enum(['user', 'assistant']), content: z.string().min(1).max(12000), parent_message_id: idSchema.nullable(), client_turn_id: idSchema, run_id: idSchema.nullable(), status: z.enum(['saved']), classification: z.enum(['user_original', 'ai_generated']), execution_kind: z.enum(['fake', 'real']).nullable().default(null), created_at: timestampSchema });

const resultSchema = z.strictObject({ summary: z.string().min(1).max(4000) }).passthrough();
export const legacyAnalysisRunSchema = z.strictObject({ id: idSchema, request_id: idSchema, conversation_id: idSchema, parent_run_id: idSchema.nullable(), mode: z.enum(['portfolio_review', 'instrument_research', 'candidate_screen', 'daily_review', 'follow_up']), journal_date: dateSchema, state: z.literal('succeeded'), output_validated: z.literal(true), local_saved: z.literal(true), provider: z.literal('fake'), demo: z.literal(true), source_ids: z.array(idSchema).max(500).refine(items => new Set(items).size === items.length, 'duplicate_source_id'), result: resultSchema, created_at: timestampSchema, completed_at: timestampSchema });
export const analysisRunSchema = z.strictObject({
  schema_version: z.literal(2), id: idSchema, request_id: idSchema, conversation_id: idSchema, parent_run_id: idSchema.nullable(), mode: z.enum(['portfolio_review', 'instrument_research', 'candidate_screen', 'daily_review', 'follow_up']), journal_date: dateSchema,
  state: z.literal('succeeded'), output_validated: z.literal(true), local_saved: z.literal(true), execution_kind: z.enum(['fake', 'real']), data_mode: z.enum(['demo', 'personal']), provider_id: z.string().min(1).max(80), source_integrity: z.enum(['verified', 'legacy_unverified']),
  source_ids: z.array(idSchema).max(500).refine(items => new Set(items).size === items.length, 'duplicate_source_id'), final_manifest: z.unknown(),
  provider_metadata: z.strictObject({ protocol: z.string().min(1).max(80), model: z.string().min(1).max(160), credential_mode: z.enum(['sponsored', 'byok', 'not_applicable']), input_units: z.number().int().nonnegative(), output_units: z.number().int().nonnegative() }), result: resultSchema, created_at: timestampSchema, completed_at: timestampSchema,
});
export const legacySourceSnapshotSchema = z.strictObject({ id: idSchema, revision: idSchema, type: z.enum(['ledger', 'policy', 'quote', 'journal', 'user_statement', 'ai_output', 'imported_excerpt', 'instrument_catalog', 'fundamentals', 'news', 'candidate_pool']), as_of: timestampSchema, available_at: timestampSchema, content_hash: z.string().regex(/^[0-9a-f]{8}$/), content: z.string().max(20000) });
export const sourceSnapshotSchema = z.strictObject({ id: idSchema, origin_entity_id: idSchema, origin_revision: z.string().min(1).max(200), type: legacySourceSnapshotSchema.shape.type, as_of: timestampSchema, available_at: timestampSchema, content_digest: z.string().regex(/^[0-9a-f]{64}$/), content: z.string().max(20000) });
export const migrationStateSchema = z.strictObject({ source: z.literal('legacy_reviews'), completed_at: timestampSchema, legacy_review_map: z.record(dateSchema, idSchema) });
export const outboxStatusSchema = z.enum(['prepared', 'submitting', 'running', 'outcome_unknown', 'remote_succeeded', 'local_save_pending', 'saved', 'failed', 'expired', 'detached']);
export const outboxTurnSchema = z.strictObject({ schema_version: z.literal(1), request_id: idSchema, workspace_instance_id: idSchema, conversation_id: idSchema, client_turn_id: idSchema, user_message_id: idSchema, assistant_message_id: idSchema, run_id: idSchema, payload_digest: z.string().regex(/^[0-9a-f]{64}$/), envelope: researchTurnEnvelopeV1Schema, status: outboxStatusSchema, remote_run_id: idSchema.nullable(), response_digest: z.string().regex(/^[0-9a-f]{64}$/).nullable(), error_code: z.string().min(1).max(80).nullable(), created_at: timestampSchema, updated_at: timestampSchema, last_checked_at: timestampSchema.nullable(), detached_reason: z.string().max(300).nullable() });
export const workspaceStateSchema = z.strictObject({ version: z.literal(2), instance_id: idSchema, portfolio_id: idSchema, root_generation: z.number().int().nonnegative(), migration: migrationStateSchema, journal: z.array(journalEntrySchema).max(10000), conversations: z.array(conversationSchema).max(1000), messages: z.array(messageSchema).max(20000), runs: z.array(analysisRunSchema).max(5000), sources: z.array(sourceSnapshotSchema).max(10000), policies: z.array(policySchema).max(1000), outbox: z.array(outboxTurnSchema).max(2000) });
export const legacyMessageSchema = messageSchema.omit({ execution_kind: true });
export const legacyWorkspaceStateSchema = z.strictObject({ version: z.literal(1), instance_id: idSchema, portfolio_id: idSchema, root_generation: z.number().int().nonnegative(), migration: migrationStateSchema, journal: z.array(journalEntrySchema).max(10000), conversations: z.array(conversationSchema).max(1000), messages: z.array(legacyMessageSchema).max(20000), runs: z.array(legacyAnalysisRunSchema).max(5000), sources: z.array(legacySourceSnapshotSchema).max(10000), policies: z.array(policySchema).max(1000) });

export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type AnalysisRun = z.infer<typeof analysisRunSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type OutboxTurn = z.infer<typeof outboxTurnSchema>;
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
