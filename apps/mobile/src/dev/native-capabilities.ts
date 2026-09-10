// Development-only probe module. No app route imports it; never run against user data.
import { Platform } from 'react-native';
import { decimalText, decimal } from '@portfolio/domain';
export async function probeSyntheticCrypto() {
  if (!__DEV__ || !['ios','android'].includes(Platform.OS)) throw new Error('native_development_build_required');
  const crypto = await import('react-native-quick-crypto');
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const first = cipher.update('SYNTHETIC ONLY', 'utf8');
  const last = cipher.final();
  const tag = cipher.getAuthTag();
  const encrypted = new Uint8Array(first.length + last.length);
  encrypted.set(first); encrypted.set(last,first.length);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decoded = decipher.update(encrypted).toString('utf8') + decipher.final().toString('utf8');
  if (decoded !== 'SYNTHETIC ONLY') throw new Error('aes_roundtrip_failed');
  encrypted[0] = encrypted[0]! ^ 1;
  let rejected = false;
  try {
    const corrupt = crypto.createDecipheriv('aes-256-gcm', key, iv);
    corrupt.setAuthTag(tag); corrupt.update(encrypted); corrupt.final();
  } catch { rejected = true; }
  if (!rejected) throw new Error('aes_tamper_not_rejected');
  // Public synthetic vector; never an account or backup password.
  const start = performance.now();
  const derived = await new Promise<string>((resolve,reject) => {
    crypto.pbkdf2('password','salt',1,32,'sha256',(error,value) => {
      if(error || !value)reject(error ?? new Error('missing_derived_key')); else resolve(value.toString('hex'));
    });
  });
  if(derived !== '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b')throw new Error('pbkdf2_vector_failed');
  const vector_ms = performance.now()-start;
  const kdfStart = performance.now();
  await new Promise<void>((resolve,reject) => crypto.pbkdf2('password','salt',600000,32,'sha256',(error,value)=>error || !value ? reject(error ?? new Error('missing_derived_key')) : resolve()));
  key.fill(0);
  return {platform:Platform.OS,aes_roundtrip_tamper:true,pbkdf2_vector:true,vector_ms,kdf_iterations:600000,kdf_ms:performance.now()-kdfStart,domain_decimal:decimalText(decimal('0.1').plus(decimal('0.2')))};
}
