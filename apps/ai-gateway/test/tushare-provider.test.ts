import test from 'node:test';
import assert from 'node:assert/strict';
import { TushareFundProvider } from '../src/market/tushare-provider.ts';
import { createDomesticBoard } from '../src/market/domestic-board.ts';
import { createMemoryMarketInfrastructure } from '../src/market/ports.ts';
const now = () => '2026-09-20T08:00:00Z';
function transport(calls: string[], failNav = false): typeof fetch {
 return (async (url, init) => {
  assert.equal(url, 'https://api.tushare.pro'); assert.equal(init?.redirect, 'error');
  const req = JSON.parse(String(init?.body)); calls.push(req.api_name);
  const rows = req.api_name === 'fund_basic' ? req.params.market === 'E' ? [{ ts_code: '513500.SH', name: '测试标普500ETF', market: 'E', status: 'L', fund_type: '股票型', benchmark: '标普500' }] : [{ ts_code: '000001.OF', name: '测试QDII A', market: 'O', status: 'L', fund_type: 'QDII', benchmark: '' }] : req.api_name === 'fund_daily' ? [{ ts_code: '513500.SH', trade_date: '20260918', close: 1.05, pct_chg: 0 }] : [{ ts_code: req.params.ts_code, nav_date: '20260917', ann_date: '20260918', unit_nav: 1 }, { ts_code: req.params.ts_code, nav_date: '20260919', ann_date: '20260921', unit_nav: 9 }];
  return new Response(JSON.stringify(req.api_name === 'fund_nav' && failNav ? { code: -1, msg: 'secret must not escape' } : { code: 0, data: { fields: req.fields.split(','), items: rows.map(row => req.fields.split(',').map((field: string) => (row as any)[field])) } }));
 }) as typeof fetch;
}
test('official daily ETF quote and published NAV preserve dates and true zero; future publication excluded', async () => {
 const calls: string[] = [], provider = new TushareFundProvider({ token: 'test-token', cnyCodes: ['513500.SH', '000001.OF'], now, fetch: transport(calls) });
 const etf = await provider.board('etf'), row = etf.rows[0];
 assert.equal(row.price, '1.05'); assert.equal(row.changePct, 0); assert.equal(row.navDate, '2026-09-17'); assert.equal(row.announcementDate, '2026-09-18'); assert.ok(Math.abs(row.premiumPct! - 5) < 1e-9); assert.match(row.premiumLabel, /非实时/);
 const fund = (await provider.board('fund')).rows[0]; assert.equal(fund.instrument.symbol, '000001'); assert.equal(fund.price, null); assert.equal(fund.premiumPct, null); assert.equal(fund.nav, '1');
 assert.ok(!JSON.stringify(etf).includes('test-token'));
});
test('NAV failure leaves real daily price and no guessed premium; unknown currency products never added', async () => {
 const provider = new TushareFundProvider({ token: 'test-token', cnyCodes: ['513500.SH'], now, fetch: transport([], true) });
 const row = (await provider.board('etf')).rows[0]; assert.equal(row.price, '1.05'); assert.equal(row.nav, null); assert.equal(row.premiumPct, null); assert.equal(row.quality, 'partial');
 let calls = 0; const noCatalog = new TushareFundProvider({ token: 'test-token', cnyCodes: [], now, fetch: (async () => { calls++; throw Error(); }) as typeof fetch });
 assert.deepEqual((await noCatalog.board('etf')).rows, []); assert.equal(calls, 0);
});
test('public grant fails closed; valid grant coalesces and caches only public data', async () => {
 const grant = { enabled: true, tokenConfigured: true, publicDisplay: false, cacheAllowed: true, reference: 'contract-test', validUntil: '2027-01-01T00:00:00Z', cacheSeconds: 3600 };
 const infrastructure = createMemoryMarketInfrastructure(now); let calls = 0;
 const provider = { async board() { calls++; return { segment: 'etf' as const, status: 'partial' as const, reason: '', rows: [] }; } };
 const denied = createDomesticBoard({ grant, cache: infrastructure.cache, provider, now }); assert.equal((await denied.load('etf')).status, 'unavailable'); assert.equal(calls, 0);
 const accepted = createDomesticBoard({ grant: { ...grant, publicDisplay: true }, cache: infrastructure.cache, provider, now }); await Promise.all([accepted.load('etf'), accepted.load('etf')]); await accepted.load('etf'); assert.equal(calls, 1);
 const expired = createDomesticBoard({ grant: { ...grant, publicDisplay: true, validUntil: '2026-01-01T00:00:00Z' }, cache: infrastructure.cache, provider, now }); assert.equal((await expired.load('etf')).rows.length, 0); assert.equal(calls, 1);
});
