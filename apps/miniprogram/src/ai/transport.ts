import type { ResearchTurnEnvelopeV1, ResearchTurnEnvelopeV2, ResearchTurnResponseV1, ResearchTurnResponseV2 } from '@portfolio/ai-context';
import { z } from 'zod';

export const aiCapabilitiesSchema = z.strictObject({ schemaVersion: z.literal(1), enabled: z.boolean(), authorized: z.boolean(), enrolled: z.boolean(), consented: z.boolean(), accessMode: z.enum(['closed_beta', 'public']), principalHash: z.string().regex(/^[a-f0-9]{64}$/), providerConfigured: z.boolean(), credentialMode: z.literal('sponsored'), byokEnabled: z.boolean(), consentVersion: z.number().int().positive(), usage: z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), used: z.number().int().nonnegative(), inflight: z.number().int().nonnegative(), timezone: z.literal('UTC'), totalUsed: z.number().int().nonnegative().optional() }), limits: z.strictObject({ dailyRequests: z.number().int().positive(), unlimited: z.boolean().optional(), lifetimeRequests: z.number().int().positive().nullable().optional(), globalDailyRequests: z.number().int().positive(), maxInflight: z.number().int().positive(), maxInputBytes: z.number().int().positive(), maxOutputTokens: z.number().int().positive() }) });
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>;
export type AiRemoteStatus = { requestId: string; status: 'running' | 'outcome_unknown' | 'succeeded' | 'failed' | 'expired'; responseDigest?: string; errorCode?: string };
export interface AiTransport {
  capabilities(): Promise<AiCapabilities>;
  acceptConsent?(version: number): Promise<void>;
  analyze(envelope: ResearchTurnEnvelopeV1 | ResearchTurnEnvelopeV2): Promise<AiRemoteStatus>;
  status(requestId: string, payloadDigest: string): Promise<AiRemoteStatus>;
  result(requestId: string, payloadDigest: string): Promise<ResearchTurnResponseV1 | ResearchTurnResponseV2>;
  ack(requestId: string, payloadDigest: string, responseDigest: string): Promise<void>;
}

export class TransportError extends Error {
  readonly code: string;
  readonly outcomeUnknown: boolean;
  constructor(code: string, message: string, outcomeUnknown = false) { super(message); this.name = 'TransportError'; this.code = code; this.outcomeUnknown = outcomeUnknown; }
}
