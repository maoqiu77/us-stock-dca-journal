import { ActivityIcon, WalletIcon } from "lucide-react";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { getChangeBadgeClass, getChangeClass } from "@/features/charts/format";
import { formatMoney, formatRatio } from "@/features/platform/trading-data";
import { cn } from "@/lib/utils";

export function OverviewPanel({
  holdingValue,
  holdingPnl,
  holdingPnlRatio,
  holdingDayChange,
  marketCoverage,
  pnlCoverage,
  dayChangeCoverage,
}: {
  holdingValue?: number | null;
  holdingPnl?: number | null;
  holdingPnlRatio?: number | null;
  holdingDayChange?: number | null;
  marketCoverage?: string;
  pnlCoverage?: string;
  dayChangeCoverage?: string;
}) {
  const dayReturn =
    holdingDayChange !== undefined &&
    holdingDayChange !== null &&
    holdingValue !== undefined &&
    holdingValue !== null &&
    holdingValue - holdingDayChange > 0
      ? holdingDayChange / (holdingValue - holdingDayChange)
      : undefined;

  return (
    <div className="flex flex-col gap-2">
      <section aria-label="资产表现" className="grid grid-cols-2 gap-3">
        <OverviewMetric
          label="持仓浮动盈亏"
          value={formatMoney(holdingPnl)}
          ratio={formatRatio(holdingPnlRatio)}
          detail={pnlCoverage ?? "仅对同时有报价和成本的持仓计算"}
          valueClassName={getChangeClass(holdingPnl)}
          badgeClassName={getChangeBadgeClass(holdingPnl)}
          icon={<WalletIcon className="size-4" />}
        />
        <OverviewMetric
          label="今日变动"
          value={formatMoney(holdingDayChange)}
          ratio={formatRatio(dayReturn)}
          detail={dayChangeCoverage ?? "需要当前价和昨收；不代表完整账户日盈亏"}
          valueClassName={getChangeClass(holdingDayChange)}
          badgeClassName={getChangeBadgeClass(holdingDayChange)}
          icon={<ActivityIcon className="size-4" />}
        />
      </section>
      {marketCoverage ? <p className="text-xs text-muted-foreground">市值覆盖：{marketCoverage}</p> : null}
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  ratio,
  detail,
  valueClassName,
  badgeClassName,
  icon,
}: {
  label: string;
  value: string;
  ratio: string;
  detail: string;
  valueClassName?: string;
  badgeClassName?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0 shadow-xs ring-border">
      <CardContent className="flex flex-col gap-3 p-3 sm:p-4 lg:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
          <span className="hidden size-8 items-center justify-center rounded-lg bg-primary/8 text-primary sm:flex">{icon}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={cn("break-all text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl lg:text-4xl", valueClassName)}>{value}</div>
          <span className={cn("rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums", badgeClassName)}>{ratio}</span>
        </div>
        <p className="text-[13px] text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
