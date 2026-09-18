import { canonicalInstrumentSchema, quoteV1Schema, resolveLedgerInstrument, type CanonicalInstrument, type MarketCapabilities, type QuoteV1 } from '@portfolio/market-data';
import type { MarketObservation } from '@portfolio/domain';
import type { StoragePort } from '../repository.ts';
import type { MarketTransport } from './transport.ts';

export const MARKET_STORAGE_KEY = 'portfolio.wechat.market.v1';
type LedgerInstrument = { id: string; symbol: string; asset_type: 'STOCK' | 'ETF'; exchange?: string };
type MappingLabel = 'verified' | 'ambiguous' | 'not_found' | 'inactive' | 'type_conflict' | 'invalid_symbol';
type Stored = { version: 1; mappings: Record<string, CanonicalInstrument>; mappingStates: Record<string, MappingLabel>; mappingCheckedAt: Record<string, string>; quotes: Record<string, QuoteV1>; updatedAt: string };
const empty = (): Stored => ({ version: 1, mappings: {}, mappingStates: {}, mappingCheckedAt: {}, quotes: {}, updatedAt: '' });

function decode(raw: string): Stored {
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw); if (parsed?.version !== 1 || typeof parsed.mappings !== 'object' || typeof parsed.quotes !== 'object' || typeof parsed.updatedAt !== 'string') return empty();
    const mappings: Record<string, CanonicalInstrument> = {}, quotes: Record<string, QuoteV1> = {}, mappingStates: Record<string, MappingLabel> = {}, mappingCheckedAt: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.mappings)) { const result = canonicalInstrumentSchema.safeParse(value); if (result.success) mappings[key] = result.data; }
    for (const [key, value] of Object.entries(parsed.quotes)) { const result = quoteV1Schema.safeParse(value); if (result.success) quotes[key] = result.data; }
    for (const [key, value] of Object.entries(parsed.mappingStates ?? {})) if (['verified', 'ambiguous', 'not_found', 'inactive', 'type_conflict', 'invalid_symbol'].includes(String(value))) mappingStates[key] = value as MappingLabel;
    for (const [key, value] of Object.entries(parsed.mappingCheckedAt ?? {})) if (typeof value === 'string' && Number.isFinite(Date.parse(value))) mappingCheckedAt[key] = value;
    return { version: 1, mappings, mappingStates, mappingCheckedAt, quotes, updatedAt: parsed.updatedAt };
  } catch { return empty(); }
}

export function createMarketClient(storage: Pick<StoragePort, 'get' | 'set'>, transport: MarketTransport | undefined, options: { now(): string; ttlMs?: number }) {
  let state = decode(storage.get(MARKET_STORAGE_KEY)), sequence = 0, lastError = '', capabilities: MarketCapabilities | null = null;
  const ttlMs = options.ttlMs ?? 60_000;
  const save = (next: Stored) => { storage.set(MARKET_STORAGE_KEY, JSON.stringify(next)); state = next; };
  function demoteQuotes() {
    const quotes = Object.fromEntries(Object.entries(state.quotes).map(([key, quote]) => [key, quoteV1Schema.parse({ ...quote, freshness: 'stale', cache_state: 'stale_hit' })]));
    try { save({ ...state, quotes }); } catch { state = { ...state, quotes }; }
  }
  function invalidate() { sequence++; }
  async function refresh(instruments: readonly LedgerInstrument[]) {
    const request = ++sequence;
    if (!transport) { lastError = '行情服务未配置'; return; }
    try {
      const caps = await transport.capabilities();
      if (request !== sequence) return;
      capabilities = caps;
      if (!caps.enabled || !caps.provider_configured || !caps.authorized || !caps.quote_access) { lastError = !caps.enabled ? '行情服务已关闭' : !caps.authorized ? '尚未获得行情访问授权' : '行情供应商或报价权限尚未配置'; demoteQuotes(); return; }
      const mappings: Record<string, CanonicalInstrument> = {}, mappingStates: Record<string, MappingLabel> = {}, mappingCheckedAt: Record<string, string> = {}, now = options.now();
      for (const instrument of instruments) {
        const stored = state.mappings[instrument.id], checked = state.mappingCheckedAt[instrument.id];
        if (stored && checked && Date.parse(now) - Date.parse(checked) < 86_400_000 && stored.symbol === instrument.symbol && stored.asset_type === instrument.asset_type) { mappings[instrument.id] = stored; mappingStates[instrument.id] = 'verified'; mappingCheckedAt[instrument.id] = checked; continue; }
        if (!caps.search_access) { mappingStates[instrument.id] = 'not_found'; continue; }
        const candidates = await transport.search(instrument.symbol, caps.limits.search_results);
        if (request !== sequence) return;
        const resolution = resolveLedgerInstrument(instrument, candidates);
        if (resolution.kind === 'matched') { mappings[instrument.id] = resolution.instrument; mappingStates[instrument.id] = 'verified'; }
        else mappingStates[instrument.id] = resolution.kind === 'ambiguous' ? 'ambiguous' : resolution.reason;
        mappingCheckedAt[instrument.id] = now;
      }
      const keys = [...new Set(Object.values(mappings).map(item => item.instrument_key))], received: QuoteV1[] = [];
      for (let offset = 0; offset < keys.length; offset += caps.limits.quote_batch) received.push(...await transport.quotes(keys.slice(offset, offset + caps.limits.quote_batch)));
      if (request !== sequence) return;
      const quotes: Record<string, QuoteV1> = {};
      for (const quote of received) if (quote.status === 'available') quotes[quote.instrument_key] = quote;
      for (const [key, quote] of Object.entries(state.quotes)) if (!quotes[key] && Object.values(mappings).some(item => item.instrument_key === key)) quotes[key] = quoteV1Schema.parse({ ...quote, freshness: 'stale', cache_state: 'stale_hit' });
      save({ version: 1, mappings, mappingStates, mappingCheckedAt, quotes, updatedAt: options.now() });
      lastError = '';
    } catch (error) {
      if (request === sequence) {
        lastError = error instanceof Error ? error.message : '行情请求失败';
        demoteQuotes();
      }
    }
  }
  function mappingFor(instrument: LedgerInstrument): { label: MappingLabel; instrument?: CanonicalInstrument } {
    const mapped = state.mappings[instrument.id];
    if (mapped && mapped.symbol === instrument.symbol && mapped.asset_type === instrument.asset_type) return { label: 'verified', instrument: mapped };
    return { label: state.mappingStates[instrument.id] ?? (/^[A-Z][A-Z0-9.-]{0,14}$/.test(instrument.symbol) ? 'not_found' : 'invalid_symbol') };
  }
  function snapshot(instruments: readonly LedgerInstrument[]) {
    const now = options.now(), rows = instruments.map(item => {
      const mapped = mappingFor(item), quote = mapped.instrument ? state.quotes[mapped.instrument.instrument_key] : undefined;
      const expired = Boolean(quote && (!transport || quote.freshness === 'stale' || Date.parse(now) - Date.parse(quote.served_at) > ttlMs));
      return { id: item.id, symbol: item.symbol, mapping: mapped.label, instrumentKey: mapped.instrument?.instrument_key ?? null, canonicalInstrument: mapped.instrument ?? null, quote: quote ? { ...quote, freshness: expired ? 'stale' as const : quote.freshness } : null, stale: expired };
    });
    const observations: MarketObservation[] = rows.flatMap(row => row.quote?.status === 'available' && row.quote.price && row.quote.as_of && row.quote.freshness !== 'unknown' ? [{ instrument_id: row.id, price: row.quote.price, currency: row.quote.currency, source: `${row.quote.provider}/${row.quote.feed}`, as_of: row.quote.as_of, received_at: row.quote.received_at, quality: row.stale || row.quote.freshness === 'stale' ? 'stale' as const : 'current' as const, mapping_status: row.mapping === 'verified' ? 'verified' as const : 'unverified' as const, adjustment: row.quote.adjustment, feed: row.quote.feed, price_kind: row.quote.price_kind, trading_date: row.quote.trading_date }] : []);
    const covered = observations.length, stale = observations.some(item => item.quality === 'stale');
    return { status: covered ? stale || lastError ? 'stale' as const : covered === instruments.length ? 'ready' as const : 'partial' as const : capabilities?.enabled === false || !transport ? 'disabled' as const : 'unavailable' as const, covered, total: instruments.length, error: lastError, attribution: capabilities?.attribution ?? rows.find(row => row.quote)?.quote?.attribution ?? '', instruments: rows, observations, corporateActionNotice: '公司行动未自动核验；如近期发生拆股，请先核对持仓数量和成本。' };
  }
  return { refresh, snapshot, invalidate, clear() { invalidate(); storage.set(MARKET_STORAGE_KEY, ''); state = empty(); capabilities = null; lastError = ''; } };
}
