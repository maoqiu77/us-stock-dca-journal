const cloud = require('wx-server-sdk');
const crypto = require('node:crypto');
const gateway = require('./gateway.cjs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const number = (name, fallback) => { const value = Number(process.env[name] || fallback); if (!Number.isFinite(value) || value <= 0) throw Error(`INVALID_${name}`); return value; };
const providerResolver = gateway.createProviderResolver({
  provider: process.env.AI_PROVIDER,
  protocol: process.env.AI_PROTOCOL,
  baseUrl: process.env.AI_BASE_URL,
  model: process.env.AI_MODEL,
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  timeoutMs: number('AI_TIMEOUT_MS', 35000),
  maxOutputTokens: number('AI_MAX_OUTPUT_TOKENS', 1500),
  byokEnabled: process.env.AI_BYOK_ENABLED === 'true',
});
const handler = gateway.createPortfolioAiHandler({
  config: { expectedAppId: process.env.EXPECTED_WEAPP_APPID || '', enabled: process.env.AI_ENABLED === 'true', consentVersion: 1, dailyLimit: number('AI_DAILY_REQUEST_LIMIT', 10), maxInflight: number('AI_MAX_INFLIGHT_PER_USER', 1), maxInputBytes: number('AI_MAX_INPUT_BYTES', 200000), maxOutputTokens: number('AI_MAX_OUTPUT_TOKENS', 1500), maxExpiryMs: number('AI_MAX_PREPARE_WINDOW_MS', 600000), providerConfigured: providerResolver.configured() },
  store: gateway.createCloudbaseRequestStore(db), providerResolver, access: gateway.createCloudbaseAccess(db), now: () => new Date().toISOString(), id: () => crypto.randomUUID(),
});
exports.main = async event => { const wx = cloud.getWXContext(); return handler(event, { appId: wx.APPID || '', openId: wx.OPENID || '', source: 'wechat-miniprogram' }); };
