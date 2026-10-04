import { decimal, decimalText } from "@portfolio/domain";
import type { TradingDataState, TradeRecord } from "./trading-data.ts";

export type CheckpointRow = {
  ticker: string; market: "US" | "HKEX" | "CN"; currency: "USD" | "HKD" | "CNY";
  assetType: "STOCK" | "ETF"; shareClass: string; instrumentId: string;
  quantity: string; totalCost: string;
};
export type Checkpoint = {
  id: string; kind: "position_checkpoint"; observedAt: string; recordedAt: string;
  throughDate: string; baseRevision: string; scope: "partial" | "complete";
  historyComplete: false; source: { kind: "screenshot" | "manual" | "migration"; reference: string };
  rows: CheckpointRow[]; retainedTickers: string[]; baseline: TradeRecord[];
};

export const tradeEvidence = (row: TradeRecord) => [row.id, row.ticker, row.date, row.action, String(row.shares), String(row.unitPrice), String(row.amount)];
export const identity = (row: Omit<CheckpointRow, "instrumentId" | "quantity" | "totalCost">) => [row.market, row.ticker, row.assetType, row.currency, row.shareClass].join(":");
const day = (stamp: string) => new Date(stamp).toISOString().slice(0, 10);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function validateCheckpoints(state: TradingDataState) {
  if (state.schemaVersion === 1 && state.checkpoints?.length) throw new Error("校准需要版本 2 账本");
  const ids = new Set<string>();
  const identities = new Map<string, string>();
  for (const cp of state.checkpoints ?? []) {
    if (!cp.id || ids.has(cp.id) || cp.kind !== "position_checkpoint" || !cp.baseRevision || cp.historyComplete !== false || !["partial", "complete"].includes(cp.scope)) throw new Error("校准批次格式或 ID 无效");
    ids.add(cp.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cp.throughDate) || !/Z$|[+-]\d\d:\d\d$/.test(cp.observedAt) || !/Z$|[+-]\d\d:\d\d$/.test(cp.recordedAt) || !Number.isFinite(Date.parse(cp.observedAt)) || Date.parse(cp.recordedAt) < Date.parse(cp.observedAt) || day(cp.throughDate + "T00:00:00Z") !== cp.throughDate) throw new Error("校准观察时间无效");
    if (!cp.source?.reference || !["screenshot", "manual", "migration"].includes(cp.source.kind) || !cp.rows.length || new Set(cp.rows.map(row => row.ticker)).size !== cp.rows.length) throw new Error("来源缺失或校准标的重复");
    for (const row of cp.rows) {
      if (!row.ticker || row.ticker !== row.ticker.trim().toUpperCase() || !state.stockPool.includes(row.ticker) || !["US", "HKEX", "CN"].includes(row.market) || !["STOCK", "ETF"].includes(row.assetType) || ({ US: "USD", HKEX: "HKD", CN: "CNY" }[row.market] !== row.currency) || !row.shareClass || row.instrumentId !== identity(row)) throw new Error("标的身份、市场或币种未确认");
      if (identities.has(row.ticker) && identities.get(row.ticker) !== row.instrumentId) throw new Error("同代码不同身份不可合并，请使用独立代码映射");
      identities.set(row.ticker, row.instrumentId);
      const q = decimal(row.quantity), cost = decimal(row.totalCost);
      if (q.isZero() && !cost.isZero()) throw new Error("零持仓不能有剩余成本");
    }
  }
  if (new Set(state.trades.map(t => t.id)).size !== state.trades.length) throw new Error("流水 ID 重复");
  // Only the latest checkpoint for each identity is active. Old immutable evidence survives corrections.
  for (const [ticker] of identities) {
    const cp = [...(state.checkpoints ?? [])].reverse().find(c => c.rows.some(r => r.ticker === ticker))!;
    const actual = state.trades.filter(t => t.ticker === ticker && t.date <= cp.throughDate).map(tradeEvidence);
    const baseline = cp.baseline.filter(t => t.ticker === ticker).map(tradeEvidence);
    if (canonical(actual) !== canonical(baseline)) throw new Error(`${ticker} 校准前/同日流水已变化；请核对时间并重新校准，不能沿用旧基线`);
  }
}

export function applyCheckpoint(state: TradingDataState, checkpoint: Checkpoint): TradingDataState {
  const existing = state.checkpoints?.find(cp => cp.id === checkpoint.id);
  if (existing) {
    if (canonical(existing) !== canonical(checkpoint)) throw new Error("同一校准批次对应不同内容");
    return state;
  }
  const next: TradingDataState = { ...state, schemaVersion: 2, checkpoints: [...(state.checkpoints ?? []), checkpoint], stockPool: [...new Set([...state.stockPool, ...checkpoint.rows.map(r => r.ticker)])] };
  validateCheckpoints(next);
  return next;
}

/** Conversion is available only when an external immutable source was explicitly confirmed. */
export function migrateCheckpoint(state: TradingDataState, checkpoint: Omit<Checkpoint, "source"> & { source: { kind: "migration"; reference: `verified:${string}` } }) {
  if (!checkpoint.source.reference.startsWith("verified:")) throw new Error("迁移来源必须是已核验的不可变证据");
  return applyCheckpoint(state, checkpoint);
}

export function projectCheckpoint(state: TradingDataState, ticker: string) {
  const cp = [...(state.checkpoints ?? [])].reverse().find(c => c.rows.some(r => r.ticker === ticker));
  if (!cp) return null;
  const row = cp.rows.find(r => r.ticker === ticker)!;
  const lots = decimal(row.quantity).gt(0) ? [{ q: decimal(row.quantity), cost: decimal(row.totalCost) }] : [];
  for (const trade of state.trades.filter(t => t.ticker === ticker && t.date > cp.throughDate).sort((a, b) => a.date.localeCompare(b.date))) {
    let q = decimal(String(trade.shares));
    if (trade.action === "买入") lots.push({ q, cost: decimal(String(trade.amount)) });
    else {
      while (q.gt(0) && lots.length) {
        const lot = lots[0], take = q.lt(lot.q) ? q : lot.q;
        lot.cost = lot.cost.minus(lot.cost.times(take).div(lot.q)); lot.q = lot.q.minus(take); q = q.minus(take);
        if (lot.q.isZero()) lots.shift();
      }
      if (q.gt(0)) throw new Error(`${ticker} 卖出超过校准后的持仓`);
    }
  }
  const q = lots.reduce((sum, lot) => sum.plus(lot.q), decimal("0"));
  const cost = lots.reduce((sum, lot) => sum.plus(lot.cost), decimal("0"));
  return { shares: Number(decimalText(q, 6)), holdingCost: Number(decimalText(cost, 2)), costBasis: q.gt(0) ? Number(decimalText(cost.div(q), 4)) : 0, assetType: row.assetType, currency: row.currency, instrumentId: row.instrumentId, checkpointId: cp.id, observedAt: cp.observedAt, historyComplete: false };
}
