import type { ChartBar } from "@/features/charts/types";

export function formatPrice(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "--";
  }
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: value > 1000 ? 1 : 2,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatVolume(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "--";
  }
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(1)}万`;
  }
  return value.toLocaleString("zh-CN");
}

export function getChangeClass(value?: number | null) {
  if (!value) {
    return "text-muted-foreground";
  }
  return value > 0 ? "text-price-up" : "text-price-down";
}

export function getChangeBadgeClass(value?: number | null) {
  if (!value) {
    return "";
  }
  return value > 0
    ? "bg-price-up/10 text-price-up"
    : "bg-price-down/10 text-price-down";
}

export function summarizeBars(bars: ChartBar[]) {
  if (!bars.length) {
    return null;
  }

  const first = bars[0];
  const last = bars[bars.length - 1];
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  const volume = bars.reduce((total, bar) => total + (bar.volume ?? 0), 0);
  const change = last.close - first.open;
  const changePercent = first.open ? (change / first.open) * 100 : 0;

  return {
    startTime: first.time,
    endTime: last.time,
    open: first.open,
    close: last.close,
    high,
    low,
    volume,
    change,
    changePercent,
    count: bars.length,
  };
}
