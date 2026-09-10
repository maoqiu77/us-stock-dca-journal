import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const requiredChecks = [
  'single_react_bundle', 'single_rn_autolinking', 'sqlcipher_plaintext_rejected',
  'write_restart_read', 'wrong_key_rejected', 'missing_key_blocked',
  'secure_store_lifecycle', 'backup_exclusion', 'aes_gcm_roundtrip_tamper',
  'pbkdf2_vector_timing', 'tls_only', 'redirect_rejected', 'chinese_search',
  'release_excludes_probes',
];
export function validateNativeEvidence(report, lockHash) {
  const errors = [];
  for (const platform of ['android','ios']) {
    const entry = report?.[platform];
    if (entry?.status !== 'passed') { errors.push(`${platform}: native evidence blocked or missing`); continue; }
    for (const field of ['device','os','build','measured_at','lock_sha256']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) errors.push(`${platform}: missing ${field}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(entry.measured_at ?? '') || !Number.isFinite(Date.parse(entry.measured_at))) errors.push(`${platform}: invalid measurement time`);
    if (!/^[a-f0-9]{64}$/.test(entry.lock_sha256 ?? '') || (lockHash && entry.lock_sha256 !== lockHash)) errors.push(`${platform}: lockfile evidence mismatch`);
    for (const name of requiredChecks) {
      const check = entry.checks?.[name];
      if (check?.status !== 'passed' || typeof check.evidence !== 'string' || !check.evidence.trim()) errors.push(`${platform}: ${name} not verified`);
    }
  }
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = process.argv[2] ?? fileURLToPath(new URL('../../../docs/mobile/native-evidence.json',import.meta.url));
    const hash = createHash('sha256').update(readFileSync(new URL('../../../package-lock.json',import.meta.url))).digest('hex');
    const errors = validateNativeEvidence(JSON.parse(readFileSync(file,'utf8')), hash);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log('Android and iOS native evidence recorded for the current lockfile. Review linked evidence manually.');
  } catch (error) { console.error(`Native gate blocked: ${error.message}`); process.exitCode = 1; }
}
