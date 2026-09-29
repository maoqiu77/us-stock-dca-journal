"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/features/charts/market-chart";
import { toBoardChartData } from "./board-chart-data";
import type { Series } from "./types";

export function BoardChart({ series }: { series: Series }) {
  const chart = React.useMemo(() => toBoardChartData(series), [series]);
  return <Card><CardHeader><CardTitle>日 K · {series.range}</CardTitle></CardHeader><CardContent><MarketChart data={chart} /><p className="mt-2 text-xs text-muted-foreground">币种：{series.currency} · 复权：{series.adjustment} · 来源：{series.meta.source} · {series.meta.status === "sample" ? "示例数据，非真实行情" : series.meta.status}</p></CardContent></Card>;
}
