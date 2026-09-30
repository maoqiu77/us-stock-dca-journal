"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/features/charts/market-chart";
import { toBoardChartData } from "./board-chart-data";
import {formatFetchedAt,statusLabels} from "../market-board/format";
import type { Series } from "../market-board/types";

export function BoardChart({ series }: { series: Series }) {
  const chart = React.useMemo(() => toBoardChartData(series), [series]);
  const latest = series.bars.at(-1);
  return <Card><CardHeader><CardTitle>日 K · {series.range}</CardTitle></CardHeader><CardContent>{latest&&!latest.is_final?<p className="mb-2 text-xs text-muted-foreground">最新日 K 尚未收盘；图中的收盘价和均线仍可能变化。</p>:null}<MarketChart data={chart} /><p className="mt-2 text-xs text-muted-foreground">币种：{series.currency} · 复权：{series.adjustment} · 来源：{series.meta.source} · {series.meta.status === "sample" ? "示例数据，非真实行情" : statusLabels[series.meta.status]} · 观察：{series.meta.as_of??"未知"} · 获取：{formatFetchedAt(series.meta.fetched_at)}</p></CardContent></Card>;
}
