import { quoteV1Schema, barsV1Schema, canonicalInstrumentSchema, type QuoteV1, type CanonicalInstrument } from '@portfolio/market-data';
import { MarketProviderError } from './twelve-data-provider.ts';
import { popularUS } from '@portfolio/market-data/popular';
import type { MarketProvider } from './ports.ts';

function wallClockInZone(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const wall = Date.UTC(...match.slice(1).map(Number).map((part, index) => index === 1 ? part - 1 : part) as [number, number, number, number, number, number]);
  const offsetAt = (time: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)).map(part => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - time;
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

function nasdaqTime(value: unknown): string | null {
  const match = typeof value === 'string' ? /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(value) : null;
  if (!match) return null;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[1]) + 1;
  const hour = Number(match[4]) % 12 + (match[6] === 'PM' ? 12 : 0);
  return wallClockInZone(`${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')} ${String(hour).padStart(2, '0')}:${match[5]}:00`, 'America/New_York');
}

export class EastmoneyUSProvider implements MarketProvider {
  private now: () => string;
  private fetcher: typeof fetch;
  constructor(options: { now(): string; fetch?: typeof fetch }) { this.now = options.now; this.fetcher = options.fetch ?? fetch; }
  private catalog = new Map(popularUS.map(item => [item.instrument_key, { item, expires: Infinity }]));
  private async readText(url: string, timeoutMs = 8000): Promise<string> {
    let response: Response;
    const referer = url.includes('gtimg.cn') ? 'https://gu.qq.com/' : url.includes('nasdaq.com') ? 'https://www.nasdaq.com/' : 'https://quote.eastmoney.com/';
    try { response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer } }); } catch { throw new MarketProviderError('PROVIDER_TIMEOUT', 'Public history connection failed'); }
    if (!response.ok) throw new MarketProviderError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : 'PROVIDER_RESPONSE', 'Public source returned non-success status');
    const reader = response.body?.getReader(); if (!reader) throw Error('PUBLIC_QUOTES_UNAVAILABLE');
    let length = 0; const chunks: Uint8Array[] = [];
    while (true) { const {done, value} = await reader.read(); if (done) break; length += value.length; if (length > 256000) { await reader.cancel(); throw Error('PUBLIC_QUOTES_TOO_LARGE'); } chunks.push(value); }
    return Buffer.concat(chunks).toString('utf8');
  }
  private async read(url: string, timeoutMs?: number): Promise<any> { return JSON.parse(await this.readText(url, timeoutMs)); }
  async search(query: string, limit: number): Promise<CanonicalInstrument[]> {
    const q = query.trim().toUpperCase();
    if (!q || q.length > 80 || !Number.isInteger(limit) || limit < 1 || limit > 10) return [];
    const local = popularUS.filter(item => `${item.symbol} ${item.name}`.toUpperCase().includes(q));
    let remote: CanonicalInstrument[] = [];
    try {
      const payload = await this.read(`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(q)}&count=${limit}&type=14`);
      if (!Array.isArray(payload.QuotationCodeTable?.Data)) throw Error('PUBLIC_CATALOG_INVALID');
      remote = payload.QuotationCodeTable.Data.flatMap((row: any) => {
        if (row.Classify !== 'UsStock' || !['1', '5'].includes(row.TypeUS) || typeof row.Code !== 'string') return [];
        const known = popularUS.find(item => item.symbol === row.Code);
        // Vendor AMEX combines NYSE American and Arca. Do not invent an MIC.
        const mic = row.JYS === 'NASDAQ' && row.MktNum === '105' ? 'XNAS' : row.JYS === 'NYSE' && row.MktNum === '106' ? 'XNYS' : row.JYS === 'AMEX' && row.MktNum === '107' && known?.mic === 'ARCX' ? 'ARCX' : null;
        if (!mic || row.QuoteID !== `${row.MktNum}.${row.Code}`) return [];
        const candidate = canonicalInstrumentSchema.safeParse({ schema_version: 1, instrument_key: `US:${mic}:${row.Code}`, symbol: row.Code, name: row.Name, mic, exchange: row.JYS, market: 'US', currency: 'USD', asset_type: row.TypeUS === '5' ? 'ETF' : 'STOCK', provider_symbol: row.Code, provider_catalog_version: this.now(), status: 'active' });
        if (!candidate.success) return [];
        const item = known?.instrument_key === candidate.data.instrument_key ? known : candidate.data;
        if (this.catalog.size >= 500) { const oldest = [...this.catalog].find(([, entry]) => entry.expires !== Infinity); if (oldest) this.catalog.delete(oldest[0]); }
        this.catalog.set(item.instrument_key, { item, expires: Date.parse(this.now()) + 3600000 });
        return [item];
      });
    } catch { if (!local.length) throw Error('PUBLIC_SEARCH_UNAVAILABLE'); }
    return [...new Map([...local, ...remote].map(item => [item.instrument_key, item])).values()].slice(0, limit);
  }
  private async eastmoneyQuotes(keys: string[], instruments: Array<CanonicalInstrument | undefined>): Promise<QuoteV1[]> {
    const market = (item: CanonicalInstrument) => item.mic === 'XNAS' ? 105 : item.mic === 'XNYS' ? 106 : 107;
    const secids = instruments.flatMap(item => item ? [`${market(item)}.${item.symbol}`] : []).join(',');
    let values: any[] = [];
    if (secids) {
      const data = await this.read(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fltt=2&fields=f12,f13,f14,f2,f3,f4,f18,f124,f20`, 1800);
      if (!Array.isArray(data.data?.diff)) throw Error('PUBLIC_QUOTES_INVALID'); values=data.data.diff;
    }
    const now=this.now();
    return keys.map((key,i) => {
      const item=instruments[i], q=item ? values.find(row=>row.f12===item.symbol && row.f13===market(item)) : undefined;
      const valid=!!q && typeof q.f2==='number' && Number.isFinite(q.f2) && q.f2>0 && typeof q.f124==='number' && q.f124>0 && q.f124*1000<=Date.parse(now);
      const numeric=(v: unknown) => typeof v==='number' && Number.isFinite(v) ? String(v) : null;
      const asOf=valid ? new Date(q.f124*1000).toISOString() : null;
      const date=asOf ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf)) : null;
      return quoteV1Schema.parse({ schema_version:1,instrument_key:key,symbol:item?.symbol ?? key.split(':').at(-1),currency:'USD',price:valid?String(q.f2):null,price_kind:'indicative',previous_close:valid&&q.f18>0?numeric(q.f18):null,previous_close_date:null,change:valid?numeric(q.f4):null,change_percent:valid?numeric(q.f3):null,market_cap:valid&&q.f20>0?numeric(q.f20):null,volume:null,volume_scope:'unknown',session:'unknown',market_status:'unknown',trading_date:date,exchange_timezone:'America/New_York',provider:'东方财富公开接口',feed:'public-us-reference',coverage:'indicative',timeliness:'unknown',delay_seconds:null,as_of:asOf,received_at:now,served_at:now,freshness:'unknown',cache_state:'miss',status:valid?'available':'unavailable',reason:valid?null:item?'NO_OBSERVATION':'OUTSIDE_PUBLIC_CATALOG',adjustment:'unadjusted',attribution:'东方财富公开参考行情 · 延迟未知' });
    });
  }
  private async tencentQuotes(keys: string[], instruments: Array<CanonicalInstrument | undefined>): Promise<QuoteV1[]> {
    const suffix: Record<string, string> = { XNAS: 'OQ', XNYS: 'N', ARCX: 'AM' };
    const ids = instruments.flatMap(item => item ? [`us${item.symbol}`] : []);
    if (!ids.length) throw Error('PUBLIC_QUOTES_UNAVAILABLE');
    const body = await this.readText(`https://qt.gtimg.cn/q=${ids.map(encodeURIComponent).join(',')}`, 1800);
    const records = new Map<string, string[]>();
    for (const match of body.matchAll(/v_us([A-Z0-9.-]+)="([^"]*)";/g)) records.set(match[1], match[2].split('~'));
    const now = this.now(), positive = (value: unknown) => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0 ? value : null;
    const decimal = (value: unknown) => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? value : null;
    return keys.map((key, index) => {
      const item = instruments[index], row = item ? records.get(item.symbol) : undefined;
      const expected = item ? `${item.symbol}.${suffix[item.mic] ?? ''}` : '', asOf = row ? wallClockInZone(row[30], 'America/New_York') : null;
      const valid = !!item && !!row && row[0] === '200' && row[2] === expected && row[35] === 'USD' && !!positive(row[3]) && !!asOf && Date.parse(asOf) <= Date.parse(now) + 60_000;
      return quoteV1Schema.parse({ schema_version: 1, instrument_key: key, symbol: item?.symbol ?? key.split(':').at(-1), currency: 'USD', price: valid ? positive(row![3]) : null, price_kind: 'indicative', previous_close: valid ? positive(row![4]) : null, previous_close_date: null, change: valid ? decimal(row![31]) : null, change_percent: valid ? decimal(row![32]) : null, volume: valid && /^\d+$/.test(row![36]) ? row![36] : null, volume_scope: valid ? 'feed_only' : 'unknown', session: 'unknown', market_status: 'unknown', trading_date: valid ? row![30].slice(0, 10) : null, exchange_timezone: 'America/New_York', provider: '腾讯财经', feed: 'public-us-reference-secondary', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, as_of: valid ? asOf : null, received_at: now, served_at: now, freshness: 'unknown', cache_state: 'miss', status: valid ? 'available' : 'unavailable', reason: valid ? null : item ? 'NO_OBSERVATION' : 'OUTSIDE_PUBLIC_CATALOG', adjustment: 'unadjusted', attribution: '腾讯财经公开参考行情 · 延迟未知' });
    });
  }
  private async yahooQuotes(keys: string[], instruments: Array<CanonicalInstrument | undefined>): Promise<QuoteV1[]> {
    const exchanges: Record<string, string[]> = { XNAS: ['NMS', 'NGM', 'NCM'], XNYS: ['NYQ'], ARCX: ['PCX'] };
    const results: Array<QuoteV1 | undefined> = new Array(keys.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, keys.length) }, async () => {
      while (next < keys.length) {
        const index = next++, item = instruments[index];
        if (!item) continue;
        try {
          const payload = await this.read(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=5d&interval=1d`);
          const meta = payload.chart?.result?.[0]?.meta;
          const price = meta?.regularMarketPrice, previous = meta?.previousClose, time = meta?.regularMarketTime;
          if (meta?.symbol !== item.symbol || meta.currency !== 'USD' || !exchanges[item.mic]?.includes(meta.exchangeName) || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || typeof time !== 'number' || time * 1000 > Date.parse(this.now()) + 60_000) continue;
          const asOf = new Date(time * 1000).toISOString(), now = this.now();
          const prev = typeof previous === 'number' && Number.isFinite(previous) && previous > 0 ? previous : null;
          results[index] = quoteV1Schema.parse({ schema_version: 1, instrument_key: keys[index], symbol: item.symbol, currency: 'USD', price: String(price), price_kind: 'indicative', previous_close: prev === null ? null : String(prev), previous_close_date: null, change: prev === null ? null : String(price - prev), change_percent: prev === null ? null : String((price - prev) / prev * 100), volume: Number.isSafeInteger(meta.regularMarketVolume) && meta.regularMarketVolume >= 0 ? String(meta.regularMarketVolume) : null, volume_scope: 'unknown', session: 'unknown', market_status: 'unknown', trading_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf)), exchange_timezone: 'America/New_York', provider: 'Yahoo Finance', feed: 'public-us-chart', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, as_of: asOf, received_at: now, served_at: now, freshness: 'unknown', cache_state: 'miss', status: 'available', reason: null, adjustment: 'unadjusted', attribution: 'Yahoo Finance 公开参考行情 · 延迟未知' });
        } catch { /* Continue to the remaining public sources. */ }
      }
    }));
    return keys.map((key, index) => results[index] ?? quoteV1Schema.parse({ schema_version: 1, instrument_key: key, symbol: instruments[index]?.symbol ?? key.split(':').at(-1), currency: 'USD', price: null, price_kind: 'indicative', previous_close: null, previous_close_date: null, change: null, change_percent: null, volume: null, volume_scope: 'unknown', session: 'unknown', market_status: 'unknown', trading_date: null, exchange_timezone: 'America/New_York', provider: 'Yahoo Finance', feed: 'public-us-chart', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, as_of: null, received_at: this.now(), served_at: this.now(), freshness: 'unknown', cache_state: 'miss', status: 'unavailable', reason: 'NO_OBSERVATION', adjustment: 'unadjusted', attribution: 'Yahoo Finance 公开参考行情 · 延迟未知' }));
  }
  private async nasdaqQuotes(keys: string[], instruments: Array<CanonicalInstrument | undefined>): Promise<Array<QuoteV1 | undefined>> {
    const results: Array<QuoteV1 | undefined> = new Array(keys.length);
    const number = (value: unknown) => typeof value === 'string' && /^[-+]?[\d,]+(?:\.\d+)?%?$/.test(value.replace(/^\$/, '')) ? Number(value.replace(/[$,%]/g, '')) : null;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, keys.length) }, async () => {
      while (next < keys.length) {
        const index = next++, item = instruments[index];
        if (!item) continue;
        try {
          const payload = await this.read(`https://api.nasdaq.com/api/quote/${encodeURIComponent(item.symbol)}/info?assetclass=${item.asset_type === 'ETF' ? 'etf' : 'stocks'}`);
          const data = payload.data, primary = data?.primaryData;
          const exchange = data?.exchange;
          const identity = item.mic === 'XNAS' ? typeof exchange === 'string' && exchange.startsWith('NASDAQ-') : item.mic === 'XNYS' ? exchange === 'NYSE' : exchange === 'PSE' || exchange === 'NYSE ARCA';
          const price = number(primary?.lastSalePrice), change = number(primary?.netChange), percent = number(primary?.percentageChange), asOf = nasdaqTime(primary?.lastTradeTimestamp), now = this.now();
          if (data?.symbol !== item.symbol || data.assetClass !== (item.asset_type === 'ETF' ? 'ETF' : 'STOCKS') || !identity || price === null || price <= 0 || !asOf || Date.parse(asOf) > Date.parse(now) + 60_000) continue;
          const previous = change === null || price - change <= 0 ? null : Number((price - change).toFixed(6));
          const volume = number(primary?.volume);
          results[index] = quoteV1Schema.parse({ schema_version: 1, instrument_key: keys[index], symbol: item.symbol, currency: 'USD', price: String(price), price_kind: 'indicative', previous_close: previous === null ? null : String(previous), previous_close_date: null, change: change === null ? null : String(change), change_percent: percent === null ? null : String(percent), volume: volume !== null && Number.isSafeInteger(volume) && volume >= 0 ? String(volume) : null, volume_scope: 'unknown', session: 'unknown', market_status: 'unknown', trading_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf)), exchange_timezone: 'America/New_York', provider: 'Nasdaq', feed: 'public-us-reference', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, as_of: asOf, received_at: now, served_at: now, freshness: 'unknown', cache_state: 'miss', status: 'available', reason: null, adjustment: 'unadjusted', attribution: 'Nasdaq 公开参考行情 · 延迟未知' });
        } catch { /* Continue to the remaining public source. */ }
      }
    }));
    return results;
  }
  async quotes(keys: string[]): Promise<QuoteV1[]> {
    if (keys.length > 30) throw Error('QUOTE_BATCH_LIMIT');
    const instruments: Array<CanonicalInstrument | undefined> = new Array(keys.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, keys.length) }, async () => {
      while (next < keys.length) {
        const i = next++, key = keys[i], match = /^US:(XNAS|XNYS|ARCX):([A-Z][A-Z0-9.-]{0,14})$/.exec(key);
        if (!match) continue;
        let cached = this.catalog.get(key);
        if (!cached || cached.expires <= Date.parse(this.now())) {
          try { await this.search(match[2], 10); } catch { /* fail closed if identity cannot be verified */ }
          cached = this.catalog.get(key);
        }
        if (cached && cached.expires > Date.parse(this.now())) instruments[i] = cached.item;
      }
    }));
    const fast: Array<PromiseSettledResult<QuoteV1[]> | undefined> = [];
    const tasks = [this.eastmoneyQuotes(keys, instruments), this.tencentQuotes(keys, instruments)].map((task, index) => task.then(
      value => { fast[index] = { status: 'fulfilled', value }; },
      reason => { fast[index] = { status: 'rejected', reason }; },
    ));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(tasks), new Promise<void>(resolve => { timer = setTimeout(resolve, 400); })]);
    if (timer) clearTimeout(timer);
    if (!fast.some(result => result?.status === 'fulfilled' && result.value.some(item => item.status === 'available'))) await Promise.all(tasks);
    const selected: Array<QuoteV1 | undefined> = keys.map((_, index) => {
      const observations = fast.flatMap(result => result?.status === 'fulfilled' && result.value[index]?.status === 'available' ? [result.value[index]] : []);
      return observations.sort((a, b) => Date.parse(b.as_of!) - Date.parse(a.as_of!))[0];
    });
    const now = this.now(), parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(part => [part.type, part.value]));
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const active = !['Sat', 'Sun'].includes(parts.weekday) && minute >= 240 && minute < 1200;
    const unresolved = keys.map((_, index) => index).filter(index => !selected[index] || active && Date.parse(now) - Date.parse(selected[index]!.as_of!) > 120_000);
    if (unresolved.length) {
      const remainingKeys = unresolved.map(index => keys[index]), remainingInstruments = unresolved.map(index => instruments[index]);
      const slower = await Promise.allSettled([this.yahooQuotes(remainingKeys, remainingInstruments), this.nasdaqQuotes(remainingKeys, remainingInstruments)]);
      for (let offset = 0; offset < unresolved.length; offset++) {
        const index = unresolved[offset];
        for (const result of slower) {
          const quote = result.status === 'fulfilled' ? result.value[offset] : undefined;
          if (quote?.status === 'available' && (!selected[index] || Date.parse(quote.as_of!) > Date.parse(selected[index]!.as_of!))) selected[index] = quote;
        }
      }
    }
    return keys.map((key, index) => selected[index] ?? (fast.find(result => result?.status === 'fulfilled') as PromiseFulfilledResult<QuoteV1[]> | undefined)?.value[index] ?? quoteV1Schema.parse({ schema_version: 1, instrument_key: key, symbol: instruments[index]?.symbol ?? key.split(':').at(-1), currency: 'USD', price: null, price_kind: 'indicative', previous_close: null, previous_close_date: null, change: null, change_percent: null, volume: null, volume_scope: 'unknown', session: 'unknown', market_status: 'unknown', trading_date: null, exchange_timezone: 'America/New_York', provider: 'public-us', feed: 'none', coverage: 'indicative', timeliness: 'unknown', delay_seconds: null, as_of: null, received_at: now, served_at: now, freshness: 'unknown', cache_state: 'miss', status: 'unavailable', reason: 'NO_OBSERVATION', adjustment: 'unadjusted', attribution: '公开美股行情' }));
  }
  async bars(key: string, range: '1M'|'3M'|'1Y', _interval: '1day') {
    const match = /^US:(XNAS|XNYS|ARCX):([A-Z][A-Z0-9.-]{0,14})$/.exec(key);
    if (!match) throw Error('INVALID_INSTRUMENT');
    let entry = this.catalog.get(key);
    if (!entry || entry.expires <= Date.parse(this.now())) { await this.search(match[2], 10); entry = this.catalog.get(key); }
    if (!entry || entry.expires <= Date.parse(this.now())) throw Error('OUTSIDE_PUBLIC_CATALOG');
    const market = match[1] === 'XNAS' ? 105 : match[1] === 'XNYS' ? 106 : 107;
    const limit = range === '1M' ? 22 : range === '3M' ? 66 : 320;
    try {
    const payload = await this.read(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${encodeURIComponent(match[2])}&klt=101&fqt=0&end=20500101&lmt=${limit}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`);
    if (payload.data?.code !== match[2] || Number(payload.data?.market) !== market || !Array.isArray(payload.data?.klines)) throw Error('PUBLIC_HISTORY_INVALID');
    const now = this.now();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    // Exclude the ongoing trading date: only closed daily observations enter the chart.
    const bars = payload.data.klines.map((line: string) => {
      const [trading_date, open, close, high, low, volume] = line.split(',');
      return { trading_date, starts_at: null, open, close, high, low, volume: /^\d+$/.test(volume) ? volume : null, is_final: true };
    }).filter((bar: { trading_date: string }) => bar.trading_date < today);
    const last = bars[bars.length - 1];
    return barsV1Schema.parse({ schema_version: 1, instrument_key: key, currency: 'USD', interval: '1day', range, adjustment: 'unadjusted', provider: '东方财富公开接口', feed: 'public-us-reference', coverage: 'indicative', timezone: 'America/New_York', as_of: last ? `${last.trading_date}T00:00:00Z` : null, received_at: now, served_at: now, status: last ? 'available' : 'unavailable', reason: last ? null : 'HISTORY_UNAVAILABLE', bars });
    } catch { try { return await this.fallbackBars(key, match[2], range); } catch { return this.tencentBars(key, match[2], range); } }
  }
  private async tencentBars(key: string, symbol: string, range: '1M'|'3M'|'1Y') {
    const suffix = {XNAS:'OQ', XNYS:'N', ARCX:'AM'}[key.split(':')[1]];
    if (!suffix) throw Error('PUBLIC_HISTORY_INVALID');
    const vendorSymbol = `${symbol}.${suffix}`, id = `us${vendorSymbol}`;
    const payload = await this.read(`https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=${encodeURIComponent(id)},day,,,320,qfq`);
    const result = payload.data?.[id], quote = result?.qt?.[id];
    if (payload.code !== 0 || quote?.[2] !== vendorSymbol || quote?.[35] !== 'USD' || !Array.isArray(result.qfqday)) throw Error('PUBLIC_HISTORY_INVALID');
    const now = this.now(), formatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}), today = formatter.format(new Date(now));
    const bars = result.qfqday.map((row: string[]) => ({ trading_date: row[0], starts_at:null, open:row[1],close:row[2],high:row[3],low:row[4],volume:Number.isSafeInteger(Number(row[5])) && Number(row[5]) >= 0 ? String(Number(row[5])) : null,is_final:true }))
      .filter((bar: {trading_date:string}) => bar.trading_date < today).slice(-(range==='1M'?22:range==='3M'?66:320));
    const last=bars[bars.length-1];
    return barsV1Schema.parse({schema_version:1,instrument_key:key,currency:'USD',interval:'1day',range,adjustment:'forward_adjusted',provider:'腾讯财经',feed:'public-us-daily',coverage:'indicative',timezone:'America/New_York',as_of:last?`${last.trading_date}T00:00:00Z`:null,received_at:now,served_at:now,status:last?'available':'unavailable',reason:last?null:'HISTORY_UNAVAILABLE',bars});
  }
  private async fallbackBars(key: string, symbol: string, range: '1M'|'3M'|'1Y') {
    const payload = await this.read(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`);
    const result = payload.chart?.result?.[0], meta = result?.meta;
    const exchanges: Record<string, string[]> = { XNAS: ['NMS', 'NGM', 'NCM'], XNYS: ['NYQ'], ARCX: ['PCX'] };
    if (meta?.symbol !== symbol || meta?.currency !== 'USD' || !exchanges[key.split(':')[1]]?.includes(meta.exchangeName) || !Array.isArray(result.timestamp)) throw Error('PUBLIC_HISTORY_INVALID');
    const now = this.now(), formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
    const today = formatter.format(new Date(now)), quote = result.indicators?.quote?.[0];
    if (!quote) throw Error('PUBLIC_HISTORY_INVALID');
    const bars = result.timestamp.map((time: number, i: number) => ({ trading_date: formatter.format(new Date(time * 1000)), starts_at: null, open: String(quote.open[i]), close: String(quote.close[i]), high: String(quote.high[i]), low: String(quote.low[i]), volume: Number.isSafeInteger(quote.volume[i]) && quote.volume[i] >= 0 ? String(quote.volume[i]) : null, is_final: true }))
      .filter((bar: {trading_date:string}) => bar.trading_date < today).slice(-(range === '1M' ? 22 : range === '3M' ? 66 : 320));
    const last = bars[bars.length - 1];
    return barsV1Schema.parse({ schema_version:1, instrument_key:key, currency:'USD', interval:'1day', range, adjustment:'split_adjusted', provider:'Yahoo Finance', feed:'public-daily-reference', coverage:'indicative', timezone:'America/New_York', as_of:last ? `${last.trading_date}T00:00:00Z` : null, received_at:now, served_at:now, status:last?'available':'unavailable', reason:last?null:'HISTORY_UNAVAILABLE', bars });
  }
}
