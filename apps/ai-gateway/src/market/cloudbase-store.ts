import { createHash } from 'node:crypto';
import type { MarketBudgetPort, MarketCachePort, MarketLeasePort } from './ports.ts';

type Doc = { get(): Promise<{ data?: any | any[] }>; set(input: { data: any }): Promise<any>; remove(): Promise<any> };
type Database = { collection(name: string): { doc(id: string): Doc }; runTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> };
const id = (value: string) => createHash('sha256').update(value).digest('hex');
const one = async (doc: Doc) => { try { const value = (await doc.get()).data; return Array.isArray(value) ? value[0] : value; } catch { return undefined; } };
export function createCloudbaseMarketInfrastructure(db: Database) {
  const cache: MarketCachePort = { async get(key) { const row = await one(db.collection('market_cache').doc(id(key))); return row && row.staleExpiresAt > new Date().toISOString() ? { value: row.value, expiresAt: row.expiresAt, staleExpiresAt: row.staleExpiresAt } : undefined; }, async put(key, value, expiresAt, staleExpiresAt) { await db.collection('market_cache').doc(id(key)).set({ data: { keyHash: id(key), value, expiresAt, staleExpiresAt } }); } };
  const leases: MarketLeasePort = { acquire: (key, holder, expiresAt) => db.runTransaction(async tx => { const doc = tx.collection('market_leases').doc(id(key)), row = await one(doc); if (row && row.expiresAt > new Date().toISOString()) return false; await doc.set({ data: { keyHash: id(key), holder, expiresAt } }); return true; }), release: (key, holder) => db.runTransaction(async tx => { const doc = tx.collection('market_leases').doc(id(key)), row = await one(doc); if (row?.holder === holder) await doc.remove(); }) };
  const budget: MarketBudgetPort = { reserve: (scope, units, limit, now) => db.runTransaction(async tx => { const doc = tx.collection('market_usage').doc(id(`${scope}:${now.slice(0, 10)}`)), row = await one(doc), next = (row?.units ?? 0) + units; if (next > limit) return false; await doc.set({ data: { scopeHash: id(scope), date: now.slice(0, 10), units: next, updatedAt: now } }); return true; }) };
  return { cache, leases, budget };
}
