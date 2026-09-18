import { TwelveDataProvider } from '../src/market/twelve-data-provider.ts';

const required = ['TWELVE_DATA_API_KEY', 'MARKET_FEED', 'MARKET_TIMELINESS', 'MARKET_COVERAGE', 'MARKET_ATTRIBUTION'];
const missing = required.filter(name => !String(process.env[name] ?? '').trim());
if (missing.length) throw Error(`blocked_by_configuration:${missing.join(',')}`);
const timeliness = process.env.MARKET_TIMELINESS;
if (!['realtime', 'delayed', 'eod'].includes(timeliness)) throw Error('invalid_MARKET_TIMELINESS');
const coverage = process.env.MARKET_COVERAGE;
if (!['consolidated', 'venue_subset', 'indicative', 'unknown'].includes(coverage)) throw Error('invalid_MARKET_COVERAGE');
const delaySeconds = process.env.MARKET_DELAY_SECONDS === undefined ? null : Number(process.env.MARKET_DELAY_SECONDS);
if (timeliness === 'delayed' && (!Number.isInteger(delaySeconds) || delaySeconds <= 0)) throw Error('invalid_MARKET_DELAY_SECONDS');
let calls = 0;
const provider = new TwelveDataProvider({ apiKey: process.env.TWELVE_DATA_API_KEY, feed: process.env.MARKET_FEED, coverage, timeliness, delaySeconds: timeliness === 'realtime' ? 0 : delaySeconds, attribution: process.env.MARKET_ATTRIBUTION, catalogVersion: process.env.MARKET_CATALOG_VERSION || new Date().toISOString().slice(0, 10), fetch: async (url, init) => { calls++; return fetch(url, init); } });
const requested = ['AAPL', 'QQQ', 'ZZZZZZZZZZZZZZZ'], resolved = [];
for (const symbol of requested) {
  const matches = await provider.search(symbol, 10);
  const exact = matches.find(item => item.symbol === symbol);
  resolved.push({ symbol, instrument_key: exact?.instrument_key ?? null, matches: matches.length });
}
const keys = resolved.flatMap(item => item.instrument_key ? [item.instrument_key] : []);
const quotes = keys.length ? await provider.quotes(keys) : [];
console.log(JSON.stringify({ ran_at: new Date().toISOString(), provider: 'Twelve Data', feed: process.env.MARKET_FEED, calls, resolved, quotes: quotes.map(item => ({ instrument_key: item.instrument_key, status: item.status, price: item.price, as_of: item.as_of, received_at: item.received_at, timeliness: item.timeliness, delay_seconds: item.delay_seconds, attribution: item.attribution })) }, null, 2));
