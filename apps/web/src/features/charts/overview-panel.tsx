import { LayoutDashboardIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getChangeClass } from "@/features/charts/format";
import { formatMoney, formatRatio } from "@/features/platform/trading-data";
import { cn } from "@/lib/utils";

export function OverviewPanel({
  holdingCost,
  holdingValue,
  holdingDayChange,
}: {
  holdingCost?: number;
  holdingValue?: number;
  holdingDayChange?: number;
}) {
  const totalReturn =
    holdingCost && holdingCost > 0 && holdingValue !== undefined
      ? (holdingValue - holdingCost) / holdingCost
      : undefined;
  const totalPnl =
    holdingCost && holdingCost > 0 && holdingValue !== undefined
      ? holdingValue - holdingCost
      : undefined;
  const dayReturn =
    holdingDayChange !== undefined &&
    holdingValue !== undefined &&
    holdingValue - holdingDayChange > 0
      ? holdingDayChange / (holdingValue - holdingDayChange)
      : undefined;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <LayoutDashboardIcon />
          资产表现
        </CardTitle>
        <CardDescription>当前持仓的累计盈亏与今日变动</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        <OverviewMetric
          label="总资产盈亏"
          value={formatTotalReturn(totalReturn, totalPnl)}
          detail="当前持仓市值 - 持仓成本"
          valueClassName={getChangeClass(totalPnl)}
        />
        <OverviewMetric
          label="今日变动"
          value={formatDayChange(holdingDayChange, dayReturn)}
          detail="持仓数量 x 单股今日变动"
          valueClassName={getChangeClass(holdingDayChange)}
        />
      </CardContent>
    </Card>
  );
}

function formatTotalReturn(returnValue?: number, pnl?: number) {
  if (returnValue === undefined || pnl === undefined || Number.isNaN(returnValue)) {
    return "--";
  }
  return `${formatMoney(pnl)} / ${formatRatio(returnValue)}`;
}

function formatDayChange(change?: number, returnValue?: number) {
  if (change === undefined || Number.isNaN(change)) {
    return "--";
  }
  return `${formatMoney(change)} / ${formatRatio(returnValue)}`;
}

function OverviewMetric({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-h-24 flex-col justify-between gap-2 rounded-lg bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", valueClassName)}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
