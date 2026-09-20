import type { DomesticBoard } from '@portfolio/market-data/domestic';
import type { MarketCachePort } from './ports.ts';
type Observation = { date: string; premium: number };
export async function enrichEtfHistory(board: DomesticBoard, cache: MarketCachePort, now: string): Promise<DomesticBoard> {
  if (board.segment !== 'etf') return board;
  await Promise.all(board.rows.map(async row => {
    if (!row.metrics || row.metrics.quotedPremiumPct === null || !row.tradeDate) return;
    const key = `cn-premium-history:eastmoney-discount-v1:${row.instrument.instrument_key}`;
    const record = await cache.get(key).catch(() => undefined);
    const observations: Observation[] = Array.isArray(record?.value) ? record.value.filter((v: any) => v && typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && Number.isFinite(Date.parse(v.date)) && new Date(v.date).toISOString().slice(0,10) === v.date && Date.parse(v.date) >= Date.parse(now) - 120 * 86400000 && v.date < row.tradeDate! && typeof v.premium === 'number' && Number.isFinite(v.premium)) : [];
    const unique = new Map(observations.map(item => [item.date, item]));
    unique.set(row.tradeDate, { date: row.tradeDate, premium: row.metrics.quotedPremiumPct });
    const recent = [...unique.values()].sort((a,b) => a.date.localeCompare(b.date)).slice(-60);
    const dates = board.tradingDates ?? [];
    const validWindow = dates.length === 60 && new Set(dates).size === 60 && dates.every((date, i) => !i || dates[i - 1] < date) && dates[59] === row.tradeDate;
    const byDate = new Map(recent.map(item => [item.date, item]));
    const window = validWindow ? dates.flatMap(date => byDate.get(date) ?? []) : [];
    row.metrics.sampleDays = validWindow ? window.length : recent.length;
    // A complete window must cover every exchange date, not just any 60 samples.
    row.metrics.percentile60 = window.length === 60 ? window.filter(item => item.premium <= row.metrics!.quotedPremiumPct!).length / 60 * 100 : null;
    const until = new Date(Date.parse(now) + 120 * 86400000).toISOString();
    await cache.put(key, recent, until, until).catch(() => undefined);
  }));
  return board;
}
