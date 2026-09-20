import { researchTurnResponseV1Schema, researchTurnResponseV2Schema } from '@portfolio/ai-context';
import { aiCapabilitiesSchema, type AiTransport, TransportError } from './transport.ts';

type CloudCall = (options: { name: string; data: unknown }) => Promise<{ result?: unknown }>;
export function createCloudTransport(callFunction: CloudCall, functionName: string): AiTransport {
  if (!functionName.trim()) throw Error('云函数名未配置。');
  async function call(data: unknown) {
    try {
      const response = await callFunction({ name: functionName, data });
      const result = response.result as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string; outcome_unknown?: boolean } } | undefined;
      if (!result?.ok) throw new TransportError(result?.error?.code ?? 'CLOUD_RESPONSE_INVALID', result?.error?.message ?? '云函数返回无效。', !!result?.error?.outcome_unknown);
      return result.data;
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError('CLOUD_CALL_UNKNOWN', '云请求结果待核验，请查询原请求。', true);
    }
  }
  return {
    capabilities: async () => aiCapabilitiesSchema.parse(await call({ action: 'capabilities', capabilities_version: 2 })),
    acceptConsent: async version => { await call({ action: 'consent', accepted: true, consent_version: version }); },
    analyze: async envelope => await call({ action: 'analyze', envelope }) as any,
    status: async (requestId, payloadDigest) => await call({ action: 'status', request_id: requestId, payload_digest: payloadDigest }) as any,
    result: async (requestId, payloadDigest) => { const value = await call({ action: 'result', request_id: requestId, payload_digest: payloadDigest }); const v2 = researchTurnResponseV2Schema.safeParse(value); return v2.success ? v2.data : researchTurnResponseV1Schema.parse(value); },
    ack: async (requestId, payloadDigest, responseDigest) => { await call({ action: 'ack', request_id: requestId, payload_digest: payloadDigest, response_digest: responseDigest }); },
  };
}
