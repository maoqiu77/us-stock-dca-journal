import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EastmoneyCNHoldingProvider } from '../src/market/cn-holding-quotes.ts';

test('A-share and exchange ETF quotes retain matching code and observation time', async () => {
  const now = '2026-09-23T03:00:00.000Z';
  const fetcher = async (url: string) => {
    assert.match(url, /secids=1\.600009%2C0\.159501/);
    return new Response(JSON.stringify({ data: { diff: [
      { f12: '600009', f13: 1, f14: '上海机场', f2: 34.52, f124: 1790132340 },
      { f12: '159501', f13: 0, f14: '纳指ETF嘉实', f2: 1.523, f124: 1790132340 },
    ] } }));
  };
  const rows = await new EastmoneyCNHoldingProvider({ now: () => now, fetch: fetcher as typeof fetch }).quotes(['600009', '159501']);
  assert.deepEqual(rows.map(row => row.price), ['34.52', '1.523']);
  assert.equal(rows[0].asOf, '2026-09-23T02:59:00.000Z');
});

test('mismatched or future observations remain unavailable', async () => {
  const provider = new EastmoneyCNHoldingProvider({ now: () => '2026-09-23T03:00:00.000Z', fetch: (async () => new Response(JSON.stringify({ data: { diff: [{ f12: '600009', f13: 0, f14: '错误市场', f2: 34, f124: 1890132340 }] } }))) as typeof fetch });
  const [row] = await provider.quotes(['600009']);
  assert.equal(row.status, 'unavailable');
  assert.equal(row.price, null);
});

test('Tencent reference quotes backfill unavailable Eastmoney instruments with Shanghai timestamps', async () => {
  const now = '2026-09-23T04:10:00.000Z';
  const fields = Array(88).fill('');
  Object.assign(fields, { 2: '600009', 3: '22.87', 30: '20260923120543', 82: 'CNY' });
  const provider = new EastmoneyCNHoldingProvider({ now: () => now, fetch: (async url => {
    if (String(url).includes('push2delay.eastmoney.com')) return new Response(JSON.stringify({ data: { diff: [] } }));
    assert.match(String(url), /qt\.gtimg\.cn\/q=sh600009/);
    return new Response(`v_sh600009="${fields.join('~')}";`);
  }) as typeof fetch });
  const [quote] = await provider.quotes(['600009']);
  assert.equal(quote.status, 'available');
  assert.equal(quote.price, '22.87');
  assert.equal(quote.asOf, '2026-09-23T04:05:43.000Z');
  assert.match(quote.source, /腾讯财经/);
});

test('both unavailable public quote sources return per-symbol unavailable status', async () => {
  const provider = new EastmoneyCNHoldingProvider({ now: () => '2026-09-23T04:10:00.000Z', fetch: (async () => { throw Error('offline'); }) as typeof fetch });
  const [quote] = await provider.quotes(['600009']);
  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.price, null);
  assert.equal(quote.asOf, null);
});
