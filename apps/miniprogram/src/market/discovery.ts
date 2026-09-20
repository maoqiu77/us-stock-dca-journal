import { domesticBoardSchema, type DomesticBoard } from '@portfolio/market-data/domestic';
import { barsV1Schema, canonicalInstrumentSchema, quoteV1Schema, type QuoteV1, type BarsV1, type CanonicalInstrument } from '@portfolio/market-data';
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
export function createMarketDiscovery(storage: Pick<StoragePort, 'get' | 'set'>, transport: MarketTransport | undefined, options: { now(): string; searchTtlMs?: number; workspaceId?(): string; defaults?: CanonicalInstrument[] }) {
  let scope: string | null = null, key = WATCHLIST_STORAGE_KEY;
  let state = decode(storage.get(key)), results: CanonicalInstrument[] = [], query = '', error = '', sequence = 0;
  const cache = new Map<string, { at: number; results: CanonicalInstrument[] }>(), searchTtl = options.searchTtlMs ?? 60 * 60_000;
  const sync = () => {
    const next = options.workspaceId?.() ?? '';
    if (next === scope) return;
    const nextKey = next ? `${WATCHLIST_STORAGE_KEY}:${next}` : WATCHLIST_STORAGE_KEY;
    let raw = storage.get(nextKey);
    if (next && !raw) {
      const ownerKey = `${WATCHLIST_STORAGE_KEY}:migrated`;
      let owner = storage.get(ownerKey);
      if (!owner) { storage.set(ownerKey, next); owner = next; }
      if (owner === next) raw = storage.get(WATCHLIST_STORAGE_KEY);
    }
    const seededKey = `${nextKey}:popular-seeded-v1`;
    if (options.defaults?.length && !storage.get(seededKey)) {
      const previous = decode(raw).instruments;
      const instruments = [...previous, ...options.defaults.filter(item => !previous.some(old => old.instrument_key === item.instrument_key))];
      raw = JSON.stringify({ version: 1, instruments, updated_at: options.now() });
      storage.set(nextKey, raw); storage.set(seededKey, '1');
    }
    state = decode(raw); scope = next; key = nextKey; results = []; query = ''; error = ''; sequence++;
  };
  const save = (next: State) => { storage.set(key, JSON.stringify(next)); state = next; refreshedAt = 0; };
  const quoteCacheKey = 'portfolio.wechat.board-quotes.v1';
  const quotes = new Map<string, QuoteV1>();
  try { const stored = JSON.parse(storage.get(quoteCacheKey) || '[]'); if (Array.isArray(stored)) for (const raw of stored) { const quote = quoteV1Schema.safeParse(raw); if (quote.success) quotes.set(quote.data.instrument_key, quote.data); } } catch { /* Only public cache; malformed cache is discarded. */ }
  const domestic = new Map<string, DomesticBoard>();
  let refreshing: Promise<void> | null = null, refreshedAt = 0;
  async function refreshQuotes() {
    sync(); if (refreshing) return refreshing;
    if (Date.parse(options.now()) - refreshedAt < 60_000) return;
    const instruments = state.instruments.slice();
    const demote = () => { for (const [key, quote] of quotes) quotes.set(key, { ...quote, freshness: 'stale' }); };
    refreshing = (async () => {
      try {
        if (!transport) throw Error('行情服务未配置');
        const caps = await transport.capabilities();
        if (!caps.enabled) { error = '行情服务尚未启用'; demote(); return; }
        if (!caps.provider_configured) { error = '行情供应商尚未配置'; demote(); return; }
        if (!caps.authorized || !caps.quote_access) { error = '当前账号暂无行情访问权限'; demote(); return; }
        for (let i = 0; i < instruments.length; i += caps.limits.quote_batch) {
          const keys = instruments.slice(i, i + caps.limits.quote_batch).map(item => item.instrument_key);
          for (const raw of await transport.quotes(keys)) {
            const quote = quoteV1Schema.parse(raw);
            if (!keys.includes(quote.instrument_key)) continue;
            if (quote.status === 'available') quotes.set(quote.instrument_key, quote);
            else if (quotes.has(quote.instrument_key)) quotes.set(quote.instrument_key, { ...quotes.get(quote.instrument_key)!, freshness: 'stale' });
          }
        }
        storage.set(quoteCacheKey, JSON.stringify([...quotes.values()].slice(-200)));
        error = ''; refreshedAt = Date.parse(options.now());
      } catch { error = '部分行情暂不可用，持仓和手记仍可使用。'; for (const [key, value] of quotes) quotes.set(key, { ...value, freshness: 'stale' }); }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  function quoteView(instrument: CanonicalInstrument) {
    const quote = quotes.get(instrument.instrument_key), stale = quote && (!transport || quote.freshness === 'stale' || Date.parse(options.now()) - Date.parse(quote.served_at) > 60_000);
    const session = { regular: '常规交易', pre: '盘前', post: '盘后', closed: '收盘', unknown: '时段未知' };
    return { ...instrument, previousClose: quote?.previous_close ?? null, volume: quote?.volume ?? null, marketCap: quote?.market_cap ?? null, logo: (options.defaults ?? []).some(item => item.symbol === instrument.symbol) ? `/assets/stocks/${instrument.symbol}.png` : `https://financialmodelingprep.com/image-stock/${encodeURIComponent(instrument.symbol)}.png`, priceText: quote?.price ?? '--', changeAmountText: quote?.change == null ? '--' : `${Number(quote.change) > 0 ? '+' : ''}${Number(quote.change).toFixed(3)}`, direction: quote?.change == null ? 'flat' : Number(quote.change) > 0 ? 'up' : Number(quote.change) < 0 ? 'down' : 'flat', changeText: quote?.change_percent == null ? '--' : `${Number(quote.change_percent).toFixed(2)}%`, asOf: quote?.as_of ?? '', source: quote ? `${quote.provider} / ${quote.feed}` : '', sessionLabel: quote ? session[quote.session] : '', qualityLabel: !quote ? '暂无行情' : stale ? '缓存已过期' : quote.timeliness === 'delayed' ? `延迟 ${quote.delay_seconds ?? '?'} 秒` : quote.timeliness === 'eod' ? '日终数据' : quote.timeliness === 'realtime' ? '实时' : '延迟未知' };
  }
  async function search(input: string) {
    sync(); const normalized = input.trim().toUpperCase(), request = ++sequence; query = normalized; error = '';
    if (normalized.length < 2) { results = []; return []; }
    const hit = cache.get(normalized), now = Date.parse(options.now());
    if (hit && now - hit.at < searchTtl) { results = hit.results; return hit.results; }
    const local = (options.defaults ?? []).filter(item => `${item.symbol} ${item.name}`.toUpperCase().includes(normalized));
    if (!transport) { results = local; error = local.length ? '' : '行情搜索未配置'; return local; }
    try {
      const capabilities = await transport.capabilities();
      if (!capabilities.enabled || !capabilities.authorized || !capabilities.search_access) throw Error('当前无搜索权限');
      const received = (await transport.search(normalized, capabilities.limits.search_results)).map(item => canonicalInstrumentSchema.parse(item));
      cache.set(normalized, { at: now, results: received });
      sync(); if (request === sequence) results = received;
      return received;
    } catch (cause) { if (request === sequence) { results = local; error = local.length ? '' : cause instanceof Error ? cause.message : '搜索失败'; } return local; }
  }
  async function loadBars(instrument: CanonicalInstrument, range: '1M' | '3M' | '1Y') {
    if (!transport?.bars) { const value = unavailable(instrument, range, options.now()); return { ...value, line: [], candles: [] }; }
    try {
      const capabilities = await transport.capabilities();
      if (!capabilities.enabled || !capabilities.authorized || !capabilities.bars_access) throw Error('ENTITLEMENT_DENIED');
      const value = barsV1Schema.parse(await transport.bars(instrument.instrument_key, range, '1day'));
      if (value.instrument_key !== instrument.instrument_key || value.range !== range) throw Error('BARS_IDENTITY_MISMATCH');
      return { ...value, line: value.bars.map(item => ({ date: item.trading_date, close: item.close })), candles: value.bars.map(item => ({ date: item.trading_date, open: item.open, high: item.high, low: item.low, close: item.close })) };
    } catch (cause) { const value = unavailable(instrument, range, options.now()); return { ...value, reason: cause instanceof Error ? cause.message : 'BARS_UNAVAILABLE', line: [], candles: [] }; }
  }
  return {
    async domesticBoard(segment: 'etf' | 'fund') {
      sync();
      try { const result = transport?.domesticBoard ? domesticBoardSchema.parse(await transport.domesticBoard(segment)) : { segment, status: 'unavailable' as const, reason: '国内基金行情尚未配置', rows: [] }; domestic.set(segment, result); return result; }
      catch { const result: DomesticBoard = { segment, status: 'unavailable', reason: '国内行情暂不可用，请稍后重试。', rows: [] }; domestic.set(segment, result); return result; }
    },
    domesticRows() { return [...domestic.values()].flatMap(value => value.rows); },
    async refreshDetailQuote(instrument: CanonicalInstrument) {
      if (!transport) return;
      try {
        const caps = await transport.capabilities();
        if (!caps.enabled || !caps.authorized || !caps.quote_access) return;
        const raw = (await transport.quotes([instrument.instrument_key])).find(q => q.instrument_key === instrument.instrument_key);
        if (raw) { const quote = quoteV1Schema.parse(raw); if (quote.status === 'available') quotes.set(quote.instrument_key, quote); else { const old = quotes.get(quote.instrument_key); if (old) quotes.set(quote.instrument_key, { ...old, freshness: 'stale' }); } }
      } catch { const old = quotes.get(instrument.instrument_key); if (old) quotes.set(instrument.instrument_key, { ...old, freshness: 'stale' }); }
    },
    search, refreshQuotes, quoteView, cancelSearch() { sequence++; },
    add(instrument: CanonicalInstrument) { sync(); const valid = canonicalInstrumentSchema.parse(instrument); if (!state.instruments.some(item => item.instrument_key === valid.instrument_key)) { save({ version: 1, instruments: [valid, ...state.instruments], updated_at: options.now() }); } },
    move(instrumentKey: string, offset: number) { sync(); const index = state.instruments.findIndex(item => item.instrument_key === instrumentKey), target = index + offset; if (!Number.isInteger(offset) || index < 0 || target < 0 || target >= state.instruments.length) return; const instruments = state.instruments.slice(); const [item] = instruments.splice(index, 1); instruments.splice(target, 0, item); save({ version: 1, instruments, updated_at: options.now() }); },
    remove(instrumentKey: string) { sync(); save({ version: 1, instruments: state.instruments.filter(item => item.instrument_key !== instrumentKey), updated_at: options.now() }); },
    loadBars,
    exportWatchlist() { sync(); return state.instruments.slice(); },
    readWatchlist(instance: string) { return decode(storage.get(`${WATCHLIST_STORAGE_KEY}:${instance}`)).instruments; },
    replaceWatchlist(instruments: CanonicalInstrument[]) { sync(); save({ version: 1, instruments: instruments.map(item => canonicalInstrumentSchema.parse(item)), updated_at: options.now() }); },
    view() { sync(); return { query, results, error, watchlist: state.instruments, updatedAt: state.updated_at }; },
  };
}
