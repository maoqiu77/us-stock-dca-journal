import assert from 'node:assert/strict';
import test from 'node:test';
import { barsV1Schema, evaluateFreshness, quoteV1Schema, resolveLedgerInstrument, type CanonicalInstrument } from '../src/index.ts';

const now = '2026-09-13T15:00:00.000Z';
const unavailable = { schema_version: 1, instrument_key: 'US:XNAS:AAPL', symbol: 'AAPL', currency: 'USD', price: null, price_kind: 'last_trade', previous_close: null, previous_close_date: null, change: null, change_percent: null, volume: null, volume_scope: 'unknown', session: 'unknown', market_status: 'unknown', trading_date: null, exchange_timezone: 'America/New_York', provider: 'unconfigured', feed: 'none', coverage: 'unknown', timeliness: 'unknown', delay_seconds: null, as_of: null, received_at: now, served_at: now, freshness: 'unknown', cache_state: 'miss', status: 'unavailable', reason: 'PROVIDER_NOT_CONFIGURED', adjustment: 'unadjusted', attribution: '行情服务未配置' };
test('unavailable quote cannot smuggle zero or a synthetic price', () => {
  assert.equal(quoteV1Schema.parse(unavailable).price, null);
  assert.equal(quoteV1Schema.safeParse({ ...unavailable, price: '0' }).success, false);
  assert.equal(quoteV1Schema.safeParse({ ...unavailable, price: '123.45' }).success, false);
  assert.equal(quoteV1Schema.safeParse({ ...unavailable, previous_close: '123.45' }).success, false);
});
test('bars reject duplicate dates and invalid OHLC', () => {
  const bar = { trading_date: '2026-09-12', starts_at: null, open: '10', high: '12', low: '9', close: '11', volume: null, is_final: true };
  const base = { schema_version: 1, instrument_key: 'US:XNAS:AAPL', currency: 'USD', interval: '1day', range: '1M', adjustment: 'unadjusted', provider: 'p', feed: 'f', coverage: 'unknown', timezone: 'America/New_York', as_of: now, received_at: now, served_at: now, status: 'available', reason: null };
  assert.equal(barsV1Schema.safeParse({ ...base, bars: [] }).success, false);
  assert.equal(barsV1Schema.safeParse({ ...base, bars: [bar, bar] }).success, false);
  assert.equal(barsV1Schema.safeParse({ ...base, bars: [{ ...bar, high: '8' }] }).success, false);
  assert.equal(barsV1Schema.safeParse({ ...base, bars: [{ ...bar, trading_date: '2026-09-14' }] }).success, false);
});
test('mapping keeps ledger identity and distinguishes ambiguity and type conflicts', () => {
  const candidate = (mic: string, type: 'STOCK' | 'ETF' = 'STOCK'): CanonicalInstrument => ({ schema_version: 1, instrument_key: `US:${mic}:ABC`, symbol: 'ABC', name: 'ABC', mic, exchange: mic, market: 'US', currency: 'USD', asset_type: type, provider_symbol: 'ABC', provider_catalog_version: 'v1', status: 'active' });
  assert.equal(resolveLedgerInstrument({ id: 'ledger-1', symbol: 'ABC', asset_type: 'STOCK', exchange: 'UNSPECIFIED' }, [candidate('XNAS'), candidate('XNYS')]).kind, 'ambiguous');
  assert.equal(resolveLedgerInstrument({ id: 'ledger-1', symbol: 'ABC', asset_type: 'ETF' }, [candidate('XNAS')]).kind, 'unresolved');
});
test('freshness respects declared delay and closed-market completed date', () => {
  assert.equal(evaluateFreshness('2026-09-13T14:58:30.000Z', now, '2026-09-13', { timeliness: 'delayed', delaySeconds: 60, graceSeconds: 60, marketOpen: true }), 'current');
  assert.equal(evaluateFreshness('2026-09-12T20:00:00.000Z', now, '2026-09-12', { timeliness: 'eod', delaySeconds: null, graceSeconds: 0, marketOpen: false, latestCompletedTradingDate: '2026-09-12' }), 'current');
});
