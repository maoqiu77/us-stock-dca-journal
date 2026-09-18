import assert from 'node:assert/strict';
import test from 'node:test';
import { TwelveDataProvider, MarketProviderError } from '../src/market/twelve-data-provider.ts';

const receivedAt = '2026-09-14T14:31:05.000Z';
const provider = (responses: Record<string, unknown>, calls: Array<{ url: string; authorization: string | null }> = []) => new TwelveDataProvider({
  apiKey: 'server-secret', feed: 'business-us-delayed', coverage: 'venue_subset', timeliness: 'delayed', delaySeconds: 900,
  attribution: 'Twelve Data', catalogVersion: '2026-09-13', now: () => receivedAt,
  fetch: async (input, init) => {
    const url = String(input); calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
    const endpoint = new URL(url).pathname.slice(1);
    const body = responses[endpoint];
    return new Response(JSON.stringify(body), { status: body === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  },
});

test('Twelve Data search maps only supported US stock and ETF identities without leaking the key', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const result = await provider({ symbol_search: { status: 'ok', data: [
    { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', mic_code: 'XNAS', exchange_timezone: 'America/New_York', instrument_type: 'Common Stock', country: 'United States', currency: 'USD' },
    { symbol: 'QQQ', instrument_name: 'Invesco QQQ', exchange: 'NASDAQ', mic_code: 'XNAS', exchange_timezone: 'America/New_York', instrument_type: 'ETF', country: 'United States', currency: 'USD' },
    { symbol: 'BARC', instrument_name: 'Barclays', exchange: 'LSE', mic_code: 'XLON', exchange_timezone: 'Europe/London', instrument_type: 'Common Stock', country: 'United Kingdom', currency: 'GBP' },
  ] } }, calls).search('apple', 10);
  assert.deepEqual(result.map(item => [item.instrument_key, item.asset_type]), [['US:XNAS:AAPL', 'STOCK'], ['US:XNAS:QQQ', 'ETF']]);
  assert.equal(calls[0].authorization, 'apikey server-secret');
  assert.equal(calls[0].url.includes('server-secret'), false);
});

test('Twelve Data quote fixture preserves source time and rejects invalid previous close without inventing values', async () => {
  const result = await provider({ quote: {
    symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', mic_code: 'XNAS', currency: 'USD', datetime: '2026-09-14 10:31:00', timestamp: 1789396260,
    close: '250.125', previous_close: '0', change: '2.125', percent_change: '0.857', volume: '123456', is_market_open: true,
  } }).quotes(['US:XNAS:AAPL']);
  assert.equal(result.length, 1);
  assert.equal(result[0].price, '250.125');
  assert.equal(result[0].previous_close, null);
  assert.equal(result[0].change, null);
  assert.equal(result[0].as_of, '2026-09-14T14:31:00.000Z');
  assert.equal(result[0].received_at, receivedAt);
  assert.equal(result[0].timeliness, 'delayed');
});

test('Twelve Data daily bars request is unadjusted and quarantines malformed OHLC rows', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const result = await provider({ time_series: { status: 'ok', meta: { symbol: 'AAPL', currency: 'USD', exchange_timezone: 'America/New_York', mic_code: 'XNAS' }, values: [
    { datetime: '2026-09-11', open: '230', high: '240', low: '225', close: '238', volume: '1000' },
    { datetime: '2026-09-10', open: '220', high: '219', low: '210', close: '218', volume: '900' },
  ] } }, calls).bars('US:XNAS:AAPL', '1M', '1day');
  assert.equal(new URL(calls[0].url).searchParams.get('adjust'), 'none');
  assert.deepEqual(result.bars.map(item => item.trading_date), ['2026-09-11']);
  assert.equal(result.adjustment, 'unadjusted');
});

test('Twelve Data HTTP and timeout failures are normalized without response secrets', async () => {
  const denied = new TwelveDataProvider({ apiKey: 'server-secret', feed: 'feed', coverage: 'unknown', timeliness: 'unknown', delaySeconds: null, attribution: 'Twelve Data', catalogVersion: 'v1', now: () => receivedAt,
    fetch: async () => new Response(JSON.stringify({ status: 'error', code: 401, message: 'bad key server-secret' }), { status: 401 }) });
  await assert.rejects(() => denied.quotes(['US:XNAS:AAPL']), (error: unknown) => error instanceof MarketProviderError && error.code === 'PROVIDER_AUTH' && !error.message.includes('server-secret'));
  const timed = new TwelveDataProvider({ apiKey: 'server-secret', feed: 'feed', coverage: 'unknown', timeliness: 'unknown', delaySeconds: null, attribution: 'Twelve Data', catalogVersion: 'v1', timeoutMs: 1, now: () => receivedAt,
    fetch: async (_input, init) => await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) });
  await assert.rejects(() => timed.search('AAPL', 1), (error: unknown) => error instanceof MarketProviderError && error.code === 'PROVIDER_TIMEOUT');
});

test('Twelve Data retries a rate-limited idempotent read once and honors Retry-After', async () => {
  let attempts = 0; const waits: number[] = [];
  const retried = new TwelveDataProvider({ apiKey: 'server-secret', feed: 'feed', coverage: 'unknown', timeliness: 'unknown', delaySeconds: null, attribution: 'Twelve Data', catalogVersion: 'v1', now: () => receivedAt, sleep: async ms => { waits.push(ms); }, random: () => 0,
    fetch: async () => ++attempts === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } }) : new Response(JSON.stringify({ status: 'ok', data: [] }), { status: 200 }) });
  assert.deepEqual(await retried.search('AAPL', 1), []);
  assert.equal(attempts, 2); assert.deepEqual(waits, [2000]);
});

test('unfinished current daily bar is never labeled final or assigned a future close time', async () => {
  const result = await provider({ time_series: { status: 'ok', meta: { symbol: 'AAPL', currency: 'USD', exchange_timezone: 'America/New_York', mic_code: 'XNAS' }, values: [
    { datetime: '2026-09-14', open: '230', high: '240', low: '225', close: '238', volume: '1000' },
  ] } }).bars('US:XNAS:AAPL', '1M', '1day');
  assert.equal(result.bars[0].is_final, false);
  assert.equal(result.as_of, receivedAt);
});

test('EOD quote dated today before the close is not mislabeled as a completed current close', async () => {
  const eod = new TwelveDataProvider({ apiKey: 'server-secret', feed: 'eod-feed', coverage: 'venue_subset', timeliness: 'eod', delaySeconds: null, attribution: 'Twelve Data', catalogVersion: 'v1', now: () => receivedAt,
    fetch: async () => new Response(JSON.stringify({ symbol: 'AAPL', mic_code: 'XNAS', currency: 'USD', datetime: '2026-09-14 10:31:00', timestamp: 1789396260, close: '250', previous_close: '248', is_market_open: true })) });
  const result = await eod.quotes(['US:XNAS:AAPL']);
  assert.equal(result[0].price_kind, 'official_close');
  assert.equal(result[0].freshness, 'stale');
});

test('daily finality uses New York DST and known early-close sessions without inventing weekend bars', async () => {
  const rows = [
    { datetime: '2026-11-28', open: '238', high: '241', low: '237', close: '240', volume: '1000' },
    { datetime: '2026-11-27', open: '230', high: '240', low: '225', close: '238', volume: '1000' },
  ];
  const earlyClose = new TwelveDataProvider({ apiKey: 'server-secret', feed: 'feed', coverage: 'venue_subset', timeliness: 'delayed', delaySeconds: 900, attribution: 'Twelve Data', catalogVersion: 'v1', now: () => '2026-11-27T18:30:00.000Z',
    fetch: async () => new Response(JSON.stringify({ status: 'ok', meta: { symbol: 'AAPL', currency: 'USD', exchange_timezone: 'America/New_York', mic_code: 'XNAS' }, values: rows })) });
  const early = await earlyClose.bars('US:XNAS:AAPL', '1M', '1day');
  assert.equal(early.bars[0].is_final, true);
  assert.equal(early.as_of, '2026-11-27T18:00:00.000Z');
  assert.deepEqual(early.bars.map(item => item.trading_date), ['2026-11-27']);

  const summer = new TwelveDataProvider({ apiKey: 'server-secret', feed: 'feed', coverage: 'venue_subset', timeliness: 'delayed', delaySeconds: 900, attribution: 'Twelve Data', catalogVersion: 'v1', now: () => '2026-07-02T20:01:00.000Z',
    fetch: async () => new Response(JSON.stringify({ status: 'ok', meta: { symbol: 'AAPL', currency: 'USD', exchange_timezone: 'America/New_York', mic_code: 'XNAS' }, values: [{ ...rows[0], datetime: '2026-07-02' }] })) });
  const daylight = await summer.bars('US:XNAS:AAPL', '1M', '1day');
  assert.equal(daylight.as_of, '2026-07-02T20:00:00.000Z');
  assert.deepEqual(daylight.bars.map(item => item.trading_date), ['2026-07-02']);
});
