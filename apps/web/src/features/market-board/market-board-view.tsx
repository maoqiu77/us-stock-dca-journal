"use client";

import * as React from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchBoard, fetchDetail, fetchSelection, fetchSeries, saveSelection, searchInstruments } from "./api";
import { formatAmount, formatPercent, qualityLabel } from "./format";
import type { BoardResponse, BoardRow, DetailResponse, Instrument, Segment, Series } from "./types";
import { BoardChart } from "./board-chart";

export function MarketBoardView({ marketRefreshKey = 0 }: { marketRefreshKey?: number }) {
  const [segment, setSegment] = React.useState<Segment>("us");
  const [board, setBoard] = React.useState<BoardResponse | null>(null);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Instrument[]>([]);
  const [detail, setDetail] = React.useState<DetailResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const requestGeneration = React.useRef(0);
  const load = React.useCallback(async (next = segment, signal?: AbortSignal) => { const generation = ++requestGeneration.current; try { setError(null); const response = await fetchBoard(next, false, signal); if (generation === requestGeneration.current) setBoard(response); } catch (err) { if (err instanceof DOMException && err.name === "AbortError") return; if (generation === requestGeneration.current) setError(err instanceof Error ? err.message : "看板加载失败"); } }, [segment]);
  React.useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => { void load(segment, controller.signal); }, 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [segment, marketRefreshKey, load]);
  React.useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => { if (!query.trim()) { setResults([]); return; } void searchInstruments(query, segment === "us" ? "US" : "CN", segment === "us" ? undefined : segment === "etf" ? "ETF" : "FUND", controller.signal).then((data) => setResults(data.items)).catch(() => undefined); }, query.trim() ? 300 : 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [query, segment]);
  const add = async (item: Instrument) => { if (!board) return; const selection = await fetchSelection(segment); if (selection.items.some((row) => row.key === item.key)) return; await saveSelection(segment, [...selection.items.map((row) => row.key), item.key], selection.revision); await load(); setQuery(""); };
  const remove = async (key: string) => { if (!board) return; const selection = await fetchSelection(segment); await saveSelection(segment, selection.items.filter((row) => row.key !== key).map((row) => row.key), selection.revision); await load(); };
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">多市场看板</h1><p className="text-sm text-muted-foreground">独立自选，区分交易价、净值与数据时效</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 size-4" />刷新</Button></div>
    <Card><CardContent className="flex flex-wrap items-center gap-2 pt-6"><Search className="size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或代码" className="max-w-sm" />{results.map((item) => <Button key={item.key} size="sm" variant="secondary" onClick={() => void add(item)}>{item.symbol} · {item.name}</Button>)}</CardContent></Card>
    {error ? <Card><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card> : null}
    <Tabs value={segment} onValueChange={(value) => { setDetail(null); setSegment(value as Segment); }}><TabsList><TabsTrigger value="us">美股</TabsTrigger><TabsTrigger value="etf">场内 ETF</TabsTrigger><TabsTrigger value="fund">场外基金</TabsTrigger></TabsList>
      <TabsContent value={segment} className="mt-4"><Card><CardHeader><CardTitle>{board?.segment === segment ? board.warnings?.[0] ?? "关注列表" : "加载中"}</CardTitle></CardHeader><CardContent>{board?.segment === segment && board.rows.length ? <BoardTable segment={segment} rows={board.rows} onOpen={(key) => void fetchDetail(key).then(setDetail)} onRemove={(key) => void remove(key)} /> : <div className="py-12 text-center text-sm text-muted-foreground">{board?.segment === segment ? "暂无关注标的" : "正在加载当前板块"}</div>}</CardContent></Card></TabsContent>
    </Tabs>
    {detail ? <DetailPanel detail={detail} onClose={() => setDetail(null)} /> : null}
  </div>;
}

function BoardTable({ segment, rows, onOpen, onRemove }: { segment: Segment; rows: BoardRow[]; onOpen: (key: string) => void; onRemove: (key: string) => void }) { return <Table><TableHeader><TableRow><TableHead>标的</TableHead><TableHead>{segment === "fund" ? "净值" : "最新价"}</TableHead><TableHead>{segment === "fund" ? "净值涨幅" : "涨跌幅"}</TableHead><TableHead>状态</TableHead><TableHead className="w-24" /></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.instrument.key}><TableCell><button className="text-left font-medium hover:underline" onClick={() => onOpen(row.instrument.key)}>{row.instrument.name}<span className="ml-2 text-xs text-muted-foreground">{row.instrument.symbol}</span></button></TableCell><TableCell>{formatAmount(segment === "fund" ? row.nav?.value : row.quote?.price, row.instrument.currency)}</TableCell><TableCell>{formatPercent(segment === "fund" ? row.nav?.change_pct : row.quote?.change_pct)}</TableCell><TableCell><Badge variant={row.quality === "sample" ? "secondary" : "outline"}>{qualityLabel(row)}</Badge></TableCell><TableCell><Button variant="ghost" size="icon" aria-label="移除" onClick={() => onRemove(row.instrument.key)}><X className="size-4" /></Button></TableCell></TableRow>)}</TableBody></Table>; }

function DetailPanel({ detail, onClose }: { detail: DetailResponse; onClose: () => void }) {
  const row = detail.row;
  const [series, setSeries] = React.useState<Series | null>(null);
  const [range, setRange] = React.useState<"1mo" | "3mo" | "1y">("1y");
  React.useEffect(() => { if (row.instrument.market !== "US") return; const controller = new AbortController(); void fetchSeries(row.instrument.key, "1d", range, controller.signal).then(setSeries).catch(() => undefined); return () => controller.abort(); }, [row.instrument.key, row.instrument.market, range]);
  return <div className="grid gap-4"><Card><CardHeader className="flex-row items-center justify-between"><CardTitle>{row.instrument.name} ({row.instrument.symbol})</CardTitle><Button variant="ghost" size="icon" onClick={onClose}><X className="size-4" /></Button></CardHeader><CardContent className="grid gap-2 text-sm sm:grid-cols-2"><div>市场：{row.instrument.market}</div><div>币种：{row.instrument.currency}</div><div>来源：{row.quote?.meta.source ?? row.nav?.meta.source ?? "--"}</div><div>观察时间：{row.quote?.meta.as_of ?? row.nav?.nav_date ?? "--"}</div><div>数据状态：{qualityLabel(row)}</div><div>{row.instrument.asset_type === "FUND" ? "正式净值不等同于盘中成交价" : "价格为独立交易报价"}</div>{row.purchase_limit ? <div>申购状态：{row.purchase_limit.state}</div> : null}</CardContent></Card>{detail.holdings ? <Card><CardHeader><CardTitle>披露持仓与资产配置</CardTitle></CardHeader><CardContent className="text-sm">报告期：{String((detail.holdings as { report_date?: string }).report_date ?? "--")} · 数据状态：{qualityLabel(row)}</CardContent></Card> : null}{row.instrument.market === "US" ? <div className="flex gap-2"><span className="self-center text-sm text-muted-foreground">范围</span>{(["1mo", "3mo", "1y"] as const).map((option) => <Button key={option} size="sm" variant={range === option ? "default" : "outline"} onClick={() => setRange(option)}>{option}</Button>)}</div> : null}{series ? <BoardChart series={series} /> : null}</div>;
}
