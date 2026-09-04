"use client";

import { ActivityIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  formatMoney,
  formatRatio,
  formatShares,
  holdingMarketValue,
  uniqueTickers,
} from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";

export function DashboardView({
  marketRefreshKey = 0,
}: {
  marketRefreshKey?: number;
}) {
  const signalsQuery = useSignalsQuery();
  const signals = signalsQuery.data ?? [];
  const { state, derivedPositions, holdingCost, removePosition } = useTradingData();
  const heldPositions = derivedPositions.filter((position) => position.shares > 0);
  const tickers = uniqueTickers([
    ...state.stockPool,
    ...heldPositions.map((position) => position.ticker),
  ]);
  const quotesQuery = useQuotesQuery(tickers, marketRefreshKey);
  const quotes = quotesQuery.data ?? [];
  const priceByTicker = new Map(
    quotes
      .filter((quote) => quote.source !== "sample")
      .map((quote) => [quote.ticker, quote.price])
  );
  const changeByTicker = new Map(
    quotes
      .filter((quote) => quote.source !== "sample")
      .map((quote) => [quote.ticker, quote.change])
  );
  const signalByTicker = new Map(signals.map((signal) => [signal.ticker, signal]));
  const valuationPriceByTicker = new Map(priceByTicker);
  for (const signal of signals) {
    const signalPrice =
      signal.source === "sample" ? undefined : finiteNumber(signal.current_price);
    if (signalPrice !== undefined && !valuationPriceByTicker.has(signal.ticker)) {
      valuationPriceByTicker.set(signal.ticker, signalPrice);
    }
  }
  const holdingValue = holdingMarketValue(heldPositions, valuationPriceByTicker);
  const holdingDayChange = changeByTicker.size
    ? heldPositions.reduce((total, position) => {
        const change = changeByTicker.get(position.ticker);
        return change === undefined ? total : total + position.shares * change;
      }, 0)
    : undefined;
  const statusRows = derivedPositions
    .map((position) => {
      const signal = signalByTicker.get(position.ticker);
      const realSignal = signal?.source === "sample" ? undefined : signal;
      const quotePrice = priceByTicker.get(position.ticker);
      const price =
        quotePrice ?? finiteNumber(realSignal?.current_price) ?? position.costBasis;
      const isHeld = position.shares > 0;
      const isCostEstimate = isHeld && !realSignal && quotePrice === undefined;
      const marketValue =
        quotePrice === undefined
          ? finiteNumber(realSignal?.market_value) ?? position.shares * price
          : position.shares * price;
      const pnl = isHeld ? marketValue - position.holdingCost : undefined;
      const returnFromCost =
        pnl !== undefined && position.holdingCost > 0
          ? pnl / position.holdingCost
          : undefined;

      return {
        position,
        realSignal,
        price,
        isCostEstimate,
        pnl,
        returnFromCost,
        isHeld,
      };
    })
    .sort((first, second) =>
      comparePositionReturnsDescending(first.returnFromCost, second.returnFromCost)
    );

  return (
    <div className="flex flex-col gap-2">
      {quotesQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <OverviewPanel
          holdingCost={holdingCost}
          holdingValue={holdingValue}
          holdingDayChange={holdingDayChange}
        />
      )}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon />
            标的状态
          </CardTitle>
          <CardDescription>
            已持仓与仅观察标的的行情和客观技术指标
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>标的</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">删除观察标的</span>
                </TableHead>
                <TableHead className="text-right">现价</TableHead>
                <TableHead className="text-right">持仓成本</TableHead>
                <TableHead className="text-right">盈亏</TableHead>
                <TableHead className="text-right">技术指标</TableHead>
                <TableHead>技术状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statusRows.map(
                ({ position, realSignal, price, isCostEstimate, pnl, returnFromCost, isHeld }) => (
                  <TableRow key={position.ticker}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{position.ticker}</span>
                        <Badge variant="outline" className="w-fit">
                          {position.assetType}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="px-1">
                      {!isHeld ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => removePosition(position.ticker)}
                          aria-label={`删除观察标的 ${position.ticker}`}
                          title={`从总览删除 ${position.ticker}`}
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{formatMoney(price)}</div>
                      {isCostEstimate ? (
                        <div className="text-xs text-muted-foreground">成本估算</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isHeld ? (
                        <>
                          <div>{formatMoney(position.holdingCost)}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatShares(position.shares)} 股 x {formatMoney(position.costBasis)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">未持仓</span>
                      )}
                    </TableCell>
                    <TableCell className={signedCellClass(pnl)}>
                      {isHeld ? `${formatMoney(pnl)} / ${formatRatio(returnFromCost)}` : "--"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>MA {maLine(realSignal)}</div>
                      <div className="text-xs text-muted-foreground">
                        RSI {numberLabel(realSignal?.rsi, 1)} / 52 周回撤{" "}
                        {formatRatio(realSignal?.drawdown252 ?? realSignal?.drawdown)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={signalVariant(realSignal?.status)}>
                          {realSignal?.status ?? "等待真实行情"}
                        </Badge>
                        <span className="max-w-64 truncate text-xs text-muted-foreground">
                          {realSignal?.action ?? "样例行情不参与市值和信号计算"}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              )}
              {!statusRows.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    暂无跟踪标的，请到数据管理录入交易或选择仅观察。
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
