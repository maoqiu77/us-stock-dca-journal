// Dedicated synthetic database only. This is not the M08 product bootstrap.
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { randomBytes } from 'react-native-quick-crypto';
const DB_NAME = 'm07-synthetic-probe.db';
const KEY_NAME = 'm07.synthetic.db.key';
const SYNTHETIC_VALUE = 'SYNTHETIC M07 中文持仓记录';
function assertProbe() {
  if (!__DEV__ || Platform.OS !== 'android') throw new Error('android_development_probe_only');
}
async function openWithKey(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('invalid_probe_key');
  // Expo issue #38168: FTS owns internal statements; blanket finalization double-frees.
  // getFirstAsync/runAsync finalize their own prepared statements in finally.
  console.log('NATIVE_PROBE_STAGE','open');
  const db = await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false });
  try {
    console.log('NATIVE_PROBE_STAGE','key');
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    console.log('NATIVE_PROBE_STAGE','cipher_version');
    const version = await db.getFirstAsync<{cipher_version: string}>('PRAGMA cipher_version');
    if (!version?.cipher_version) throw new Error('sqlcipher_unavailable_no_fallback');
    return { db, version: version.cipher_version };
  } catch (error) { await db.closeAsync(); throw error; }
}
async function openExisting() {
  const key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) throw new Error('probe_key_missing_blocked');
  return openWithKey(key);
}
export async function seedStorageProbe() {
  assertProbe();
  if (await SecureStore.getItemAsync(KEY_NAME)) throw new Error('probe_already_seeded_use_reopen');
  const bytes = randomBytes(32);
  const key = bytes.toString('hex');
  bytes.fill(0);
  await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  const {db,version} = await openWithKey(key);
  try {
    console.log('NATIVE_PROBE_STAGE','schema');
    await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE VIRTUAL TABLE probe_fts USING fts5(body);');
    console.log('NATIVE_PROBE_STAGE','insert');
    await db.runAsync('INSERT INTO probe(id,body) VALUES (?,?)',1,SYNTHETIC_VALUE);
    await db.runAsync('INSERT INTO probe_fts(body) VALUES (?)','英伟达 长期 持有');
    await db.runAsync('INSERT INTO probe_fts(body) VALUES (?)','英伟达长期持有');
    console.log('NATIVE_PROBE_STAGE','fts');
    const fts = await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM probe_fts WHERE probe_fts MATCH ?', '英伟达');
    const bounded = await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM probe_fts WHERE instr(body,?)>0', '英伟达');
    if (fts?.n !== 1 || bounded?.n !== 2) throw new Error('chinese_search_probe_failed');
    console.log('NATIVE_PROBE_STAGE','checkpoint');
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
    return {sqlcipher_version:version,database_path:db.databasePath,fts_spaced_hits:fts.n,bounded_chinese_hits:bounded.n};
  } finally { console.log('NATIVE_PROBE_STAGE','close'); await db.closeAsync(); }
}
export async function reopenStorageProbe() {
  assertProbe();
  const {db,version} = await openExisting();
  try {
    const row = await db.getFirstAsync<{body:string}>('SELECT body FROM probe WHERE id=1');
    if (row?.body !== SYNTHETIC_VALUE) throw new Error('persisted_synthetic_value_mismatch');
  } finally { console.log('NATIVE_PROBE_STAGE','close'); await db.closeAsync(); }
  const key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) throw new Error('probe_key_missing_blocked');
  const wrong = (key[0]==='0'?'1':'0') + key.slice(1);
  const bad = await openWithKey(wrong);
  let wrongKeyRejected = false;
  try { await bad.db.getFirstAsync('SELECT body FROM probe WHERE id=1'); }
  catch { wrongKeyRejected = true; }
  finally { await bad.db.closeAsync(); }
  if (!wrongKeyRejected) throw new Error('wrong_key_was_accepted');
  const good = await openExisting();
  try {
    const row = await good.db.getFirstAsync<{body:string}>('SELECT body FROM probe WHERE id=1');
    if (row?.body !== SYNTHETIC_VALUE) throw new Error('wrong_key_attempt_damaged_database');
  } finally { await good.db.closeAsync(); }
  return {sqlcipher_version:version,cold_start_read:true,secure_store_persisted:true,wrong_key_rejected:true};
}
export async function missingKeyStorageProbe() {
  assertProbe();
  await SecureStore.deleteItemAsync(KEY_NAME);
  try { await openExisting(); }
  catch (error) {
    if (error instanceof Error && error.message === 'probe_key_missing_blocked') return {missing_key_blocked_before_database_open:true};
    throw error;
  }
  throw new Error('missing_key_not_blocked');
}
export async function afterReinstallStorageProbe() {
  assertProbe();
  if (await SecureStore.getItemAsync(KEY_NAME) !== null) throw new Error('secure_store_survived_android_uninstall');
  return {secure_store_absent_after_reinstall:true};
}

export async function ftsCloseStorageProbe() {
  assertProbe();
  const {db}=await openExisting();
  try {
    const fts=await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM probe_fts WHERE probe_fts MATCH ?', '英伟达');
    const bounded=await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM probe_fts WHERE instr(body,?)>0','英伟达');
    if(fts?.n!==1 || bounded?.n!==2)throw new Error('chinese_search_mismatch');
    console.log('NATIVE_PROBE_STAGE','fts_query_passed_before_close');
  } finally { await db.closeAsync(); }
  return {fts_spaced_hits:1,bounded_chinese_hits:2,fts_connection_closed:true};
}
