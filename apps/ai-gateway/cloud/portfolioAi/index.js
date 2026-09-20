const cloud = require('wx-server-sdk');
const crypto = require('node:crypto');
const gateway = require('./gateway.cjs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const accessMode = process.env.AI_ACCESS_MODE === 'public' ? 'public' : 'closed_beta';
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
  config: { expectedAppId: process.env.EXPECTED_WEAPP_APPID || '', enabled: process.env.AI_ENABLED === 'true', consentVersion: 1, accessMode, dailyLimit: number('AI_DAILY_REQUEST_LIMIT', 10), globalDailyLimit: number('AI_GLOBAL_DAILY_REQUEST_LIMIT', 1000), maxInflight: number('AI_MAX_INFLIGHT_PER_USER', 1), maxInputBytes: number('AI_MAX_INPUT_BYTES', 200000), maxOutputTokens: number('AI_MAX_OUTPUT_TOKENS', 1500), maxExpiryMs: number('AI_MAX_PREPARE_WINDOW_MS', 600000), providerConfigured: providerResolver.configured() },
  store: gateway.createCloudbaseRequestStore(db), receipts: gateway.createCloudbaseMarketReceiptStore(db), providerResolver, access: gateway.createCloudbaseAccess(db), now: () => new Date().toISOString(), id: () => crypto.randomUUID(),
});
const visionEnabled = process.env.AI_VISION_ENABLED === 'true';
const visionProvider = visionEnabled ? gateway.createDeepSeekVisionProvider({
  baseUrl: process.env.AI_BASE_URL,
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  model: process.env.AI_VISION_MODEL || '',
  timeoutMs: number('AI_VISION_TIMEOUT_MS', 35000),
  maxOutputTokens: number('AI_VISION_MAX_OUTPUT_TOKENS', 1200),
}) : gateway.disabledVisionProvider();
const visionHandler = gateway.createHoldingVisionHandler({
  config: { expectedAppId: process.env.EXPECTED_WEAPP_APPID || '', enabled: visionEnabled, maxBytes: number('AI_VISION_MAX_BYTES', 4194304), maxPixels: number('AI_VISION_MAX_PIXELS', 20000000), maxRows: number('AI_VISION_MAX_ROWS', 20), timeoutMs: number('AI_VISION_TIMEOUT_MS', 35000), taskTtlMs: number('AI_VISION_TASK_TTL_MS', 86400000), dailyLimit: null, maxInflight: 1 },
  store: gateway.createCloudbaseVisionTaskStore(db),
  objectStore: { async read(fileID) { const result = await cloud.downloadFile({ fileID }); return new Uint8Array(result.fileContent); }, async remove(fileID) { await cloud.deleteFile({ fileList: [fileID] }); } },
  provider: visionProvider, now: () => new Date().toISOString(), id: () => crypto.randomUUID(),
});
const visionActions = new Set(['visionCapabilities', 'createHoldingUpload', 'completeHoldingUpload', 'cancelHoldingUpload', 'recognizeHoldings']);
exports.main = async event => { const wx = cloud.getWXContext(), context = { appId: wx.APPID || '', openId: wx.OPENID || '', source: 'wechat-miniprogram' }; return visionActions.has(event?.action) ? visionHandler(event, context) : handler(event, context); };
