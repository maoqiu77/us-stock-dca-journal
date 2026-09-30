"use client";
import type * as React from "react";
import Image from "next/image";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";
import {formatAmount,formatNumber,formatPercent,formatShares,qualityLabel,sessionLabel,limitLabel,basisLabel,marketTone} from "./format";
import type {BoardRow,Segment} from "./types";

const US_LOGOS = new Set(["AAPL","AMD","AMZN","AVGO","BABA","COIN","COST","DIA","GLD","GOOG","INTC","IWM","JPM","META","MSFT","MU","NFLX","NVDA","PLTR","QQQ","SMH","SOXX","SPY","SQQQ","TQQQ","TSLA","TSM","V","VOO","WMT"]);
function StockAvatar({symbol}:{symbol:string}) {
 const logo = symbol === "GOOGL" ? "GOOG" : symbol === "QQQM" ? "QQQ" : symbol;
 return US_LOGOS.has(logo)
  ? <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-white"><Image src={`/market-board/stocks/${logo}.png`} alt="" width={32} height={32} className="size-8 object-contain" unoptimized/></span>
  : <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{symbol.slice(0,4)}</span>;
}
export function BoardRows({segment,rows,sort,onSort,onOpen,managing,actions,onDragStart,onDropRow}:{segment:Segment;rows:BoardRow[];sort:{field:string;ascending:boolean};onSort:(field:string)=>void;onOpen:(key:string)=>void;managing:boolean;actions:(row:BoardRow)=>React.ReactNode;onDragStart?:(key:string)=>void;onDropRow?:(key:string)=>void}) {
 const headers=segment==="us"?[["symbol","名称 / 代码"],["price","最新价 / 时段"],["change_pct","涨跌额 / 涨跌幅"]]:segment==="etf"?[["symbol","代码 / 名称"],["change_pct","日涨幅 / 当前价"],["premium_pct","参考溢价 / 60 日分位"],["shares","份额 / 份额变化"]]:[["symbol","代码 / 名称"],["amount","单日限额 / 渠道"],["change_pct","净值涨幅 / 正式净值"]];
 const identity=(row:BoardRow)=><div className="flex min-w-0 items-start gap-2">{segment==="us"?<StockAvatar symbol={row.instrument.symbol}/>:null}<button className="min-w-0 text-left hover:underline" onClick={()=>onOpen(row.instrument.key)}><span className="block text-xs text-muted-foreground">{row.instrument.symbol}</span><span className="line-clamp-2 break-words font-medium">{row.instrument.name}</span></button></div>;
 const fields=(row:BoardRow)=>segment==="us"?[
  <div key="price" className="grid gap-1"><strong>{formatNumber(row.quote?.price)}</strong>{row.quote?.session&&row.quote.session!=="unknown"?<small className="text-muted-foreground">{sessionLabel(row.quote.session)}</small>:null}</div>,
  <div key="change" className="grid gap-1"><strong className={marketTone(row.quote?.change)}>{formatNumber(row.quote?.change)}</strong><small className={marketTone(row.quote?.change_pct)}>{formatPercent(row.quote?.change_pct)}</small></div>
 ]:segment==="etf"?[
  <div key="price" className="grid gap-1"><strong className={marketTone(row.quote?.change_pct)}>{formatPercent(row.quote?.change_pct)}</strong><small className="text-muted-foreground">{formatAmount(row.quote?.price,"CNY")}</small></div>,
  <div key="premium" className="grid gap-1"><strong>{row.metrics?.premium_pct==null?"不可计算":formatPercent(row.metrics.premium_pct)}</strong><small>{formatPercent(row.metrics?.percentile60)} · {row.metrics?.sample_days??0}/60 日</small><small className="text-muted-foreground">{basisLabel(row.metrics?.premium_basis)}</small></div>,
  <div key="shares" className="grid gap-1"><strong>{formatShares(row.metrics?.shares)}</strong><small>{formatShares(row.metrics?.shares_change)}</small></div>
 ]:[
  <div key="limit" className="grid gap-1"><strong>{limitLabel(row.purchase_limit)}</strong><small className="text-muted-foreground">天天基金</small></div>,
  <div key="nav" className="grid gap-1"><strong className={marketTone(row.nav?.change_pct)}>{formatPercent(row.nav?.change_pct)}</strong><small className="text-muted-foreground">正式净值 {formatAmount(row.nav?.value,"CNY")}</small></div>
 ];
 const quality=(row:BoardRow)=>{const meta=row.quote?.meta??row.nav?.meta;const variant=row.quality==="missing"?"destructive":row.quality==="sample"||row.quality==="stale"?"secondary":"outline";return <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{row.quality!=="available"?<Badge variant={variant}>{qualityLabel(row)}</Badge>:null}<span title={meta?.reason??undefined} className="min-w-0 break-words text-[11px] leading-4 text-muted-foreground">{meta?.source??"来源未知"}</span></div>;};
 return <>
  <div className="hidden min-w-0 md:block"><Table className="w-full table-fixed"><TableHeader><TableRow>{headers.map(([field,label])=><TableHead key={field} className="whitespace-normal" aria-sort={sort.field===field?(sort.ascending?"ascending":"descending"):"none"}><button className="text-left text-xs" disabled={managing} onClick={()=>onSort(field)}>{label} {sort.field===field?(sort.ascending?"↑":"↓"):"↕"}</button></TableHead>)}<TableHead className={managing?"w-40":"w-16"}>操作</TableHead></TableRow></TableHeader><TableBody>{rows.map(row=><TableRow key={row.instrument.key} draggable={managing} onDragStart={()=>onDragStart?.(row.instrument.key)} onDragOver={event=>{if(managing)event.preventDefault();}} onDrop={()=>onDropRow?.(row.instrument.key)} className={managing?"cursor-grab":undefined}><TableCell className="whitespace-normal py-3">{identity(row)}<div className="mt-2">{quality(row)}</div></TableCell>{fields(row).map((field,index)=><TableCell className="whitespace-normal align-top py-3 text-sm tabular-nums" key={index}>{field}</TableCell>)}<TableCell className="whitespace-normal">{managing?actions(row):<Button variant="ghost" size="sm" aria-label={"详情 "+row.instrument.symbol} onClick={()=>onOpen(row.instrument.key)}>详情</Button>}</TableCell></TableRow>)}</TableBody></Table></div>
  <div className="flex flex-col gap-2 md:hidden"><div className="flex flex-wrap gap-1">{headers.map(([field,label])=><Button key={field} variant="ghost" size="sm" disabled={managing} onClick={()=>onSort(field)}>{label.split(" / ")[0]} {sort.field===field?(sort.ascending?"↑":"↓"):"↕"}</Button>)}</div>{rows.map(row=><article className={"min-w-0 rounded-lg border p-3 "+(managing?"cursor-grab":"")} draggable={managing} onDragStart={()=>onDragStart?.(row.instrument.key)} onDragOver={event=>{if(managing)event.preventDefault();}} onDrop={()=>onDropRow?.(row.instrument.key)} key={row.instrument.key}><div className="flex items-start justify-between gap-2">{identity(row)}<Button variant="ghost" size="sm" aria-label={"详情 "+row.instrument.symbol} onClick={()=>onOpen(row.instrument.key)}>详情</Button></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs tabular-nums">{fields(row).map((field,index)=><div key={index}><div className="mb-1 text-[10px] text-muted-foreground">{headers[index+1][1]}</div>{field}</div>)}</div><div className="mt-3">{quality(row)}</div>{managing?<div className="mt-2 border-t pt-2">{actions(row)}</div>:null}</article>)}</div>
 </>;
}
