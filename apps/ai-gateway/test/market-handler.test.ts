import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortfolioMarketHandler } from '../src/market/handler.ts';
import { createMemoryMarketInfrastructure } from '../src/market/ports.ts';

const context = { appId: 'wx-market', openId: 'owner-a', source: 'wechat-miniprogram' as const };
const config = { schema_version: 1 as const, expected_app_id: 'wx-market', enabled: true, provider_configured: false, authorized: false, access_mode: 'public' as const, quote_access: true, bars_access: true, search_access: true, ai_source_access: false, archive_access: false, provider: null, feed: null, coverage: 'unknown' as const, timeliness: 'unknown' as const, delay_seconds: null, attribution: '', limits: { quote_batch: 30, search_results: 10, bars: 400 } };
test('market handler ignores forged owner and URL fields and returns honest unavailable quotes', async () => {
  const handler = createPortfolioMarketHandler({ config, access: { allowed: async owner => owner === 'owner-a' }, now: () => '2026-09-13T15:00:00.000Z' });
  const result = await handler({ action: 'quotes', owner: 'owner-b', provider_url: 'https://attacker.invalid', instrument_keys: ['US:XNAS:AAPL'] }, context);
  assert.equal(result.ok, true); if (result.ok) { assert.equal((result.data as any).quotes[0].status, 'unavailable'); assert.equal((result.data as any).quotes[0].price, null); }
});
test('market action whitelist, trusted app identity and batch validation fail closed', async () => {
  const handler = createPortfolioMarketHandler({ config, access: { allowed: async () => true }, now: () => '2026-09-13T15:00:00.000Z' });
  assert.equal((await handler({ action: 'proxy', url: 'https://example.com' }, context)).ok, false);
  assert.equal((await handler({ action: 'quotes', instrument_keys: ['bad'] }, context)).ok, false);
  assert.equal((await handler({ action: 'capabilities' }, { ...context, appId: 'forged' })).ok, false);
});
test('partial provider response becomes a per-instrument unavailable result', async () => {
  const handler = createPortfolioMarketHandler({ config: { ...config, provider_configured: true }, access: { allowed: async () => true }, now: () => '2026-09-13T15:00:00.000Z', provider: { async search() { return []; }, async quotes() { return []; }, async bars() { throw Error('not used'); } } });
  const result = await handler({ action: 'quotes', instrument_keys: ['US:XNAS:AAPL', 'US:XNAS:QQQ'] }, context);
  assert.equal(result.ok, true); if (result.ok) assert.deepEqual((result.data as any).quotes.map((item: any) => item.reason), ['PROVIDER_NO_RESULT', 'PROVIDER_NO_RESULT']);
});
test('disabled production service still expresses quote and bar absence without zero data', async () => {
  const handler = createPortfolioMarketHandler({ config: { ...config, enabled: false }, access: { allowed: async () => true }, now: () => '2026-09-13T15:00:00.000Z' });
  const quote = await handler({ action: 'quotes', instrument_keys: ['US:XNAS:AAPL'] }, context);
  const bars = await handler({ action: 'bars', instrument_key: 'US:XNAS:AAPL', range: '1M', interval: '1day' }, context);
  assert.equal((quote as any).data.quotes[0].reason, 'MARKET_DISABLED'); assert.equal((quote as any).data.quotes[0].price, null);
  assert.equal((bars as any).data.reason, 'MARKET_DISABLED'); assert.deepEqual((bars as any).data.bars, []);
});
test('per-user market request limit is shared through the budget port', async () => {
  const now = '2026-09-13T15:00:00.000Z', infrastructure = createMemoryMarketInfrastructure(() => now);
  const handler = createPortfolioMarketHandler({ config, access: { allowed: async () => true }, now: () => now, userRate: { budget: infrastructure.budget, perMinute: 2 } });
  assert.equal((await handler({ action: 'quotes', instrument_keys: ['US:XNAS:AAPL'] }, context)).ok, true);
  assert.equal((await handler({ action: 'quotes', instrument_keys: ['US:XNAS:AAPL'] }, context)).ok, true);
  const denied = await handler({ action: 'quotes', instrument_keys: ['US:XNAS:AAPL'] }, context);
  assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, 'USER_RATE_LIMIT');
});
