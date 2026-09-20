import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchMarketProvider } from '../src/market/research-provider.ts';
const now=()=> '2026-09-20T13:00:00.000Z';
const quote=Array(36).fill('');quote[1]='贵州茅台';quote[2]='600519';
test('CN minute series uses exchange timestamps and validates candles',async()=>{
 const response={code:0,data:{sh600519:{qt:{sh600519:quote},m5:[['202609181005','10','11','12','9','123']]}}};
 const p=new ResearchMarketProvider({now,fetch:(async u=>{assert.ok(String(u).includes('ifzq.gtimg.cn'));return new Response(JSON.stringify(response));}) as typeof fetch});
 const [r]=await p.load({market:'CN',symbol:'600519',period:'5min',auxiliary:[]});assert.equal(r.status,'available');assert.equal(r.bars[0].time,'2026-09-18T02:05:00.000Z');assert.equal(r.currency,'CNY');
 response.data.sh600519.m5[0][3]='8';assert.equal((await p.load({market:'CN',symbol:'600519',period:'5min',auxiliary:[]}))[0].status,'unavailable');
});
test('US intraday uses epoch time and excludes still forming bars',async()=>{
 const ts=[Date.parse('2026-09-18T15:00:00Z')/1000,Date.parse(now())/1000];
 const body={chart:{result:[{meta:{symbol:'NVDA',currency:'USD',exchangeName:'NMS'},timestamp:ts,indicators:{quote:[{open:[10,10],high:[12,12],low:[9,9],close:[11,11],volume:[1,1]}]}}]}};
 const p=new ResearchMarketProvider({now,fetch:(async()=>new Response(JSON.stringify(body))) as typeof fetch});
 const [r]=await p.load({market:'US',symbol:'NVDA',period:'1min',auxiliary:[]});assert.equal(r.status,'available');assert.equal(r.bars.length,1);
 body.chart.result[0].meta.currency='HKD';assert.equal((await p.load({market:'US',symbol:'NVDA',period:'1min',auxiliary:[]}))[0].status,'unavailable');
});
test('duplicate auxiliary periods and malformed market codes are rejected before fetching',async()=>{
 const p=new ResearchMarketProvider({now,fetch:(async()=>{throw Error('must not fetch');}) as typeof fetch});
 await assert.rejects(p.load({market:'HK',symbol:'AAPL',period:'1day',auxiliary:[]}));
 await assert.rejects(p.load({market:'CN',symbol:'600519',period:'5min',auxiliary:['5min']}));
});

test('US fallback parses JSONP without execution and resolves winter and summer exchange offsets',async()=>{
 const p=new ResearchMarketProvider({now,fetch:(async u=>{
  if(!String(u).includes('US_MinKService'))return new Response('{}',{status:429});
  return new Response('/* untrusted comment */\ndata=('+JSON.stringify([{d:'2026-02-18 16:00:00',o:'10',h:'12',l:'9',c:'11',v:'100'},{d:'2026-09-18 16:00:00',o:'10',h:'12',l:'9',c:'11',v:'100'}])+');');
 }) as typeof fetch});
 const [r]=await p.load({market:'US',symbol:'NVDA',period:'60min',auxiliary:[]});
 assert.equal(r.status,'available');assert.equal(r.provider,'新浪财经');assert.equal(r.timeLabel,'interval_end');
 assert.deepEqual(r.bars.map(b=>b.time),['2026-02-18T21:00:00.000Z','2026-09-18T20:00:00.000Z']);
});

test('HK real OHLC aggregation respects lunch break, session ends, and shares volume',async()=>{
 let calls=0;
 const p=new ResearchMarketProvider({now,fetch:(async()=>{calls++;return new Response(JSON.stringify({data:{code:'00700',market:116,name:'腾讯',trends:['2026-09-18 11:31,10,11,12,9,100','2026-09-18 12:00,11,12,13,10,200','2026-09-18 13:01,12,13,14,11,300','2026-09-18 14:00,13,14,15,12,400']}}));}) as typeof fetch});
 const [r,m]=await p.load({market:'HK',symbol:'00700',period:'60min',auxiliary:['1min']});assert.equal(calls,1);assert.equal(r.status,'available');assert.equal(r.bars.length,2);assert.equal(m.bars.length,4);
 assert.deepEqual(r.bars[0],{time:'2026-09-18T04:00:00.000Z',open:10,high:13,low:9,close:12,volume:300});assert.equal(r.bars[1].time,'2026-09-18T06:00:00.000Z');
});
