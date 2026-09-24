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
test('ETF board falls back to Tencent quotes when the primary public endpoint is unreachable', async () => {
  const fields=Array(88).fill('');Object.assign(fields,{0:'1',1:'标普500ETF博时',2:'513500',3:'2.688',30:'20260918161444',32:'0.11',72:'10278638600',77:'9.97',78:'2.4444',82:'CNY'});
  const p=new EastmoneyFundProvider({now,fetch:(async url=>{if(String(url).includes('qt.gtimg.cn'))return new Response(`v_sh513500="${fields.join('~')}";`);throw Error('primary unavailable');}) as typeof fetch});
  const board=await p.board('etf'),row=board.rows.find(item=>item.instrument.symbol==='513500')!;
  assert.equal(board.status,'partial');assert.match(board.reason,/已切换腾讯财经/);assert.equal(row.price,'2.688');assert.equal(row.tradeDate,'2026-09-18');assert.equal(row.changePct,0.11);assert.equal(row.metrics?.quotedPremiumPct,9.97);assert.equal(row.source,'腾讯财经公开接口 · 延迟未知');
});
test('ETF board also falls back when the primary endpoint returns no usable observations', async () => {
  const fields=Array(88).fill('');Object.assign(fields,{0:'1',2:'513500',3:'2.688',30:'20260918161444',32:'0.11',72:'10278638600',77:'9.97',78:'2.4444',82:'CNY'});
  const p=new EastmoneyFundProvider({now,fetch:(async url=>new Response(String(url).includes('fundcode') ? 'var r = [["513500","","标普500ETF博时"]];' : String(url).includes('qt.gtimg.cn') ? `v_sh513500="${fields.join('~')}";` : JSON.stringify({data:{diff:[]}}))) as typeof fetch});
  const row=(await p.board('etf')).rows.find(item=>item.instrument.symbol==='513500')!;assert.equal(row.price,'2.688');assert.equal(row.source,'腾讯财经公开接口 · 延迟未知');
});
test('Tencent ETF fallback rejects future and mismatched quote identities', async () => {
  const fields=Array(88).fill('');Object.assign(fields,{0:'1',2:'000001',3:'2.688',30:'20990918161444',32:'0.11',77:'9.97',78:'2.4444',82:'CNY'});
  const p=new EastmoneyFundProvider({now,fetch:(async url=>{if(String(url).includes('qt.gtimg.cn'))return new Response(`v_sh513500="${fields.join('~')}";`);throw Error('primary unavailable');}) as typeof fetch});
  const row=(await p.board('etf')).rows.find(item=>item.instrument.symbol==='513500')!;assert.equal(row.price,null);assert.equal(row.metrics?.quotedPremiumPct,null);
});
test('fund NAV ignores future records and preserves unknown announcement date', async () => {
  const row = (await provider(observation).board('fund')).rows[0];
  assert.equal(row.nav, '2.5'); assert.equal(row.navDate, '2026-09-17'); assert.equal(row.announcementDate, null);
});
test('fund daily change uses the official NAV-date growth field', async () => {
  const p = new EastmoneyFundProvider({ now, fetch: (async url => new Response(String(url).includes('fundcode') ? 'var r = [["017730","","嘉实全球产业升级股票发起式(QDII)A"]];' : String(url).includes('lsjz') ? JSON.stringify({ Data: { LSJZList: [{ FSRQ: '2099-01-01', DWJZ: '9', JZZZL: '99' }, { FSRQ: '2026-09-18', DWJZ: '2.5', JZZZL: '-1.23' }] } }) : '')) as typeof fetch });
  const row = (await p.board('fund', ['017730'])).rows[0];
  assert.equal(row.navDate, '2026-09-18'); assert.equal(row.changePct, -1.23);
});
test('fund holdings parse the latest disclosed stock table and dated asset allocation', async () => {
  const html = `<div class="boxitem"><h4><font class="px12">2026-06-30</font></h4><table><thead><tr><th>序号</th><th>股票代码</th><th>股票名称</th><th>占净值比例</th></tr></thead><tbody><tr><td>1</td><td>AMD</td><td>超威半导体</td><td>3.54%</td></tr><tr><td>2</td><td>MU</td><td>美光科技</td><td>3.40%</td></tr></tbody></table></div>`;
  const asset = { series: [{ name: '股票占净比', data: [79.68] }, { name: '债券占净比', data: [4.96] }, { name: '现金占净比', data: [10.34] }], categories: ['2026-06-30'] };
  const p = new EastmoneyFundProvider({ now, fetch: (async url => new Response(String(url).includes('FundArchivesDatas') ? `var apidata={ content:${JSON.stringify(html)},arryear:[2026]};` : `var Data_assetAllocation = ${JSON.stringify(asset)};`)) as typeof fetch });
  const result = await p.holdings('017730');
  assert.equal(result.status, 'available'); assert.equal(result.asOf, '2026-06-30');
  assert.deepEqual(result.stocks.map(item => [item.symbol, item.weightPct]), [['AMD', 3.54], ['MU', 3.4]]);
  assert.deepEqual(result.allocation, { asOf: '2026-06-30', stocksPct: 79.68, bondsPct: 4.96, cashPct: 10.34 });
});
test('fund board reads a sourced daily limit and searches catalog codes', async () => {
  const p = new EastmoneyFundProvider({ now, fetch: (async url => new Response(String(url).includes('fundcode') ? 'var r = [["017730","","嘉实全球产业升级股票发起式(QDII)A"],["513500","","标普500ETF博时"]];' : String(url).includes('lsjz') ? JSON.stringify({ Data: { LSJZList: [{ FSRQ: '2026-09-17', DWJZ: '2.5' }] } }) : '<div class="buyWayStatic"><span>单日累计购买上限1000.00元</span></div>')) as typeof fetch });
  assert.deepEqual((await p.search('017730', 'fund')).map(item => item.code), ['017730']);
  assert.deepEqual((await p.search('513500', 'etf')).map(item => item.code), ['513500']);
  const row = (await p.board('fund', ['017730'])).rows[0];
  assert.deepEqual(row.dailyLimit, { amount: '1000', channel: 'eastmoney', fetchedAt: now() });
});
test('fund board converts ten-thousand-yuan purchase limits without treating them as yuan', async () => {
  const p = new EastmoneyFundProvider({ now, fetch: (async url => new Response(String(url).includes('fundcode') ? 'var r = [["270023","","广发全球精选股票(QDII)人民币A"]];' : String(url).includes('lsjz') ? JSON.stringify({ Data: { LSJZList: [] } }) : '<div class="buyWayStatic"><div class="staticItem"><span>单日累计购买上限1.00万元</span></div></div>')) as typeof fetch });
  assert.equal((await p.board('fund', ['270023'])).rows[0].dailyLimit?.amount, '10000');
});
test('network failure rejects without fabricating observations', async () => {
  const p = new EastmoneyFundProvider({ now, fetch: (async () => { throw Error('offline'); }) as typeof fetch });
  await assert.rejects(p.board('fund'));
});
