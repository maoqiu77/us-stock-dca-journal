"use client";

import { ListFilterIcon } from "lucide-react";

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
  formatPercent,
  formatPrice,
  getChangeBadgeClass,
  getChangeClass,
} from "@/features/charts/format";
import type { Quote } from "@/features/charts/types";
import { cn } from "@/lib/utils";

export function WatchlistRail({
  quotes,
  selectedTicker,
  isLoading,
  onSelect,
}: {
  quotes: Quote[];
  selectedTicker: string;
  isLoading: boolean;
  onSelect: (ticker: string) => void;
}) {
  return (
    <Card className="min-h-[360px] xl:h-[calc(100svh-6.5rem)]">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <ListFilterIcon />
          自选股
        </CardTitle>
        <CardDescription>本地 watchlist，可替换为私有数据</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))
        ) : (
          quotes.map((quote) => {
            const selected = quote.ticker === selectedTicker;
            return (
              <Button
                key={quote.ticker}
                variant={selected ? "secondary" : "ghost"}
                className="h-auto w-full justify-start px-2 py-2"
                onClick={() => onSelect(quote.ticker)}
              >
                <div className="grid w-full min-w-0 grid-cols-[minmax(max-content,1fr)_auto] items-center gap-2 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 font-medium">{quote.ticker}</span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "min-w-fit shrink-0",
                          getChangeBadgeClass(quote.changePercent)
                        )}
                      >
                        {formatPercent(quote.changePercent)}
                      </Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {quote.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium tabular-nums">
                      {formatPrice(quote.price)}
                    </div>
                    <div
                      className={cn(
                        "text-xs tabular-nums",
                        getChangeClass(quote.changePercent)
                      )}
                    >
                      {quote.change !== null && quote.change >= 0 ? "+" : ""}
                      {formatPrice(quote.change)}
                    </div>
                  </div>
                </div>
              </Button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
