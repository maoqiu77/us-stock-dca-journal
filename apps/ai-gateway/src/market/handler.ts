import { researchSelectionSchema, type ResearchSelection, type ResearchSeries } from '@portfolio/market-data/research';
import type { DomesticBoard } from '@portfolio/market-data/domestic';
import { barsV1Schema, canonicalInstrumentSchema, instrumentKeySchema, marketCapabilitiesSchema, quoteV1Schema, type CanonicalInstrument, type MarketCapabilities, type QuoteV1 } from '@portfolio/market-data';
import type { MarketBudgetPort, MarketProvider } from './ports.ts';
import { MarketProviderError } from './twelve-data-provider.ts';
import type { MarketReceiptStore } from './receipt-store.ts';

export type MarketTrustedContext = { appId: string; openId: string; source: 'wechat-miniprogram' };
export type MarketConfig = MarketCapabilities & { expected_app_id: string };
export type MarketAccessPort = { allowed(owner: string): Promise<boolean> };
type Deps = { research?: { load(input: ResearchSelection): Promise<ResearchSeries[]> }; domestic?: { load(segment: 'etf' | 'fund'): Promise<DomesticBoard> }; config: MarketConfig; access: MarketAccessPort; provider?: MarketProvider; receipts?: MarketReceiptStore; now(): string; id?(): string; userRate?: { budget: MarketBudgetPort; perMinute: number } };
const ok = (data: unknown) => ({ ok: true as const, data });
const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message, outcome_unknown: false } });
const providerFailure = (error: unknown) => error instanceof MarketProviderError ? fail(error.code, error.code === 'PROVIDER_RATE_LIMIT' ? '行情供应商限频，请稍后重试。' : error.code === 'PROVIDER_AUTH' ? '行情供应商授权失败。' : error.code === 'PROVIDER_TIMEOUT' ? '行情供应商请求超时。' : '行情供应商暂不可用。') : fail('PROVIDER_UNAVAILABLE', '行情供应商暂不可用。');

function unavailable(instrumentKey: string, now: string, reason: string, config: MarketConfig) {
  return quoteV1Schema.parse({ schema_version: 1, instrument_key: instrumentKey, symbol: instrumentKey.split(':')[2], currency: 'USD', price: null, price_kind: 'last_trade', previous_close: null, previous_close_date: null, change: null, change_percent: null, volume: null, volume_scope: 'unknown', session: 'unknown', market_status: 'unknown', trading_date: null, exchange_timezone: 'America/New_York', provider: config.provider ?? 'unconfigured', feed: config.feed ?? 'none', coverage: config.coverage, timeliness: config.timeliness, delay_seconds: config.delay_seconds, as_of: null, received_at: now, served_at: now, freshness: 'unknown', cache_state: 'miss', status: 'unavailable', reason, adjustment: 'unadjusted', attribution: config.attribution || '行情服务未配置' });
}

export function createPortfolioMarketHandler(deps: Deps) {
  const { expected_app_id: _expectedAppId, ...capabilities } = deps.config;
  const publicCapabilities = marketCapabilitiesSchema.parse(capabilities);
  return async function handle(event: any, context: MarketTrustedContext) {
    if (context.source !== 'wechat-miniprogram' || context.appId !== deps.config.expected_app_id || !context.openId) return fail('UNAUTHORIZED_SOURCE', '调用来源未通过验证。');
    const action = event?.action;
    if (action === 'capabilities') return ok({ ...publicCapabilities, authorized: await deps.access.allowed(context.openId) });
    if (!['search', 'quotes', 'bars', 'prepareAnalysisSnapshot', 'domesticBoard', 'researchSnapshot'].includes(action)) return fail('UNKNOWN_ACTION', '不支持的行情 action。');
    if (!await deps.access.allowed(context.openId)) return fail('ACCESS_DENIED', '当前用户无行情访问权限。');
    const withinUserRate = async () => !deps.userRate || await deps.userRate.budget.reserve(`market-user:${context.openId}:${deps.now().slice(0, 16)}`, 1, deps.userRate.perMinute, deps.now());
    if (action === 'researchSnapshot') {
      const parsed = researchSelectionSchema.safeParse(event.selection);
      if (!parsed.success) return fail('INVALID_RESEARCH_SELECTION', '市场、代码或周期设置无效。');
      if (!deps.config.enabled || !deps.research || !deps.receipts || !deps.id) return fail('RESEARCH_NOT_CONFIGURED', '多市场研究服务暂未配置。');
      if (!await withinUserRate()) return fail('USER_RATE_LIMIT', '请求过于频繁，请稍后重试。');
      try {
        const series = await deps.research.load(parsed.data);
        const createdAt=deps.now(), expiresAt=new Date(Date.parse(createdAt)+600000).toISOString();
        const receipt=await deps.receipts.create({ owner:context.openId,id:deps.id(),purpose:'instrument_research',instrumentKeys:[`${parsed.data.market}:${parsed.data.symbol}`],quotes:[],provider:'public-research',feed:'multi-period',entitlementVersion:'research-v1',createdAt,expiresAt,research:{selection:parsed.data,series} });
        return ok({receipt_id:receipt.id,receipt_digest:receipt.digest,created_at:createdAt,expires_at:expiresAt,selection:parsed.data,series});
      } catch { return fail('RESEARCH_UNAVAILABLE','研究行情暂不可用，请稍后重试。'); }
    }
    if (action === 'domesticBoard') {
      if (event.segment !== 'etf' && event.segment !== 'fund') return fail('INVALID_SEGMENT', '无效的基金分类。');
      if (!await withinUserRate()) return fail('USER_RATE_LIMIT', '行情请求过于频繁，请稍后重试。');
      return ok(deps.domestic ? await deps.domestic.load(event.segment) : { segment: event.segment, status: 'unavailable', reason: '国内基金行情尚未配置', rows: [] });
    }
    if (action === 'prepareAnalysisSnapshot') {
      const parsed: Array<ReturnType<typeof instrumentKeySchema.safeParse>> = Array.isArray(event.instrument_keys) ? event.instrument_keys.map((key: unknown) => instrumentKeySchema.safeParse(key)) : [];
      const purpose = event.purpose;
      if (!parsed.length || parsed.length > deps.config.limits.quote_batch || parsed.some(item => !item.success) || !['portfolio_review', 'instrument_research', 'daily_review', 'follow_up'].includes(purpose)) return fail('INVALID_SNAPSHOT_REQUEST', '分析行情范围无效。');
      if (!deps.config.enabled || !deps.config.quote_access || !deps.config.ai_source_access || !deps.config.archive_access) return fail('ENTITLEMENT_DENIED', '当前行情授权不允许 AI 来源归档。');
      if (!deps.provider || !deps.receipts || !deps.id) return fail('SERVICE_NOT_CONFIGURED', '行情凭据服务尚未配置。');
      if (!await withinUserRate()) return fail('USER_RATE_LIMIT', '行情请求过于频繁，请稍后重试。');
      const keys: string[] = parsed.map(item => item.success ? item.data : '');
      try {
        const received = new Map((await deps.provider.quotes(keys)).map(item => [item.instrument_key, quoteV1Schema.parse(item)]));
        const quotes = keys.map(key => received.get(key) ?? unavailable(key, deps.now(), 'PROVIDER_NO_RESULT', deps.config));
        const createdAt = deps.now(), receipt = await deps.receipts.create({ owner: context.openId, id: deps.id(), purpose, instrumentKeys: keys, quotes, provider: deps.config.provider ?? 'unconfigured', feed: deps.config.feed ?? 'none', entitlementVersion: 'market-v1', createdAt, expiresAt: new Date(Date.parse(createdAt) + 10 * 60_000).toISOString() });
        return ok({ receipt_id: receipt.id, receipt_digest: receipt.digest, created_at: receipt.createdAt, expires_at: receipt.expiresAt, provider: receipt.provider, feed: receipt.feed, attribution: deps.config.attribution, quotes: receipt.quotes });
      } catch (error) { return providerFailure(error); }
    }
    if (action === 'search') {
      const query = typeof event.query === 'string' ? event.query.trim() : '', limit = Number(event.limit ?? 10);
      if (query.length < 1 || query.length > 80 || !Number.isInteger(limit) || limit < 1 || limit > deps.config.limits.search_results) return fail('INVALID_SEARCH', '搜索条件无效。');
      if (!await withinUserRate()) return fail('USER_RATE_LIMIT', '行情请求过于频繁，请稍后重试。');
      if (!deps.config.enabled) return fail('MARKET_DISABLED', '行情服务已关闭。');
      if (!deps.config.search_access) return fail('ENTITLEMENT_DENIED', '当前行情授权不包含标的搜索。');
      if (!deps.provider) return ok({ query, results: [] });
      try { return ok({ query, results: (await deps.provider.search(query, limit)).map(item => canonicalInstrumentSchema.parse(item)) }); }
      catch (error) { return providerFailure(error); }
    }
    if (action === 'quotes') {
      const parsed: Array<ReturnType<typeof instrumentKeySchema.safeParse>> = Array.isArray(event.instrument_keys) ? event.instrument_keys.map((key: unknown) => instrumentKeySchema.safeParse(key)) : [];
      if (!parsed.length || parsed.length > deps.config.limits.quote_batch || parsed.some(item => !item.success)) return fail('INVALID_INSTRUMENT_KEYS', '标的列表无效。');
      if (!await withinUserRate()) return fail('USER_RATE_LIMIT', '行情请求过于频繁，请稍后重试。');
      const keys: string[] = parsed.map(item => item.success ? item.data : '');
      if (!deps.config.enabled || !deps.config.quote_access || !deps.provider) return ok({ quotes: keys.map(key => unavailable(key, deps.now(), !deps.config.enabled ? 'MARKET_DISABLED' : deps.config.quote_access ? 'PROVIDER_NOT_CONFIGURED' : 'ENTITLEMENT_DENIED', deps.config)) });
      try {
        const received = new Map<string, QuoteV1>((await deps.provider.quotes(keys)).map((item: QuoteV1) => [item.instrument_key, quoteV1Schema.parse(item)]));
        return ok({ quotes: keys.map(key => received.get(key) ?? unavailable(key, deps.now(), 'PROVIDER_NO_RESULT', deps.config)) });
      } catch (error) { const code = error instanceof MarketProviderError ? error.code : 'PROVIDER_UNAVAILABLE'; return ok({ quotes: keys.map(key => unavailable(key, deps.now(), code, deps.config)) }); }
    }
    const key = instrumentKeySchema.safeParse(event.instrument_key), range = event.range, interval = event.interval;
    if (!key.success || !['1M', '3M', '1Y'].includes(range) || interval !== '1day') return fail('INVALID_BARS_REQUEST', '走势图请求无效。');
    if (!await withinUserRate()) return fail('USER_RATE_LIMIT', '行情请求过于频繁，请稍后重试。');
    if (!deps.config.bars_access && deps.config.enabled) return fail('ENTITLEMENT_DENIED', '当前行情授权不包含历史走势。');
    if (!deps.config.enabled || !deps.provider) return ok(barsV1Schema.parse({ schema_version: 1, instrument_key: key.data, currency: 'USD', interval: '1day', range, adjustment: 'unadjusted', provider: deps.config.provider ?? 'unconfigured', feed: deps.config.feed ?? 'none', coverage: deps.config.coverage, timezone: 'America/New_York', as_of: null, received_at: deps.now(), served_at: deps.now(), status: 'unavailable', reason: !deps.config.enabled ? 'MARKET_DISABLED' : 'PROVIDER_NOT_CONFIGURED', bars: [] }));
    try { return ok(barsV1Schema.parse(await deps.provider.bars(key.data, range, interval))); }
    catch (error) { return providerFailure(error); }
  };
}
