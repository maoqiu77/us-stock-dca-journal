import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudMarketTransport, MarketTransportError } from '../src/market/cloud-transport.ts';

test('market cloud transport calls only the configured function and strictly validates quote responses', async () => {
  const calls: any[] = [];
  const transport = createCloudMarketTransport(async options => { calls.push(options); return { result: { ok: true, data: { quotes: [{ status: 'available', price: 0 }] } } }; }, 'portfolioMarket');
  await assert.rejects(() => transport.quotes(['US:XNAS:AAPL']));
  assert.deepEqual(calls[0], { name: 'portfolioMarket', data: { action: 'quotes', instrument_keys: ['US:XNAS:AAPL'] } });
});

test('market cloud transport preserves explicit server errors as known outcomes', async () => {
  const transport = createCloudMarketTransport(async () => ({ result: { ok: false, error: { code: 'ACCESS_DENIED', message: 'denied', outcome_unknown: false } } }), 'portfolioMarket');
  await assert.rejects(() => transport.capabilities(), (error: unknown) => error instanceof MarketTransportError && error.code === 'ACCESS_DENIED' && error.outcomeUnknown === false);
});

test('domestic board transport does not turn malformed or foreign-segment payloads into rows', async () => {
 const transport = createCloudMarketTransport(async options => {
  assert.deepEqual(options.data, { action: 'domesticBoard', segment: 'fund' });
  return { result: { ok: true, data: { segment: 'fund', status: 'unavailable', reason: '授权未配置', rows: [] } } };
 }, 'portfolioMarket');
 assert.deepEqual((await transport.domesticBoard!('fund')).rows, []);
 const bad = createCloudMarketTransport(async () => ({ result: { ok: true, data: { segment: 'fund', status: 'available', rows: [{ price: 0 }] } } }), 'portfolioMarket');
 await assert.rejects(() => bad.domesticBoard!('fund'));
});
