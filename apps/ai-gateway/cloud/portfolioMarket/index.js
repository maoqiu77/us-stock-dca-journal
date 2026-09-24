// CloudBase may create functions on Node 16, which has no native fetch.
if (typeof globalThis.fetch !== 'function') globalThis.fetch = require('undici').fetch;
if (typeof AbortSignal.timeout !== 'function') AbortSignal.timeout = milliseconds => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), milliseconds); if (timer.unref) timer.unref(); return controller.signal; };
const cloud = require('wx-server-sdk');
const crypto = require('node:crypto');
const market = require('./market.cjs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const bool = name => process.env[name] === 'true';
const positive = (name, fallback, maximum) => { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value < 1 || value > maximum) throw Error(`INVALID_${name}`); return value; };
const accessMode = process.env.MARKET_ACCESS_MODE === 'public' ? 'public' : 'closed_beta';
const db = cloud.database();
const now = () => new Date().toISOString();
const publicUS = !process.env.MARKET_PROVIDER || process.env.MARKET_PROVIDER === 'eastmoney';
const providerName = process.env.MARKET_PROVIDER === 'twelvedata' ? 'twelvedata' : '';
const feed = (process.env.MARKET_FEED || '').trim();
const attribution = (process.env.MARKET_ATTRIBUTION || '').trim();
const key = (process.env.TWELVE_DATA_API_KEY || '').trim();
const timeliness = ['realtime', 'delayed', 'eod'].includes(process.env.MARKET_TIMELINESS) ? process.env.MARKET_TIMELINESS : 'unknown';
const coverage = ['consolidated', 'venue_subset', 'indicative'].includes(process.env.MARKET_COVERAGE) ? process.env.MARKET_COVERAGE : 'unknown';
const rawDelay = process.env.MARKET_DELAY_SECONDS === undefined ? null : Number(process.env.MARKET_DELAY_SECONDS);
const declaredDelay = Number.isInteger(rawDelay) && rawDelay >= 0 ? rawDelay : null;
const delay = timeliness === 'realtime' ? 0 : timeliness === 'delayed' || timeliness === 'eod' ? declaredDelay : null;
const providerConfigured = publicUS || providerName === 'twelvedata' && !!key && !!feed && !!attribution && timeliness !== 'unknown' && coverage !== 'unknown' && (timeliness !== 'delayed' || delay !== null && delay > 0);
const infrastructure = market.createCloudbaseMarketInfrastructure(db);
const receipts = market.createCloudbaseMarketReceiptStore(db);
const rawProvider = publicUS ? new market.EastmoneyUSProvider({ now }) : providerConfigured ? new market.TwelveDataProvider({ apiKey: key, feed, coverage, timeliness, delaySeconds: delay, attribution, catalogVersion: process.env.MARKET_CATALOG_VERSION || 'unversioned' }) : undefined;
const provider = rawProvider ? market.createCachedMarketProvider(rawProvider, infrastructure, {
  scope: `${publicUS ? 'eastmoney' : 'twelvedata'}:${process.env.MARKET_ENTITLEMENT_DOMAIN || 'private'}:${feed}`,
  quoteTtlMs: positive('MARKET_QUOTE_CACHE_SECONDS', 15, 3600) * 1000,
  staleRetentionMs: positive('MARKET_STALE_RETENTION_SECONDS', 86400, 604800) * 1000,
  dailyUnits: positive('MARKET_DAILY_UNITS', 10000, 10000000), minuteUnits: positive('MARKET_MINUTE_UNITS', 100, 100000), now,
}) : undefined;
const handler = market.createPortfolioMarketHandler({
  config: {
    schema_version: 1, expected_app_id: process.env.EXPECTED_WEAPP_APPID || '', enabled: publicUS ? process.env.MARKET_ENABLED !== 'false' : bool('MARKET_ENABLED'), provider_configured: providerConfigured,
    authorized: false, access_mode: accessMode, quote_access: publicUS || bool('MARKET_QUOTE_ACCESS'), bars_access: publicUS || bool('MARKET_BARS_ACCESS'), search_access: publicUS || bool('MARKET_SEARCH_ACCESS'),
    ai_source_access: !publicUS && bool('MARKET_AI_SOURCE_ACCESS'), archive_access: !publicUS && bool('MARKET_ARCHIVE_ACCESS'), provider: publicUS ? '东方财富公开接口' : providerConfigured ? 'Twelve Data' : null, feed: publicUS ? 'public-us-reference' : providerConfigured ? feed : null, coverage: publicUS ? 'indicative' : coverage, timeliness: publicUS ? 'unknown' : timeliness, delay_seconds: publicUS ? null : delay,
    attribution: publicUS ? '东方财富公开参考行情 · 延迟未知' : attribution, limits: { quote_batch: positive('MARKET_QUOTE_BATCH', 30, 30), search_results: positive('MARKET_SEARCH_RESULTS', 10, 10), bars: positive('MARKET_MAX_BARS', 400, 400) },
  },
  access: { async allowed(owner) { const ownerHash = crypto.createHash('sha256').update(owner).digest('hex'); const value = await db.collection('market_access').doc(ownerHash).get().catch(() => ({ data: [] })); const row = Array.isArray(value.data) ? value.data[0] : value.data; return row?.enabled === true && row?.consentVersion === (process.env.MARKET_CONSENT_VERSION || 'market-v1') && (accessMode === 'public' || row?.enrolled === true) && (row.owner === undefined || row.owner === owner); } },
  userRate: { budget: infrastructure.budget, perMinute: positive('MARKET_USER_REQUESTS_PER_MINUTE', 30, 1000) },
  domestic: market.createDomesticBoard({
    grant: process.env.CN_MARKET_PROVIDER !== 'tushare' ? { mode: 'public_endpoint', enabled: process.env.CN_MARKET_ENABLED !== 'false', cacheSeconds: 300 } : { enabled: bool('CN_MARKET_ENABLED'), tokenConfigured: !!process.env.TUSHARE_TOKEN, publicDisplay: bool('CN_PUBLIC_DISPLAY_ALLOWED'), cacheAllowed: bool('CN_CACHE_ALLOWED'), reference: process.env.CN_ENTITLEMENT_REFERENCE || '', validUntil: process.env.CN_ENTITLEMENT_VALID_UNTIL || '', cacheSeconds: Number(process.env.CN_CACHE_SECONDS || 3600) },
    provider: process.env.CN_MARKET_PROVIDER !== 'tushare' ? new market.EastmoneyFundProvider({ now }) : process.env.TUSHARE_TOKEN ? new market.TushareFundProvider({ token: process.env.TUSHARE_TOKEN, cnyCodes: (process.env.CN_CNY_FUND_CODES || '').split(',').map(code => code.trim()).filter(code => /^\d{6}\.(SH|SZ|OF)$/.test(code)), now }) : undefined,
    cache: infrastructure.cache, now,
  }),
  domesticHoldings: process.env.CN_MARKET_ENABLED === 'false' ? undefined : new market.EastmoneyCNHoldingProvider({ now }),
  research: process.env.RESEARCH_MARKET_ENABLED === 'false' ? undefined : new market.ResearchMarketProvider({ now }),
  provider, receipts, now, id: () => crypto.randomUUID(),
});
exports.main = async event => { const wx = cloud.getWXContext(); return handler(event, { appId: wx.APPID || '', openId: wx.OPENID || '', source: 'wechat-miniprogram' }); };
