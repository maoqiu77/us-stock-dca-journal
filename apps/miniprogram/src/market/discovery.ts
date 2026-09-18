import { barsV1Schema, canonicalInstrumentSchema, type BarsV1, type CanonicalInstrument } from '@portfolio/market-data';
import type { StoragePort } from '../repository.ts';
import type { MarketTransport } from './transport.ts';

export const WATCHLIST_STORAGE_KEY = 'portfolio.wechat.watchlist.v1';
type State = { version: 1; instruments: CanonicalInstrument[]; updated_at: string };
const empty = (): State => ({ version: 1, instruments: [], updated_at: '' });
function decode(text: string): State {
  try {
    const value = JSON.parse(text); if (value?.version !== 1 || !Array.isArray(value.instruments)) return empty();
    return { version: 1, instruments: value.instruments.map((item: unknown) => canonicalInstrumentSchema.parse(item)), updated_at: typeof value.updated_at === 'string' ? value.updated_at : '' };
  } catch { return empty(); }
}
function unavailable(instrument: CanonicalInstrument, range: '1M' | '3M' | '1Y', now: string): BarsV1 {
  return barsV1Schema.parse({ schema_version: 1, instrument_key: instrument.instrument_key, currency: 'USD', interval: '1day', range, adjustment: 'unadjusted', provider: 'unconfigured', feed: 'none', coverage: 'unknown', timezone: 'America/New_York', as_of: null, received_at: now, served_at: now, status: 'unavailable', reason: 'MARKET_NOT_CONFIGURED', bars: [] });
}
export function createMarketDiscovery(storage: Pick<StoragePort, 'get' | 'set'>, transport: MarketTransport | undefined, options: { now(): string; searchTtlMs?: number }) {
  let state = decode(storage.get(WATCHLIST_STORAGE_KEY)), results: CanonicalInstrument[] = [], query = '', error = '', sequence = 0;
  const cache = new Map<string, { at: number; results: CanonicalInstrument[] }>(), searchTtl = options.searchTtlMs ?? 60 * 60_000;
  const save = () => storage.set(WATCHLIST_STORAGE_KEY, JSON.stringify(state));
  async function search(input: string) {
    const normalized = input.trim().toUpperCase(), request = ++sequence; query = normalized; error = '';
    if (normalized.length < 2) { results = []; return []; }
    const hit = cache.get(normalized), now = Date.parse(options.now());
    if (hit && now - hit.at < searchTtl) { results = hit.results; return hit.results; }
    if (!transport) { results = []; error = '行情搜索未配置'; return []; }
    try {
      const capabilities = await transport.capabilities();
      if (!capabilities.enabled || !capabilities.authorized || !capabilities.search_access) throw Error('当前无搜索权限');
      const received = (await transport.search(normalized, capabilities.limits.search_results)).map(item => canonicalInstrumentSchema.parse(item));
      cache.set(normalized, { at: now, results: received });
      if (request === sequence) results = received;
      return received;
    } catch (cause) { if (request === sequence) { results = []; error = cause instanceof Error ? cause.message : '搜索失败'; } return []; }
  }
  async function loadBars(instrument: CanonicalInstrument, range: '1M' | '3M' | '1Y') {
    if (!transport?.bars) { const value = unavailable(instrument, range, options.now()); return { ...value, line: [], candles: [] }; }
    try {
      const capabilities = await transport.capabilities();
      if (!capabilities.enabled || !capabilities.authorized || !capabilities.bars_access) throw Error('ENTITLEMENT_DENIED');
      const value = barsV1Schema.parse(await transport.bars(instrument.instrument_key, range, '1day'));
      return { ...value, line: value.bars.map(item => ({ date: item.trading_date, close: item.close })), candles: value.bars.map(item => ({ date: item.trading_date, open: item.open, high: item.high, low: item.low, close: item.close })) };
    } catch (cause) { const value = unavailable(instrument, range, options.now()); return { ...value, reason: cause instanceof Error ? cause.message : 'BARS_UNAVAILABLE', line: [], candles: [] }; }
  }
  return {
    search, cancelSearch() { sequence++; },
    add(instrument: CanonicalInstrument) { const valid = canonicalInstrumentSchema.parse(instrument); if (!state.instruments.some(item => item.instrument_key === valid.instrument_key)) { state = { version: 1, instruments: [...state.instruments, valid], updated_at: options.now() }; save(); } },
    remove(instrumentKey: string) { state = { version: 1, instruments: state.instruments.filter(item => item.instrument_key !== instrumentKey), updated_at: options.now() }; save(); },
    loadBars,
    exportWatchlist() { return state.instruments.slice(); },
    replaceWatchlist(instruments: CanonicalInstrument[]) { state = { version: 1, instruments: instruments.map(item => canonicalInstrumentSchema.parse(item)), updated_at: options.now() }; save(); },
    view() { return { query, results, error, watchlist: state.instruments, updatedAt: state.updated_at }; },
  };
}
