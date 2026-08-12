"use client";

import {
  ActivityIcon,
  ArrowRightIcon,
  DatabaseIcon,
  ListChecksIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { OverviewPanel } from "@/features/charts/overview-panel";
import { formatPrice } from "@/features/charts/format";
import { useQuotesQuery } from "@/features/charts/queries";
import { useSignalsQuery } from "@/features/platform/queries";
import type { SignalRow } from "@/features/platform/api";
import {
  dynamicCash,
  formatMoney,
  formatRatio,
  formatShares,
  holdingMarketValue,
} from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";
import {
  platformNavItems,
  type PlatformView,
} from "@/features/platform/types";
import { cn } from "@/lib/utils";

export function DashboardView({
  marketRefreshKey = 0,
  onNavigate,
}: {
  marketRefreshKey?: number;
  onNavigate: (view: PlatformView) => void;
}) {
  const signalsQuery = useSignalsQuery();
  const signals = signalsQuery.data ?? [];
  const {
    state,
    derivedPositions,
    holdingCost,
    cash,
    validationIssues,
    activeStrategyProfile,
    storageStatus,
  } = useTradingData();
  const tickers = state.stockPool;
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
  const holdingValue = holdingMarketValue(derivedPositions, valuationPriceByTicker);
  const holdingDayChange = changeByTicker.size
    ? derivedPositions.reduce((total, position) => {
        const change = changeByTicker.get(position.ticker);
        return change === undefined ? total : total + position.shares * change;
      }, 0)
    : undefined;
  const holdingReturn =
    holdingCost > 0 ? (holdingValue - holdingCost) / holdingCost : undefined;
  const accountCash = dynamicCash(state.account.totalAssets, holdingCost);
  const quoteSources = new Set(quotes.map((quote) => quote.source));
  const marketSource =
    quotes.length === 0
      ? "loading"
      : quoteSources.size === 1
        ? (quotes[0]?.source ?? "loading")
        : "mixed";
  const marketSourceDescription =
    marketSource === "sample"
      ? "当前为样例行情，未返回可用最新数据"
      : marketSource === "yfinance"
        ? "当前报价来自 yfinance"
        : marketSource === "nasdaq"
          ? "当前报价来自 Nasdaq 延迟行情"
          : "多个行情源混合返回";

  return (
    <div className="flex flex-col gap-3">
      {quotesQuery.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <OverviewPanel
          quotes={quotes}
          holdingCost={holdingCost}
          holdingValue={holdingValue}
          holdingDayChange={holdingDayChange}
        />
      )}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <WalletCardsIcon />
              账户总览
            </CardTitle>
            <CardDescription>
              现金按总资产减持仓成本推算，市值和浮盈单独展示
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <AccountMetric
              label="总资产"
              value={formatMoney(state.account.totalAssets)}
              orientation="vertical"
            />
            <AccountMetric
              label="现金"
              value={formatMoney(accountCash)}
              orientation="vertical"
            />
            <AccountMetric
              label="持仓成本"
              value={formatMoney(holdingCost)}
              orientation="vertical"
            />
            <AccountMetric
              label="持仓市值"
              value={formatMoney(holdingValue)}
              orientation="vertical"
            />
            <AccountMetric
              label="成本收益率"
              value={formatRatio(holdingReturn)}
              orientation="vertical"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ListChecksIcon />
              数据状态
            </CardTitle>
            <CardDescription>设置、流水、策略的当前可用性</CardDescription>
            <CardAction>
              <Badge variant={validationIssues.length ? "outline" : "secondary"}>
                {validationIssues.length ? "needs-fix" : "ready"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <AccountMetric label="股票池" value={`${state.stockPool.length} 个标的`} />
            <AccountMetric label="交易流水" value={`${state.trades.length} 条`} />
            <AccountMetric label="当前策略" value={activeStrategyProfile.name} />
            <AccountMetric label="可用现金" value={formatMoney(cash)} />
            <AccountMetric label="状态库" value={storageStatusLabel(storageStatus)} />
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon />
              标的状态
            </CardTitle>
            <CardDescription>
              合并持仓成本、浮动盈亏、均线、RSI、回撤和今日加减仓信号
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>标的</TableHead>
                  <TableHead className="text-right">现价</TableHead>
                  <TableHead className="text-right">持仓</TableHead>
                  <TableHead className="text-right">成本/市值</TableHead>
                  <TableHead className="text-right">盈亏</TableHead>
                  <TableHead className="text-right">仓位</TableHead>
                  <TableHead className="text-right">技术指标</TableHead>
                  <TableHead>今日信号</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {derivedPositions.map((position) => {
                  const signal = signalByTicker.get(position.ticker);
                  const realSignal = signal?.source === "sample" ? undefined : signal;
                  const quotePrice = priceByTicker.get(position.ticker);
                  const price =
                    quotePrice ??
                    finiteNumber(realSignal?.current_price) ??
                    position.costBasis;
                  const isCostEstimate = !realSignal && quotePrice === undefined;
                  const marketValue =
                    quotePrice === undefined
                      ? finiteNumber(realSignal?.market_value) ??
                        position.shares * price
                      : position.shares * price;
                  const pnl = marketValue - position.holdingCost;
                  const returnFromCost =
                    position.holdingCost > 0 ? pnl / position.holdingCost : undefined;
                  const currentWeight =
                    realSignal?.current_weight ??
                    (state.account.totalAssets > 0
                      ? marketValue / state.account.totalAssets
                      : 0);
                  return (
                    <TableRow key={position.ticker}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{position.ticker}</span>
                          <Badge variant="outline" className="w-fit">
                            {position.assetType}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{formatMoney(price)}</div>
                        {isCostEstimate ? (
                          <div className="text-xs text-muted-foreground">
                            成本估算
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{formatShares(position.shares)} 股</div>
                        <div className="text-xs text-muted-foreground">
                          成本价 {formatMoney(position.costBasis)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{formatMoney(position.holdingCost)}</div>
                        <div className="text-xs text-muted-foreground">
                          市值 {formatMoney(marketValue)}
                        </div>
                      </TableCell>
                      <TableCell className={signedCellClass(pnl)}>
                        {formatMoney(pnl)} / {formatRatio(returnFromCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{formatRatio(currentWeight)}</div>
                        <div className="text-xs text-muted-foreground">
                          目标 {formatRatio(position.targetWeight)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>MA {maLine(realSignal)}</div>
                        <div className="text-xs text-muted-foreground">
                          RSI {numberLabel(realSignal?.rsi, 1)} / 52 周回撤 {formatRatio(realSignal?.drawdown252 ?? realSignal?.drawdown)}
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
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>工作流</CardTitle>
            <CardDescription>行情、策略、AI、数据的主入口</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {platformNavItems
              .filter((item) => item.id !== "overview")
              .map((item) => (
                <div key={item.id} className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <item.icon />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {item.title}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onNavigate(item.id)}
                    >
                      <ArrowRightIcon />
                      <span className="sr-only">打开{item.title}</span>
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <StatusCard
          icon={<ShieldCheckIcon />}
          title="提交安全"
          description="storage/local 与 .env 已排除提交"
          badge="ready"
        />
        <StatusCard
          icon={<DatabaseIcon />}
          title="数据源"
          description={marketSourceDescription}
          badge={marketSource}
        />
      </div>
    </div>
  );
}

function AccountMetric({
  label,
  value,
  orientation = "row",
}: {
  label: string;
  value: string;
  orientation?: "row" | "vertical";
}) {
  const isVertical = orientation === "vertical";
  return (
    <div
      className={cn(
        "rounded-lg bg-muted/50 p-3",
        isVertical
          ? "flex min-h-20 flex-col justify-between gap-2"
          : "flex items-center justify-between gap-3"
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words font-medium tabular-nums",
          isVertical ? "text-lg" : "text-right"
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  description,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant="secondary">{badge}</Badge>
        </CardAction>
      </CardHeader>
    </Card>
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
  return ["允许加仓", "建议减仓", "风险减仓"].includes(status)
    ? "secondary"
    : "outline";
}

function storageStatusLabel(status: string) {
  if (status === "api") {
    return "SQLite";
  }
  if (status === "saving") {
    return "保存中";
  }
  if (status === "loading") {
    return "加载中";
  }
  if (status === "error") {
    return "本地兜底";
  }
  return "localStorage";
}
