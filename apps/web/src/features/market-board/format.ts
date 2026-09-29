import type { BoardRow } from "./types";
export function formatAmount(value: string | null | undefined, currency = "CNY") { if (value == null) return "--"; return `${currency === "USD" ? "$" : "¥"}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}`; }
export function formatPercent(value: string | null | undefined) { return value == null ? "--" : `${Number(value).toFixed(2)}%`; }
export function qualityLabel(row: BoardRow) { return row.quality === "sample" ? "示例数据" : row.quality === "missing" ? "数据缺失" : row.quality === "stale" ? "已过期" : "可用"; }

