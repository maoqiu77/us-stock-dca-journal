import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumView } from '../src/reference.ts';
const price = { instrumentId: 'CN:XSHG:TEST', currency: 'CNY', kind: 'market_price', value: '1.05', asOf: '2026-09-18T06:00:00Z', fetchedAt: '2026-09-18T06:01:00Z', tradeDate: '2026-09-18', sourceId: 'fixture', quality: 'available' };
const nav = { ...price, kind: 'nav', value: '1', valuationDate: '2026-09-17', asOf: '2026-09-17T12:00:00Z' };
test('old NAV uses dated non-real-time label; IOPV must be same instrument, currency, date and time', () => {
 assert.ok(Math.abs(premiumView(price, nav).valuePct! - 5) < 1e-9);
 assert.match(premiumView(price, nav).label, /非实时/);
 for (const change of [{ value: '0' }, { currency: 'USD' }, { instrumentId: 'other' }, { valuationDate: '2026-09-19' }, { quality: 'stale' }, { kind: 'model' }]) assert.equal(premiumView(price, { ...nav, ...change }).valuePct, null);
 assert.equal(premiumView(price, { ...price, kind: 'iopv', value: '1', asOf: '2026-09-18T05:00:00Z' }).reason, 'IOPV_TIME_MISMATCH');
 assert.equal(premiumView(nav, nav).valuePct, null);
});
