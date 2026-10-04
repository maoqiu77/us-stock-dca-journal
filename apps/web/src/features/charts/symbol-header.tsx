import { Badge } from "@/components/ui/badge";
import {
  getChangeBadgeClass,
  getChangeClass,
  formatPercent,
  formatPrice,
  formatVolume,
} from "@/features/charts/format";
import type { Quote, TimeframeConfig } from "@/features/charts/types";
import { cn } from "@/lib/utils";

export function SymbolHeader({
  ticker,
  quote,
  timeframe,
}: {
  ticker: string;
  quote?: Quote;
  timeframe: TimeframeConfig;
}) {
  const change = quote?.changePercent;

  return (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold leading-tight md:text-2xl">
            {ticker}
          </h1>
          {quote?.market ? <Badge variant="outline">{quote.market}</Badge> : null}
          <Badge variant="secondary" className={getChangeBadgeClass(change)}>
            {quote?.source ?? "loading"}
          </Badge>
        </div>
        <div className="mt-1 truncate text-sm text-muted-foreground">
          {quote?.name ?? "加载标的信息"} · {timeframe.description}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-3 md:justify-end">
        <div className="text-2xl font-semibold tabular-nums">
          {formatPrice(quote?.price)}
        </div>
        <div className={cn("text-sm font-medium tabular-nums", getChangeClass(change))}>
          {quote ? `${quote.change !== null && quote.change >= 0 ? "+" : ""}${formatPrice(quote.change)} ${formatPercent(change)}` : "--"}
        </div>
        <div className="text-xs text-muted-foreground">
          Vol {formatVolume(quote?.volume)}
        </div>
      </div>
    </div>
  );
}
