"use client";
import * as React from "react";
import {RefreshCw, Search, Settings2, ArrowUp, ArrowDown, ChevronsUp, X} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card,CardContent} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Tabs,TabsList,TabsTrigger} from "@/components/ui/tabs";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {fetchBoard,saveSelection,searchInstruments} from "./api";
import {useResource} from "./use-resource";
import {matchesSegment,moveSelection,selectionNeedsReload,sortRows} from "./state";
import {formatFetchedAt,formatPercent,metaSummary} from "./format";
import type {Instrument,Segment} from "./types";
import {BoardRows} from "./board-rows";
import {InstrumentDetail} from "./instrument-detail";

const labels={us:"美股",etf:"场内 ETF",fund:"场外基金"};
export function MarketBoardView({marketRefreshKey=0}:{marketRefreshKey?:number}) {
 const [segment,setSegment]=React.useState<Segment>("us");
 return <div className="flex min-w-0 flex-col gap-4" data-testid="market-board">
  <div><h1 className="text-2xl font-semibold">多市场看板</h1><p className="mt-1 text-sm text-muted-foreground">自选独立保存；移除与清空不修改持仓、交易记录或策略股票池。</p></div>
  <Tabs value={segment} onValueChange={value=>setSegment(value as Segment)}><TabsList className="grid w-full grid-cols-3 sm:w-fit"><TabsTrigger value="us">美股</TabsTrigger><TabsTrigger value="etf">场内 ETF</TabsTrigger><TabsTrigger value="fund">场外基金</TabsTrigger></TabsList></Tabs>
  <SegmentBoard key={segment} segment={segment} marketRefreshKey={marketRefreshKey}/>
 </div>;
}
function SegmentBoard({segment,marketRefreshKey}:{segment:Segment;marketRefreshKey:number}) {
 const [refresh,setRefresh]=React.useState(0),[revision,setRevision]=React.useState(0);
 const [query,setQuery]=React.useState(""),[managing,setManaging]=React.useState(false),[confirmClear,setConfirmClear]=React.useState(false);
 const [detailKey,setDetailKey]=React.useState<string|null>(null);
 const [saving,setSaving]=React.useState(false),[mutationError,setMutationError]=React.useState<string|null>(null);
 const [selectionKeys,setSelectionKeys]=React.useState<string[]|null>(null),draggedKey=React.useRef<string|null>(null),selectionRevision=React.useRef<number|null>(null);
 const savingRef=React.useRef(false);
 const [sort,setSort]=React.useState({field:"",ascending:true});
 const boardLoader=React.useCallback((signal:AbortSignal)=>fetchBoard(segment,refresh>0,signal),[segment,refresh]);
 const board=useResource(segment+":"+marketRefreshKey+":"+refresh+":"+revision,boardLoader);
 const trimmed=query.trim();
 const searchLoader=React.useCallback((signal:AbortSignal)=>trimmed ? searchInstruments(trimmed,segment==="us"?"US":"CN",segment==="us"?undefined:segment==="etf"?"ETF":"FUND",signal) : Promise.resolve({items:[]}),[trimmed,segment]);
 const search=useResource(segment+":"+trimmed,searchLoader,trimmed?300:0);
 const data=board.data;
 React.useEffect(()=>{if(data&&!savingRef.current&&(selectionRevision.current===null||data.revision>=selectionRevision.current)){setSelectionKeys(null);selectionRevision.current=data.revision;}},[data]);
 const keys=selectionKeys??data?.rows.map(row=>row.instrument.key)??[];
 const update=async(next:string[])=>{
  if(!data || savingRef.current)return;
  const previous=keys;
  setSelectionKeys(next);
  savingRef.current=true;setSaving(true);setMutationError(null);
  const expectedRevision=selectionRevision.current??data.revision;
  try {const saved=await saveSelection(segment,next,expectedRevision);selectionRevision.current=saved.revision;setQuery("");if(selectionNeedsReload(next,data.rows))setRevision(v=>v+1);}
  catch(error){setSelectionKeys(previous);selectionRevision.current=null;setMutationError(error instanceof Error?error.message:"保存失败");setRevision(v=>v+1);}
  finally{savingRef.current=false;setSaving(false);}
 };
 const add=(item:Instrument)=>{if(matchesSegment(item,segment)&&!keys.includes(item.key))void update([...keys,item.key]);};
 const ordered=data ? keys.map(key=>data.rows.find(row=>row.instrument.key===key)).filter((row):row is NonNullable<typeof row>=>Boolean(row)) : [];
 const sorted=data ? managing||!sort.field ? ordered : sortRows(ordered,sort.field,sort.ascending) : [];
 const sortBy=(field:string)=>setSort(current=>({field,ascending:current.field===field?!current.ascending:true}));
 const dropRow=(targetKey:string)=>{const sourceKey=draggedKey.current;draggedKey.current=null;if(!sourceKey||sourceKey===targetKey)return;const targetIndex=keys.indexOf(targetKey);if(targetIndex>=0)void update(moveSelection(keys,sourceKey,targetIndex));};
 return <>
  <Card className="min-w-0"><CardContent className="flex min-w-0 flex-col gap-4 pt-5">
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{labels[segment]} <span className="text-xs font-normal text-muted-foreground">{data?keys.length:"--"} 个自选</span></h2><div className="flex gap-2"><Button variant="outline" size="sm" disabled={board.loading||saving} onClick={()=>{selectionRevision.current=null;setRefresh(v=>v+1);}}><RefreshCw className={board.loading?"animate-spin":""}/>刷新</Button><Button variant={managing?"secondary":"outline"} size="sm" onClick={()=>setManaging(v=>!v)}><Settings2/>{managing?"完成管理":"管理"}</Button></div></div>
   <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input aria-label="搜索名称或代码" placeholder={segment==="fund"?"搜索人民币基金名称或代码（保留 A/C 份额）":"搜索名称或代码"} value={query} maxLength={80} onChange={event=>setQuery(event.target.value)} className="w-full pl-9"/></div>
   {trimmed?<div className="grid gap-1 rounded-md border p-2" aria-live="polite">{search.loading?<p className="p-2 text-sm">搜索中…</p>:search.error?<p role="alert" className="text-destructive">{search.error}</p>:search.data?.items.filter(item=>matchesSegment(item,segment)).length ? search.data.items.filter(item=>matchesSegment(item,segment)).map(item=><Button className="h-auto justify-start whitespace-normal py-2 text-left" key={item.key} variant="ghost" disabled={saving||!data||keys.includes(item.key)} onClick={()=>add(item)}>{item.symbol} · {item.name} {keys.includes(item.key)?"已自选":"＋添加"}</Button>):<p className="p-2 text-sm text-muted-foreground">当前板块无匹配结果；场外仅收录已核实人民币份额。</p>}</div>:null}
   {mutationError||board.error?<p role="alert" className="text-sm text-destructive">{mutationError??board.error}</p>:null}
   {data?.warnings.map(warning=><p key={warning} className="rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">{warning}</p>)}
   {segment==="fund"?<p className="text-xs leading-5 text-muted-foreground">正式净值不是盘中价格；限额仅代表天天基金渠道。</p>:segment==="etf"?<p className="text-xs leading-5 text-muted-foreground">参考溢价不是实时溢价；缺同步 NAV / IOPV 时显示“不可计算”。</p>:null}
   {data?<p className="break-words text-xs leading-5 text-muted-foreground">更新于 {formatFetchedAt(data.fetched_at)} · {segment==="fund"?"净值日期":"行情日期"}：{[...new Set(data.rows.map(row=>segment==="fund"?row.nav?.nav_date:row.quote?.trading_date).filter(Boolean))].sort().join(" / ")||"未知"}</p>:null}
   {managing?<div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"><span className="text-xs leading-5 text-muted-foreground">拖拽行或使用箭头调整自选顺序。</span><Button size="sm" variant="destructive" disabled={!keys.length||saving} onClick={()=>setConfirmClear(true)}>清空当前自选</Button></div>:null}
   {board.loading?<p role="status" className="py-10 text-center text-sm text-muted-foreground">正在加载{labels[segment]}…</p>:data&&!data.rows.length?<p role="status" className="py-10 text-center text-sm text-muted-foreground">暂无自选，搜索名称或代码添加。清空后不会自动恢复默认列表。</p>:data?<BoardRows segment={segment} rows={sorted} sort={sort} onSort={sortBy} onOpen={setDetailKey} managing={managing} onDragStart={key=>{draggedKey.current=key;}} onDropRow={dropRow} actions={row=>{const index=keys.indexOf(row.instrument.key);return <div className="flex flex-wrap justify-end gap-1"><Button variant="ghost" size="icon-sm" aria-label={"置顶 "+row.instrument.symbol} disabled={saving||index===0} onClick={()=>void update(moveSelection(keys,row.instrument.key,0))}><ChevronsUp/></Button><Button variant="ghost" size="icon-sm" aria-label={"上移 "+row.instrument.symbol} disabled={saving||index===0} onClick={()=>void update(moveSelection(keys,row.instrument.key,index-1))}><ArrowUp/></Button><Button variant="ghost" size="icon-sm" aria-label={"下移 "+row.instrument.symbol} disabled={saving||index===keys.length-1} onClick={()=>void update(moveSelection(keys,row.instrument.key,index+1))}><ArrowDown/></Button><Button variant="ghost" size="icon-sm" aria-label={"移除 "+row.instrument.symbol} disabled={saving} onClick={()=>void update(keys.filter(key=>key!==row.instrument.key))}><X/></Button></div>;}}/>:null}
  </CardContent></Card>
  {data?.benchmarks.length?<div className="grid min-w-0 gap-2 sm:grid-cols-3">{data.benchmarks.map(item=><Card key={item.symbol}><CardContent className="grid gap-1 pt-4 text-xs"><span className="font-medium">{item.name} · {item.kind==="future"?"期货":"指数"}</span><span>{item.quote.price??"--"} · {formatPercent(item.quote.change_pct)}</span><span className="break-all text-muted-foreground">{metaSummary(item.quote.meta)}</span></CardContent></Card>)}</div>:null}
  <Dialog open={confirmClear} onOpenChange={setConfirmClear}><DialogContent><DialogHeader><DialogTitle>清空{labels[segment]}自选？</DialogTitle><DialogDescription>仅移除当前板块关注关系，不删除持仓、交易、策略或行情历史。</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setConfirmClear(false)}>取消</Button><Button variant="destructive" disabled={saving} onClick={()=>{setConfirmClear(false);void update([]);}}>确认清空</Button></div></DialogContent></Dialog>
  {detailKey?<InstrumentDetail key={detailKey} instrumentKey={detailKey} onClose={()=>setDetailKey(null)}/>:null}
 </>;
}
