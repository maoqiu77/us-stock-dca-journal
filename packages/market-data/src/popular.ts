import type { CanonicalInstrument } from './contracts.ts';
// Curated identities, never sample prices. This list is not a live popularity ranking.
const stocks = [
  ['NVDA', '英伟达'], ['AMD', '美国超微公司'], ['SPY', '标普500ETF'], ['AAPL', '苹果'], ['GOOG', '谷歌-C'], ['QQQ', '纳指100ETF'], ['SMH', 'VanEck半导体ETF'],
  ['MSFT', '微软'], ['AMZN', '亚马逊'], ['META', 'Meta'], ['TSLA', '特斯拉'], ['AVGO', '博通'], ['TSM', '台积电'], ['PLTR', 'Palantir'], ['NFLX', '奈飞'], ['COIN', 'Coinbase'], ['MU', '美光科技'], ['INTC', '英特尔'], ['BABA', '阿里巴巴'], ['JPM', '摩根大通'], ['V', 'Visa'], ['WMT', '沃尔玛'], ['COST', '好市多'], ['GLD', '黄金ETF'], ['IWM', '罗素2000ETF'], ['DIA', '道琼斯ETF'], ['VOO', '先锋标普500ETF'], ['SOXX', 'iShares半导体ETF'], ['TQQQ', '三倍做多纳指ETF'], ['SQQQ', '三倍做空纳指ETF'],
];
const arca = new Set(['SPY', 'GLD', 'IWM', 'DIA', 'VOO']);
const nyse = new Set(['TSM', 'BABA', 'JPM', 'V']);
const etfs = new Set([...arca, 'QQQ', 'SMH', 'SOXX', 'TQQQ', 'SQQQ']);
export const popularUS: CanonicalInstrument[] = stocks.map(([symbol, name]) => {
  const mic = arca.has(symbol) ? 'ARCX' : nyse.has(symbol) ? 'XNYS' : 'XNAS';
  return { schema_version: 1, instrument_key: `US:${mic}:${symbol}`, symbol, name, mic, exchange: mic === 'ARCX' ? 'NYSE Arca' : mic === 'XNYS' ? 'NYSE' : 'NASDAQ', market: 'US', currency: 'USD', asset_type: etfs.has(symbol) ? 'ETF' : 'STOCK', provider_symbol: symbol, provider_catalog_version: 'curated-2026-09-20', status: 'active' };
});
