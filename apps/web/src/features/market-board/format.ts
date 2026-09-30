import type { BoardRow, ObservationMeta, ObservationStatus, PurchaseLimit } from "./types";
export function numeric(value: string | null | undefined): number | null { return value == null || !value.trim() || !Number.isFinite(Number(value)) ? null : Number(value); }
export function marketTone(value: string | null | undefined): string { const n = numeric(value); return n == null || n === 0 ? "" : n > 0 ? "text-price-up" : "text-price-down"; }
export function formatNumber(value: string | null | undefined) { const n = numeric(value); return n == null ? "--" : n.toLocaleString("zh-CN", { maximumFractionDigits: 4 }); }
export function formatAmount(value: string | null | undefined, currency = "CNY") { const n = numeric(value); return n == null ? "--" : (currency === "USD" ? "$" : "¥") + n.toLocaleString("zh-CN", { maximumFractionDigits: 4 }); }
export function formatPercent(value: string | null | undefined) { const n = numeric(value); return n == null ? "--" : n.toFixed(2) + "%"; }
export function formatShares(value: string | null | undefined) { const n = numeric(value); return n == null ? "--" : (n / 10000).toLocaleString("zh-CN", {maximumFractionDigits:2}) + " 万份"; }
export function formatVolume(value: string | null | undefined, unit?: string | null) { const n = numeric(value); const unitLabel=({shares:"股",feed_shares:"股（供应商口径）"} as Record<string,string>)[unit??""]??"单位未知"; return n == null ? "--" : n.toLocaleString("zh-CN") + " " + unitLabel; }
export const statusLabels: Record<ObservationStatus,string> = {sample:"示例数据",missing:"数据缺失",stale:"旧缓存",partial:"字段不完整",available:"可用"};
export const timelinessLabels: Record<string,string> = {eod:"日终",delayed:"延迟",realtime:"实时",unknown:"未知"};
export const cacheStateLabels: Record<string,string> = {fresh_hit:"已缓存",stale_hit:"旧缓存",miss:"本次获取"};
export function qualityLabel(row: Pick<BoardRow,"quality">) { return statusLabels[row.quality] ?? "状态未知"; }
export function sessionLabel(value?: string) { return ({pre:"盘前",regular:"盘中",post:"盘后",closed:"收盘",unknown:"时段未知"} as Record<string,string>)[value ?? "unknown"] ?? "时段未知"; }
export function limitLabel(limit?: PurchaseLimit | null) { if (!limit) return "未知"; return limit.state === "limited" ? formatAmount(limit.amount, limit.currency) : ({unlimited:"不限额",suspended:"暂停申购",unknown:"未知"} as Record<string,string>)[limit.state] ?? "未知"; }
export function basisLabel(value?: string) { return ({nav:"正式 NAV",iopv:"IOPV",vendor_reference:"供应商参考值（非实时溢价）"} as Record<string,string>)[value ?? ""] ?? "不可计算"; }
export function observationTime(value?: string | null) {
 if (!value) return "未知";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return "未知";
 const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date).map(part => [part.type, part.value]));
 return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute} 北京时间`;
}
export function formatFetchedAt(value?: string | null) {
 if (!value) return "--";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return "--";
 const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date).map(part => [part.type, part.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} 北京时间`;
}
export function observationLabel(meta?: ObservationMeta | null) {
 if (!meta) return "未知";
 let observed = observationTime(meta.as_of);
 if (meta.source.includes("正式净值档案") && meta.as_of) {
  const date = new Date(meta.as_of);
  if (!Number.isNaN(date.getTime())) {
   const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).map(part => [part.type, part.value]));
   observed = `${parts.year}-${parts.month}-${parts.day} 净值日期`;
  }
 }
 return observed;
}
export function metaSummary(meta?: ObservationMeta | null) { return meta ? `${meta.source} · ${statusLabels[meta.status]} · ${observationLabel(meta)}` : "来源与观察时间未知"; }
