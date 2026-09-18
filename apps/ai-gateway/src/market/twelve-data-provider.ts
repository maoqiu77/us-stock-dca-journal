import { barV1Schema, barsV1Schema, canonicalInstrumentSchema, evaluateFreshness, quoteV1Schema, type BarsV1, type CanonicalInstrument, type QuoteV1 } from '@portfolio/market-data';
import type { MarketProvider } from './ports.ts';

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Coverage = QuoteV1['coverage'];
type Timeliness = QuoteV1['timeliness'];
export type TwelveDataProviderOptions = {
  apiKey: string; feed: string; coverage: Coverage; timeliness: Timeliness; delaySeconds: number | null; attribution: string; catalogVersion: string;
  fetch?: Fetch; timeoutMs?: number; now?: () => string;
  sleep?: (ms: number) => Promise<void>; random?: () => number;
};

export class MarketProviderError extends Error {
  readonly code: 'PROVIDER_AUTH' | 'PROVIDER_RATE_LIMIT' | 'PROVIDER_TIMEOUT' | 'PROVIDER_RESPONSE' | 'PROVIDER_UNAVAILABLE';
  readonly retryAfterSeconds: number | null;
  constructor(code: MarketProviderError['code'], message: string, retryAfterSeconds: number | null = null) { super(message); this.name = 'MarketProviderError'; this.code = code; this.retryAfterSeconds = retryAfterSeconds; }
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const decimal = (value: unknown, positive = false) => {
  const candidate = text(value);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate)) return null;
  if (positive && Number(candidate) <= 0) return null;
  return candidate;
};
const integer = (value: unknown) => { const candidate = text(value); return /^\d+$/.test(candidate) ? candidate : null; };
const instrumentType = (value: unknown): 'STOCK' | 'ETF' | null => {
  const normalized = text(value).toLowerCase();
  if (normalized === 'etf' || normalized.includes('exchange traded fund')) return 'ETF';
  if (normalized === 'common stock' || normalized === 'stock') return 'STOCK';
  return null;
};
const instrumentKey = (mic: string, symbol: string) => `US:${mic}:${symbol}`;
const isoFromEpoch = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
const tradingDate = (value: unknown) => { const candidate = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null; };

function providerCode(status: number) {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH' as const;
  if (status === 429) return 'PROVIDER_RATE_LIMIT' as const;
  if (status >= 500) return 'PROVIDER_UNAVAILABLE' as const;
  return 'PROVIDER_RESPONSE' as const;
}

function weekday(date: string) { return new Date(`${date}T12:00:00.000Z`).getUTCDay(); }
function fourthThursdayOfNovember(year: number) {
  let seen = 0;
  for (let day = 1; day <= 30; day++) if (weekday(`${year}-11-${String(day).padStart(2, '0')}`) === 4 && ++seen === 4) return day;
  throw Error('invalid_calendar_year');
}
function isKnownEarlyClose(date: string) {
  const [yearText, monthText, dayText] = date.split('-'), year = Number(yearText), month = Number(monthText), day = Number(dayText), dow = weekday(date);
  if (month === 11 && dow === 5 && day === fourthThursdayOfNovember(year) + 1) return true;
  if (month === 12 && day === 24 && dow >= 1 && dow <= 5) return true;
  if (month === 7 && day === 3 && dow >= 1 && dow <= 5) return true;
  return false;
}
function closeInstant(date: string) {
  // US equities only: determine the New York UTC offset at noon, avoiding a
  // hard-coded DST assumption, then represent the regular-session close.
  const noon = new Date(`${date}T17:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).formatToParts(noon);
  const label = parts.find(part => part.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  const match = label.match(/GMT([+-]\d{2}):?(\d{2})/);
  const offset = match ? `${match[1]}:${match[2]}` : '-05:00';
  const hour = isKnownEarlyClose(date) ? '13' : '16';
  return new Date(`${date}T${hour}:00:00${offset}`).toISOString();
}

export class TwelveDataProvider implements MarketProvider {
  private readonly fetcher: Fetch;
  private readonly timeoutMs: number;
  private readonly clock: () => string;
  private readonly options: TwelveDataProviderOptions;
  constructor(options: TwelveDataProviderOptions) {
    this.options = options;
    if (!options.apiKey.trim()) throw Error('Twelve Data API key is required.');
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.clock = options.now ?? (() => new Date().toISOString());
  }

  private async request(endpoint: 'symbol_search' | 'quote' | 'time_series', params: Record<string, string>) {
    const url = new URL(`https://api.twelvedata.com/${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(url, { headers: { Authorization: `apikey ${this.options.apiKey}`, Accept: 'application/json' }, signal: controller.signal });
        const payload = await response.json().catch(() => undefined) as any;
        if (!response.ok || payload?.status === 'error') {
          const retry = Number(response.headers.get('retry-after'));
          throw new MarketProviderError(providerCode(response.status || Number(payload?.code)), `Twelve Data ${endpoint} request failed.`, Number.isFinite(retry) && retry >= 0 ? retry : null);
        }
        return payload;
      } catch (error) {
        const normalized = error instanceof MarketProviderError ? error : (error as any)?.name === 'AbortError' ? new MarketProviderError('PROVIDER_TIMEOUT', `Twelve Data ${endpoint} request timed out.`) : new MarketProviderError('PROVIDER_UNAVAILABLE', `Twelve Data ${endpoint} request was unavailable.`);
        if (attempt === 0 && (normalized.code === 'PROVIDER_RATE_LIMIT' || normalized.code === 'PROVIDER_UNAVAILABLE')) {
          const ms = normalized.retryAfterSeconds !== null ? normalized.retryAfterSeconds * 1000 : 250 + Math.floor((this.options.random ?? Math.random)() * 250);
          await (this.options.sleep ?? (delay => new Promise(resolve => setTimeout(resolve, delay))))(ms);
          continue;
        }
        throw normalized;
      } finally { clearTimeout(timer); }
    }
    throw new MarketProviderError('PROVIDER_UNAVAILABLE', `Twelve Data ${endpoint} request was unavailable.`);
  }

  async search(query: string, limit: number): Promise<CanonicalInstrument[]> {
    const payload = await this.request('symbol_search', { symbol: query, outputsize: String(limit), show_plan: 'true' });
    if (!Array.isArray(payload?.data)) throw new MarketProviderError('PROVIDER_RESPONSE', 'Twelve Data symbol_search response was malformed.');
    const results: CanonicalInstrument[] = [];
    for (const row of payload.data) {
      const symbol = text(row?.symbol).toUpperCase(), mic = text(row?.mic_code).toUpperCase(), type = instrumentType(row?.instrument_type);
      if (!symbol || !/^[A-Z0-9]{4}$/.test(mic) || !type || text(row?.currency).toUpperCase() !== 'USD' || text(row?.country).toLowerCase() !== 'united states' || text(row?.exchange_timezone) !== 'America/New_York') continue;
      const parsed = canonicalInstrumentSchema.safeParse({ schema_version: 1, instrument_key: instrumentKey(mic, symbol), symbol, name: text(row?.instrument_name), mic, exchange: text(row?.exchange), market: 'US', currency: 'USD', asset_type: type, provider_symbol: symbol, provider_catalog_version: this.options.catalogVersion, status: 'active' });
      if (parsed.success) results.push(parsed.data);
      if (results.length >= limit) break;
    }
    return results;
  }

  async quotes(keys: string[]): Promise<QuoteV1[]> {
    const symbols = keys.map(key => key.split(':')[2]);
    const payload = await this.request('quote', { symbol: symbols.join(',') });
    const rows = keys.length === 1 ? [payload] : keys.map((key, index) => payload?.[symbols[index]] ?? payload?.[key]);
    const receivedAt = this.clock(), results: QuoteV1[] = [];
    for (let index = 0; index < keys.length; index++) {
      const row = rows[index]; if (!row || row.status === 'error') continue;
      const symbol = text(row.symbol).toUpperCase(), mic = text(row.mic_code).toUpperCase();
      if (symbol !== symbols[index] || mic !== keys[index].split(':')[1] || text(row.currency).toUpperCase() !== 'USD') continue;
      const price = decimal(row.close, true), asOf = isoFromEpoch(row.last_quote_at) ?? isoFromEpoch(row.timestamp);
      if (!price || !asOf) continue;
      const previousClose = decimal(row.previous_close, true), change = previousClose ? decimal(row.change) : null, percent = previousClose ? decimal(row.percent_change) : null;
      const open = row.is_market_open === true, date = tradingDate(row.datetime), completed = Boolean(date && Date.parse(receivedAt) >= Date.parse(closeInstant(date)));
      const quote = quoteV1Schema.safeParse({ schema_version: 1, instrument_key: keys[index], symbol, currency: 'USD', price, price_kind: this.options.timeliness === 'eod' || !open ? 'official_close' : 'last_trade', previous_close: previousClose, previous_close_date: previousClose ? null : null, change, change_percent: percent, volume: integer(row.volume), volume_scope: 'feed_only', session: open ? 'regular' : 'closed', market_status: open ? 'open' : 'closed', trading_date: date, exchange_timezone: 'America/New_York', provider: 'Twelve Data', feed: this.options.feed, coverage: this.options.coverage, timeliness: this.options.timeliness, delay_seconds: this.options.delaySeconds, as_of: asOf, received_at: receivedAt, served_at: receivedAt, freshness: evaluateFreshness(asOf, receivedAt, date, { timeliness: this.options.timeliness, delaySeconds: this.options.delaySeconds, graceSeconds: 120, marketOpen: open, latestCompletedTradingDate: completed ? date ?? undefined : undefined }), cache_state: 'miss', status: 'available', reason: null, adjustment: 'unadjusted', attribution: this.options.attribution });
      if (quote.success) results.push(quote.data);
    }
    return results;
  }

  async bars(key: string, range: '1M' | '3M' | '1Y', interval: '1day'): Promise<BarsV1> {
    const outputsize = range === '1M' ? 31 : range === '3M' ? 93 : 366;
    const payload = await this.request('time_series', { symbol: key.split(':')[2], interval, outputsize: String(outputsize), order: 'DESC', timezone: 'Exchange', adjust: 'none' });
    if (!Array.isArray(payload?.values) || text(payload?.meta?.currency).toUpperCase() !== 'USD' || text(payload?.meta?.exchange_timezone) !== 'America/New_York' || text(payload?.meta?.mic_code).toUpperCase() !== key.split(':')[1]) throw new MarketProviderError('PROVIDER_RESPONSE', 'Twelve Data time_series response was malformed.');
    const receivedAt = this.clock();
    const bars = payload.values.flatMap((row: any) => {
      const date = tradingDate(row?.datetime); if (!date || weekday(date) === 0 || weekday(date) === 6) return [];
      const parsed = barV1Schema.safeParse({ trading_date: date, starts_at: null, open: decimal(row.open, true), high: decimal(row.high, true), low: decimal(row.low, true), close: decimal(row.close, true), volume: integer(row.volume), is_final: Date.parse(receivedAt) >= Date.parse(closeInstant(date)) });
      return parsed.success ? [parsed.data] : [];
    }).sort((a: any, b: any) => a.trading_date.localeCompare(b.trading_date)).slice(-400);
    if (!bars.length) throw new MarketProviderError('PROVIDER_RESPONSE', 'Twelve Data time_series contained no valid bars.');
    const last = bars[bars.length - 1], asOf = last.is_final ? closeInstant(last.trading_date) : receivedAt;
    return barsV1Schema.parse({ schema_version: 1, instrument_key: key, currency: 'USD', interval, range, adjustment: 'unadjusted', provider: 'Twelve Data', feed: this.options.feed, coverage: this.options.coverage, timezone: 'America/New_York', as_of: asOf, received_at: receivedAt, served_at: receivedAt, status: 'available', reason: null, bars });
  }
}
