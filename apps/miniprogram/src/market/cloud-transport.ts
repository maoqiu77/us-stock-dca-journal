import { researchSnapshotSchema } from '@portfolio/market-data/research';
import { domesticBoardSchema } from '@portfolio/market-data/domestic';
import { barsV1Schema, canonicalInstrumentSchema, marketCapabilitiesSchema, quoteV1Schema } from '@portfolio/market-data';
import { MarketTransportError, type MarketTransport } from './transport.ts';
export { MarketTransportError } from './transport.ts';

type CloudCall = (options: { name: string; data: unknown }) => Promise<{ result?: unknown }>;
export function createCloudMarketTransport(callFunction: CloudCall, functionName: string): MarketTransport {
  if (!functionName.trim()) throw Error('行情云函数名未配置。');
  async function call(data: unknown) {
    try {
      const response = await callFunction({ name: functionName, data });
      const result = response.result as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string; outcome_unknown?: boolean } } | undefined;
      if (!result?.ok) throw new MarketTransportError(result?.error?.code ?? 'CLOUD_RESPONSE_INVALID', result?.error?.message ?? '行情云函数返回无效。', !!result?.error?.outcome_unknown);
      return result.data;
    } catch (error) {
      if (error instanceof MarketTransportError) throw error;
      throw new MarketTransportError('MARKET_CLOUD_UNKNOWN', '行情请求失败，已保留最近一次有效参考价。', true);
    }
  }
  return {
    researchSnapshot: async selection => researchSnapshotSchema.parse(await call({ action: 'researchSnapshot', selection })),
    domesticBoard: async segment => { const result = domesticBoardSchema.parse(await call({ action: 'domesticBoard', segment })); if (result.segment !== segment) throw Error('国内行情分类不匹配'); return result; },
    capabilities: async () => marketCapabilitiesSchema.parse(await call({ action: 'capabilities' })),
    search: async (query, limit) => {
      const data = await call({ action: 'search', query, limit }) as any;
      return canonicalInstrumentSchema.array().parse(data?.results);
    },
    quotes: async instrumentKeys => {
      const data = await call({ action: 'quotes', instrument_keys: instrumentKeys }) as any;
      return quoteV1Schema.array().parse(data?.quotes);
    },
    bars: async (instrumentKey, range, interval) => barsV1Schema.parse(await call({ action: 'bars', instrument_key: instrumentKey, range, interval })),
    prepareAnalysisSnapshot: async (instrumentKeys, purpose) => {
      const data = await call({ action: 'prepareAnalysisSnapshot', instrument_keys: instrumentKeys, purpose }) as any;
      return { ...data, quotes: quoteV1Schema.array().parse(data?.quotes) };
    },
  };
}
