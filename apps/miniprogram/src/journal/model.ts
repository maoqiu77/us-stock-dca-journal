import { z } from 'zod';
import { dateSchema, idSchema, policySchema, timestampSchema } from '@portfolio/domain';

export const journalEntrySchema = z.strictObject({
  id: idSchema,
  revision_id: idSchema,
  parent_revision: idSchema.nullable(),
  journal_date: dateSchema,
  type: z.enum(['personal_note', 'user_decision', 'trade_ref', 'analysis_ref', 'conversation_ref']),
  ref_id: idSchema.nullable(),
  body: z.string().max(4000).nullable(),
  classification: z.enum(['user_original', 'ai_reference', 'ledger_reference']),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const conversationSchema = z.strictObject({
  id: idSchema,
  workspace_instance_id: idSchema,
  origin: z.enum(['portfolio', 'instrument', 'daily_review']),
  anchor_id: z.string().min(1).max(120).nullable(),
  context_mode: z.enum(['current', 'historical']),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const messageSchema = z.strictObject({
  id: idSchema,
  conversation_id: idSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(12000),
  parent_message_id: idSchema.nullable(),
  client_turn_id: idSchema,
  run_id: idSchema.nullable(),
  status: z.enum(['saved']),
  classification: z.enum(['user_original', 'ai_generated']),
  created_at: timestampSchema,
});

export const analysisRunSchema = z.strictObject({
  id: idSchema,
  request_id: idSchema,
  conversation_id: idSchema,
  parent_run_id: idSchema.nullable(),
  mode: z.enum(['portfolio_review', 'instrument_research', 'candidate_screen', 'daily_review', 'follow_up']),
  journal_date: dateSchema,
  state: z.enum(['succeeded']),
  output_validated: z.literal(true),
  local_saved: z.literal(true),
  provider: z.literal('fake'),
  demo: z.literal(true),
  source_ids: z.array(idSchema).max(500).refine(items => new Set(items).size === items.length, 'duplicate_source_id'),
  result: z.strictObject({ summary: z.string().min(1).max(4000) }).passthrough(),
  created_at: timestampSchema,
  completed_at: timestampSchema,
});

export const sourceSnapshotSchema = z.strictObject({
  id: idSchema,
  revision: idSchema,
  type: z.enum(['ledger', 'policy', 'quote', 'journal', 'user_statement', 'ai_output', 'imported_excerpt', 'instrument_catalog', 'fundamentals', 'news', 'candidate_pool']),
  as_of: timestampSchema,
  available_at: timestampSchema,
  content_hash: z.string().regex(/^[0-9a-f]{8}$/),
  content: z.string().max(20000),
});

export const migrationStateSchema = z.strictObject({
  source: z.literal('legacy_reviews'),
  completed_at: timestampSchema,
  legacy_review_map: z.record(dateSchema, idSchema),
});

export const workspaceStateSchema = z.strictObject({
  version: z.literal(1),
  instance_id: idSchema,
  portfolio_id: idSchema,
  root_generation: z.number().int().nonnegative(),
  migration: migrationStateSchema,
  journal: z.array(journalEntrySchema).max(10000),
  conversations: z.array(conversationSchema).max(1000),
  messages: z.array(messageSchema).max(20000),
  runs: z.array(analysisRunSchema).max(5000),
  sources: z.array(sourceSnapshotSchema).max(10000),
  policies: z.array(policySchema).max(1000),
});

export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type AnalysisRun = z.infer<typeof analysisRunSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
