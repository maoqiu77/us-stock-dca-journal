import test from 'node:test';
import assert from 'node:assert/strict';
import { latestEtfTradingDates } from '../src/market/etf-calendar.ts';
const dates = Array.from({length:60},(_,i)=>new Date(Date.UTC(2026,8,18-i)).toISOString().slice(0,10));
const read = (bad = '') => async (url: string) => {
 const page = Number(new URL(url).searchParams.get('PAGENO'));
 return JSON.stringify([{metadata:{tabkey:'tab1',pageno:bad==='page'?1:page,pagesize:20,recordcount:80},data:dates.slice((page-1)*20,page*20).map(date=>({fund_code:'159501',size_date:bad==='duplicate'?'2026-09-18':date}))}]);
};
test('calendar requires 3 verified contiguous pages of distinct dates',async()=>{
 const actual=await latestEtfTradingDates(read(),'2026-09-20');assert.equal(actual.length,60);assert.equal(actual[59],'2026-09-18');assert.ok(actual[0]<actual[59]);
 assert.deepEqual(await latestEtfTradingDates(read('page'),'2026-09-20'),[]);
 assert.deepEqual(await latestEtfTradingDates(read('duplicate'),'2026-09-20'),[]);
});
