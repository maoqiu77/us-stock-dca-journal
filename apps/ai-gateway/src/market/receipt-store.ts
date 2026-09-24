import { researchSelectionSchema, researchSeriesSchema, type ResearchSelection, type ResearchSeries } from '@portfolio/market-data/research';
import { createHash } from 'node:crypto';
import { payloadDigest } from '@portfolio/ai-context';
import { quoteV1Schema, type QuoteV1 } from '@portfolio/market-data';

export type MarketReceipt = {
  owner: string; id: string; digest: string; purpose: 'portfolio_review' | 'instrument_research' | 'daily_review' | 'follow_up';
  instrumentKeys: string[]; quotes: QuoteV1[]; provider: string; feed: string; entitlementVersion: string; createdAt: string; expiresAt: string;
  research?: { selection: ResearchSelection; series: ResearchSeries[] };
  portfolioSeries?: ResearchSeries[];
  acceptedRequestId?: string; requestDocumentId?: string; retainedUntil?: string;
};
export type CreateMarketReceipt = Omit<MarketReceipt, 'digest' | 'acceptedRequestId' | 'retainedUntil'>;
export interface MarketReceiptStore {
  create(input: CreateMarketReceipt): Promise<MarketReceipt>;
  get(owner: string, id: string): Promise<MarketReceipt | undefined>;
  resolve(owner: string, id: string, now: string): Promise<MarketReceipt | undefined>;
  bind(owner: string, id: string, digest: string, requestId: string, retainedUntil: string): Promise<MarketReceipt>;
  remove(owner: string, id: string): Promise<void>;
}
function seal(input: CreateMarketReceipt) {
  const research = input.research ? { selection: researchSelectionSchema.parse(input.research.selection), series: input.research.series.map(item => researchSeriesSchema.parse(item)) } : undefined;
  const portfolioSeries = input.portfolioSeries?.map(item => researchSeriesSchema.parse(item));
  const body = { ...(research ? { research } : {}), ...(portfolioSeries ? { portfolioSeries } : {}), id: input.id, purpose: input.purpose, instrument_keys: [...input.instrumentKeys].sort(), quotes: input.quotes.map(item => quoteV1Schema.parse(item)), provider: input.provider, feed: input.feed, entitlement_version: input.entitlementVersion, created_at: input.createdAt, expires_at: input.expiresAt };
  return { ...input, ...(research ? { research } : {}), ...(portfolioSeries ? { portfolioSeries } : {}), instrumentKeys: body.instrument_keys, quotes: body.quotes, digest: payloadDigest(body) } satisfies MarketReceipt;
}
export function createMemoryMarketReceiptStore(): MarketReceiptStore {
  const rows = new Map<string, MarketReceipt>(), key = (owner: string, id: string) => `${owner}:${id}`;
  return {
    async create(input) { const value = seal(input); rows.set(key(input.owner, input.id), value); return structuredClone(value); },
    async get(owner, id) { const value = rows.get(key(owner, id)); return value ? structuredClone(value) : undefined; },
    async resolve(owner, id, now) { const value = rows.get(key(owner, id)); if (!value) return undefined; if (Date.parse(now) >= Date.parse(value.expiresAt) && !value.acceptedRequestId) throw Error('RECEIPT_EXPIRED'); return structuredClone(value); },
    async bind(owner, id, digest, requestId, retainedUntil) { const value = rows.get(key(owner, id)); if (!value || value.digest !== digest) throw Error('RECEIPT_NOT_FOUND'); if (value.acceptedRequestId && value.acceptedRequestId !== requestId) throw Error('RECEIPT_ALREADY_USED'); Object.assign(value, { acceptedRequestId: requestId, retainedUntil }); return structuredClone(value); },
    async remove(owner, id) { rows.delete(key(owner, id)); },
  };
}

type Doc = { get(): Promise<{ data?: any | any[] }>; set(input: { data: any }): Promise<any>; remove(): Promise<any> };
type Db = { collection(name: string): { doc(id: string): Doc }; runTransaction?<T>(fn: (tx: Db) => Promise<T>): Promise<T> };
const docId = (owner: string, id: string) => createHash('sha256').update(`${owner}:${id}`).digest('hex');
const one = async (doc: Doc) => { try { const value = (await doc.get()).data; return Array.isArray(value) ? value[0] : value; } catch { return undefined; } };
export function createCloudbaseMarketReceiptStore(db: Db): MarketReceiptStore {
  const document = (owner: string, id: string) => db.collection('market_receipts_private').doc(docId(owner, id));
  return {
    async create(input) { const value = seal(input); await document(input.owner, input.id).set({ data: value }); return value; },
    async get(owner, id) { const value = await one(document(owner, id)); if(value?.owner !== owner)return undefined; const { _id, ...receipt } = value; return receipt as MarketReceipt; },
    async resolve(owner, id, now) { const value = await this.get(owner, id); if (!value) return undefined; if (Date.parse(now) >= Date.parse(value.expiresAt) && !value.acceptedRequestId) throw Error('RECEIPT_EXPIRED'); return value; },
    async bind(owner, id, digest, requestId, retainedUntil) { const value = await this.get(owner, id); if (!value || value.digest !== digest) throw Error('RECEIPT_NOT_FOUND'); if (value.acceptedRequestId && value.acceptedRequestId !== requestId) throw Error('RECEIPT_ALREADY_USED'); const next = { ...value, acceptedRequestId: requestId, requestDocumentId: createHash('sha256').update(`${owner}:${requestId}`).digest('hex'), retainedUntil }; await document(owner, id).set({ data: next }); return next; },
    async remove(owner, id) { await document(owner, id).remove(); },
  };
}
