import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudTransport } from '../src/ai/cloud-transport.ts';

const valid = { schemaVersion: 1, enabled: true, authorized: false, enrolled: true, consented: false, accessMode: 'public', principalHash: 'a'.repeat(64), providerConfigured: true, credentialMode: 'sponsored', byokEnabled: false, consentVersion: 1, usage: { date: '2026-09-13', used: 2, inflight: 0, timezone: 'UTC' }, limits: { dailyRequests: 10, globalDailyRequests: 1000, maxInflight: 1, maxInputBytes: 200000, maxOutputTokens: 800 } };
test('cloud capabilities are strict and consent sends only the declared version', async () => {
  const seen: unknown[] = [];
  const transport = createCloudTransport(async options => { seen.push(options.data); return { result: { ok: true, data: (options.data as any).action === 'capabilities' ? valid : { accepted: true } } }; }, 'portfolioAi');
  assert.equal((await transport.capabilities()).usage.used, 2);
  await transport.acceptConsent!(1); assert.deepEqual(seen[1], { action: 'consent', accepted: true, consent_version: 1 });
  const malformed = createCloudTransport(async () => ({ result: { ok: true, data: { enabled: true } } }), 'portfolioAi');
  await assert.rejects(() => malformed.capabilities());
});
