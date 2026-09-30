export type TimeframeKey = "1D" | "5D" | "D" | "W" | "M";

export type TimeframeConfig = {
  key: TimeframeKey;
  label: string;
  description: string;
  range: string;
  interval: string;
};

export const TIMEFRAMES: TimeframeConfig[] = [
  {
    key: "1D",
    label: "1日",
    description: "1日K线",
    range: "1d",
    interval: "5m",
  },
  {
    key: "5D",
    label: "五日",
    description: "五日分时",
    range: "5d",
    interval: "15m",
  },
  {
    key: "D",
    label: "日K",
    description: "五年日K",
    range: "5y",
    interval: "1d",
  },
  {
    key: "W",
    label: "周K",
    description: "十年周K",
    range: "10y",
    interval: "1wk",
  },
  {
    key: "M",
    label: "月K",
    description: "十年月K",
    range: "10y",
    interval: "1mo",
  },
];

export type WatchlistItem = {
  ticker: string;
  name: string;
  market: string;
};

export type Quote = WatchlistItem & {
  price: number;
  change: number;
  changePercent: number;
  volume: number | null;
  source: "yfinance" | "sample" | string;
};

export type ChartBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type ChartResponse = {
  ticker: string;
  range: string;
  interval: string;
  seriesType: "line" | "candlestick";
  timezone?: string;
  source: "yfinance" | "sample" | string;
  lastUpdated: string;
  message?: string;
  bars: ChartBar[];
};
