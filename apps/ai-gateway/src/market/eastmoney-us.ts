import { quoteV1Schema, barsV1Schema, canonicalInstrumentSchema, type QuoteV1, type CanonicalInstrument } from '@portfolio/market-data';
import { MarketProviderError } from './twelve-data-provider.ts';
import { popularUS } from '@portfolio/market-data/popular';
import type { MarketProvider } from './ports.ts';
export class EastmoneyUSProvider implements MarketProvider {
  private now: () => string;
  private fetcher: typeof fetch;
  constructor(options: { now(): string; fetch?: typeof fetch }) { this.now = options.now; this.fetcher = options.fetch ?? fetch; }
  private catalog = new Map(popularUS.map(item => [item.instrument_key, { item, expires: Infinity }]));
  private async read(url: string): Promise<any> {
    let response: Response;
    try { response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' } }); } catch { throw new MarketProviderError('PROVIDER_TIMEOUT', 'Public history connection failed'); }
    if (!response.ok) throw new MarketProviderError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : 'PROVIDER_RESPONSE', 'Public source returned non-success status');
    const reader = response.body?.getReader(); if (!reader) throw Error('PUBLIC_QUOTES_UNAVAILABLE');
    let length = 0; const chunks: Uint8Array[] = [];
    while (true) { const {done, value} = await reader.read(); if (done) break; length += value.length; if (length > 256000) { await reader.cancel(); throw Error('PUBLIC_QUOTES_TOO_LARGE'); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
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
    const market = (item: CanonicalInstrument) => item.mic === 'XNAS' ? 105 : item.mic === 'XNYS' ? 106 : 107;
    const secids = instruments.flatMap(item => item ? [`${market(item)}.${item.symbol}`] : []).join(',');
    let values: any[] = [];
    if (secids) {
      const data = await this.read(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fltt=2&fields=f12,f13,f14,f2,f3,f4,f18,f124,f20`);
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
    } catch { try { return await this.tencentBars(key, match[2], range); } catch { return this.fallbackBars(key, match[2], range); } }
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
