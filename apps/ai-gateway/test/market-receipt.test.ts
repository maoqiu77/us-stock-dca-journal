import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortfolioMarketHandler } from '../src/market/handler.ts';
import { createMemoryMarketReceiptStore } from '../src/market/receipt-store.ts';

const at = '2026-09-13T10:00:00.000Z';
const id = (n: number) => `84000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = (openId: string) => ({ appId: 'wx-market', openId, source: 'wechat-miniprogram' as const });
const config = { schema_version: 1 as const, expected_app_id: 'wx-market', enabled: true, provider_configured: true, authorized: false, access_mode: 'public' as const, quote_access: true, bars_access: true, search_access: true, ai_source_access: true, archive_access: true, provider: 'Twelve Data', feed: 'licensed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, attribution: 'Twelve Data', limits: { quote_batch: 30, search_results: 10, bars: 400 } };
const quote = { schema_version: 1 as const, instrument_key: 'US:XNAS:AAPL', symbol: 'AAPL', currency: 'USD' as const, price: '221.10', price_kind: 'last_trade' as const, previous_close: '220', previous_close_date: '2026-09-12', change: '1.10', change_percent: '0.5', volume: '1', volume_scope: 'feed_only' as const, session: 'regular' as const, market_status: 'open' as const, trading_date: '2026-09-13', exchange_timezone: 'America/New_York' as const, provider: 'Twelve Data', feed: 'licensed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, as_of: at, received_at: at, served_at: at, freshness: 'current' as const, cache_state: 'miss' as const, status: 'available' as const, reason: null, adjustment: 'unadjusted' as const, attribution: 'Twelve Data' };

test('prepareAnalysisSnapshot freezes trusted provider quotes and binds receipt to owner', async () => {
  const receipts = createMemoryMarketReceiptStore();
  const handler = createPortfolioMarketHandler({ config, access: { allowed: async () => true }, provider: { search: async () => [], quotes: async () => [quote], bars: async () => { throw Error('unused'); } }, receipts, now: () => at, id: () => id(1) });
  const result = await handler({ action: 'prepareAnalysisSnapshot', instrument_keys: ['US:XNAS:AAPL'], purpose: 'portfolio_review', client_quote: { price: '999999' } }, context('owner-a'));
  assert.equal(result.ok, true); if (!result.ok) return;
  const data = result.data as any; assert.equal(data.quotes[0].price, '221.10');
  assert.equal((await receipts.get('owner-a', data.receipt_id))?.digest, data.receipt_digest);
  assert.equal(await receipts.get('owner-b', data.receipt_id), undefined);
});

test('receipt resolution rejects expiry and cannot silently refresh frozen content', async () => {
  const receipts = createMemoryMarketReceiptStore();
  await receipts.create({ owner: 'owner-a', id: id(2), purpose: 'portfolio_review', instrumentKeys: ['US:XNAS:AAPL'], quotes: [quote], provider: 'Twelve Data', feed: 'licensed', entitlementVersion: 'market-v1', createdAt: at, expiresAt: '2026-09-13T10:10:00.000Z' });
  assert.equal((await receipts.resolve('owner-a', id(2), '2026-09-13T10:09:59.000Z'))?.quotes[0].price, '221.10');
  const digest = (await receipts.get('owner-a', id(2)))!.digest;
  await receipts.bind('owner-a', id(2), digest, id(3), '2026-09-14T10:00:00.000Z');
  await assert.rejects(() => receipts.bind('owner-a', id(2), digest, id(4), '2026-09-14T10:00:00.000Z'), /RECEIPT_ALREADY_USED/);
  assert.equal((await receipts.resolve('owner-a', id(2), '2026-09-13T10:10:00.000Z'))?.acceptedRequestId, id(3));
  await receipts.create({ owner: 'owner-a', id: id(5), purpose: 'portfolio_review', instrumentKeys: ['US:XNAS:AAPL'], quotes: [quote], provider: 'Twelve Data', feed: 'licensed', entitlementVersion: 'market-v1', createdAt: at, expiresAt: '2026-09-13T10:10:00.000Z' });
  await assert.rejects(() => receipts.resolve('owner-a', id(5), '2026-09-13T10:10:00.000Z'), /RECEIPT_EXPIRED/);
});
