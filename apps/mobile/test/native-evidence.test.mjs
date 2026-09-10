import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeEvidence, requiredChecks } from '../scripts/verify-native-evidence.mjs';
test('native gate refuses missing, blocked, incomplete and metadata-free reports', () => {
  for (const value of [undefined, {}, {android:{status:'blocked'},ios:{status:'blocked'}}]) {
    assert.ok(validateNativeEvidence(value).length > 0);
  }
  const report = Object.fromEntries(['android','ios'].map(platform => [platform, {
    status:'passed', device:'synthetic device for validator only', os:'test', build:'test',
    measured_at:'2026-09-09T00:00:00Z', lock_sha256:'a'.repeat(64),
    checks:Object.fromEntries(requiredChecks.map(name => [name,{status:'passed',evidence:'synthetic test assertion'}]))
  }]));
  assert.deepEqual(validateNativeEvidence(report,'a'.repeat(64)), []);
  assert.ok(validateNativeEvidence(report,'b'.repeat(64)).length > 0);
  delete report.ios.checks.sqlcipher_plaintext_rejected;
  assert.ok(validateNativeEvidence(report).length > 0);
});
