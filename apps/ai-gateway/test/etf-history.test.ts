import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichEtfHistory } from '../src/market/etf-history.ts';
import { enrichEtfShares } from '../src/market/etf-shares.ts';
import { createMemoryMarketInfrastructure } from '../src/market/ports.ts';
import type { DomesticBoard } from '@portfolio/market-data/domestic';
const board = (date: string, premium = 10): DomesticBoard => ({ tradingDates: Array.from({length:60},(_,i)=>new Date(Date.UTC(2026,5,i+1)).toISOString().slice(0,10)), segment: 'etf', status: 'partial', reason: '', rows: [{ instrument: { instrument_key: 'CN:XSHE:159501', symbol: '159501', name: '纳指ETF嘉实', market: 'CN', currency: 'CNY', asset_type: 'ETF', exchange: 'XSHE', provider_symbol: '159501.SZ', provider_catalog_version: '2026-09-20T00:00:00Z' }, price: '2', tradeDate: date, changePct: 1, nav: null, navDate: null, announcementDate: null, premiumPct: null, premiumLabel: '', source: 'test', fetchedAt: '2026-09-20T00:00:00Z', quality: 'partial', metrics: { quotedPremiumPct: premium, percentile60: null, sampleDays: 0, shares: 1, sharesChange: null, sharesDate: date, referenceValue: '1.8', label: '' } }] });
test('percentile needs 60 distinct dates and repeated intraday reads do not inflate sample', async () => {
 const {cache} = createMemoryMarketInfrastructure(() => '2026-09-20T00:00:00Z');
 let result;
 for (let i=0;i<60;i++) { const date = new Date(Date.UTC(2026, 5, i+1)).toISOString().slice(0,10); result = await enrichEtfHistory(board(date,i),cache,'2026-09-20T00:00:00Z'); if(i<59) assert.equal(result.rows[0].metrics?.percentile60,null); }
 assert.equal(result!.rows[0].metrics?.percentile60,100); assert.equal(result!.rows[0].metrics?.sampleDays,60);
 const repeated=await enrichEtfHistory(board(result!.rows[0].tradeDate!,0),cache,'2026-09-20T00:00:00Z'); assert.equal(repeated.rows[0].metrics?.sampleDays,60); assert.equal(repeated.rows[0].metrics?.percentile60,2 / 60 * 100);
});
test('exchange shares use same-source adjacent report dates and correct units', async () => {
 const b=board('2026-09-18'); const data=[{fund_code:'159501 ',size_date:'2026-09-18',current_size:'678,698.65'},{fund_code:'159501',size_date:'2026-09-17',current_size:'678,598.65'}];
 await enrichEtfShares(b.rows,async url => url.includes('szse') ? JSON.stringify([{metadata:{tabkey:'tab1',recordcount:2},data}]) : JSON.stringify({result:[]}), '2026-09-20');
 assert.equal(b.rows[0].metrics?.shares,6786986500); assert.equal(b.rows[0].metrics?.sharesChange,1000000); assert.equal(b.rows[0].metrics?.sharesPreviousDate,'2026-09-17');
});

test('60 saved observations are insufficient without a complete matching exchange window', async () => {
 const {cache} = createMemoryMarketInfrastructure(() => '2026-09-20T00:00:00Z');
 for (let i=0;i<60;i++) { const b = board(new Date(Date.UTC(2026,5,i+1)).toISOString().slice(0,10),i); delete b.tradingDates; const result = await enrichEtfHistory(b,cache,'2026-09-20T00:00:00Z'); assert.equal(result.rows[0].metrics?.percentile60,null); }
 const missing = board('2026-07-30'); missing.tradingDates![0]='2026-05-31';
 assert.equal((await enrichEtfHistory(missing,cache,'2026-09-20T00:00:00Z')).rows[0].metrics?.percentile60,null);
});
