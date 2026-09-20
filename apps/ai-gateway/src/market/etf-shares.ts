import type { DomesticBoard } from '@portfolio/market-data/domestic';
type Read = (url: string, referer: string) => Promise<string>;
const amount = (v: unknown) => typeof v === 'string' && /^\d[\d,]*(\.\d+)?$/.test(v) && Number.isFinite(Number(v.replaceAll(',', ''))) ? Number(v.replaceAll(',', '')) * 10000 : null;
// Exchange reports use ten-thousand units. Keep full shares in the contract.
export async function enrichEtfShares(rows: DomesticBoard['rows'], read: Read, today: string) {
  try {
    const start = new Date(Date.parse(today) - 14 * 86400000).toISOString().slice(0, 10);
    const query = new URLSearchParams({ SHOWTYPE: 'JSON', CATALOGID: 'scsj_fund_jjgm', TABKEY: 'tab1', txtStart: start, txtEnd: today, jjlb: 'ETF', txtDm: '159501' });
    const calendar = JSON.parse(await read(`https://www.szse.cn/api/report/ShowReport/data?${query}`, 'https://www.szse.cn/market/fund/volume/etf/index.html'));
    const report = Array.isArray(calendar) ? calendar.find(item => item.metadata?.tabkey === 'tab1') : null;
    if (!Array.isArray(report?.data) || Number(report.metadata.recordcount) !== report.data.length) return;
    const dates: string[] = [...new Set<string>(report.data.filter((v: any) => typeof v.fund_code === 'string' && v.fund_code.trim() === '159501').map((v: any) => v.size_date).filter((v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today))].sort().slice(-3);
    if (dates.length < 2) return;
    const observations = new Map<string, { date: string; shares: number }[]>();
    const collect = (symbol: string, date: string, shares: number | null) => {
      if (!dates.includes(date) || shares === null || shares < 0 || !rows.some(row => row.instrument.symbol === symbol)) return;
      const list = observations.get(symbol) ?? []; if (!list.some(item => item.date === date)) list.push({ date, shares }); observations.set(symbol, list);
    };
    const tasks = dates.map(date => async () => {
      const params = new URLSearchParams({ isPagination: 'true', 'pageHelp.pageSize': '10000', 'pageHelp.pageNo': '1', sqlId: 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L', STAT_DATE: date });
      const payload = JSON.parse(await read(`https://query.sse.com.cn/commonQuery.do?${params}`, 'https://www.sse.com.cn/'));
      if (Array.isArray(payload.result)) for (const item of payload.result) if (item.STAT_DATE === date) collect(item.SEC_CODE, item.STAT_DATE, amount(item.TOT_VOL));
    });
    for (const row of rows.filter(row => row.instrument.exchange === 'XSHE')) tasks.push(async () => {
      const code = row.instrument.symbol;
      const params = new URLSearchParams({ SHOWTYPE: 'JSON', CATALOGID: 'scsj_fund_jjgm', TABKEY: 'tab1', txtStart: dates[0], txtEnd: dates.at(-1)!, jjlb: 'ETF', txtDm: code });
      const payload = JSON.parse(await read(`https://www.szse.cn/api/report/ShowReport/data?${params}`, 'https://www.szse.cn/market/fund/volume/etf/index.html'));
      const report = Array.isArray(payload) ? payload.find(item => item.metadata?.tabkey === 'tab1') : null;
      if (Array.isArray(report?.data)) for (const item of report.data) if (typeof item.fund_code === 'string' && item.fund_code.trim() === code) collect(code, item.size_date, amount(item.current_size));
    });
    // Bound upstream concurrency; each read also has its own timeout and byte limit.
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => { while (next < tasks.length) { const task = tasks[next++]; try { await task(); } catch { /* a failed exchange never removes a valid quote */ } } }));
    for (const row of rows) {
      if (!row.metrics) continue;
      const [current, previous] = (observations.get(row.instrument.symbol) ?? []).sort((a,b) => b.date.localeCompare(a.date));
      if (!current) continue;
      row.metrics.shares = current.shares; row.metrics.sharesDate = current.date;
      // Require adjacent observed trading dates; never compare across a missing report.
      const adjacent = previous && dates.indexOf(current.date) - dates.indexOf(previous.date) === 1;
      row.metrics.sharesChange = adjacent ? current.shares - previous.shares : null;
      row.metrics.sharesPreviousDate = adjacent ? previous.date : null;
      row.metrics.sharesSource = row.instrument.exchange === 'XSHG' ? '上海证券交易所' : '深圳证券交易所';
    }
  } catch { /* calendar unavailable: keep source shares with unknown change */ }
}
