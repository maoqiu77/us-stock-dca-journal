import type { ChartResponse } from "@/features/charts/types";
import type { Series } from "../market-board/types";

export function toBoardChartData(series: Series): ChartResponse {
  return {
    ticker: series.instrument_key,
    range: series.range,
    interval: series.period === "1d" ? "1d" : series.period,
    seriesType: "candlestick",
    timezone: series.timezone,
    source: series.meta.source,
    lastUpdated: series.meta.fetched_at,
    message: series.meta.status === "sample" ? "示例数据，非真实行情" : series.meta.reason ?? undefined,
    bars: series.bars.map((bar) => ({ time: bar.trading_date ?? bar.time, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: bar.volume == null ? null : Number(bar.volume) })),
  };
}
