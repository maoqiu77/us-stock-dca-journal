import { domesticHoldingQuoteSchema, type DomesticHoldingQuote } from '@portfolio/market-data/domestic';

export class EastmoneyCNHoldingProvider {
  private options: { now(): string; fetch?: typeof fetch };
  constructor(options: { now(): string; fetch?: typeof fetch }) { this.options = options; }

  private async request(url: string, referer = 'https://quote.eastmoney.com/'): Promise<string> {
    const response = await (this.options.fetch ?? fetch)(url, {
      redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer },
    });
    if (!response.ok) throw Error('CN_QUOTE_UNAVAILABLE');
    const body = await response.text();
    if (body.length > 256_000) throw Error('CN_QUOTE_TOO_LARGE');
    return body;
  }

  private async tencent(symbols: string[], now: string): Promise<Map<string, DomesticHoldingQuote>> {
    const ids = symbols.map(symbol => `${symbol.startsWith('5') || symbol.startsWith('6') ? 'sh' : 'sz'}${symbol}`);
    const body = await this.request(`https://qt.gtimg.cn/q=${ids.map(encodeURIComponent).join(',')}`, 'https://gu.qq.com/');
    const records = new Map<string, string[]>();
    for (const match of body.matchAll(/v_(sh|sz)(\d{6})="([^"]*)";/g)) records.set(`${match[1]}${match[2]}`, match[3].split('~'));
    const nowMs = Date.parse(now), values = new Map<string, DomesticHoldingQuote>();
    for (const symbol of symbols) {
      const market = symbol.startsWith('5') || symbol.startsWith('6') ? 'sh' : 'sz', row = records.get(`${market}${symbol}`);
      const stamp = row?.[30] ?? '', parts = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
      const asOfMs = parts ? Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]) - 8, Number(parts[5]), Number(parts[6])) : NaN;
      const price = row?.[3] ?? '';
      const valid = !!row && row.length >= 83 && row[2] === symbol && row[82] === 'CNY' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price) && Number(price) > 0 && Number.isFinite(asOfMs) && asOfMs <= nowMs + 60_000 && nowMs - asOfMs <= 7 * 86_400_000;
      values.set(symbol, domesticHoldingQuoteSchema.parse({ symbol, price: valid ? price : null, asOf: valid ? new Date(asOfMs).toISOString() : null, fetchedAt: now,
        source: '腾讯财经公开参考行情 · 延迟未知', status: valid ? 'available' : 'unavailable' }));
    }
    return values;
  }

  async quotes(symbols: string[]): Promise<DomesticHoldingQuote[]> {
    if (!symbols.length || symbols.length > 30 || new Set(symbols).size !== symbols.length || symbols.some(symbol => !/^(?:0|3|5|6|1)\d{5}$/.test(symbol))) throw Error('CN_INVALID_SYMBOLS');
    const now = this.options.now();
    const secids = symbols.map(symbol => `${symbol.startsWith('5') || symbol.startsWith('6') ? 1 : 0}.${symbol}`).join(',');
    let eastmoneyQuotes = new Map<string, DomesticHoldingQuote>();
    try {
      const payload = JSON.parse(await this.request(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=${encodeURIComponent(secids)}&fltt=2&fields=f12,f13,f14,f2,f124`));
      if (!Array.isArray(payload.data?.diff) || payload.data.diff.length > 30) throw Error('CN_QUOTE_INVALID');
      for (const symbol of symbols) {
        const market = symbol.startsWith('5') || symbol.startsWith('6') ? 1 : 0;
        const item = payload.data.diff.find((row: any) => row.f12 === symbol && row.f13 === market && typeof row.f14 === 'string' && row.f14.trim());
        const observed = item && typeof item.f124 === 'number' && Number.isInteger(item.f124) ? item.f124 * 1000 : NaN;
        const valid = item && typeof item.f2 === 'number' && Number.isFinite(item.f2) && item.f2 > 0 && Number.isFinite(observed) && observed > 0 && observed <= Date.parse(now) + 60_000;
        if (valid) eastmoneyQuotes.set(symbol, domesticHoldingQuoteSchema.parse({ symbol, price: String(item.f2), asOf: new Date(observed).toISOString(), fetchedAt: now,
          source: '东方财富公开参考行情 · 延迟未知', status: 'available' }));
      }
    } catch { /* Use the secondary public source for unavailable instruments. */ }
    if (eastmoneyQuotes.size === symbols.length) return symbols.map(symbol => eastmoneyQuotes.get(symbol)!);
    try {
      const missing = symbols.filter(symbol => !eastmoneyQuotes.has(symbol));
      const fallback = await this.tencent(missing, now);
      for (const [symbol, quote] of fallback) if (quote.status === 'available') eastmoneyQuotes.set(symbol, quote);
    } catch { /* Missing observations remain explicitly unavailable. */ }
    return symbols.map(symbol => eastmoneyQuotes.get(symbol) ?? domesticHoldingQuoteSchema.parse({ symbol, price: null, asOf: null, fetchedAt: now,
      source: '国内行情暂不可用 · 延迟未知', status: 'unavailable' }));
  }
}
