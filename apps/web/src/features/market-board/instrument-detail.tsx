"use client";
import * as React from "react";
import {Button} from "@/components/ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {fetchDetail,fetchSeries} from "./api";
import {useResource} from "./use-resource";
import {cacheStateLabels,formatAmount,formatFetchedAt,formatPercent,formatShares,formatVolume,qualityLabel,sessionLabel,limitLabel,basisLabel,statusLabels,timelinessLabels,observationLabel} from "./format";
import type {ObservationMeta,BoardRow} from "./types";
import {BoardChart} from "@/features/charts/board-chart";

export function Metadata({meta,showReason=true}:{meta?:ObservationMeta|null;showReason?:boolean}) {return <div className="mt-2 grid gap-1 break-words text-xs text-muted-foreground"><span>来源：{meta?.source??"--"} · {meta?statusLabels[meta.status]:"数据缺失"}</span><span>观察：{observationLabel(meta)} · 获取：{formatFetchedAt(meta?.fetched_at)}</span><span>时效：{meta?timelinessLabels[meta.timeliness]??"未知":"未知"} · 缓存：{meta?cacheStateLabels[meta.cache_state]??"未知":"未知"}</span>{showReason&&meta?.reason?<span>{meta.reason}</span>:null}</div>;}
export function InstrumentDetail({instrumentKey,onClose}:{instrumentKey:string;onClose:()=>void}) {
 const loader=React.useCallback((signal:AbortSignal)=>fetchDetail(instrumentKey,signal),[instrumentKey]);
 const detail=useResource(instrumentKey,loader);
 const row=detail.data?.row;
 const holdings=detail.data?.holdings;
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl"><DialogHeader className="pr-8"><DialogTitle>{row?row.instrument.name+" · "+row.instrument.symbol:"标的详情"}</DialogTitle><DialogDescription>{row?row.instrument.currency+" · "+row.instrument.exchange+" · "+qualityLabel(row):"独立加载身份与各字段数据"}</DialogDescription></DialogHeader>
  {detail.loading?<p role="status">详情加载中…</p>:detail.error?<p role="alert" className="text-destructive">{detail.error}</p>:row?<div className="grid min-w-0 gap-4">
   {row.instrument.asset_type==="FUND"?<><Card><CardHeader><CardTitle>正式净值</CardTitle></CardHeader><CardContent className="text-sm">{formatAmount(row.nav?.value,"CNY")} · 涨幅 {formatPercent(row.nav?.change_pct)}<p>净值日期：{row.nav?.nav_date??"--"} · 公告日期：{row.nav?.announcement_date??"未知"}</p><p className="text-muted-foreground">正式净值不是盘中价格；未接入估算数据，不以估算替代。</p><Metadata meta={row.nav?.meta}/></CardContent></Card>
   <Card><CardHeader><CardTitle>渠道单日限额</CardTitle></CardHeader><CardContent className="text-sm">{limitLabel(row.purchase_limit)} · 币种 {row.purchase_limit?.currency??"CNY"} · 渠道 {row.purchase_limit?.channel==="eastmoney"?"天天基金":row.purchase_limit?.channel??"未知"}<Metadata meta={row.purchase_limit?.meta}/></CardContent></Card>
   <Card><CardHeader><CardTitle>资产配置</CardTitle></CardHeader><CardContent className="text-sm"><p>报告期：{holdings?.allocation?.report_date??"--"}</p><div className="mt-2 grid grid-cols-3 gap-2"><p>股票 {formatPercent(holdings?.allocation?.stocks_pct)}</p><p>债券 {formatPercent(holdings?.allocation?.bonds_pct)}</p><p>现金 {formatPercent(holdings?.allocation?.cash_pct)}</p></div><Metadata meta={holdings?.allocation_meta}/></CardContent></Card>
   <Card><CardHeader><CardTitle>前十重仓（披露，不代表实时持仓）</CardTitle></CardHeader><CardContent className="text-sm"><p>报告期：{holdings?.report_date??"--"}</p>{holdings?.stocks.length?<ol className="mt-3 grid gap-2">{holdings.stocks.map(stock=><li key={stock.rank+stock.symbol} className="flex justify-between gap-3 border-b pb-2"><span className="min-w-0 break-words">{stock.rank}. {stock.name} · {stock.symbol}</span><span className="shrink-0 tabular-nums">{formatPercent(stock.weight_pct)}</span></li>)}</ol>:<p className="mt-3 text-muted-foreground">暂无可核实的前十重仓披露；其他有效字段仍保留。</p>}<Metadata meta={holdings?.meta}/></CardContent></Card></>:<>
    <Card><CardHeader><CardTitle>交易价格</CardTitle></CardHeader><CardContent className="text-sm"><p className="text-xl font-semibold">{formatAmount(row.quote?.price,row.instrument.currency)}</p><p>涨跌额 {formatAmount(row.quote?.change,row.instrument.currency)} · 涨跌幅 {formatPercent(row.quote?.change_pct)} · {sessionLabel(row.quote?.session)}</p><p>行情日期：{row.quote?.trading_date??"--"} · 成交量：{formatVolume(row.quote?.volume,row.quote?.volume_unit)}</p><Metadata meta={row.quote?.meta}/></CardContent></Card>
    {row.instrument.market==="CN"?<EtfDetail row={row}/>:<SeriesPanel instrumentKey={instrumentKey}/>}
   </>}
  </div>:null}
 </DialogContent></Dialog>;
}
function EtfDetail({row}:{row:BoardRow}) {const m=row.metrics;return <Card><CardHeader><CardTitle>ETF 参考值与份额</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-2"><div>正式 NAV：{formatAmount(m?.nav?.value,"CNY")}<p>净值日 {m?.nav?.nav_date??"未知"}</p><Metadata meta={m?.nav?.meta}/></div><div>IOPV：{formatAmount(m?.iopv?.value,"CNY")}<p>参考日 {m?.iopv?.reference_date??"未知"}</p><Metadata meta={m?.iopv?.meta}/></div><div>供应商参考值：{formatAmount(m?.vendor_reference?.value??m?.reference_value,"CNY")}<p>参考日期：{m?.reference_date??"未知（不使用行情日期代替）"}</p><p className="text-xs text-muted-foreground">供应商原始份额字段披露日未知；独立交易所份额报告另行核实。</p><Metadata meta={m?.vendor_reference?.meta} showReason={false}/></div><div>参考溢价：{m?.premium_pct==null?"不可计算":formatPercent(m.premium_pct)}<p>{basisLabel(m?.premium_basis)}</p><p className="break-all text-xs">定义：{m?.basis_id??"--"}</p><p>同步实时溢价：不可计算</p><p>60 日分位 {formatPercent(m?.percentile60)} · 有效 {m?.sample_days??0}/60 日</p></div><div>份额 {formatShares(m?.shares)}<p>原始份额 {m?.shares??"--"} 份 · 披露日 {m?.shares_date??"未知"}</p><p>份额变化 {formatShares(m?.shares_change)} · 上期 {m?.previous_shares_date??"--"}</p><Metadata meta={m?.shares_meta}/></div><div><Metadata meta={m?.meta} showReason={false}/></div></CardContent></Card>;}
function SeriesPanel({instrumentKey}:{instrumentKey:string}) {
 const [range,setRange]=React.useState<"1mo"|"3mo"|"1y">("1y");
 const loader=React.useCallback((signal:AbortSignal)=>fetchSeries(instrumentKey,"1d",range,signal),[instrumentKey,range]);
 const series=useResource(instrumentKey+":"+range,loader);
 return <><div className="flex flex-wrap gap-2"><span className="self-center text-sm">日 K / 均线</span>{(["1mo","3mo","1y"] as const).map(value=><Button key={value} variant={range===value?"default":"outline"} size="sm" onClick={()=>setRange(value)}>{value}</Button>)}</div>{series.loading?<p role="status">日 K 加载中…</p>:series.error?<p role="alert" className="text-destructive">{series.error}</p>:series.data?<BoardChart series={series.data}/>:null}</>;
}
