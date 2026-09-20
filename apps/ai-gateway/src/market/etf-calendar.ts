type Read = (url: string, referer: string) => Promise<string>;
// The daily exchange report supplies observed trading dates; never infer holidays.
export async function latestEtfTradingDates(read: Read, today: string): Promise<string[]> {
  const start = new Date(Date.parse(today) - 120 * 86400000).toISOString().slice(0, 10);
  try {
    const pages = await Promise.all([1, 2, 3].map(async page => {
      const query = new URLSearchParams({ SHOWTYPE: 'JSON', CATALOGID: 'scsj_fund_jjgm', TABKEY: 'tab1', txtStart: start, txtEnd: today, jjlb: 'ETF', txtDm: '159501', PAGENO: String(page) });
      const payload = JSON.parse(await read(`https://www.szse.cn/api/report/ShowReport/data?${query}`, 'https://www.szse.cn/market/fund/volume/etf/index.html'));
      const report = Array.isArray(payload) ? payload.find(item => item.metadata?.tabkey === 'tab1') : undefined;
      if (report?.metadata?.pageno !== page || report.metadata.pagesize !== 20 || report.metadata.recordcount < 60 || !Array.isArray(report.data) || report.data.length !== 20) throw Error('CALENDAR_INCOMPLETE');
      return report.data.map((item: any) => {
        const date = item.size_date;
        if (typeof item.fund_code !== 'string' || item.fund_code.trim() !== '159501' || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date < start || date > today) throw Error('CALENDAR_INVALID');
        return date as string;
      });
    }));
    const dates = pages.flat();
    if (new Set(dates).size !== 60 || dates.some((date, index) => index && dates[index - 1] <= date)) return [];
    return dates.reverse();
  } catch { return []; }
}
