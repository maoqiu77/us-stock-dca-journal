import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGate } from './requests.ts';
import { matchesSegment } from './state.ts';
import { fetchBoard, saveSelection, searchInstruments, fetchDetail, fetchSeries } from './api.ts';
import type { Instrument } from './types.ts';
test('late board/search/detail/range completions cannot commit after replacement or cancellation',()=>{
 for(const scope of ['board','search','detail','range']) {
  const gate=createRequestGate(); const first=gate.start();const second=gate.start();
  assert.equal(first.signal.aborted,true,scope); assert.equal(first.isCurrent(),false); assert.equal(second.isCurrent(),true);
  gate.cancel();assert.equal(second.isCurrent(),false);
 }
});
test('segment filtering rejects cross-market ETF and fund identities',()=>{
 const item={market:'US',asset_type:'ETF'} as Instrument;
 assert.equal(matchesSegment(item,'us'),true);assert.equal(matchesSegment(item,'etf'),false);assert.equal(matchesSegment(item,'fund'),false);
});
test('API propagates abort, refresh and revision and does not silently swallow failures',async()=>{
 const original=globalThis.fetch;const calls:{url:string,init?:RequestInit}[]=[];
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),init});return new Response(JSON.stringify({items:[]}));};
 try {
  const signal=new AbortController().signal;
  await fetchBoard('etf',true,signal); await searchInstruments('纳指','CN','ETF',signal);
  await saveSelection('us',[],7,signal); await fetchDetail('US:XNAS:AAPL:STOCK',signal);await fetchSeries('US:XNAS:AAPL:STOCK','1d','3mo',signal);
  assert.match(calls[0].url,/refresh=true/);assert.equal(calls[0].init?.signal,signal);assert.match(calls[1].url,/asset_type=ETF/);
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)),{keys:[],expected_revision:7});assert.match(calls[4].url,/range=3mo/);
  globalThis.fetch=async()=>new Response('{}',{status:409});await assert.rejects(saveSelection('us',[],7),/409|其他页面/);
 } finally {globalThis.fetch=original;}
});
