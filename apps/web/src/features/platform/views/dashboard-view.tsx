"use client";

import { useState } from "react";
import { ActivityIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice } from "@/features/charts/format";
import { OverviewPanel } from "@/features/charts/overview-panel";
import { useQuotesQuery } from "@/features/charts/queries";
import type { SignalRow } from "@/features/platform/api";
import { useSignalsQuery } from "@/features/platform/queries";
import {
  comparePositionReturnsDescending,
  calculateHoldingValuation,
  formatMoney,
  formatRatio,
  formatShares,
  uniqueTickers,
  type ValuationObservation,
} from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";

export function DashboardView({
  marketRefreshKey = 0,
}: {
  marketRefreshKey?: number;
}) {
  const [positionFilter, setPositionFilter] = useState("all");
  const signalsQuery = useSignalsQuery();
  const signals = signalsQuery.data ?? [];
  const { state, derivedPositions, removePosition } = useTradingData();
  const heldPositions = derivedPositions.filter((position) => position.shares > 0);
  const tickers = uniqueTickers([
    ...state.stockPool,
    ...heldPositions.map((position) => position.ticker),
  ]);
  const quotesQuery = useQuotesQuery(tickers, marketRefreshKey);
  const quotes = quotesQuery.data ?? [];
  const priceByTicker = new Map(
    quotes
      .filter((quote) => quote.source !== "sample" && finiteNumber(quote.price) !== undefined)
      .map((quote) => [quote.ticker, quote.price])
  );
  const signalByTicker = new Map(signals.map((signal) => [signal.ticker, signal]));
  const valuationObservations = new Map<string, ValuationObservation>(
    quotes.map((quote) => [quote.ticker, {
      price: quote.price,
      previousClose: quote.previousClose,
      change: quote.change,
      source: quote.source,
      status: quote.status,
    }])
  );
  for (const signal of signals) {
    const signalPrice =
      signal.source === "sample" ? undefined : finiteNumber(signal.current_price);
    if (signalPrice !== undefined && !valuationObservations.has(signal.ticker)) {
      valuationObservations.set(signal.ticker, {
        price: signalPrice,
        previousClose: null,
        change: null,
        source: signal.source,
        status: signal.source === "unavailable" ? "unavailable" : "available",
      });
    }
  }
  const valuation = calculateHoldingValuation(
    heldPositions,
    valuationObservations,
    state.account.baseCurrency,
  );
  const holdingPnlRatio =
    valuation.unrealizedPnl !== null && valuation.unrealizedCovered > 0
      ? valuation.unrealizedPnl /
        heldPositions
          .filter((position) => {
            const observation = valuationObservations.get(position.ticker);
            return Boolean(
              finiteNumber(observation?.price) !== undefined &&
                observation?.source !== "sample" &&
                observation?.status !== "unavailable" &&
                observation?.status !== "missing" &&
                Number.isFinite(position.holdingCost),
            );
          })
          .reduce((total, position) => total + position.holdingCost, 0)
      : null;
  const statusRows = derivedPositions
    .filter((position) => positionFilter === "all" || (positionFilter === "held" ? position.shares > 0 : position.shares <= 0))
    .map((position) => {
      const signal = signalByTicker.get(position.ticker);
      const realSignal = signal?.source === "sample" ? undefined : signal;
      const quotePrice = priceByTicker.get(position.ticker);
      const price = quotePrice ?? finiteNumber(realSignal?.current_price);
      const isHeld = position.shares > 0;
      const marketValue = price !== undefined ? position.shares * price : undefined;
      const pnl = isHeld && marketValue !== undefined ? marketValue - position.holdingCost : undefined;
      const returnFromCost =
        pnl !== undefined && position.holdingCost > 0
          ? pnl / position.holdingCost
          : undefined;

      return {
        position,
        realSignal,
        price,
        pnl,
        returnFromCost,
        isHeld,
      };
    })
    .sort((first, second) =>
      comparePositionReturnsDescending(first.returnFromCost, second.returnFromCost)
    );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">资产总览</h1>
        <p className="mt-1 text-sm text-muted-foreground">当前持仓表现与关注标的，一目了然。</p>
      </div>
      {quotesQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <OverviewPanel
          holdingValue={valuation.marketValue}
          holdingPnl={valuation.unrealizedPnl}
          holdingPnlRatio={holdingPnlRatio}
          holdingDayChange={valuation.dayChange}
          marketCoverage={`${valuation.marketValueCovered}/${valuation.marketValueTotal} 个持仓有可用报价`}
          pnlCoverage={`${valuation.unrealizedCovered}/${valuation.unrealizedTotal} 个持仓同时有报价和成本`}
          dayChangeCoverage={`${valuation.dayChangeCovered}/${valuation.dayChangeTotal} 个持仓有昨收基准`}
        />
      )}
      <Card className="gap-0 pb-0 shadow-xs ring-border">
        <CardHeader className="gap-1 border-b pb-4 max-sm:flex max-sm:flex-col max-sm:gap-3">
          <CardTitle className="flex items-center gap-2 font-semibold">
            <ActivityIcon className="size-4 text-primary" />
            标的状态
          </CardTitle>
          <CardDescription className="text-[13px]">
            {heldPositions.length} 个持仓 · {derivedPositions.length - heldPositions.length} 个观察 · 按持仓收益率排序
          </CardDescription>
          <CardAction className="max-sm:w-full max-sm:self-stretch">
            <Tabs value={positionFilter} onValueChange={setPositionFilter}>
              <TabsList aria-label="筛选标的" className="w-full sm:w-auto">
                <TabsTrigger value="all" className="px-3 data-active:text-primary">全部</TabsTrigger>
                <TabsTrigger value="held" className="px-3 data-active:text-primary">已持仓</TabsTrigger>
                <TabsTrigger value="watching" className="px-3 data-active:text-primary">仅观察</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <p className="px-4 py-2 text-xs text-muted-foreground lg:hidden">左右滑动查看完整持仓与技术指标</p>
          <Table className="min-w-[880px] [&_td]:px-4 [&_td]:py-3 [&_th]:px-4">
            <TableHeader className="bg-muted/60 [&_th]:text-[13px] [&_th]:text-muted-foreground">
              <TableRow>
                <TableHead>标的</TableHead>
                <TableHead className="text-right">现价</TableHead>
                <TableHead className="text-right">持仓成本</TableHead>
                <TableHead className="text-right">盈亏</TableHead>
                <TableHead className="text-right">技术指标</TableHead>
                <TableHead>技术状态</TableHead>
                <TableHead className="w-12"><span className="sr-only">删除观察标的</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statusRows.map(
                ({ position, realSignal, price, pnl, returnFromCost, isHeld }) => (
                  <TableRow key={position.ticker}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-[15px] font-semibold">{position.ticker}</span>
                        <span className="text-xs text-muted-foreground">{position.assetType === "ETF" ? "ETF" : "股票"} · {isHeld ? "持仓" : "观察"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-[15px] font-medium tabular-nums">
                      <div>{formatMoney(price)}</div>
                      {price === undefined && isHeld ? <div className="text-xs text-muted-foreground">真实报价不可用，未计入估值</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isHeld ? (
                        <>
                          <div>{formatMoney(position.holdingCost)}</div>
                          <div className="mt-1 text-[13px] text-muted-foreground">
                            {formatShares(position.shares)} 股 x {formatMoney(position.costBasis)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">未持仓</span>
                      )}
                    </TableCell>
                    <TableCell className={signedCellClass(pnl)}>
                      {isHeld ? <><div className="text-[15px] font-semibold">{formatMoney(pnl)}</div><div className="mt-1 text-[13px]">{formatRatio(returnFromCost)}</div></> : "--"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="text-[13px]"><span className="text-muted-foreground">MA</span> {maLine(realSignal)}</div>
                      <div className="mt-1 text-[13px] text-muted-foreground">
                        RSI {numberLabel(realSignal?.rsi, 1)} / 52 周回撤{" "}
                        {formatRatio(realSignal?.drawdown252 ?? realSignal?.drawdown)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={signalVariant(realSignal?.status)} className={realSignal?.status === "趋势偏强" ? "border-transparent bg-primary/8 text-primary" : "bg-muted/50 text-muted-foreground"}>
                          {realSignal?.status ?? "等待真实行情"}
                        </Badge>
                        <span className="max-w-64 text-[13px] text-muted-foreground">
                          {realSignal?.action ?? "缺少可核实行情，未参与估值和信号计算"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {!isHeld ? (
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => removePosition(position.ticker)} aria-label={`删除观察标的 ${position.ticker}`} title={`从总览删除 ${position.ticker}`}>
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              )}
              {!statusRows.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {positionFilter === "all" ? "暂无跟踪标的，请到交易记录录入交易或选择仅观察。" : positionFilter === "held" ? "暂无持仓，可到交易记录录入交易。" : "暂无仅观察标的。"}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function maLine(signal?: SignalRow) {
  if (!signal) {
    return "--";
  }
  return [signal.ma20, signal.ma60, signal.ma120]
    .map((value) => formatPrice(value ?? undefined))
    .join(" / ");
}

function numberLabel(value?: number | null, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

function finiteNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function signedCellClass(value?: number) {
  if (!value) {
    return "text-right tabular-nums text-muted-foreground";
  }
  return value > 0
    ? "text-right tabular-nums text-price-up"
    : "text-right tabular-nums text-price-down";
}

function signalVariant(status?: string): "secondary" | "outline" {
  if (!status) {
    return "outline";
  }
  return status === "趋势偏强" ? "secondary" : "outline";
}
