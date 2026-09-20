import { domesticBoardSchema, domesticInstrumentSchema, type DomesticBoard } from '@portfolio/market-data/domestic';

type Row = Record<string, unknown>;
type Options = { token: string; cnyCodes: readonly string[]; now(): string; fetch?: typeof fetch; timeoutMs?: number };
const compactDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : null;
};
const decimal = (value: unknown): string | null => {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) && Number(text) > 0 ? text : null;
};
export class TushareFundProvider {
  private options: Options;
  constructor(options: Options) { this.options = options; }
  private async query(api_name: string, params: Record<string, string>, fields: string, deadline = Date.now() + 12000): Promise<Row[]> {
    if (Date.now() >= deadline) throw Error('CN_DEADLINE');
    if (!this.options.token) throw Error('CN_TOKEN_MISSING');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(this.options.timeoutMs ?? 4000, deadline - Date.now())));
    try {
      const response = await (this.options.fetch ?? fetch)('https://api.tushare.pro', { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_name, token: this.options.token, params, fields }) });
      if (!response.ok) throw Error('CN_PROVIDER_UNAVAILABLE');
      const raw = await response.text(); if (raw.length > 8_000_000) throw Error('CN_RESPONSE_TOO_LARGE');
      const value = JSON.parse(raw);
      // Provider messages can contain request details; never expose them.
      if (value.code !== 0) throw Error('CN_PROVIDER_ACCESS_OR_QUOTA');
      if (!Array.isArray(value.data?.fields) || !Array.isArray(value.data?.items) || value.data.items.length > 15000) throw Error('CN_INVALID_RESPONSE');
      const columns: string[] = value.data.fields;
      if (!fields.split(',').every(field => columns.includes(field))) throw Error('CN_INVALID_RESPONSE');
      return value.data.items.map((row: unknown) => {
        if (!Array.isArray(row) || row.length !== columns.length) throw Error('CN_INVALID_RESPONSE');
        return Object.fromEntries(columns.map((key, i) => [key, row[i]]));
      });
    } catch (error) { if (error instanceof Error && /^CN_/.test(error.message)) throw error; throw Error('CN_PROVIDER_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  async board(segment: 'etf' | 'fund'): Promise<DomesticBoard> {
    if (!this.options.cnyCodes.length) return { segment, status: 'unavailable', reason: '尚未配置已核实为人民币份额的产品目录。', rows: [] };
    const deadline = Date.now() + 12000;
    const fetchedAt = this.options.now(), today = new Date(Date.parse(fetchedAt) + 8 * 3600000).toISOString().slice(0, 10), market = segment === 'etf' ? 'E' : 'O';
    const metadata = await this.query('fund_basic', { market, status: 'L' }, 'ts_code,name,market,status,fund_type,benchmark', deadline);
    // Only explicit provider metadata in the supported RMB universe, no guessed default list.
    const catalog = metadata.flatMap(row => {
      if (!this.options.cnyCodes.includes(String(row.ts_code)) || row.market !== market || row.status !== 'L' || typeof row.ts_code !== 'string' || typeof row.name !== 'string' || /美元|美金|USD|港币|HKD/i.test(row.name)) return [];
      const match = /^(\d{6})\.(SH|SZ|OF)$/.exec(row.ts_code); if (!match) return [];
      if (segment === 'etf' ? !/ETF/i.test(row.name) || !/纳斯达克|纳指|NASDAQ|标普|S&P.?500/i.test(`${row.name} ${row.benchmark}`) : !/QDII/i.test(`${row.name} ${row.fund_type}`)) return [];
      if (segment === 'etf' && match[2] === 'OF' || segment === 'fund' && match[2] !== 'OF') return [];
      const exchange = segment === 'fund' ? 'FUND' : match[2] === 'SH' ? 'XSHG' : 'XSHE';
      return [domesticInstrumentSchema.parse({ instrument_key: `CN:${exchange}:${match[1]}`, symbol: match[1], name: row.name, market: 'CN', currency: 'CNY', asset_type: segment === 'etf' ? 'ETF' : 'FUND', exchange, provider_symbol: row.ts_code, provider_catalog_version: fetchedAt })];
    }).sort((a, b) => a.instrument_key.localeCompare(b.instrument_key)).slice(0, 12);
    const start_date = new Date(Date.parse(fetchedAt) - 30 * 86400000).toISOString().slice(0, 10).replaceAll('-', ''), end_date = today.replaceAll('-', '');
    const rows: DomesticBoard['rows'] = [];
    // Sequential requests bound load; failures stay local to the instrument.
    for (const instrument of catalog) {
      let navRows: Row[] = [], prices: Row[] = [];
      try { navRows = await this.query('fund_nav', { ts_code: instrument.provider_symbol, market, start_date, end_date }, 'ts_code,ann_date,nav_date,unit_nav', deadline); } catch { /* explicit missing state */ }
      if (segment === 'etf') try { prices = await this.query('fund_daily', { ts_code: instrument.provider_symbol, start_date, end_date }, 'ts_code,trade_date,close,pct_chg', deadline); } catch { /* NAV can remain readable */ }
      const navs = navRows.filter(row => row.ts_code === instrument.provider_symbol && compactDate(row.nav_date) && compactDate(row.ann_date) && compactDate(row.nav_date)! <= today && compactDate(row.ann_date)! <= today).sort((a, b) => String(b.nav_date).localeCompare(String(a.nav_date)) || String(b.ann_date).localeCompare(String(a.ann_date)));
      const daily = prices.filter(row => row.ts_code === instrument.provider_symbol && compactDate(row.trade_date) && compactDate(row.trade_date)! <= today).sort((a, b) => String(b.trade_date).localeCompare(String(a.trade_date)))[0];
      const price = decimal(daily?.close), tradeDate = compactDate(daily?.trade_date);
      const reference = segment === 'etf' ? navs.find(row => tradeDate && compactDate(row.nav_date)! <= tradeDate && compactDate(row.ann_date)! <= tradeDate) : navs[0];
      const nav = decimal(reference?.unit_nav), navDate = compactDate(reference?.nav_date), announcementDate = compactDate(reference?.ann_date);
      const pct = daily?.pct_chg, changePct = price && (typeof pct === 'number' || typeof pct === 'string' && /^-?\d+(\.\d+)?$/.test(pct)) && Number.isFinite(Number(pct)) ? Number(pct) : null;
      const premium = price && nav ? (Number(price) / Number(nav) - 1) * 100 : null;
      rows.push({ instrument, price, tradeDate: price ? tradeDate : null, changePct, nav, navDate: nav ? navDate : null, announcementDate: nav ? announcementDate : null,
        premiumPct: premium !== null && Number.isFinite(premium) ? premium : null, premiumLabel: segment === 'etf' ? '收盘价相对已公布净值（非实时）' : '', source: 'Tushare Pro · fund_basic / fund_daily / fund_nav', fetchedAt,
        quality: segment === 'etf' ? price && nav ? 'available' : price || nav ? 'partial' : 'missing' : nav ? 'available' : 'missing' });
    }
    return domesticBoardSchema.parse({ segment, status: rows.some(row => row.quality !== 'missing') ? rows.every(row => row.quality === 'available') ? 'available' : 'partial' : 'unavailable', reason: rows.length ? '有限目录，最多 12 项；日终行情及正式净值，不提供实时 IOPV。' : '没有取得符合范围的基金目录。', rows });
  }
}
