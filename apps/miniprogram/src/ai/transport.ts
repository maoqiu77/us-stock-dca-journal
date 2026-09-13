import type { ResearchTurnEnvelopeV1, ResearchTurnResponseV1 } from '@portfolio/ai-context';

export type AiCapabilities = { enabled: boolean; authorized: boolean; providerConfigured: boolean; consentVersion: number; limits: { dailyRequests: number; maxInflight: number; maxInputBytes: number; maxOutputTokens: number } };
export type AiRemoteStatus = { requestId: string; status: 'running' | 'outcome_unknown' | 'succeeded' | 'failed' | 'expired'; responseDigest?: string; errorCode?: string };
export interface AiTransport {
  capabilities(): Promise<AiCapabilities>;
  analyze(envelope: ResearchTurnEnvelopeV1): Promise<AiRemoteStatus>;
  status(requestId: string, payloadDigest: string): Promise<AiRemoteStatus>;
  result(requestId: string, payloadDigest: string): Promise<ResearchTurnResponseV1>;
  ack(requestId: string, payloadDigest: string, responseDigest: string): Promise<void>;
}

export class TransportError extends Error {
  readonly code: string;
  readonly outcomeUnknown: boolean;
  constructor(code: string, message: string, outcomeUnknown = false) { super(message); this.name = 'TransportError'; this.code = code; this.outcomeUnknown = outcomeUnknown; }
}
