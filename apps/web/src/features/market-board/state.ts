import type { BoardRow, Instrument, Segment } from "./types";
export function moveSelection(keys: string[], key: string, to: number) { if (!keys.includes(key)) return [...keys]; const next = keys.filter(item => item !== key); next.splice(Math.max(0, Math.min(to, next.length)), 0, key); return next; }
export function removeSelection(keys: string[], removed: string[]) { const set = new Set(removed); return keys.filter(key => !set.has(key)); }
export function selectionNeedsReload(keys: string[], rows: BoardRow[]) { const loaded = new Set(rows.map(row => row.instrument.key)); return keys.some(key => !loaded.has(key)); }
export function matchesSegment(item: Instrument, segment: Segment) { return segment === "us" ? item.market === "US" && ["STOCK","ETF"].includes(item.asset_type) : item.market === "CN" && item.asset_type === (segment === "etf" ? "ETF" : "FUND"); }
export function sortRows(rows: BoardRow[], field: string, ascending: boolean) {
 const value = (row: BoardRow): string | null | undefined => {
  if (field === "name" || field === "symbol") return row.instrument[field];
  if (field === "amount") return row.purchase_limit?.state === "limited" ? row.purchase_limit.amount : null;
  if (["premium_pct","percentile60","shares","shares_change"].includes(field)) return row.metrics?.[field as "premium_pct"];
  return row.quote?.[field as "price" | "change_pct"] ?? row.nav?.[field as "value" | "change_pct"];
 };
 return rows.map((row,index)=>({row,index})).sort((a,b)=>{
  const av=value(a.row), bv=value(b.row); const text=field === "name" || field === "symbol";
  const x=av == null || av === "" ? null : text ? av : Number(av), y=bv == null || bv === "" ? null : text ? bv : Number(bv);
  const missingX=x == null || typeof x === "number" && !Number.isFinite(x), missingY=y == null || typeof y === "number" && !Number.isFinite(y);
  if(missingX || missingY) return missingX && missingY ? a.index-b.index : missingX ? 1 : -1;
  const diff=text ? String(x).localeCompare(String(y),"zh-CN",{numeric:true}) : Number(x)-Number(y);
  return diff * (ascending ? 1 : -1) || a.index-b.index;
 }).map(item=>item.row);
}
