import { latestEtfTradingDates } from './etf-calendar.ts';
import { enrichEtfShares } from './etf-shares.ts';
import { parse } from 'node-html-parser';
import { domesticBoardSchema, domesticFundHoldingsSchema, domesticSearchResultSchema, type DomesticBoard, type DomesticFundHoldings, type DomesticSearchResult } from '@portfolio/market-data/domestic';
type Options = { now(): string; fetch?: typeof fetch; timeoutMs?: number };
// Small RMB product list; names are verified against the live public catalog.
const catalog = { etf: ['159501|纳指ETF嘉实','513870|纳指ETF富国','159696|纳指ETF易方达','159513|纳斯达克100ETF大成','159632|纳斯达克ETF华安','513390|纳指100ETF博时','159659|纳斯达克100ETF招商','159660|纳指ETF汇添富','159941|纳指ETF广发','513100|纳指ETF国泰','513110|纳指ETF华泰柏瑞','513300|纳斯达克ETF华夏','513500|标普500ETF博时','159612|标普500ETF国泰','513650|标普500ETF南方','159655|标普500ETF华夏'].map(value => { const [code, name] = value.split('|'); return { code, name }; }), fund: ['501312|华宝海外科技股票(QDII-LOF)A','016701|银华海外数字经济量化选股混合发起式(QDII)A','017091|景顺长城纳斯达克科技ETF联接(QDII)A人民币','017730|嘉实全球产业升级股票发起式(QDII)A','017436|华宝纳斯达克精选股票发起式(QDII)A','161128|易方达标普信息科技指数(QDII-LOF)A(人民币)','008253|华宝致远混合(QDII)A','001668|汇添富全球移动互联混合(QDII)人民币A','012920|易方达全球成长精选混合(QDII)人民币A','005698|华夏全球科技先锋混合(QDII)A(人民币)','006373|国富全球科技互联混合(QDII)人民币A','006555|浦银全球智能科技(QDII)A','270023|广发全球精选股票(QDII)人民币A','016664|天弘全球高端制造混合(QDII)A','501226|长城全球新能源车股票发起式(QDII)A','539002|建信新兴市场混合(QDII)A','017731|嘉实全球产业升级股票发起式(QDII)C','016452|南方纳斯达克100指数发起(QDII)A','016453|南方纳斯达克100指数发起(QDII)C','007721|天弘标普500发起(QDII-FOF)A','007722|天弘标普500发起(QDII-FOF)C'].map(value => { const [code, name] = value.split('|'); return { code, name }; }) };
const segmentOf = (code: string, name: string): 'etf' | 'fund' => /^(?:5\d{5}|159\d{3})$/.test(code) && /ETF/.test(name) && !/联接/.test(name) ? 'etf' : 'fund';
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
  private async metadata(): Promise<unknown[]> {
    const raw = await this.read('https://fund.eastmoney.com/js/fundcode_search.js', 'https://fund.eastmoney.com/');
    const data = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    if (!Array.isArray(data)) throw Error('CN_INVALID_CATALOG');
    return data;
  }
  async search(query: string, segment: 'etf' | 'fund'): Promise<DomesticSearchResult[]> {
    const needle = query.trim().toUpperCase();
    if (!needle || needle.length > 80) return [];
    return (await this.metadata()).filter((row): row is string[] => Array.isArray(row) && typeof row[0] === 'string' && /^\d{6}$/.test(row[0]) && typeof row[2] === 'string' && segmentOf(row[0], row[2]) === segment && `${row[0]} ${row[1] || ''} ${row[2]}`.toUpperCase().includes(needle)).slice(0, 20).map(row => domesticSearchResultSchema.parse({ code: row[0], name: row[2], segment }));
  }
  async holdings(code: string): Promise<DomesticFundHoldings> {
    if (!/^\d{6}$/.test(code)) throw Error('INVALID_FUND_CODE');
    const fetchedAt = this.options.now(), today = new Date(Date.parse(fetchedAt) + 28800000).toISOString().slice(0, 10);
    const response = await this.read(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`, `https://fundf10.eastmoney.com/ccmx_${code}.html`);
    const quoted = /^var apidata=\{\s*content:("(?:\\.|[^"\\])*")/.exec(response)?.[1];
    if (!quoted) throw Error('CN_HOLDINGS_INVALID');
    const document = parse(JSON.parse(quoted));
    let asOf: string | null = null, stocks: DomesticFundHoldings['stocks'] = [];
    for (const section of document.querySelectorAll('.boxitem')) {
      const date = section.querySelector('h4 font.px12')?.textContent.trim() ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || new Date(date).toISOString().slice(0, 10) !== date) continue;
      const table = section.querySelector('table');
      const headings = table?.querySelectorAll('thead th').map(cell => cell.textContent.trim()) ?? [];
      const weightIndex = headings.findIndex(label => label.includes('占净值比例'));
      if (weightIndex < 0) continue;
      const rows = table?.querySelectorAll('tbody tr') ?? [];
      const parsed = rows.slice(0, 10).map(row => {
        const cells = row.querySelectorAll('td'), rank = Number(cells[0]?.textContent.trim()), symbol = cells[1]?.textContent.trim().toUpperCase() ?? '', name = cells[2]?.textContent.trim() ?? '';
        const weightText = cells[weightIndex]?.textContent.trim() ?? '', weightPct = Number(weightText.replace('%', ''));
        return Number.isInteger(rank) && rank >= 1 && rank <= 10 && /^[A-Z0-9.-]{1,24}$/.test(symbol) && name && /^\d+(?:\.\d+)?%$/.test(weightText) && weightPct >= 0 && weightPct <= 100 ? { rank, symbol, name, weightPct } : null;
      }).filter((row): row is NonNullable<typeof row> => row !== null);
      if (parsed.length) { asOf = date; stocks = parsed; break; }
    }
    let allocation: DomesticFundHoldings['allocation'] = null;
    try {
      const script = await this.read(`https://fund.eastmoney.com/pingzhongdata/${code}.js`, `https://fund.eastmoney.com/${code}.html`);
      const raw = /var Data_assetAllocation\s*=\s*(\{[\s\S]*?\});/.exec(script)?.[1];
      const data = raw ? JSON.parse(raw) : null;
      const dates: unknown[] = data?.categories;
      let index = -1;
      if (Array.isArray(dates)) for (let i = 0; i < dates.length; i++) if (typeof dates[i] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dates[i] as string) && (dates[i] as string) <= today) index = i;
      if (index >= 0 && Array.isArray(data?.series)) {
        const value = (label: string) => { const number = data.series.find((series: any) => series?.name === label)?.data?.[index]; return typeof number === 'number' && number >= 0 && number <= 100 ? number : null; };
        allocation = { asOf: dates[index] as string, stocksPct: value('股票占净比'), bondsPct: value('债券占净比'), cashPct: value('现金占净比') };
      }
    } catch { /* Holdings remain useful without asset allocation. */ }
    return domesticFundHoldingsSchema.parse({ symbol: code, status: asOf ? 'available' : 'unavailable', reason: asOf ? '' : '尚无可核实的股票持仓披露。', asOf, fetchedAt, source: '天天基金公开基金档案', allocation, stocks });
  }
  private async etfs(metadata: unknown[], fetchedAt: string, items = catalog.etf): Promise<DomesticBoard> {
    const valid = items.filter(item => metadata.some(row => Array.isArray(row) && row[0] === item.code && row[2] === item.name));
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
  private async tencentEtfs(fetchedAt: string, items = catalog.etf): Promise<DomesticBoard> {
    const ids = items.map(item => `${item.code.startsWith('5') ? 'sh' : 'sz'}${item.code}`);
    const body = await this.read(`https://qt.gtimg.cn/q=${ids.join(',')}`, 'https://gu.qq.com/');
    const records = new Map<string, string[]>();
    for (const match of body.matchAll(/v_(sh|sz)(\d{6})="([^"]*)";/g)) records.set(`${match[1]}${match[2]}`, match[3].split('~'));
    const positive = (value: unknown) => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0 ? value : null;
    const numeric = (value: unknown) => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
    const rows: DomesticBoard['rows'] = items.map(item => {
      const sh = item.code.startsWith('5'), exchange = sh ? 'XSHG' : 'XSHE', row = records.get(`${sh ? 'sh' : 'sz'}${item.code}`);
      const stamp = row?.[30] ?? '', observedAt = /^\d{14}$/.test(stamp) ? Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)), Number(stamp.slice(8, 10)) - 8, Number(stamp.slice(10, 12)), Number(stamp.slice(12, 14))) : NaN;
      const valid = !!row && row[2] === item.code && row[82] === 'CNY' && Number.isFinite(observedAt) && observedAt <= Date.parse(fetchedAt) + 60_000;
      const price = valid ? positive(row[3]) : null, referenceValue = valid ? positive(row[78]) : null;
      const quotedPremiumPct = price && referenceValue ? numeric(row![77]) : null;
      return { instrument: { instrument_key: `CN:${exchange}:${item.code}`, symbol: item.code, name: item.name, market: 'CN', currency: 'CNY', asset_type: 'ETF', exchange, provider_symbol: `${item.code}.${sh ? 'SH' : 'SZ'}`, provider_catalog_version: fetchedAt }, price, tradeDate: price ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : null, changePct: price ? numeric(row![32]) : null,
        nav: null, navDate: null, announcementDate: null, premiumPct: null, premiumLabel: '来源参考溢价，估值时点未知', source: '腾讯财经公开接口 · 延迟未知', fetchedAt, quality: price ? 'partial' : 'missing',
        metrics: { quotedPremiumPct, percentile60: null, sampleDays: 0, shares: valid && /^\d+$/.test(row![72]) ? Number(row![72]) : null, sharesDate: null, sharesChange: null, referenceValue, label: '来源参考溢价；非实时核验 IOPV' } };
    });
    return domesticBoardSchema.parse({ tradingDates: [], benchmarks: [], segment: 'etf', status: rows.some(row => row.price) ? 'partial' : 'unavailable', reason: '主数据源暂不可用，已切换腾讯财经参考行情；延迟与估值时点未知。', rows });
  }
  async board(segment: 'etf' | 'fund', symbols?: string[]): Promise<DomesticBoard> {
    const fetchedAt = this.options.now(), today = new Date(Date.parse(fetchedAt) + 28800000).toISOString().slice(0, 10);
    let metadata: unknown[];
    try {
      metadata = await this.metadata();
      const items = symbols ? symbols.map(code => { const row = metadata.find(row => Array.isArray(row) && row[0] === code && typeof row[2] === 'string' && segmentOf(code, row[2]) === segment) as string[] | undefined; return row ? { code, name: row[2] } : null; }).filter((item): item is { code: string; name: string } => !!item) : catalog[segment];
      if (String(segment) === 'etf') {
        const primary = await this.etfs(metadata, fetchedAt, items);
        return primary.status === 'unavailable' ? await this.tencentEtfs(fetchedAt, items) : primary;
      }
      var selected = items;
    } catch (error) { if (String(segment) === 'etf') return this.tencentEtfs(fetchedAt, symbols ? catalog.etf.filter(item => symbols.includes(item.code)) : catalog.etf); throw error; }
    const rows: DomesticBoard['rows'] = [];
    for (const item of selected) {
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
        const growth = typeof value?.JZZZL === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.JZZZL) ? Number(value.JZZZL) : null;
        changePct = nav && growth !== null && Number.isFinite(growth) && growth >= -100 && growth <= 100 ? growth : null;
      } catch { /* preserve explicit missing NAV */ }
      let dailyLimit: DomesticBoard['rows'][number]['dailyLimit'] = null;
      if (segment === 'fund') try {
        const page = await this.read(`https://fund.eastmoney.com/${item.code}.html`, 'https://fund.eastmoney.com/');
        const purchaseSection = /<div class="buyWayStatic">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? '';
        const match = /单日累计购买上限\s*([\d,]+(?:\.\d{1,2})?)\s*(万)?元/.exec(purchaseSection);
        if (match && Number(match[1].replace(/,/g, '')) > 0) dailyLimit = { amount: String(Number(match[1].replace(/,/g, '')) * (match[2] ? 10000 : 1)), channel: 'eastmoney', fetchedAt };
      } catch { /* A missing limit must stay unknown. */ }
      const exchange = segment === 'etf' ? 'XSHG' : 'FUND';
      rows.push({ instrument: { instrument_key: `CN:${exchange}:${item.code}`, symbol: item.code, name: item.name, market: 'CN', currency: 'CNY', asset_type: segment === 'etf' ? 'ETF' : 'FUND', exchange, provider_symbol: `${item.code}.${segment === 'etf' ? 'SH' : 'OF'}`, provider_catalog_version: fetchedAt }, price, tradeDate, changePct, nav, navDate, announcementDate: null, premiumPct: null, premiumLabel: '公告时点未知，不计算溢价', source: '东方财富公开接口 · 行情延迟未知', fetchedAt, quality: price || nav ? 'partial' : 'missing', dailyLimit });
    }
    return domesticBoardSchema.parse({ segment, status: rows.some(row => row.quality !== 'missing') ? 'partial' : 'unavailable', reason: '有限人民币目录；公开参考行情，延迟未知；净值按净值日展示，非实时估值。', rows });
  }
}
