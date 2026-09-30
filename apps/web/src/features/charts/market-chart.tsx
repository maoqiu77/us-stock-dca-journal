"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import * as React from "react";

import {
  formatPrice,
  formatVolume,
  getChangeClass,
} from "@/features/charts/format";
import type { ChartBar, ChartResponse } from "@/features/charts/types";
import type { TradeRecord } from "@/features/platform/trading-data";

type ChartPoint = ChartBar & {
  chartTime: Time;
  formattedTime: string;
  ma20?: number;
  ma60?: number;
  ma120?: number;
  ma200?: number;
};

export function MarketChart({
  data,
  trades = [],
}: {
  data: ChartResponse;
  trades?: TradeRecord[];
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { resolvedTheme } = useTheme();
  const palette = React.useMemo(
    () => getChartPalette(resolvedTheme === "dark"),
    [resolvedTheme]
  );
  const chartPoints = React.useMemo(() => buildChartPoints(data), [data]);
  const pointByTime = React.useMemo(
    () => new Map(chartPoints.map((point) => [timeKey(point.chartTime), point])),
    [chartPoints]
  );
  const [activeTimeKey, setActiveTimeKey] = React.useState<string | null>(null);
  const activePoint =
    (activeTimeKey ? pointByTime.get(activeTimeKey) : undefined) ??
    chartPoints.at(-1) ??
    null;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !chartPoints.length) {
      return;
    }

    const {
      textColor,
      borderColor,
      upColor,
      downColor,
      volumeColor,
      ma20Color,
      ma60Color,
      ma120Color,
      ma200Color,
    } = palette;
    const isIntraday = isIntradayInterval(data.interval);
    const isFullHistory = data.range === "max" && !isIntraday;
    const shouldRenderLine = data.seriesType === "line";
    const includeDateOnTick = data.range !== "1d";
    const defaultVisibleBars = chartPoints.length;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: borderColor },
        horzLines: { color: borderColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor,
        scaleMargins: {
          top: 0.08,
          bottom: 0.26,
        },
      },
      timeScale: {
        borderColor,
        barSpacing: isFullHistory
          ? 0.2
          : isIntraday
            ? data.range === "1d"
              ? 8
              : 5
            : 6,
        minBarSpacing: isFullHistory ? 0.05 : 3,
        rightOffset: isFullHistory ? 1 : 6,
        timeVisible: isIntraday,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) =>
          formatChartTime(time, {
            includeDate: includeDateOnTick,
            isIntraday,
            timezone: isIntraday ? "UTC" : data.timezone ?? "UTC",
          }),
      },
      localization: {
        timeFormatter: (time: Time) =>
          formatChartTime(time, {
            includeDate: true,
            isIntraday,
            timezone: isIntraday ? "UTC" : data.timezone ?? "UTC",
          }),
      },
    });

    if (shouldRenderLine) {
      const lineSeries = chart.addSeries(LineSeries, {
        color: upColor,
        lineWidth: 2,
        priceLineVisible: false,
      });
      lineSeries.setData(
        chartPoints.map<LineData>((bar) => ({
          time: bar.chartTime,
          value: bar.close,
        }))
      );
    } else {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        borderVisible: false,
        wickUpColor: upColor,
        wickDownColor: downColor,
        priceLineVisible: false,
      });
      candleSeries.setData(
        chartPoints.map<CandlestickData>((bar) => ({
          time: bar.chartTime,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        }))
      );
      const markers = buildTradeMarkers(trades, chartPoints, isIntraday, {
        upColor,
        downColor,
      });
      if (markers.length) {
        createSeriesMarkers(candleSeries, markers, { zOrder: "aboveSeries" });
      }
    }

    addMovingAverageSeries(chart, chartPoints, 20, ma20Color);
    addMovingAverageSeries(chart, chartPoints, 60, ma60Color);
    addMovingAverageSeries(chart, chartPoints, 120, ma120Color);
    addMovingAverageSeries(chart, chartPoints, 200, ma200Color);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: volumeColor,
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.setData(
      chartPoints.filter((bar) => bar.volume !== null).map<HistogramData>((bar) => ({
        time: bar.chartTime,
        value: bar.volume as number,
        color: bar.close >= bar.open ? upColor : downColor,
      }))
    );
    chart.priceScale("").applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });
    if (defaultVisibleBars < chartPoints.length) {
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(chartPoints.length - defaultVisibleBars, 0),
        to: chartPoints.length - 1,
      });
    } else {
      chart.timeScale().fitContent();
    }

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setActiveTimeKey(null);
        return;
      }
      setActiveTimeKey(timeKey(param.time));
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    resizeObserver.observe(container);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [chartPoints, data.interval, data.range, data.seriesType, data.timezone, palette, trades]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChartReadout point={activePoint} palette={palette} />
      {chartPoints.length ? (
        <div ref={containerRef} className="h-[520px] min-h-[360px] w-full" />
      ) : (
        <div className="flex h-[520px] min-h-[360px] items-center justify-center px-4 text-sm text-muted-foreground">
          {data.message ?? "暂无行情数据"}
        </div>
      )}
    </div>
  );
}

function getChartPalette(isDark: boolean) {
  // lightweight-charts cannot parse oklch/lab theme tokens yet, so canvas uses
  // stable sRGB equivalents of the semantic app colors.
  if (isDark) {
    return {
      textColor: "#a3a3a3",
      borderColor: "rgba(255,255,255,0.12)",
      upColor: "#4ade80",
      downColor: "#f87171",
      volumeColor: "#94a3b8",
      ma20Color: "#60a5fa",
      ma60Color: "#facc15",
      ma120Color: "#22d3ee",
      ma200Color: "#c084fc",
    };
  }

  return {
    textColor: "#737373",
    borderColor: "#e5e5e5",
    upColor: "#16a34a",
    downColor: "#dc2626",
    volumeColor: "#64748b",
    ma20Color: "#2563eb",
    ma60Color: "#ca8a04",
    ma120Color: "#0891b2",
    ma200Color: "#9333ea",
  };
}

function ChartReadout({
  point,
  palette,
}: {
  point: ChartPoint | null;
  palette: ReturnType<typeof getChartPalette>;
}) {
  const change = point ? point.close - point.open : undefined;
  const changePercent = point?.open ? (change ?? 0) / point.open : undefined;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-xs">
      <span className="font-medium">{point?.formattedTime ?? "--"}</span>
      <ReadoutItem label="开" value={formatPrice(point?.open)} />
      <ReadoutItem label="高" value={formatPrice(point?.high)} />
      <ReadoutItem label="低" value={formatPrice(point?.low)} />
      <ReadoutItem label="收" value={formatPrice(point?.close)} />
      <span className={getChangeClass(change)}>
        {change === undefined
          ? "--"
          : `${change > 0 ? "+" : ""}${formatPrice(change)} / ${((changePercent ?? 0) * 100).toFixed(2)}%`}
      </span>
      <ReadoutItem label="量" value={formatVolume(point?.volume)} />
      <ReadoutItem label="MA20" value={formatPrice(point?.ma20)} color={palette.ma20Color} />
      <ReadoutItem label="MA60" value={formatPrice(point?.ma60)} color={palette.ma60Color} />
      <ReadoutItem label="MA120" value={formatPrice(point?.ma120)} color={palette.ma120Color} />
      <ReadoutItem label="MA200" value={formatPrice(point?.ma200)} color={palette.ma200Color} />
    </div>
  );
}

function ReadoutItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <span
      className="tabular-nums text-muted-foreground"
      style={color ? { color } : undefined}
    >
      {label} <span className={color ? undefined : "text-foreground"}>{value}</span>
    </span>
  );
}

function buildChartPoints(data: ChartResponse): ChartPoint[] {
  const isIntraday = isIntradayInterval(data.interval);
  const timezone = data.timezone ?? "UTC";
  const chartTimezone = isIntraday ? "UTC" : timezone;
  const basePoints = data.bars.map((bar) => {
    const chartTime = toChartTime(bar.time, { isIntraday, timezone });
    return {
      ...bar,
      chartTime,
      formattedTime: formatChartTime(chartTime, {
        includeDate: true,
        isIntraday,
        timezone: chartTimezone,
      }),
    };
  });
  return applyMovingAverages(basePoints);
}

function applyMovingAverages(points: Omit<ChartPoint, "ma20" | "ma60" | "ma120" | "ma200">[]) {
  const ma20 = movingAverage(points, 20);
  const ma60 = movingAverage(points, 60);
  const ma120 = movingAverage(points, 120);
  const ma200 = movingAverage(points, 200);
  return points.map((point, index) => ({
    ...point,
    ma20: ma20[index],
    ma60: ma60[index],
    ma120: ma120[index],
    ma200: ma200[index],
  }));
}

function addMovingAverageSeries(
  chart: ReturnType<typeof createChart>,
  points: ChartPoint[],
  period: 20 | 60 | 120 | 200,
  color: string
) {
  const series = chart.addSeries(LineSeries, {
    color,
    lineWidth: period <= 60 ? 2 : 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  series.setData(
    points
      .map<LineData | null>((point) => {
        const value = point[`ma${period}`];
        return value === undefined ? null : { time: point.chartTime, value };
      })
      .filter((point): point is LineData => Boolean(point))
  );
}

function movingAverage(points: Array<{ close: number }>, period: number) {
  let sum = 0;
  return points.map((point, index) => {
    sum += point.close;
    if (index >= period) {
      sum -= points[index - period].close;
    }
    if (index < period - 1) {
      return undefined;
    }
    return sum / period;
  });
}

function buildTradeMarkers(
  trades: TradeRecord[],
  points: ChartPoint[],
  isIntraday: boolean,
  colors: { upColor: string; downColor: string }
): SeriesMarker<Time>[] {
  if (isIntraday || !trades.length) {
    return [];
  }
  const availableDates = new Set(
    points
      .map((point) => (typeof point.chartTime === "string" ? point.chartTime : ""))
      .filter(Boolean)
  );
  return trades
    .filter((trade) => availableDates.has(trade.date))
    .sort((first, second) => first.date.localeCompare(second.date))
    .map((trade) => ({
      id: trade.id,
      time: trade.date as Time,
      position: trade.action === "买入" ? "belowBar" : "aboveBar",
      shape: trade.action === "买入" ? "arrowUp" : "arrowDown",
      color: trade.action === "买入" ? colors.upColor : colors.downColor,
      text: formatTradeMarkerAmount(trade.amount),
      size: 1,
    }));
}

function formatTradeMarkerAmount(amount: number) {
  return Number.isFinite(amount) ? amount.toFixed(1) : "0.0";
}

function timeKey(value: Time) {
  return typeof value === "object" ? `${value.year}-${value.month}-${value.day}` : String(value);
}

function toChartTime(
  value: string,
  { isIntraday, timezone }: { isIntraday: boolean; timezone: string }
): Time {
  if (value.includes("T")) {
    const date = new Date(value);
    if (isIntraday) {
      return toZonedWallClockTimestamp(date, timezone);
    }
    return Math.floor(date.getTime() / 1000) as UTCTimestamp;
  }
  return value as Time;
}

function isIntradayInterval(interval: string) {
  return !["1d", "1wk", "1mo"].includes(interval);
}

function formatChartTime(
  value: Time,
  {
    includeDate,
    isIntraday,
    timezone,
  }: { includeDate: boolean; isIntraday: boolean; timezone: string }
) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    const date = new Date(value * 1000);
    if (!isIntraday) {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    }
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      month: includeDate ? "2-digit" : undefined,
      day: includeDate ? "2-digit" : undefined,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(
    value.day
  ).padStart(2, "0")}`;
}

function toZonedWallClockTimestamp(value: Date, timezone: string): UTCTimestamp {
  const parts = getZonedDateTimeParts(value, timezone);
  if (!parts) {
    return Math.floor(value.getTime() / 1000) as UTCTimestamp;
  }
  return Math.floor(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    ) / 1000
  ) as UTCTimestamp;
}

function getZonedDateTimeParts(value: Date, timezone: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(value)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    };
  } catch {
    return null;
  }
}
