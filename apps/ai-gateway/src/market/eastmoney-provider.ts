import { latestEtfTradingDates } from './etf-calendar.ts';
import { enrichEtfShares } from './etf-shares.ts';
import { domesticBoardSchema, type DomesticBoard } from '@portfolio/market-data/domestic';
type Options = { now(): string; fetch?: typeof fetch; timeoutMs?: number };
// Small RMB product list; names are verified against the live public catalog.
const catalog = { etf: ['159501|纳指ETF嘉实','513870|纳指ETF富国','159696|纳指ETF易方达','159513|纳斯达克100ETF大成','159632|纳斯达克ETF华安','513390|纳指100ETF博时','159659|纳斯达克100ETF招商','159660|纳指ETF汇添富','159941|纳指ETF广发','513100|纳指ETF国泰','513110|纳指ETF华泰柏瑞','513300|纳斯达克ETF华夏','513500|标普500ETF博时','159612|标普500ETF国泰','513650|标普500ETF南方','159655|标普500ETF华夏'].map(value => { const [code, name] = value.split('|'); return { code, name }; }), fund: [{ code: '017730', name: '嘉实全球产业升级股票发起式(QDII)A' }] };
export class EastmoneyFundProvider {
  private options: Options;
  constructor(options: Options) { this.options = options; }
  private async read(url: string, referer: string): Promise<string> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 4000);
    try {
      const response = await (this.options.fetch ?? fetch)(url, { redirect: 'error', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer } });
      if (!response.ok) throw Error('CN_UNAVAILABLE');
      const reader = response.body?.getReader(); if (!reader) throw Error('CN_UNAVAILABLE');
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4_000_000) { await reader.cancel(); throw Error('CN_TOO_LARGE'); } chunks.push(value); }
      return Buffer.concat(chunks).toString('utf8');
    } finally { clearTimeout(timer); }
  }
  private async etfs(metadata: unknown[], fetchedAt: string): Promise<DomesticBoard> {
    const valid = catalog.etf.filter(item => metadata.some(row => Array.isArray(row) && row[0] === item.code && row[2] === item.name));
    const secids = valid.map(item => `${item.code.startsWith('5') ? 1 : 0}.${item.code}`).join(',');
    if (!secids) return { segment: 'etf', status: 'unavailable', reason: '产品目录暂不可核实', rows: [] };
    const payload = JSON.parse(await this.read(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fltt=2&fields=f12,f13,f14,f2,f3,f38,f402,f441,f297,f124`, 'https://quote.eastmoney.com/'));
    if (!Array.isArray(payload.data?.diff)) throw Error('CN_INVALID_QUOTES');
    const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const rows: DomesticBoard['rows'] = valid.map(item => {
      const sh = item.code.startsWith('5'), exchange = sh ? 'XSHG' : 'XSHE';
      const quote = payload.data.diff.find((row: any) => row.f12 === item.code && row.f14 === item.name && row.f13 === (sh ? 1 : 0));
      const dated = quote && typeof quote.f124 === 'number' && quote.f124 > 0 && quote.f124 * 1000 <= Date.parse(fetchedAt);
      const q = dated ? quote : {};
      const price = numeric(q.f2) !== null && q.f2 > 0 ? String(q.f2) : null;
      const tradeDate = price ? new Date(q.f124 * 1000 + 28800000).toISOString().slice(0, 10) : null;
      const referenceValue = numeric(q.f441) !== null && q.f441 > 0 ? String(q.f441) : null;
      // f402 is the vendor discount rate, so premium has the opposite sign.
      // It is a quoted reference, not our computed or time-aligned IOPV ratio.
      const quotedPremiumPct = price && referenceValue && numeric(q.f402) !== null ? -q.f402 : null;
      return { instrument: { instrument_key: `CN:${exchange}:${item.code}`, symbol: item.code, name: item.name, market: 'CN', currency: 'CNY', asset_type: 'ETF', exchange, provider_symbol: `${item.code}.${sh ? 'SH' : 'SZ'}`, provider_catalog_version: fetchedAt }, price, tradeDate, changePct: price ? numeric(q.f3) : null,
        nav: null, navDate: null, announcementDate: null, premiumPct: null, premiumLabel: '来源参考溢价，估值时点未知', source: '东方财富公开接口 · 延迟未知', fetchedAt, quality: price ? 'partial' : 'missing',
        metrics: { quotedPremiumPct, percentile60: null, sampleDays: 0, shares: numeric(q.f38) !== null && q.f38 >= 0 ? q.f38 : null, sharesDate: null, sharesChange: null, referenceValue, label: '来源参考溢价；非实时核验 IOPV' } };
    });
    let benchmarks: DomesticBoard['benchmarks'] = [];
    try {
      const payload = JSON.parse(await this.read('https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=100.SPX,100.NDX100,103.NQ00Y&fltt=2&fields=f12,f13,f14,f2,f3,f4,f124', 'https://quote.eastmoney.com/'));
      const definitions = [{ symbol: 'SPX', name: '标普500', market: 100 }, { symbol: 'NDX100', name: '纳斯达克100', market: 100 }, { symbol: 'NQ00Y', name: '小型纳指期货', market: 103 }];
      benchmarks = definitions.map(item => {
        const q = Array.isArray(payload.data?.diff) ? payload.data.diff.find((q: any) => q.f12 === item.symbol && q.f13 === item.market) : null;
        const valid = q && typeof q.f124 === 'number' && q.f124 > 0 && q.f124 * 1000 <= Date.parse(fetchedAt) && numeric(q.f2) !== null && q.f2 > 0;
        return { symbol: item.symbol, name: item.name, price: valid ? String(q.f2) : null, change: valid ? numeric(q.f4) : null, changePct: valid ? numeric(q.f3) : null, asOf: valid ? new Date(q.f124 * 1000).toISOString() : null, source: '东方财富 · 延迟未知' };
      });
    } catch { /* ETF data remains usable when benchmarks fail */ }
    const today = new Date(Date.parse(fetchedAt) + 28800000).toISOString().slice(0, 10);
    const [, tradingDates] = await Promise.all([enrichEtfShares(rows, this.read.bind(this), today), latestEtfTradingDates(this.read.bind(this), today)]);
    return domesticBoardSchema.parse({ tradingDates, benchmarks, segment: 'etf', status: rows.some(row => row.price) ? 'partial' : 'unavailable', reason: '参考行情，延迟未知；溢价为来源口径，估值时点未知；份额单位为万份。', rows });
  }
  async board(segment: 'etf' | 'fund'): Promise<DomesticBoard> {
    const fetchedAt = this.options.now(), today = new Date(Date.parse(fetchedAt) + 28800000).toISOString().slice(0, 10);
    const raw = await this.read('https://fund.eastmoney.com/js/fundcode_search.js', 'https://fund.eastmoney.com/');
    const metadata: unknown = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    if (!Array.isArray(metadata)) throw Error('CN_INVALID_CATALOG');
    if (String(segment) === 'etf') return this.etfs(metadata, fetchedAt);
    const rows: DomesticBoard['rows'] = [];
    for (const item of catalog[segment]) {
      if (!metadata.some(row => Array.isArray(row) && row[0] === item.code && row[2] === item.name)) continue;
      let price: string | null = null, tradeDate: string | null = null, changePct: number | null = null, nav: string | null = null, navDate: string | null = null;
      const positive = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && /^\d+(\.\d+)?$/.test(String(v)) && Number.isFinite(Number(v)) && Number(v) > 0 ? String(v) : null;
      if (segment === 'etf') try {
        const q = JSON.parse(await this.read(`https://push2delay.eastmoney.com/api/qt/stock/get?secid=1.${item.code}&fltt=2&fields=f57,f58,f43,f170,f86`, 'https://quote.eastmoney.com/')).data;
        if (q?.f57 !== item.code || q.f58 !== item.name || typeof q.f86 !== 'number' || q.f86 <= 0 || q.f86 * 1000 > Date.parse(fetchedAt)) throw Error('CN_INVALID_QUOTE');
        price = positive(q.f43); tradeDate = price ? new Date(q.f86 * 1000 + 28800000).toISOString().slice(0, 10) : null;
        changePct = price && typeof q.f170 === 'number' && Number.isFinite(q.f170) ? q.f170 : null;
      } catch { /* preserve explicit missing quote */ }
      try {
        const response = JSON.parse(await this.read(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${item.code}&pageIndex=1&pageSize=5`, `https://fundf10.eastmoney.com/jjjz_${item.code}.html`));
        const values = response.Data?.LSJZList;
        if (!Array.isArray(values)) throw Error('CN_INVALID_NAV');
        const value = values.filter(v => typeof v.FSRQ === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.FSRQ) && Number.isFinite(Date.parse(v.FSRQ)) && new Date(v.FSRQ).toISOString().slice(0, 10) === v.FSRQ && v.FSRQ <= today && positive(v.DWJZ)).sort((a,b) => b.FSRQ.localeCompare(a.FSRQ))[0];
        nav = positive(value?.DWJZ); navDate = nav ? value.FSRQ : null;
      } catch { /* preserve explicit missing NAV */ }
      const exchange = segment === 'etf' ? 'XSHG' : 'FUND';
      rows.push({ instrument: { instrument_key: `CN:${exchange}:${item.code}`, symbol: item.code, name: item.name, market: 'CN', currency: 'CNY', asset_type: segment === 'etf' ? 'ETF' : 'FUND', exchange, provider_symbol: `${item.code}.${segment === 'etf' ? 'SH' : 'OF'}`, provider_catalog_version: fetchedAt }, price, tradeDate, changePct, nav, navDate, announcementDate: null, premiumPct: null, premiumLabel: '公告时点未知，不计算溢价', source: '东方财富公开接口 · 行情延迟未知', fetchedAt, quality: price || nav ? 'partial' : 'missing' });
    }
    return domesticBoardSchema.parse({ segment, status: rows.some(row => row.quality !== 'missing') ? 'partial' : 'unavailable', reason: '有限人民币目录；公开参考行情，延迟未知；净值按净值日展示，非实时估值。', rows });
  }
}
