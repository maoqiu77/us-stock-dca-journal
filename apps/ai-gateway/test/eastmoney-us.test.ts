import test from 'node:test';
import assert from 'node:assert/strict';
import { EastmoneyUSProvider } from '../src/market/eastmoney-us.ts';
const now=()=> '2026-09-20T00:00:00Z';
const provider=(q: object)=>new EastmoneyUSProvider({now,fetch:(async(url)=>new Response(JSON.stringify(String(url).includes('suggest') ? {QuotationCodeTable:{Data:[]}} : {data:{diff:[q]}}))) as typeof fetch});
const q={f12:'NVDA',f13:105,f2:222.27,f3:1.34,f4:2.93,f18:219.34,f124:1789761600};
test('public US quote has actual amount, NY date and unknown delay without fake realtime',async()=>{
 const [r]=await provider(q).quotes(['US:XNAS:NVDA']);assert.equal(r.price,'222.27');assert.equal(r.change,'2.93');assert.equal(r.trading_date,'2026-09-18');assert.equal(r.timeliness,'unknown');assert.equal(r.session,'unknown');assert.equal(r.previous_close_date,null);
});
test('wrong exchange, future time and unavailable instrument cannot create observations',async()=>{
 for(const override of [{f13:106},{f124:9999999999},{f2:0}]){const[r]=await provider({...q,...override}).quotes(['US:XNAS:NVDA']);assert.equal(r.status,'unavailable');assert.equal(r.price,null);assert.equal(r.change,null);}
 const[r]=await provider(q).quotes(['US:XNAS:NOTREAL']);assert.equal(r.status,'unavailable');
});
test('public search uses curated exchange identities and rejects malformed history',async()=>{
 const p=provider(q);assert.equal((await p.search('标普500',10))[0].mic,'ARCX');assert.equal((await p.search('unknown',10)).length,0);await assert.rejects(p.bars('US:XNAS:NVDA','1M','1day'), /PUBLIC_HISTORY_INVALID/);
});
test('a non-default stock can be searched, quoted and restored in a fresh server instance', async () => {
 const record = { Code:'ORCL',Name:'甲骨文',JYS:'NYSE',MktNum:'106',QuoteID:'106.ORCL',TypeUS:'1',Classify:'UsStock' };
 const urls: string[] = [];
 const fetcher = (async (url: string) => { urls.push(url); return new Response(JSON.stringify(url.includes('suggest') ? {QuotationCodeTable:{Data:[record]}} : {data:{diff:[{...q,f12:'ORCL',f13:106}]}})); }) as typeof fetch;
 const first = new EastmoneyUSProvider({now,fetch:fetcher});
 const [item] = await first.search('甲骨文',10); assert.equal(item.instrument_key,'US:XNYS:ORCL');
 const [quote] = await first.quotes([item.instrument_key]); assert.equal(quote.status,'available');
 const restored = new EastmoneyUSProvider({now,fetch:fetcher}); assert.equal((await restored.quotes([item.instrument_key]))[0].status,'available');
 assert.ok(urls.some(url => url.includes('input=ORCL')));
 assert.ok(urls.some(url => url.includes(encodeURIComponent('甲骨文'))));
});
test('remote catalog excludes wrong market, ambiguous MIC, preferred shares and malformed identity', async () => {
 const base = {Code:'ORCL',Name:'甲骨文',JYS:'NYSE',MktNum:'106',QuoteID:'106.ORCL',TypeUS:'1',Classify:'UsStock'};
 const records = [{...base,Classify:'Fund'}, {...base,TypeUS:'2'}, {...base,QuoteID:'105.ORCL'}, {...base,JYS:'AMEX',MktNum:'107',QuoteID:'107.ORCL'}, {...base,Code:'../ORCL'}];
 const p=new EastmoneyUSProvider({now,fetch:(async()=>new Response(JSON.stringify({QuotationCodeTable:{Data:records}}))) as typeof fetch});
 assert.deepEqual(await p.search('ORCL',10),[]);
});

test('daily history validates identity and excludes ongoing dates', async () => {
 const payload = {data:{code:'NVDA',market:105,klines:['2026-09-18,219.35,222.27,222.73,218.03,190287428','2026-09-19,222,223,224,220,100']}};
 const p = new EastmoneyUSProvider({now,fetch:(async()=>new Response(JSON.stringify(payload))) as typeof fetch});
 const result = await p.bars('US:XNAS:NVDA','1Y','1day');
 assert.equal(result.bars.length,1); assert.equal(result.bars[0].close,'222.27'); assert.equal(result.adjustment,'unadjusted');
 payload.data.market=106; await assert.rejects(p.bars('US:XNAS:NVDA','1Y','1day'),/PUBLIC_HISTORY_INVALID/);
 payload.data.market=105;payload.data.klines=['2026-09-18,220,222,219,218,100'];await assert.rejects(p.bars('US:XNAS:NVDA','1Y','1day'));
});
test('history fallback validates exchange and labels split adjusted prices', async () => {
 const data={chart:{result:[{meta:{symbol:'NVDA',currency:'USD',exchangeName:'NMS'},timestamp:[1789738200],indicators:{quote:[{open:[219.35],high:[222.73],low:[218.03],close:[222.27],volume:[190287428]}]}}]}};
 const p=new EastmoneyUSProvider({now,fetch:(async u=>{if(String(u).includes('eastmoney'))throw Error('connection_closed');return new Response(JSON.stringify(data));}) as typeof fetch});
 const r=await p.bars('US:XNAS:NVDA','1Y','1day');assert.equal(r.status,'available');assert.equal(r.adjustment,'split_adjusted');assert.equal(r.provider,'Yahoo Finance');
 data.chart.result[0].meta.exchangeName='NYQ';await assert.rejects(p.bars('US:XNAS:NVDA','1Y','1day'),/PUBLIC_HISTORY_INVALID/);
});
test('Tencent history verifies vendor symbol and currency and preserves forward adjustment', async () => {
 const quote = Array(36).fill(''); quote[2]='NVDA.OQ';quote[35]='USD';
 const payload={code:0,data:{'usNVDA.OQ':{qt:{'usNVDA.OQ':quote},qfqday:[['2026-09-18','219.35','222.27','222.73','218.03','190287428.00']]}}};
 const p=new EastmoneyUSProvider({now,fetch:(async u=>{if(!String(u).includes('gtimg'))throw Error('unavailable');return new Response(JSON.stringify(payload));}) as typeof fetch});
 const r=await p.bars('US:XNAS:NVDA','1Y','1day');assert.equal(r.provider,'腾讯财经');assert.equal(r.adjustment,'forward_adjusted');assert.equal(r.bars[0].volume,'190287428');
 quote[35]='CNY';await assert.rejects(p.bars('US:XNAS:NVDA','1Y','1day'));
});
