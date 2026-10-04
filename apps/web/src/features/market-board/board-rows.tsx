"use client";

import type * as React from "react";
import Image from "next/image";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatAmount, formatNumber, formatPercent, formatShares, qualityLabel, sessionLabel, limitLabel, basisLabel, marketTone, numeric } from "./format";
import type { BoardRow, Segment } from "./types";

const US_LOGOS = new Set(["AAPL", "AMD", "AMZN", "AVGO", "BABA", "COIN", "COST", "DIA", "GLD", "GOOG", "INTC", "IWM", "JPM", "META", "MSFT", "MU", "NFLX", "NVDA", "PLTR", "QQQ", "SMH", "SOXX", "SPY", "SQQQ", "TQQQ", "TSLA", "TSM", "V", "VOO", "WMT"]);

function StockAvatar({ symbol }: { symbol: string }) {
  const logo = symbol === "GOOGL" ? "GOOG" : symbol === "QQQM" ? "QQQ" : symbol;
  return US_LOGOS.has(logo)
    ? <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-white"><Image src={`/market-board/stocks/${logo}.png`} alt="" width={24} height={24} className="size-6 object-contain" unoptimized /></span>
    : <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-xs font-semibold text-primary">{symbol.slice(0, 3)}</span>;
}

function ChangePill({ value }: { value?: string | null }) {
  const number = numeric(value);
  return <span className={cn("inline-flex min-w-20 items-center justify-center rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums", marketTone(value), number !== null && number > 0 && "bg-price-up/8", number !== null && number < 0 && "bg-price-down/8")}>
    {number !== null && number > 0 ? "+" : ""}{formatPercent(value)}
  </span>;
}

export function BoardRows({ segment, rows, sort, onSort, onOpen, managing, actions, onDragStart, onDropRow }: {
  segment: Segment;
  rows: BoardRow[];
  sort: { field: string; ascending: boolean };
  onSort: (field: string) => void;
  onOpen: (key: string) => void;
  managing: boolean;
  actions: (row: BoardRow) => React.ReactNode;
  onDragStart?: (key: string) => void;
  onDropRow?: (key: string) => void;
}) {
  const headers = segment === "us"
    ? [["symbol", "名称 / 代码"], ["price", "最新价 · USD"], ["change_pct", "涨跌幅 / 涨跌额"]]
    : segment === "etf"
      ? [["symbol", "名称 / 代码"], ["change_pct", "日涨幅 / 当前价"], ["premium_pct", "参考溢价 / 60 日分位"], ["shares", "份额 / 份额变化"]]
      : [["symbol", "名称 / 代码"], ["amount", "单日限额 / 渠道"], ["change_pct", "净值涨幅 / 正式净值"]];

  const identity = (row: BoardRow) => {
    const meta = row.quote?.meta ?? row.nav?.meta;
    return <div className="flex min-w-0 items-center gap-3">
      {managing ? <GripVertical aria-hidden className="hidden size-4 shrink-0 text-muted-foreground @min-[960px]:block" /> : null}
      {segment === "us" ? <StockAvatar symbol={row.instrument.symbol} /> : null}
      <div className="grid min-w-0 gap-1">
        <button className="rounded-sm text-left text-[15px] leading-5 font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpen(row.instrument.key)}>
          <span className="line-clamp-2 break-words">{row.instrument.name}</span>
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
          <span className="font-medium tracking-wide">{row.instrument.symbol}</span>
          <span title={meta?.reason ?? undefined} className="break-words">{meta?.source ?? "来源未知"}</span>
          {row.quality !== "available" ? <Badge className="text-xs" variant={row.quality === "missing" ? "destructive" : "secondary"}>{qualityLabel(row)}</Badge> : null}
        </div>
      </div>
    </div>;
  };

  const fields = (row: BoardRow) => segment === "us" ? [
    <div key="price" className="grid gap-1"><strong className="text-base font-semibold">{formatNumber(row.quote?.price)}</strong>{row.quote?.session && row.quote.session !== "unknown" ? <span className="text-[13px] text-muted-foreground">{sessionLabel(row.quote.session)}</span> : null}</div>,
    <div key="change" className="grid justify-items-start gap-1 @min-[960px]:justify-items-end"><ChangePill value={row.quote?.change_pct} /><span className={cn("text-[13px]", marketTone(row.quote?.change))}>{(numeric(row.quote?.change) ?? 0) > 0 ? "+" : ""}{formatNumber(row.quote?.change)} <span className="text-muted-foreground">USD</span></span></div>,
  ] : segment === "etf" ? [
    <div key="price" className="grid justify-items-start gap-1 @min-[960px]:justify-items-end"><ChangePill value={row.quote?.change_pct} /><span className="text-[13px] text-muted-foreground">{formatAmount(row.quote?.price, "CNY")}</span></div>,
    <div key="premium" className="grid gap-1"><strong className={cn("font-semibold", row.metrics?.premium_pct == null && "font-normal text-muted-foreground")}>{row.metrics?.premium_pct == null ? "不可计算" : formatPercent(row.metrics.premium_pct)}</strong><span className="text-[13px] text-muted-foreground">{formatPercent(row.metrics?.percentile60)} · {row.metrics?.sample_days ?? 0}/60 日</span><span className="text-xs text-muted-foreground">{basisLabel(row.metrics?.premium_basis)}</span></div>,
    <div key="shares" className="grid gap-1"><strong className="font-semibold">{formatShares(row.metrics?.shares)}</strong><span className="text-[13px] text-muted-foreground">{formatShares(row.metrics?.shares_change)}</span></div>,
  ] : [
    <div key="limit" className="grid gap-1"><strong className={cn("text-base font-semibold", row.purchase_limit?.state === "suspended" && "text-muted-foreground")}>{limitLabel(row.purchase_limit)}</strong><span className="text-[13px] text-muted-foreground">天天基金</span></div>,
    <div key="nav" className="grid justify-items-start gap-1 @min-[960px]:justify-items-end"><ChangePill value={row.nav?.change_pct} /><span className="text-[13px] text-muted-foreground">净值 {formatAmount(row.nav?.value, "CNY")}</span></div>,
  ];

  const sortButton = (field: string, label: string) => {
    const Icon = sort.field !== field ? ArrowUpDown : sort.ascending ? ArrowUp : ArrowDown;
    return <Button variant="ghost" size="sm" className={cn("-mx-2 h-9 gap-1 px-2 text-[13px] font-medium", sort.field === field ? "text-primary" : "text-muted-foreground")} disabled={managing} onClick={() => onSort(field)}>
      {label}<Icon aria-hidden className="size-3.5" />
    </Button>;
  };

  const dragProps = (row: BoardRow) => ({
    draggable: managing,
    onDragStart: () => onDragStart?.(row.instrument.key),
    onDragOver: (event: React.DragEvent) => { if (managing) event.preventDefault(); },
    onDrop: () => onDropRow?.(row.instrument.key),
  });

  return <>
    <div className="hidden min-w-0 @min-[960px]:block">
      <Table className="w-full table-fixed [&_td]:px-4 [&_th]:px-4">
        <TableHeader className="border-y bg-muted/60">
          <TableRow className="hover:bg-transparent">
            {headers.map(([field, label], index) => <TableHead key={field} className={cn("h-11 whitespace-normal", index === 0 ? segment === "etf" ? "w-[30%]" : "w-[40%]" : "text-right")} aria-sort={sort.field === field ? sort.ascending ? "ascending" : "descending" : "none"}>{sortButton(field, label)}</TableHead>)}
            <TableHead className={cn("text-right text-[13px] text-muted-foreground", managing ? "w-40" : "w-24")}><span className="sr-only">操作</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.instrument.key} {...dragProps(row)} className={cn("hover:bg-primary/3", managing && "cursor-grab")}>
          <TableCell className="whitespace-normal py-3">{identity(row)}</TableCell>
          {fields(row).map((field, index) => <TableCell className="py-3 text-right text-sm whitespace-normal tabular-nums" key={index}>{field}</TableCell>)}
          <TableCell className="text-right whitespace-normal">{managing ? actions(row) : <Button variant="ghost" size="sm" className="gap-0.5 text-muted-foreground hover:text-primary" aria-label={"详情 " + row.instrument.symbol} onClick={() => onOpen(row.instrument.key)}>详情<ChevronRight className="size-3.5" /></Button>}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
    <div className="grid grid-cols-1 gap-3 px-3 pb-3 @min-[600px]:grid-cols-2 @min-[960px]:hidden">
      <div className="col-span-full flex flex-wrap gap-x-3 gap-y-1 border-y py-1">{headers.map(([field, label]) => <div key={field}>{sortButton(field, label.split(" / ")[0])}</div>)}</div>
      {rows.map(row => <article className="min-w-0 rounded-xl border bg-card p-3" key={row.instrument.key}>
        <div className="flex items-center justify-between gap-2">{identity(row)}<Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={"详情 " + row.instrument.symbol} onClick={() => onOpen(row.instrument.key)}><ChevronRight /></Button></div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm tabular-nums">{fields(row).map((field, index) => <div key={index}><div className="mb-1.5 text-xs text-muted-foreground">{headers[index + 1][1]}</div>{field}</div>)}</div>
        {managing ? <div className="mt-3 border-t pt-2">{actions(row)}</div> : null}
      </article>)}
    </div>
  </>;
}
