import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EastmoneyFundProvider } from '../src/market/eastmoney-provider.ts';
const now = () => '2026-09-20T00:00:00.000Z';
function provider(quote: object) {
  return new EastmoneyFundProvider({ now, fetch: (async (url: string) => new Response(url.includes('fundcode') ? 'var r = [["513500","","标普500ETF博时"],["017730","","嘉实全球产业升级股票发起式(QDII)A"]];' : JSON.stringify(url.includes('ulist') ? { data: { diff: [quote] } } : { Data: { LSJZList: [{ FSRQ: '2099-01-01', DWJZ: '9' }, { FSRQ: '2026-09-17', DWJZ: '2.5' }] } }))) as typeof fetch });
}
const observation = { f12: '513500', f13: 1, f14: '标普500ETF博时', f2: 2.685, f3: 0, f124: 1789719100, f402: -9.95, f441: 2.442, f38: 10277638656 };
test('public quote preserves decimal price, zero change, discount sign and share units', async () => {
  const row = (await provider(observation).board('etf')).rows[0];
  assert.equal(row.price, '2.685'); assert.equal(row.changePct, 0); assert.equal(row.tradeDate, '2026-09-18');
  assert.equal(row.metrics?.quotedPremiumPct, 9.95); assert.equal(row.metrics?.shares, 10277638656);
  assert.equal(row.metrics?.percentile60, null); assert.equal(row.metrics?.sharesChange, null);
  assert.equal(row.announcementDate, null); assert.equal(row.premiumPct, null);
});
test('unknown quote identity, future date and nonpositive reference cannot contaminate metrics', async () => {
  for (const override of [{ f12: '000001' }, { f13: 0 }, { f124: 9999999999 }]) {
    const row = (await provider({ ...observation, ...override }).board('etf')).rows[0];
    assert.equal(row.price, null); assert.equal(row.metrics?.quotedPremiumPct, null); assert.equal(row.metrics?.shares, null);
  }
  const row = (await provider({ ...observation, f441: -1 }).board('etf')).rows[0];
  assert.equal(row.metrics?.quotedPremiumPct, null);
});
test('zero price is missing rather than a real quote', async () => {
  const row = (await provider({ ...observation, f2: 0 }).board('etf')).rows[0];
  assert.equal(row.price, null); assert.equal(row.tradeDate, null);
});
test('fund NAV ignores future records and preserves unknown announcement date', async () => {
  const row = (await provider(observation).board('fund')).rows[0];
  assert.equal(row.nav, '2.5'); assert.equal(row.navDate, '2026-09-17'); assert.equal(row.announcementDate, null);
});
test('network failure rejects without fabricating observations', async () => {
  const p = new EastmoneyFundProvider({ now, fetch: (async () => { throw Error('offline'); }) as typeof fetch });
  await assert.rejects(p.board('fund'));
});
