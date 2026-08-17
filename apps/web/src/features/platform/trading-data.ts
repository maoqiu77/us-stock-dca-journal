"use client";

export type AssetType = "ETF" | "STOCK";
export type TradeAction = "买入" | "卖出";

export type TradingAccount = {
  totalAssets: number;
  baseCurrency: "USD" | "HKD" | "CNY";
};

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

export type DerivedPosition = PositionPlan & {
  shares: number;
  costBasis: number;
  holdingCost: number;
};

export type PositionSnapshotInput = {
  ticker: string;
  assetType: AssetType;
  shares: number;
  averageCost: number;
};

export type LayeredPullback = {
  min: number;
  max: number;
  ratio: number;
};

export type StrategySettings = {
  maMedium: number;
  maLong: number;
  maRisk: number;
  maShort: number;
  rsiPeriod: number;
  rsiMax: number;
  reduceRsi: number;
  takeProfitRsi: number;
  pullbackMin: number;
  pullbackMax: number;
  deeperPullbackMin: number;
  deeperPullbackMax: number;
  targetWeightDefault: number;
  singleAddAssetRatio: number;
  singleAddCashRatio: number;
  starterPositionRatio: number;
  starterAddAssetRatio: number;
  starterAddCashRatio: number;
  strongAddAssetRatio: number;
  strongAddCashRatio: number;
  trimToTargetBuffer: number;
  takeProfitTrimRatio: number;
  hardStopMaBreakRatio: number;
  maxEtfWeight: number;
  monthlyDcaAmount: number;
  recentEtfInvestmentAmount: number;
  recentEtfInvestmentStartDate: string;
  etfRsiMax: number;
  etfReduceRsi: number;
  etfTakeProfitRsi: number;
  etfPullbackMin: number;
  etfPullbackMax: number;
  etfDeeperPullbackMin: number;
  etfDeeperPullbackMax: number;
  etfStarterPositionRatio: number;
  etfStarterAddAssetRatio: number;
  etfStarterAddCashRatio: number;
  etfStrongAddAssetRatio: number;
  etfStrongAddCashRatio: number;
  etfTrimToTargetBuffer: number;
  stockRsiMax: number;
  stockReduceRsi: number;
  stockTakeProfitRsi: number;
  stockPullbackMin: number;
  stockPullbackMax: number;
  stockDeeperPullbackMin: number;
  stockDeeperPullbackMax: number;
  stockStarterPositionRatio: number;
  stockStarterAddAssetRatio: number;
  stockStarterAddCashRatio: number;
  stockStrongAddAssetRatio: number;
  stockStrongAddCashRatio: number;
  stockTrimToTargetBuffer: number;
  coreRsiMax: number;
  coreReduceRsi: number;
  coreTakeProfitRsi: number;
  corePullbackMin: number;
  corePullbackMax: number;
  coreDeeperPullbackMin: number;
  coreDeeperPullbackMax: number;
  coreStarterPositionRatio: number;
  coreStarterAddAssetRatio: number;
  coreStarterAddCashRatio: number;
  coreStrongAddAssetRatio: number;
  coreStrongAddCashRatio: number;
  coreTrimToTargetBuffer: number;
  satelliteRsiMax: number;
  satelliteReduceRsi: number;
  satelliteTakeProfitRsi: number;
  satellitePullbackMin: number;
  satellitePullbackMax: number;
  satelliteDeeperPullbackMin: number;
  satelliteDeeperPullbackMax: number;
  satelliteStarterPositionRatio: number;
  satelliteStarterAddAssetRatio: number;
  satelliteStarterAddCashRatio: number;
  satelliteStrongAddAssetRatio: number;
  satelliteStrongAddCashRatio: number;
  satelliteTrimToTargetBuffer: number;
  layeredPlanAmount: number;
  layeredPullbacks: LayeredPullback[];
  coreHoldings: Record<string, "core" | "satellite">;
  satelliteSymbols: string[];
};

export type StrategyProfile = {
  id: "conservative" | "balanced" | "aggressive" | "custom";
  name: string;
  description: string;
  settings: StrategySettings;
};

export type TradingDataState = {
  schemaVersion: 1;
  account: TradingAccount;
  stockPool: string[];
  positions: PositionPlan[];
  trades: TradeRecord[];
  activeStrategyProfile: StrategyProfile["id"];
  strategyProfiles: StrategyProfile[];
  privacyMode: "local-only" | "external-ai-ready";
};

export const TRADING_DATA_STORAGE_KEY = "stock-platform-next.trading-data.v1";

const balancedSettings: StrategySettings = {
  maMedium: 60,
  maLong: 120,
  maRisk: 200,
  maShort: 20,
  rsiPeriod: 14,
  rsiMax: 72,
  reduceRsi: 78,
  takeProfitRsi: 82,
  pullbackMin: 0.03,
  pullbackMax: 0.1,
  deeperPullbackMin: 0.1,
  deeperPullbackMax: 0.18,
  targetWeightDefault: 0.1,
  singleAddAssetRatio: 0.05,
  singleAddCashRatio: 0.2,
  starterPositionRatio: 0.33,
  starterAddAssetRatio: 0.03,
  starterAddCashRatio: 0.12,
  strongAddAssetRatio: 0.07,
  strongAddCashRatio: 0.25,
  trimToTargetBuffer: 0.03,
  takeProfitTrimRatio: 0.2,
  hardStopMaBreakRatio: 0.5,
  maxEtfWeight: 0.6,
  monthlyDcaAmount: 100,
  recentEtfInvestmentAmount: 0,
  recentEtfInvestmentStartDate: "",
  etfRsiMax: 74,
  etfReduceRsi: 80,
  etfTakeProfitRsi: 84,
  etfPullbackMin: 0.02,
  etfPullbackMax: 0.08,
  etfDeeperPullbackMin: 0.08,
  etfDeeperPullbackMax: 0.15,
  etfStarterPositionRatio: 0.4,
  etfStarterAddAssetRatio: 0.04,
  etfStarterAddCashRatio: 0.15,
  etfStrongAddAssetRatio: 0.08,
  etfStrongAddCashRatio: 0.28,
  etfTrimToTargetBuffer: 0.04,
  stockRsiMax: 70,
  stockReduceRsi: 76,
  stockTakeProfitRsi: 80,
  stockPullbackMin: 0.04,
  stockPullbackMax: 0.12,
  stockDeeperPullbackMin: 0.12,
  stockDeeperPullbackMax: 0.2,
  stockStarterPositionRatio: 0.25,
  stockStarterAddAssetRatio: 0.025,
  stockStarterAddCashRatio: 0.1,
  stockStrongAddAssetRatio: 0.06,
  stockStrongAddCashRatio: 0.22,
  stockTrimToTargetBuffer: 0.02,
  coreRsiMax: 72,
  coreReduceRsi: 78,
  coreTakeProfitRsi: 82,
  corePullbackMin: 0.03,
  corePullbackMax: 0.1,
  coreDeeperPullbackMin: 0.1,
  coreDeeperPullbackMax: 0.18,
  coreStarterPositionRatio: 0.33,
  coreStarterAddAssetRatio: 0.035,
  coreStarterAddCashRatio: 0.13,
  coreStrongAddAssetRatio: 0.07,
  coreStrongAddCashRatio: 0.25,
  coreTrimToTargetBuffer: 0.03,
  satelliteRsiMax: 68,
  satelliteReduceRsi: 74,
  satelliteTakeProfitRsi: 78,
  satellitePullbackMin: 0.05,
  satellitePullbackMax: 0.14,
  satelliteDeeperPullbackMin: 0.14,
  satelliteDeeperPullbackMax: 0.24,
  satelliteStarterPositionRatio: 0.2,
  satelliteStarterAddAssetRatio: 0.02,
  satelliteStarterAddCashRatio: 0.08,
  satelliteStrongAddAssetRatio: 0.05,
  satelliteStrongAddCashRatio: 0.18,
  satelliteTrimToTargetBuffer: 0.015,
  layeredPlanAmount: 200,
  layeredPullbacks: [
    { min: 0.03, max: 0.05, ratio: 0.2 },
    { min: 0.05, max: 0.08, ratio: 0.3 },
    { min: 0.08, max: 0.12, ratio: 0.5 },
  ],
  coreHoldings: {},
  satelliteSymbols: [],
};

export const DEFAULT_TRADING_DATA: TradingDataState = {
  schemaVersion: 1,
  account: {
    totalAssets: 12000,
    baseCurrency: "USD",
  },
  stockPool: ["VOO", "QQQM", "NVDA", "MSFT"],
  positions: [
    {
      ticker: "QQQM",
      targetWeight: 0.35,
      assetType: "ETF",
      takeProfitPct: 0,
      stopLossPct: 0,
      purchaseDate: "2026-06-05",
    },
    {
      ticker: "MSFT",
      targetWeight: 0.16,
      assetType: "STOCK",
      takeProfitPct: 0.2,
      stopLossPct: 0.08,
      purchaseDate: "",
    },
  ],
  trades: [
    {
      id: "sample-qqqm-buy",
      date: "2026-06-05",
      ticker: "QQQM",
      action: "买入",
      shares: 8,
      unitPrice: 220,
      amount: 1760,
      note: "样例 ETF 底仓",
    },
  ],
  activeStrategyProfile: "balanced",
  strategyProfiles: [
    {
      id: "conservative",
      name: "保守型",
      description: "更严格的追高限制，更小的单次加仓比例。",
      settings: {
        ...balancedSettings,
        rsiMax: 68,
        reduceRsi: 74,
        takeProfitRsi: 78,
        singleAddAssetRatio: 0.03,
        singleAddCashRatio: 0.12,
        hardStopMaBreakRatio: 0.4,
        maxEtfWeight: 0.5,
      },
    },
    {
      id: "balanced",
      name: "平衡型",
      description: "默认策略参数，适合多数手动加减仓场景。",
      settings: balancedSettings,
    },
    {
      id: "aggressive",
      name: "进取型",
      description: "允许更高 RSI 和更大单次加仓比例。",
      settings: {
        ...balancedSettings,
        rsiMax: 78,
        reduceRsi: 84,
        takeProfitRsi: 88,
        pullbackMin: 0.02,
        singleAddAssetRatio: 0.08,
        singleAddCashRatio: 0.3,
        hardStopMaBreakRatio: 0.6,
        maxEtfWeight: 0.7,
      },
    },
    {
      id: "custom",
      name: "自定义",
      description: "从当前策略复制而来，可按自己的交易风格调整。",
      settings: balancedSettings,
    },
  ],
  privacyMode: "external-ai-ready",
};

export function normalizeTicker(value: string) {
  return value.trim().toUpperCase();
}

export function uniqueTickers(values: string[]) {
  const seen = new Set<string>();
  const tickers: string[] = [];
  values.forEach((value) => {
    const ticker = normalizeTicker(value);
    if (ticker && !seen.has(ticker)) {
      tickers.push(ticker);
      seen.add(ticker);
    }
  });
  return tickers;
}

export function parseStockPoolText(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => normalizeTicker(item))
    .filter(Boolean);
}

export function replaceStockPool(
  state: TradingDataState,
  value: string
): TradingDataState {
  const stockPool = parseStockPoolText(value);
  const poolSet = new Set(stockPool);

  return {
    ...state,
    stockPool,
    positions: state.positions.filter((position) =>
      poolSet.has(normalizeTicker(position.ticker))
    ),
  };
}

export function upsertPositionPlan(
  state: TradingDataState,
  position: PositionPlan
): TradingDataState {
  const nextPosition = sanitizePosition(position);
  if (!nextPosition.ticker) {
    return state;
  }

  const exists = state.positions.some(
    (item) => normalizeTicker(item.ticker) === nextPosition.ticker
  );

  return {
    ...state,
    stockPool: uniqueTickers([...state.stockPool, nextPosition.ticker]),
    positions: exists
      ? state.positions.map((item) =>
          normalizeTicker(item.ticker) === nextPosition.ticker
            ? nextPosition
            : item
        )
      : [...state.positions, nextPosition],
  };
}

export function sortPositionPlans<T extends PositionPlan>(positions: T[]): T[] {
  return positions
    .map((position, index) => ({ position, index }))
    .sort((first, second) => {
      const weightDifference =
        second.position.targetWeight - first.position.targetWeight;
      return weightDifference || first.index - second.index;
    })
    .map(({ position }) => position);
}

export function comparePositionReturnsDescending(
  first: number | undefined,
  second: number | undefined
) {
  if (first === undefined) {
    return second === undefined ? 0 : 1;
  }
  if (second === undefined) {
    return -1;
  }
  return second - first;
}

export function importPositionSnapshots(
  state: TradingDataState,
  inputs: PositionSnapshotInput[],
  importDate: string
): TradingDataState {
  const heldTickers = new Set(
    derivePositions(state)
      .filter((position) => position.shares > 0)
      .map((position) => position.ticker)
  );
  const seen = new Set<string>();
  const rows = inputs.filter((input) => {
    const ticker = normalizeTicker(input.ticker);
    const valid =
      ticker &&
      !seen.has(ticker) &&
      !heldTickers.has(ticker) &&
      Number.isFinite(input.shares) &&
      input.shares > 0 &&
      Number.isFinite(input.averageCost) &&
      input.averageCost > 0;
    seen.add(ticker);
    return Boolean(valid);
  });
  if (!rows.length) {
    return state;
  }

  const tickers = rows.map((row) => normalizeTicker(row.ticker));
  const positionByTicker = new Map(
    state.positions.map((position) => [normalizeTicker(position.ticker), position])
  );
  rows.forEach((row) => {
    const ticker = normalizeTicker(row.ticker);
    if (!positionByTicker.has(ticker)) {
      positionByTicker.set(ticker, {
        ticker,
        targetWeight: 0,
        assetType: row.assetType,
        takeProfitPct: row.assetType === "ETF" ? 0 : 0.2,
        stopLossPct: row.assetType === "ETF" ? 0 : 0.08,
        purchaseDate: importDate,
      });
    }
  });
  const trades = rows.map((row) =>
    normalizeTradeInput({
      date: importDate,
      ticker: row.ticker,
      action: "买入",
      shares: row.shares,
      unitPrice: row.averageCost,
      amount: row.shares * row.averageCost,
      note: "券商截图导入的期初持仓",
    })
  );

  const nextState = {
    ...state,
    stockPool: uniqueTickers([...state.stockPool, ...tickers]),
    positions: [...positionByTicker.values()],
    trades: [...state.trades, ...trades],
  };
  const nextHoldingCost = holdingCostValue(derivePositions(nextState));
  return {
    ...nextState,
    account: {
      ...nextState.account,
      totalAssets: Math.max(nextState.account.totalAssets, nextHoldingCost),
    },
  };
}

export function applyRecognizedTrades(state: TradingDataState, inputs: Array<{ ticker: string; action: TradeAction; shares: number; unitPrice: number; amount: number; assetType: AssetType; date?: string; note?: string }>, date: string): TradingDataState {
  const valid = inputs.filter((row) => normalizeTicker(row.ticker) && row.shares > 0 && row.unitPrice > 0);
  if (!valid.length) return state;
  const trades = valid.map((row) => normalizeTradeInput({ date: row.date || date, ticker: row.ticker, action: row.action, shares: row.shares, unitPrice: row.unitPrice, amount: row.amount || row.shares * row.unitPrice, note: row.note || "券商交易截图导入" }));
  const positions = [...state.positions];
  valid.forEach((row) => { const ticker = normalizeTicker(row.ticker); if (!positions.some((item) => normalizeTicker(item.ticker) === ticker)) positions.push({ ticker, targetWeight: 0, assetType: row.assetType, takeProfitPct: row.assetType === "ETF" ? 0 : 0.2, stopLossPct: row.assetType === "ETF" ? 0 : 0.08, purchaseDate: date }); });
  return { ...state, stockPool: uniqueTickers([...state.stockPool, ...valid.map((row) => row.ticker)]), positions, trades: [...state.trades, ...trades] };
}

export function replacePositionSnapshot(state: TradingDataState, inputs: PositionSnapshotInput[], date: string): TradingDataState {
  const rows = inputs.filter((row) => normalizeTicker(row.ticker) && row.shares > 0 && row.averageCost > 0);
  const positions = rows.map((row) => ({ ticker: normalizeTicker(row.ticker), targetWeight: 0, assetType: row.assetType, takeProfitPct: row.assetType === "ETF" ? 0 : 0.2, stopLossPct: row.assetType === "ETF" ? 0 : 0.08, purchaseDate: date }));
  const closingTrades = derivePositions(state).filter((row) => row.shares > 0).map((row) => normalizeTradeInput({ date, ticker: row.ticker, action: "卖出", shares: row.shares, unitPrice: row.costBasis, amount: row.shares * row.costBasis, note: "完整持仓截图覆盖：清除旧持仓" }));
  const trades = rows.map((row) => normalizeTradeInput({ date, ticker: row.ticker, action: "买入", shares: row.shares, unitPrice: row.averageCost, amount: row.shares * row.averageCost, note: "券商完整持仓截图覆盖" }));
  // A full snapshot is authoritative for current holdings; reset the derived ledger
  // so positions absent from the screenshot cannot reappear through old lots.
  return { ...state, stockPool: uniqueTickers([...state.stockPool, ...rows.map((row) => row.ticker)]), positions, trades: [...state.trades, ...closingTrades, ...trades] };
}

export function removeTrackedTicker(
  state: TradingDataState,
  ticker: string
): TradingDataState {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    return state;
  }

  return {
    ...state,
    stockPool: state.stockPool.filter(
      (item) => normalizeTicker(item) !== normalizedTicker
    ),
    positions: state.positions.filter(
      (position) => normalizeTicker(position.ticker) !== normalizedTicker
    ),
  };
}

export function findDuplicateTickers(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    const ticker = normalizeTicker(value);
    if (!ticker) {
      return;
    }
    if (seen.has(ticker)) {
      duplicates.add(ticker);
    }
    seen.add(ticker);
  });
  return [...duplicates];
}

export function normalizeTradeInput(
  input: Omit<TradeRecord, "id" | "shares"> & { id?: string; shares?: number }
): TradeRecord {
  const amount = cleanNumber(input.amount);
  const unitPrice = cleanNumber(input.unitPrice);
  const inputShares = cleanNumber(input.shares);
  const shares = inputShares > 0 ? inputShares : unitPrice > 0 ? amount / unitPrice : 0;

  return {
    id: input.id || createTradeId(),
    date: input.date,
    ticker: normalizeTicker(input.ticker),
    action: input.action,
    shares: roundNumber(shares, 6),
    unitPrice: roundNumber(unitPrice, 4),
    amount: roundNumber(amount > 0 ? amount : shares * unitPrice, 4),
    note: input.note.trim(),
  };
}

export function parseTradeNumberInput(value: string) {
  return cleanNumber(value);
}

export function formatTradeNumberInput(value: number, digits = 4) {
  const number = cleanNumber(value);
  return number > 0 ? String(roundNumber(number, digits)) : "";
}

export type TradeCalculationField = "amount" | "unitPrice" | "shares";
export type TradeCalculationDraft = Record<TradeCalculationField, string>;

export function updateTradeCalculation(
  draft: TradeCalculationDraft,
  editedField: TradeCalculationField,
  editedValue: string,
  recentFields: TradeCalculationField[]
) {
  const nextDraft = { ...draft, [editedField]: editedValue };
  const nextRecentFields = [
    ...recentFields.filter((field) => field !== editedField),
    editedField,
  ].slice(-2);
  const validFields = (
    ["amount", "unitPrice", "shares"] as TradeCalculationField[]
  ).filter((field) => parseTradeNumberInput(nextDraft[field]) > 0);

  let sourceFields: TradeCalculationField[] = [];
  if (validFields.length === 2) {
    sourceFields = validFields;
  } else if (
    validFields.length === 3 &&
    nextRecentFields.length === 2 &&
    nextRecentFields.every((field) => validFields.includes(field))
  ) {
    sourceFields = nextRecentFields;
  }

  if (sourceFields.length === 2) {
    const targetField = (
      ["amount", "unitPrice", "shares"] as TradeCalculationField[]
    ).find((field) => !sourceFields.includes(field));
    const amount = parseTradeNumberInput(nextDraft.amount);
    const unitPrice = parseTradeNumberInput(nextDraft.unitPrice);
    const shares = parseTradeNumberInput(nextDraft.shares);
    const calculatedValue =
      targetField === "amount"
        ? unitPrice * shares
        : targetField === "unitPrice"
          ? amount / shares
          : amount / unitPrice;

    if (targetField && Number.isFinite(calculatedValue) && calculatedValue > 0) {
      nextDraft[targetField] = formatCalculatedTradeValue(
        calculatedValue,
        targetField === "shares" ? 6 : 4
      );
    }
  }

  return { draft: nextDraft, recentFields: nextRecentFields };
}

function formatCalculatedTradeValue(value: number, digits: number) {
  return String(roundNumber(value, digits));
}

export function derivePositions(state: TradingDataState): DerivedPosition[] {
  const targetByTicker = new Map(
    state.positions.map((position) => [normalizeTicker(position.ticker), position])
  );

  return state.stockPool.map((ticker) => {
    let shares = 0;
    const lots: Array<{ shares: number; cost: number }> = [];
    let firstBuyDate = "";

    state.trades
      .filter((trade) => normalizeTicker(trade.ticker) === ticker)
      .sort((first, second) => first.date.localeCompare(second.date))
      .forEach((trade) => {
        const quantity = Math.max(cleanNumber(trade.shares), 0);
        const price = Math.max(cleanNumber(trade.unitPrice), 0);
        if (!quantity || !price) {
          return;
        }

        if (trade.action === "卖出") {
          const sellQuantity = Math.min(quantity, shares);
          shares -= sellQuantity;
          let remainingSell = sellQuantity;
          while (remainingSell > 1e-9 && lots.length) {
            const lot = lots[0];
            const consumed = Math.min(remainingSell, lot.shares);
            const unitCost = lot.shares > 0 ? lot.cost / lot.shares : 0;
            lot.shares -= consumed;
            lot.cost -= consumed * unitCost;
            remainingSell -= consumed;
            if (lot.shares <= 1e-9) {
              lots.shift();
            }
          }
        } else {
          const amount = cleanNumber(trade.amount);
          const tradeCost = amount > 0 ? amount : quantity * price;
          shares += quantity;
          lots.push({ shares: quantity, cost: tradeCost });
          if (!firstBuyDate) {
            firstBuyDate = trade.date;
          }
        }
      });

    const plan = targetByTicker.get(ticker);
    const costValue = lots.reduce((total, lot) => total + lot.cost, 0);
    return {
      ticker,
      targetWeight: plan?.targetWeight ?? balancedSettings.targetWeightDefault ?? 0.1,
      assetType: plan?.assetType ?? "STOCK",
      takeProfitPct: plan?.takeProfitPct ?? 0,
      stopLossPct: plan?.stopLossPct ?? 0,
      purchaseDate: plan?.purchaseDate || firstBuyDate,
      shares: roundNumber(Math.max(shares, 0), 6),
      costBasis: shares > 0 ? roundNumber(costValue / shares, 4) : 0,
      holdingCost: roundNumber(Math.max(costValue, 0), 2),
    };
  });
}

export function holdingCostValue(positions: DerivedPosition[]) {
  return roundNumber(
    positions.reduce((total, position) => total + position.holdingCost, 0),
    2
  );
}

export function holdingMarketValue(
  positions: DerivedPosition[],
  priceByTicker: Map<string, number>
) {
  return roundNumber(
    positions.reduce((total, position) => {
      const price = priceByTicker.get(position.ticker) ?? position.costBasis;
      return total + position.shares * price;
    }, 0),
    2
  );
}

export function dynamicCash(totalAssets: number, holdingCost: number) {
  return roundNumber(Math.max(cleanNumber(totalAssets) - cleanNumber(holdingCost), 0), 2);
}

export function targetWeightTotal(positions: PositionPlan[]) {
  return positions.reduce((total, position) => total + cleanNumber(position.targetWeight), 0);
}

export function getActiveStrategyProfile(state: TradingDataState) {
  return (
    state.strategyProfiles.find(
      (profile) => profile.id === state.activeStrategyProfile
    ) ?? state.strategyProfiles[1]
  );
}

export function validateTradingData(
  state: TradingDataState,
  positions: DerivedPosition[] = derivePositions(state)
) {
  const errors: string[] = [];
  const pool = state.stockPool.map(normalizeTicker);
  const poolSet = new Set(pool);
  const duplicates = findDuplicateTickers(state.stockPool);
  const holdingCost = holdingCostValue(positions);

  if (!pool.length) {
    errors.push("股票池至少需要保留一个标的。");
  }
  if (duplicates.length) {
    errors.push(`股票池存在重复标的：${duplicates.join(", ")}。`);
  }
  if (state.account.totalAssets + 1e-9 < holdingCost) {
    errors.push(`总资产不能低于当前持仓成本 ${formatMoney(holdingCost)}。`);
  }

  const positionTickers = state.positions.map((position) => normalizeTicker(position.ticker));
  findDuplicateTickers(positionTickers).forEach((ticker) => {
    errors.push(`持仓表存在重复标的：${ticker}。`);
  });
  state.positions.forEach((position) => {
    const ticker = normalizeTicker(position.ticker);
    if (ticker && !poolSet.has(ticker)) {
      errors.push(`持仓表标的 ${ticker} 不在股票池中。`);
    }
    if (position.targetWeight < 0 || position.targetWeight > 1) {
      errors.push(`${ticker || "持仓"} 的目标仓位必须在 0 到 1 之间。`);
    }
    if (position.takeProfitPct < 0 || position.takeProfitPct > 1) {
      errors.push(`${ticker || "持仓"} 的止盈线必须在 0 到 1 之间。`);
    }
    if (position.stopLossPct < 0 || position.stopLossPct > 1) {
      errors.push(`${ticker || "持仓"} 的止损线必须在 0 到 1 之间。`);
    }
  });

  const totalTargetWeight = targetWeightTotal(state.positions);
  if (totalTargetWeight > 1 + 1e-9) {
    errors.push(`目标仓位总和不能超过 100%，当前为 ${formatRatio(totalTargetWeight)}。`);
  }

  const runningShares = new Map<string, number>();
  state.trades.forEach((trade, index) => {
    const rowLabel = `交易记录第 ${index + 1} 行`;
    const ticker = normalizeTicker(trade.ticker);
    if (!ticker && trade.amount <= 0 && trade.unitPrice <= 0) {
      return;
    }
    if (!poolSet.has(ticker)) {
      errors.push(`${rowLabel}：${ticker || "空标的"} 不在股票池中。`);
      return;
    }
    if (!isIsoDate(trade.date)) {
      errors.push(`${rowLabel}：日期必须使用 YYYY-MM-DD 格式。`);
    }
    if (trade.amount <= 0) {
      errors.push(`${rowLabel}：交易金额必须大于 0。`);
    }
    if (trade.unitPrice <= 0) {
      errors.push(`${rowLabel}：单支成本必须大于 0。`);
    }
    if (trade.shares <= 0) {
      errors.push(`${rowLabel}：交易金额和单支成本无法计算出有效股数。`);
    }

    const current = runningShares.get(ticker) ?? 0;
    if (trade.action === "卖出") {
      if (trade.shares > current + 1e-9) {
        errors.push(
          `${rowLabel}：卖出 ${formatShares(trade.shares)} 股 ${ticker} 超过此前持仓 ${formatShares(current)} 股。`
        );
      }
      runningShares.set(ticker, Math.max(current - trade.shares, 0));
    } else {
      runningShares.set(ticker, current + trade.shares);
    }
  });

  return errors;
}

export function formatMoney(value?: number, currency = "$") {
  if (value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return `${currency}${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)}`;
}

export function formatRatio(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(2)}%`;
}

export function formatShares(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 6,
    minimumFractionDigits: value < 1 && value > 0 ? 4 : 0,
  }).format(value);
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function etfInvestmentPool(
  state: TradingDataState,
  settings: StrategySettings
) {
  const etfs = new Set(
    state.positions
      .filter((position) => position.assetType === "ETF")
      .map((position) => position.ticker)
  );
  const invested = state.trades
    .filter(
      (trade) =>
        trade.action === "买入" &&
        etfs.has(trade.ticker) &&
        (!settings.recentEtfInvestmentStartDate ||
          trade.date >= settings.recentEtfInvestmentStartDate)
    )
    .reduce((sum, trade) => sum + trade.amount, 0);
  const total = Math.max(settings.recentEtfInvestmentAmount, 0);
  return { total, invested, remaining: Math.max(total - invested, 0) };
}

export function sanitizeTradingData(value: unknown): TradingDataState {
  if (!value || typeof value !== "object") {
    return DEFAULT_TRADING_DATA;
  }

  const input = value as Partial<TradingDataState>;
  const stockPool = Array.isArray(input.stockPool)
    ? uniqueTickers(input.stockPool.map(String))
    : DEFAULT_TRADING_DATA.stockPool;
  const strategyProfiles = sanitizeStrategyProfiles(input.strategyProfiles);
  const activeStrategyProfile = strategyProfiles.some(
    (profile) => profile.id === input.activeStrategyProfile
  )
    ? input.activeStrategyProfile
    : DEFAULT_TRADING_DATA.activeStrategyProfile;

  return {
    schemaVersion: 1,
    account: {
      totalAssets: cleanNumber(input.account?.totalAssets) || DEFAULT_TRADING_DATA.account.totalAssets,
      baseCurrency: input.account?.baseCurrency ?? DEFAULT_TRADING_DATA.account.baseCurrency,
    },
    stockPool,
    positions: Array.isArray(input.positions)
      ? input.positions.map(sanitizePosition).filter((position) => position.ticker)
      : DEFAULT_TRADING_DATA.positions,
    trades: Array.isArray(input.trades)
      ? input.trades.map(sanitizeTrade).filter((trade) => trade.ticker)
      : DEFAULT_TRADING_DATA.trades,
    activeStrategyProfile: activeStrategyProfile ?? DEFAULT_TRADING_DATA.activeStrategyProfile,
    strategyProfiles,
    privacyMode:
      input.privacyMode === "local-only"
        ? "local-only"
        : DEFAULT_TRADING_DATA.privacyMode,
  };
}

function sanitizePosition(value: PositionPlan): PositionPlan {
  return {
    ticker: normalizeTicker(String(value.ticker ?? "")),
    targetWeight: clampRatio(value.targetWeight),
    assetType: value.assetType === "ETF" ? "ETF" : "STOCK",
    takeProfitPct: clampRatio(value.takeProfitPct),
    stopLossPct: clampRatio(value.stopLossPct),
    purchaseDate: String(value.purchaseDate ?? ""),
  };
}

function sanitizeTrade(value: TradeRecord): TradeRecord {
  return normalizeTradeInput({
    id: String(value.id || createTradeId()),
    date: String(value.date || todayIsoDate()),
    ticker: String(value.ticker ?? ""),
    action: value.action === "卖出" ? "卖出" : "买入",
    shares: cleanNumber(value.shares),
    unitPrice: cleanNumber(value.unitPrice),
    amount: cleanNumber(value.amount),
    note: String(value.note ?? ""),
  });
}

function sanitizeStrategyProfiles(value: unknown): StrategyProfile[] {
  if (!Array.isArray(value)) {
    return DEFAULT_TRADING_DATA.strategyProfiles;
  }

  return DEFAULT_TRADING_DATA.strategyProfiles.map((defaultProfile) => {
    const inputProfile = value.find(
      (profile) =>
        profile &&
        typeof profile === "object" &&
        (profile as Partial<StrategyProfile>).id === defaultProfile.id
    ) as Partial<StrategyProfile> | undefined;

    if (!inputProfile) {
      return defaultProfile;
    }

    return {
      id: defaultProfile.id,
      name:
        typeof inputProfile.name === "string" && inputProfile.name.trim()
          ? inputProfile.name
          : defaultProfile.name,
      description:
        typeof inputProfile.description === "string"
          ? inputProfile.description
          : defaultProfile.description,
      settings: sanitizeStrategySettings(
        inputProfile.settings,
        defaultProfile.settings
      ),
    };
  });
}

function sanitizeStrategySettings(
  value: unknown,
  defaults: StrategySettings
): StrategySettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<StrategySettings>)
      : {};
  const output: StrategySettings = {
    ...defaults,
    layeredPullbacks: defaults.layeredPullbacks.map((item) => ({ ...item })),
    coreHoldings: { ...defaults.coreHoldings },
    satelliteSymbols: [...defaults.satelliteSymbols],
  };

  (Object.keys(defaults) as Array<keyof StrategySettings>).forEach((key) => {
    const defaultValue = defaults[key];
    if (typeof defaultValue === "number") {
      (output as Record<string, unknown>)[key] = numberOrDefault(
        input[key],
        defaultValue
      );
    }
  });

  output.layeredPullbacks = sanitizeLayeredPullbacks(
    input.layeredPullbacks,
    defaults.layeredPullbacks
  );
  output.coreHoldings = sanitizeCoreHoldings(
    input.coreHoldings,
    defaults.coreHoldings
  );
  output.satelliteSymbols = Array.isArray(input.satelliteSymbols)
    ? uniqueTickers(input.satelliteSymbols.map(String))
    : [...defaults.satelliteSymbols];
  output.recentEtfInvestmentStartDate = isIsoDate(
    String(input.recentEtfInvestmentStartDate ?? "")
  )
    ? String(input.recentEtfInvestmentStartDate)
    : "";

  return output;
}

function sanitizeLayeredPullbacks(
  value: unknown,
  defaults: LayeredPullback[]
): LayeredPullback[] {
  const source = Array.isArray(value) ? value : defaults;
  const layers = source
    .map((item) => {
      const input =
        item && typeof item === "object"
          ? (item as Partial<LayeredPullback>)
          : {};
      const min = clampRatio(input.min);
      const max = clampRatio(input.max);
      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
        ratio: clampRatio(input.ratio),
      };
    })
    .filter((item) => item.max > 0 && item.ratio > 0);
  return layers.length ? layers : defaults.map((item) => ({ ...item }));
}

function sanitizeCoreHoldings(
  value: unknown,
  defaults: Record<string, "core" | "satellite">
): Record<string, "core" | "satellite"> {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : defaults;
  return Object.entries(source).reduce<Record<string, "core" | "satellite">>(
    (output, [ticker, role]) => {
      const normalizedTicker = normalizeTicker(ticker);
      const normalizedRole = String(role).toLowerCase();
      if (
        normalizedTicker &&
        (normalizedRole === "core" || normalizedRole === "satellite")
      ) {
        output[normalizedTicker] = normalizedRole;
      }
      return output;
    },
    {}
  );
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime());
}

function cleanNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrDefault(value: unknown, defaultValue: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function clampRatio(value: unknown) {
  return Math.min(Math.max(cleanNumber(value), 0), 1);
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function createTradeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
