export type AssetType = "ETF" | "STOCK";

export type TradeAction = "买入" | "卖出";

export type PositionPlan = {
  ticker: string;
  targetWeight: number;
  assetType: AssetType;
  takeProfitPct: number;
  stopLossPct: number;
  purchaseDate: string;
};

export type TradeRecord = {
  id: string;
  date: string;
  ticker: string;
  action: TradeAction;
  shares: number;
  unitPrice: number;
  amount: number;
  note: string;
};

export type LegacyLedgerInput = {
  stockPool: readonly string[];
  positions: readonly PositionPlan[];
  trades: readonly TradeRecord[];
};
export type LegacyDerivedPosition = PositionPlan & {
  shares: number;
  costBasis: number;
  holdingCost: number;
};
