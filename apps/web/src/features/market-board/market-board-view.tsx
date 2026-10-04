"use client";
import * as React from "react";
import {RefreshCw, Search, Settings2, ArrowUp, ArrowDown, ChevronsUp, X, Clock3, Info, Check, ListFilter} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card,CardContent} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Tabs,TabsList,TabsTrigger,TabsContent} from "@/components/ui/tabs";
import {Skeleton} from "@/components/ui/skeleton";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {fetchBoard,saveSelection,searchInstruments} from "./api";
import {useResource} from "./use-resource";
import {matchesSegment,moveSelection,selectionNeedsReload,sortRows} from "./state";
import {formatFetchedAt,formatPercent,metaSummary} from "./format";
import type {BoardResponse,Instrument,Segment} from "./types";
import {BoardRows} from "./board-rows";
import {InstrumentDetail} from "./instrument-detail";

const labels={us:"美股",etf:"场内 ETF",fund:"场外基金"};
export function MarketBoardView({marketRefreshKey=0}:{marketRefreshKey?:number}) {
 const [segment,setSegment]=React.useState<Segment>(()=>readMarketParam());
 const selectSegment=(value:string)=>{
  const next=value as Segment;
  setSegment(next);
  const url=new URL(window.location.href);
  url.searchParams.set("view","market-board");
  url.searchParams.set("market",next);
  url.searchParams.delete("instrument");
  window.history.replaceState({},"",url);
 };
 return <Tabs value={segment} onValueChange={selectSegment} className="min-w-0 gap-5" data-testid="market-board">
  <div className="flex flex-wrap items-center justify-between gap-4">
   <div><h1 className="text-xl font-semibold tracking-tight">多市场看板</h1><p className="mt-1 text-sm text-muted-foreground">关注行情，轻松管理你的自选。</p></div>
   <TabsList aria-label="选择市场" className="grid w-full grid-cols-3 border border-border bg-card p-1 group-data-horizontal/tabs:h-10 sm:w-auto">
    <TabsTrigger value="us" className="px-4 data-active:bg-primary/10 data-active:text-primary data-active:shadow-none">美股</TabsTrigger>
    <TabsTrigger value="etf" className="px-4 data-active:bg-primary/10 data-active:text-primary data-active:shadow-none">场内 ETF</TabsTrigger>
    <TabsTrigger value="fund" className="px-4 data-active:bg-primary/10 data-active:text-primary data-active:shadow-none">场外基金</TabsTrigger>
   </TabsList>
  </div>
  <TabsContent key={segment} value={segment}><SegmentBoard segment={segment} marketRefreshKey={marketRefreshKey}/></TabsContent>
 </Tabs>;
}
function SegmentBoard({segment,marketRefreshKey}:{segment:Segment;marketRefreshKey:number}) {
 const [refresh,setRefresh]=React.useState(0),[revision,setRevision]=React.useState(0);
 const [query,setQuery]=React.useState(""),[managing,setManaging]=React.useState(false),[confirmClear,setConfirmClear]=React.useState(false);
 const [detailKey,setDetailKey]=React.useState<string|null>(()=>readInstrumentParam());
 const [saving,setSaving]=React.useState(false),[mutationError,setMutationError]=React.useState<string|null>(null);
 const [selectionKeys,setSelectionKeys]=React.useState<string[]|null>(null),draggedKey=React.useRef<string|null>(null),selectionRevision=React.useRef<number|null>(null);
 const [previousData,setPreviousData]=React.useState<BoardResponse|null>(null);
 const savingRef=React.useRef(false);
 const [sort,setSort]=React.useState({field:"",ascending:true});
 const boardLoader=React.useCallback(async(signal:AbortSignal)=>{const next=await fetchBoard(segment,refresh>0,signal);setPreviousData(next);return next;},[segment,refresh]);
 const board=useResource(segment+":"+marketRefreshKey+":"+refresh+":"+revision,boardLoader);
 const trimmed=query.trim();
 const searchLoader=React.useCallback((signal:AbortSignal)=>trimmed ? searchInstruments(trimmed,segment==="us"?"US":"CN",segment==="us"?undefined:segment==="etf"?"ETF":"FUND",signal) : Promise.resolve({items:[]}),[trimmed,segment]);
 const search=useResource(segment+":"+trimmed,searchLoader,trimmed?300:0);
 const data=board.data;
 const visibleData=data??previousData;
 React.useEffect(()=>{if(data&&!savingRef.current&&(selectionRevision.current===null||data.revision>=selectionRevision.current)){setSelectionKeys(null);selectionRevision.current=data.revision;}},[data]);
 const keys=selectionKeys??visibleData?.rows.map(row=>row.instrument.key)??[];
 const update=async(next:string[])=>{
  if(!visibleData || savingRef.current)return;
  const previous=keys;
  setSelectionKeys(next);
  savingRef.current=true;setSaving(true);setMutationError(null);
  const expectedRevision=selectionRevision.current??visibleData.revision;
  try {const saved=await saveSelection(segment,next,expectedRevision);selectionRevision.current=saved.revision;setQuery("");if(selectionNeedsReload(next,visibleData.rows))setRevision(v=>v+1);}
  catch(error){setSelectionKeys(previous);selectionRevision.current=null;setMutationError(error instanceof Error?error.message:"保存失败");setRevision(v=>v+1);}
  finally{savingRef.current=false;setSaving(false);}
 };
 const add=(item:Instrument)=>{if(matchesSegment(item,segment)&&!keys.includes(item.key))void update([...keys,item.key]);};
 const ordered=visibleData ? keys.map(key=>visibleData.rows.find(row=>row.instrument.key===key)).filter((row):row is NonNullable<typeof row>=>Boolean(row)) : [];
 const sorted=visibleData ? managing||!sort.field ? ordered : sortRows(ordered,sort.field,sort.ascending) : [];
 const sortBy=(field:string)=>setSort(current=>({field,ascending:current.field===field?!current.ascending:true}));
 const dropRow=(targetKey:string)=>{const sourceKey=draggedKey.current;draggedKey.current=null;if(!sourceKey||sourceKey===targetKey)return;const targetIndex=keys.indexOf(targetKey);if(targetIndex>=0)void update(moveSelection(keys,sourceKey,targetIndex));};
 const openDetail=(key:string)=>{setDetailKey(key);const url=new URL(window.location.href);url.searchParams.set("view","market-board");url.searchParams.set("market",segment);url.searchParams.set("instrument",key);window.history.replaceState({},"",url);};
 const closeDetail=()=>{setDetailKey(null);const url=new URL(window.location.href);url.searchParams.delete("instrument");window.history.replaceState({},"",url);};
 return <div className="flex min-w-0 flex-col gap-4">
  <Card className="min-w-0 gap-0 py-0 shadow-xs ring-border"><CardContent className="@container flex min-w-0 flex-col gap-0 px-0">
   <div className="flex flex-wrap items-center gap-3 p-4">
   <h2 className="mr-auto flex items-center gap-2 text-base font-semibold"><ListFilter className="size-4 text-primary"/>{labels[segment]}<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{visibleData?keys.length:"--"} 自选</span></h2>
    <div className="relative order-last w-full lg:order-none lg:w-72 xl:w-80"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input aria-label="搜索名称或代码" placeholder={segment==="fund"?"搜索基金名称 / 代码，添加自选":"搜索名称 / 代码，添加自选"} value={query} maxLength={80} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Escape")setQuery("");}} className="h-9 w-full bg-muted/40 pr-9 pl-9 text-sm md:text-sm"/>{query?<Button variant="ghost" size="icon-sm" aria-label="清空搜索" className="absolute top-0.5 right-0.5 size-8" onClick={()=>setQuery("")}><X className="size-3.5"/></Button>:null}</div>
    <div className="flex gap-2"><Button variant="outline" size="sm" className="h-9" disabled={board.loading||saving} onClick={()=>{selectionRevision.current=null;setRefresh(v=>v+1);}}><RefreshCw className={board.loading?"animate-spin":""}/><span className="max-[380px]:sr-only">刷新</span></Button><Button variant={managing?"default":"outline"} size="sm" className="h-9" disabled={saving} aria-pressed={managing} onClick={()=>setManaging(v=>!v)}>{managing?<Check/>:<Settings2/>}{managing?"完成管理":"管理"}</Button></div>
   </div>
   {trimmed?<div className="mx-4 mb-3 grid max-h-72 gap-1 overflow-y-auto rounded-lg border bg-muted/20 p-2" aria-live="polite"><p className="px-2 py-1 text-xs text-muted-foreground">搜索结果 · 点击添加自选{segment==="fund"?" · 人民币 A/C 份额分别保留":""}</p>{search.loading?<p className="p-2 text-sm">搜索中…</p>:search.error?<p role="alert" className="p-2 text-destructive">{search.error}</p>:search.data?.items.filter(item=>matchesSegment(item,segment)).length ? search.data.items.filter(item=>matchesSegment(item,segment)).map(item=><Button className="h-auto justify-between gap-3 whitespace-normal py-2.5 text-left" key={item.key} variant="ghost" disabled={saving||!visibleData||keys.includes(item.key)} onClick={()=>add(item)}><span>{item.symbol} · {item.name}</span><span className="shrink-0 text-xs text-primary">{keys.includes(item.key)?"已自选":"＋添加"}</span></Button>):<p className="p-2 text-sm text-muted-foreground">当前板块无匹配结果；场外仅收录已核实人民币份额。</p>}</div>:null}
   {mutationError||board.error?<p role="alert" className="mx-4 mb-3 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{mutationError??board.error}</p>:null}
   {visibleData?.warnings.map(warning=><p key={warning} className="mx-4 mb-2 rounded-md bg-muted px-3 py-2 text-[13px] leading-5 text-muted-foreground">{warning}</p>)}
   {segment!=="us"?<p className="mx-4 mb-3 flex items-start gap-2 text-[13px] leading-5 text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0 text-primary"/>{segment==="fund"?"正式净值不是盘中价格；限额仅代表天天基金渠道。":"参考溢价不是实时溢价；缺同步 NAV / IOPV 时显示“不可计算”。"}</p>:null}
   {visibleData?<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs leading-5 text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5"/>更新于 {formatFetchedAt(visibleData.fetched_at)}</span><span>{segment==="fund"?"净值日期":"行情日期"}：{[...new Set(visibleData.rows.map(row=>segment==="fund"?row.nav?.nav_date:row.quote?.trading_date).filter(Boolean))].sort().join(" / ")||"未知"}</span>{sort.field?<Button variant="ghost" size="sm" className="h-6 text-xs md:ml-auto" onClick={()=>setSort({field:"",ascending:true})}>恢复自选顺序<X className="size-3"/></Button>:null}</div>:null}
   {managing?<div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="grid gap-1"><span className="text-sm font-medium">管理自选{saving?" · 保存中…":""}</span><span className="text-[13px] leading-5 text-muted-foreground">拖拽或使用箭头排序；移除与清空不影响持仓、交易记录或策略股票池。</span></div><Button size="sm" variant="outline" className="border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!keys.length||saving} onClick={()=>setConfirmClear(true)}>清空当前自选</Button></div>:null}
   {board.loading&&!visibleData?<div role="status" className="grid gap-3 p-4"><span className="text-sm text-muted-foreground">正在加载{labels[segment]}…</span>{[0,1,2,3].map(index=><Skeleton key={index} className="h-16 w-full"/>)}</div>:visibleData&&!keys.length?<p role="status" className="px-4 py-12 text-center text-sm text-muted-foreground">暂无自选，搜索名称或代码添加。清空后不会自动恢复默认列表。</p>:visibleData?<BoardRows segment={segment} rows={sorted} sort={sort} onSort={sortBy} onOpen={openDetail} managing={managing} onDragStart={key=>{if(!saving)draggedKey.current=key;}} onDropRow={dropRow} actions={row=>{const index=keys.indexOf(row.instrument.key);return <div className="flex flex-wrap justify-end gap-1"><Button variant="ghost" size="icon-sm" aria-label={"置顶 "+row.instrument.symbol} disabled={saving||index===0} onClick={()=>void update(moveSelection(keys,row.instrument.key,0))}><ChevronsUp/></Button><Button variant="ghost" size="icon-sm" aria-label={"上移 "+row.instrument.symbol} disabled={saving||index===0} onClick={()=>void update(moveSelection(keys,row.instrument.key,index-1))}><ArrowUp/></Button><Button variant="ghost" size="icon-sm" aria-label={"下移 "+row.instrument.symbol} disabled={saving||index===keys.length-1} onClick={()=>void update(moveSelection(keys,row.instrument.key,index+1))}><ArrowDown/></Button><Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={"移除 "+row.instrument.symbol} disabled={saving} onClick={()=>void update(keys.filter(key=>key!==row.instrument.key))}><X/></Button></div>;}}/>:null}
  </CardContent></Card>
  {visibleData?.benchmarks.length?<div className="grid min-w-0 gap-3 sm:grid-cols-3">{visibleData.benchmarks.map(item=><Card key={item.symbol} className="shadow-xs ring-border"><CardContent className="grid gap-2 text-sm"><span className="font-medium">{item.name} · {item.kind==="future"?"期货":"指数"}</span><span className="text-lg font-semibold tabular-nums">{item.quote.price??"--"} <span className="text-sm font-medium">{formatPercent(item.quote.change_pct)}</span></span><span className="break-words text-xs leading-5 text-muted-foreground">{metaSummary(item.quote.meta)}</span></CardContent></Card>)}</div>:null}
  <Dialog open={confirmClear} onOpenChange={setConfirmClear}><DialogContent><DialogHeader><DialogTitle>清空{labels[segment]}自选？</DialogTitle><DialogDescription>仅移除当前板块关注关系，不删除持仓、交易、策略或行情历史。</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setConfirmClear(false)}>取消</Button><Button variant="destructive" disabled={saving} onClick={()=>{setConfirmClear(false);void update([]);}}>确认清空</Button></div></DialogContent></Dialog>
  {detailKey?<InstrumentDetail key={detailKey} instrumentKey={detailKey} onClose={closeDetail}/>:null}
 </div>;
}

function readMarketParam(): Segment {
 if(typeof window==="undefined")return "us";
 const value=new URLSearchParams(window.location.search).get("market");
 return value==="us"||value==="etf"||value==="fund"?value:"us";
}
function readInstrumentParam(): string|null { return typeof window==="undefined"?null:new URLSearchParams(window.location.search).get("instrument"); }
