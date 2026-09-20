import { researchSelectionSchema, researchSeriesSchema, type ResearchSelection, type ResearchSeries } from '@portfolio/market-data/research';
import { EastmoneyUSProvider } from './eastmoney-us.ts';

const zones = { CN:'Asia/Shanghai',HK:'Asia/Hong_Kong',US:'America/New_York' };
const currencies = {CN:'CNY',HK:'HKD',US:'USD'} as const;
const minutes = {'1min':1,'5min':5,'15min':15,'30min':30,'60min':60,'1day':1440};
export class ResearchMarketProvider {
  private options: {now():string;fetch?:typeof fetch};
  constructor(options: {now():string;fetch?:typeof fetch}) { this.options=options; }
  private async json(url:string, jsonp = false) {
    const response=await (this.options.fetch??fetch)(url,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{'User-Agent':'Mozilla/5.0','Referer':'https://gu.qq.com/'}});
    if(!response.ok) throw Error(response.status===429?'数据源限流，请稍后重试':'数据源暂不可用');
    const reader=response.body?.getReader();if(!reader)throw Error('数据源无响应');
    let bytes=0;const parts:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1500000){await reader.cancel();throw Error('行情响应过大');}parts.push(value);}const body=Buffer.concat(parts).toString('utf8'); if(!jsonp)return JSON.parse(body); const match=body.match(/(?:^|\n)data=\(([\s\S]*)\);?\s*$/);if(!match)throw Error('行情响应格式无效');return JSON.parse(match[1]);
  }
  async load(input:ResearchSelection):Promise<ResearchSeries[]> {
    const selection=researchSelectionSchema.parse(input);
    // Resolve a US listing once; never choose an exchange by guessing its ticker.
    let usKey:string|undefined, usVendor:string|undefined;
    if(selection.market==='US'){
      const p=new EastmoneyUSProvider(this.options);
      const found=(await p.search(selection.symbol,10).catch(()=>[])).find(item=>item.symbol===selection.symbol);
      if(found){usKey=found.instrument_key;usVendor=`us${selection.symbol}.${found.mic==='XNAS'?'OQ':found.mic==='XNYS'?'N':'AM'}`;}
    }
    const hkMinutes=selection.market==='HK' && [selection.period,...selection.auxiliary].some(p=>p!=='1day') ? this.hkMinutes(selection.symbol).catch(()=>null) : null;
    return Promise.all([selection.period,...selection.auxiliary].map(async period=>{
      if(selection.market==='HK' && period!=='1day' && hkMinutes){const data=await hkMinutes;if(data){try{return this.aggregateHK({...selection,period},data);}catch{/* Try independent sources on invalid data. */}}}
      if(selection.market==='US' && period!=='1day') { try { return await this.yahoo({...selection,period},usKey); } catch { try { return await this.sinaUS({...selection,period},usKey); } catch(error) { return researchSeriesSchema.parse({market:selection.market,symbol:selection.symbol,name:selection.symbol,currency:currencies[selection.market],period,provider:'Yahoo Finance',adjustment:'split_adjusted',timezone:zones[selection.market],fetchedAt:this.options.now(),status:'unavailable',reason:error instanceof Error?error.message.slice(0,240):'行情暂不可用',bars:[]}); } } }
      try {return await this.tencent({...selection,period},usVendor);} catch {
        try{return await this.eastmoney({...selection,period},usKey);}catch { try { return await this.yahoo({...selection,period},usKey); } catch(error){return researchSeriesSchema.parse({market:selection.market,symbol:selection.symbol,name:selection.symbol,currency:currencies[selection.market],period,provider:'公开行情',adjustment:'unadjusted',timezone:zones[selection.market],fetchedAt:this.options.now(),status:'unavailable',reason:error instanceof Error?error.message.slice(0,240):'行情暂不可用',bars:[]});} }
      }
    }));
  }
  private async tencent(s:ResearchSelection,usVendor?:string):Promise<ResearchSeries>{
    const id=s.market==='US'?usVendor:s.market==='HK'?`hk${s.symbol}`:`${/^[569]/.test(s.symbol)?'sh':'sz'}${s.symbol}`;
    if(!id)throw Error('未确认美股交易所');
    const daily=s.period==='1day', period=daily?'day':`m${minutes[s.period]}`;
    const path=daily?(s.market==='US'?'usfqkline/get':'fqkline/get'):'kline/mkline';
    const param=daily?`${id},day,,,120,qfq`:`${id},${period},,120`;
    const payload=await this.json(`https://${daily?'web.ifzq.gtimg.cn':'ifzq.gtimg.cn'}/appstock/app/${path}?param=${encodeURIComponent(param)}`);
    const data=payload.data?.[id], quote=data?.qt?.[id], rows=data?.[daily?'qfqday':period]??(daily?data?.day:null);
    const expected=s.market==='US'?id.slice(2):s.symbol;
    if(payload.code!==0||quote?.[2]!==expected||!Array.isArray(rows)||!rows.length)throw Error('行情身份或周期不匹配');
    if(s.market==='US' && quote[35]!=='USD')throw Error('行情币种不匹配');
    const now=this.options.now(), today=new Intl.DateTimeFormat('en-CA',{timeZone:zones[s.market],year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
    // US minute strings have ambiguous DST/local semantics; use timestamped Yahoo data instead.
    if(!daily && s.market==='US')throw Error('需要带时区的分钟行情');
    const bars=rows.flatMap((r:any[])=>{
      const raw=String(r[0]); let time;
      if(daily){if(raw>=today)return [];time=`${raw}T00:00:00.000Z`;}
      else {const t=raw.replace(/[- :]/g,'');if(!/^\d{12}$/.test(t))throw Error('分钟时间格式无效');time=new Date(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:00+08:00`).toISOString();if(Date.parse(time)>Date.parse(now))return [];}
      return [{time,open:Number(r[1]),close:Number(r[2]),high:Number(r[3]),low:Number(r[4]),volume:r[5]==null?null:Number(r[5])}];
    }).slice(-120);
    return researchSeriesSchema.parse({market:s.market,symbol:s.symbol,name:quote[1],currency:currencies[s.market],period:s.period,provider:'腾讯财经',adjustment:daily&&data.qfqday?'forward_adjusted':'unadjusted',timezone:zones[s.market],volumeUnit:s.market==='CN'?'lots':'provider_native',timeLabel:daily?'trading_date':'interval_end',fetchedAt:now,status:'available',reason:'',bars});
  }
  private async eastmoney(s:ResearchSelection,usKey?:string):Promise<ResearchSeries>{
    const market=s.market==='CN'?(/^[569]/.test(s.symbol)?1:0):s.market==='HK'?116:usKey?.includes(':XNAS:')?105:usKey?.includes(':XNYS:')?106:usKey?.includes(':ARCX:')?107:null;
    if(market===null)throw Error('未确认交易所');
    const klt=s.period==='1day'?101:minutes[s.period];
    const payload=await this.json(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${encodeURIComponent(s.symbol)}&klt=${klt}&fqt=0&end=20500101&lmt=120&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`);
    const data=payload.data;if(data?.code!==s.symbol||Number(data.market)!==market||!Array.isArray(data.klines))throw Error('行情身份不匹配');
    const now=this.options.now();
    // Avoid interpreting unzoned US intraday strings; use a timestamped source.
    if(s.market==='US'&&s.period!=='1day')throw Error('需要带时区的分钟行情');
    const bars=data.klines.flatMap((line:string)=>{const [date,open,close,high,low,volume]=line.split(',');const time=new Date(date.length===10?date+'T00:00:00Z':date.replace(' ','T')+':00+08:00').toISOString();if(Date.parse(time)+minutes[s.period]*60000>Date.parse(now))return [];return [{time,open:Number(open),close:Number(close),high:Number(high),low:Number(low),volume:Number(volume)}];}).slice(-120);
    return researchSeriesSchema.parse({market:s.market,symbol:s.symbol,name:data.name||s.symbol,currency:currencies[s.market],period:s.period,provider:'东方财富',adjustment:'unadjusted',timezone:zones[s.market],volumeUnit:'provider_native',timeLabel:s.period==='1day'?'trading_date':'interval_end',fetchedAt:now,status:'available',reason:'',bars});
  }
  private async hkMinutes(symbol:string){
    const path=`/api/qt/stock/trends2/get?secid=116.${symbol}&ndays=5&iscr=0&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
    const payload=await this.json(`https://push2his.eastmoney.com${path}`).catch(()=>this.json(`https://push2delay.eastmoney.com${path}`));
    const d=payload.data;if(d?.code!==symbol||Number(d.market)!==116||!Array.isArray(d.trends)||!d.trends.length)throw Error('港股分钟行情身份不匹配');
    return d;
  }
  private aggregateHK(s:ResearchSelection,data:any):ResearchSeries{
    const now=this.options.now(), width=minutes[s.period];
    const grouped=new Map<string,{time:string;open:number;high:number;low:number;close:number;volume:number}>();
    let previous='';
    for(const line of data.trends){
      const [date,o,c,h,l,v]=String(line).split(',');
      if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date)||date<=previous)throw Error('港股分钟时间无效');previous=date;
      const minute=Number(date.slice(11,13))*60+Number(date.slice(14,16));
      const start=minute>=570&&minute<=720?570:minute>=780&&minute<=960?780:null;
      if(start===null)continue;
      const end=start===570?720:960;
      const bucket=width===1?minute:Math.min(end,start+Math.max(1,Math.ceil((minute-start)/width))*width);
      const time=new Date(`${date.slice(0,10)}T${String(Math.floor(bucket/60)).padStart(2,'0')}:${String(bucket%60).padStart(2,'0')}:00+08:00`).toISOString();
      if(Date.parse(time)>Date.parse(now))continue;
      const open=Number(o),high=Number(h),low=Number(l),close=Number(c),volume=Number(v);
      if(![open,high,low,close].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(volume)||volume<0||low>Math.min(open,close)||high<Math.max(open,close))throw Error('港股分钟价格无效');
      const prior=grouped.get(time);
      if(prior){prior.high=Math.max(prior.high,high);prior.low=Math.min(prior.low,low);prior.close=close;prior.volume+=volume;}
      else grouped.set(time,{time,open,high,low,close,volume});
    }
    return researchSeriesSchema.parse({market:'HK',symbol:s.symbol,name:data.name||s.symbol,currency:'HKD',period:s.period,provider:width===1?'东方财富':'东方财富 · 1分钟 K 线聚合',adjustment:'unadjusted',timezone:zones.HK,volumeUnit:'shares',timeLabel:'interval_end',fetchedAt:now,status:'available',reason:'',bars:[...grouped.values()].slice(-120)});
  }
  private async sinaUS(s:ResearchSelection,usKey?:string):Promise<ResearchSeries>{
    if(!usKey || s.market!=='US' || s.period==='1day')throw Error('未确认美股身份或周期');
    const rows=await this.json(`https://stock.finance.sina.com.cn/usstock/api/jsonp_v2.php/data=/US_MinKService.getMinK?symbol=${encodeURIComponent(s.symbol.toLowerCase())}&type=${minutes[s.period]}`,true);
    if(!Array.isArray(rows)||!rows.length)throw Error('该标的分钟行情暂不可用');
    const now=this.options.now();
    const bars=rows.flatMap((r:any)=>{
      if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.d))throw Error('分钟时间格式无效');
      // Sina labels interval ends in exchange local time. Resolve DST per bar,
      // not using the current offset (history can span the March transition).
      const nominal=Date.parse(r.d.replace(' ','T')+'Z');let epoch=nominal;
      for(let i=0;i<3;i++){
        const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch));
        const f=(name:string)=>parts.find(p=>p.type===name)!.value;
        const local=Date.parse(`${f('year')}-${f('month')}-${f('day')}T${f('hour')}:${f('minute')}:${f('second')}Z`);
        const next=epoch+nominal-local;if(next===epoch)break;epoch=next;
      }
      if(epoch>Date.parse(now))return [];
      return [{time:new Date(epoch).toISOString(),open:Number(r.o),high:Number(r.h),low:Number(r.l),close:Number(r.c),volume:r.v==null?null:Number(r.v)}];
    }).slice(-120);
    return researchSeriesSchema.parse({market:'US',symbol:s.symbol,name:s.symbol,currency:'USD',period:s.period,provider:'新浪财经',adjustment:'unadjusted',timezone:zones.US,volumeUnit:'shares',timeLabel:'interval_end',fetchedAt:now,status:'available',reason:'',bars});
  }
  private async yahoo(s:ResearchSelection,usKey?:string):Promise<ResearchSeries>{
    const ticker=s.market==='CN'?`${s.symbol}.${/^[569]/.test(s.symbol)?'SS':'SZ'}`:s.market==='HK'?`${s.symbol.replace(/^0/,'')}.HK`:s.symbol;
    const interval=s.period==='1day'?'1d':s.period.replace('min','m'), range=s.period==='1day'?'1y':s.period==='1min'?'5d':'1mo';
    const path=`/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
    const payload=await this.json(`https://query2.finance.yahoo.com${path}`).catch(()=>this.json(`https://query1.finance.yahoo.com${path}`));
    const result=payload.chart?.result?.[0], meta=result?.meta, q=result?.indicators?.quote?.[0];
    const exchanges=s.market==='CN'?['SHH','SHZ']:s.market==='HK'?['HKG']:usKey?.includes(':XNAS:')?['NMS','NGM','NCM']:usKey?.includes(':XNYS:')?['NYQ']:usKey?.includes(':ARCX:')?['PCX']:['NMS','NGM','NCM','NYQ','PCX'];
    if(meta?.symbol!==ticker||meta.currency!==currencies[s.market]||!exchanges.includes(meta.exchangeName)||!q||!Array.isArray(result.timestamp))throw Error('行情身份不匹配或没有该周期数据');
    const now=this.options.now(), today=new Intl.DateTimeFormat('en-CA',{timeZone:zones[s.market],year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
    const bars=result.timestamp.flatMap((t:number,i:number)=>{
      const time=new Date(t*1000).toISOString();if(t*1000+minutes[s.period]*60000>Date.parse(now))return [];
      if(s.period==='1day'&&new Intl.DateTimeFormat('en-CA',{timeZone:zones[s.market],year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time))>=today)return [];
      if([q.open[i],q.high[i],q.low[i],q.close[i]].some(v=>v==null))return [];
      return [{time,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i],volume:q.volume[i]??null}];
    }).slice(-120);
    return researchSeriesSchema.parse({market:s.market,symbol:s.symbol,name:meta.longName??meta.shortName??s.symbol,currency:currencies[s.market],period:s.period,provider:'Yahoo Finance',adjustment:'split_adjusted',timezone:zones[s.market],volumeUnit:'shares',timeLabel:s.period==='1day'?'trading_date':'interval_start',fetchedAt:now,status:'available',reason:'',bars});
  }
}
