import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  comparePositionReturnsDescending,
  DEFAULT_TRADING_DATA,
  derivePositions,
  etfInvestmentPool,
  formatTradeNumberInput,
  importPositionSnapshots,
  normalizeTradeInput,
  parseTradeNumberInput,
  recordTrade,
  removeTrackedTicker,
  replaceStockPool,
  replacePositionSnapshot,
  sortPositionPlans,
  sortTradesNewestFirst,
  trackTickerForObservation,
  updateTradeCalculation,
  upsertPositionPlan,
  type TradingDataState,
  type TradeInput,
  type PositionSnapshotInput,
} from "./trading-data.ts";

const legacyFixture = JSON.parse(readFileSync(new URL("../../../../../contracts/fixtures/legacy-ledger-v1.json", import.meta.url), "utf8")) as {
  cases: Array<{ id: string; input: { stockPool: string[]; positions: TradingDataState["positions"]; trades: TradeInput[] }; expected: { web: { shares: number; costBasis: number; holdingCost: number } } }>;
  rounding: { input: TradeInput; webAmount: number; pythonAmount: number };
  snapshot: { before: { trades: TradeInput[] }; date: string; inputs: PositionSnapshotInput[]; expectedAppended: Array<{ action: string; shares: number; unitPrice: number; amount: number }>; expectedPosition: { shares: number; costBasis: number; holdingCost: number } };
};

for (const example of legacyFixture.cases) {
  test(`legacy fixture after Web entry: ${example.id}`, () => {
    const state = { ...testState(), ...example.input, trades: example.input.trades.map(normalizeTradeInput) };
    const before = structuredClone(state);
    const [actual] = derivePositions(state);
    assert.deepEqual({ shares: actual.shares, costBasis: actual.costBasis, holdingCost: actual.holdingCost }, example.expected.web);
    assert.deepEqual(state, before);
  });
}

test("legacy fixture preserves Web entry precision independently of Python", () => {
  assert.equal(normalizeTradeInput(legacyFixture.rounding.input).amount, legacyFixture.rounding.webAmount);
  assert.notEqual(legacyFixture.rounding.webAmount, legacyFixture.rounding.pythonAmount);
});

test("snapshot replacement appends synthetic closing and opening trades", () => {
  const example = legacyFixture.snapshot;
  const state = { ...testState(), stockPool: ["SYNTH"], positions: [], trades: example.before.trades.map(normalizeTradeInput) };
  const before = structuredClone(state);
  const next = replacePositionSnapshot(state, example.inputs, example.date);
  assert.deepEqual(next.trades.slice(state.trades.length).map(({ action, shares, unitPrice, amount }) => ({ action, shares, unitPrice, amount })), example.expectedAppended);
  const [actual] = derivePositions(next);
  assert.deepEqual({ shares: actual.shares, costBasis: actual.costBasis, holdingCost: actual.holdingCost }, example.expectedPosition);
  assert.deepEqual(state, before);
});

function testState(): TradingDataState {
  return {
    ...DEFAULT_TRADING_DATA,
    stockPool: ["VOO"],
    positions: [
      {
        ticker: "VOO",
        targetWeight: 0.2,
        assetType: "ETF",
        takeProfitPct: 0.1,
        stopLossPct: 0.05,
        purchaseDate: "",
      },
    ],
    trades: [],
  };
}

test("upsertPositionPlan adds a new target ticker to the stock pool", () => {
  const next = upsertPositionPlan(testState(), {
    ticker: "dram",
    targetWeight: 0.1,
    assetType: "STOCK",
    takeProfitPct: 0.2,
    stopLossPct: 0.08,
    purchaseDate: "",
  });

  assert.deepEqual(next.stockPool, ["VOO", "DRAM"]);
  assert.equal(next.positions.at(-1)?.ticker, "DRAM");
});

test("sortPositionPlans orders targets descending and keeps zero-weight targets last", () => {
  const positions = [
    { ...testState().positions[0], ticker: "ZERO", targetWeight: 0 },
    { ...testState().positions[0], ticker: "HIGH", targetWeight: 0.4 },
    { ...testState().positions[0], ticker: "LOW", targetWeight: 0.1 },
  ];

  assert.deepEqual(
    sortPositionPlans(positions).map((position) => position.ticker),
    ["HIGH", "LOW", "ZERO"]
  );
});

test("position returns sort profits before losses and missing returns", () => {
  const rows = [
    { ticker: "LOSS", value: -0.08 },
    { ticker: "MISSING", value: undefined },
    { ticker: "GAIN", value: 0.12 },
    { ticker: "SMALL_GAIN", value: 0.03 },
  ];

  rows.sort((first, second) =>
    comparePositionReturnsDescending(first.value, second.value)
  );

  assert.deepEqual(
    rows.map((row) => row.ticker),
    ["GAIN", "SMALL_GAIN", "LOSS", "MISSING"]
  );
});

test("trade records sort from newest to oldest without mutating state order", () => {
  const trades = [
    { id: "old", date: "2026-08-01" },
    { id: "new-first", date: "2026-08-29" },
    { id: "middle", date: "2026-08-15" },
    { id: "new-last", date: "2026-08-29" },
  ].map((trade) => ({
    ...trade,
    ticker: "VOO",
    action: "买入" as const,
    shares: 1,
    unitPrice: 100,
    amount: 100,
    note: "",
  }));

  assert.deepEqual(
    sortTradesNewestFirst(trades).map((trade) => trade.id),
    ["new-last", "new-first", "middle", "old"]
  );
  assert.deepEqual(
    trades.map((trade) => trade.id),
    ["old", "new-first", "middle", "new-last"]
  );
});

test("importPositionSnapshots creates plans and opening trades without overwriting holdings", () => {
  const current = testState();
  current.trades = [
    {
      id: "voo-buy",
      date: "2026-01-01",
      ticker: "VOO",
      action: "买入",
      shares: 1,
      unitPrice: 400,
      amount: 400,
      note: "",
    },
  ];

  const next = importPositionSnapshots(
    current,
    [
      { ticker: "voo", assetType: "ETF", shares: 2, averageCost: 410 },
      { ticker: "nvda", assetType: "STOCK", shares: 3, averageCost: 100 },
    ],
    "2026-08-14"
  );

  assert.equal(next.trades.length, 2);
  assert.equal(next.trades.at(-1)?.ticker, "NVDA");
  assert.equal(next.trades.at(-1)?.amount, 300);
  assert.equal(next.positions.find((item) => item.ticker === "NVDA")?.targetWeight, 0);
  assert.equal(derivePositions(next).find((item) => item.ticker === "VOO")?.shares, 1);
});

test("removeTrackedTicker removes a ticker from positions and stock pool", () => {
  const withDram = upsertPositionPlan(testState(), {
    ticker: "DRAM",
    targetWeight: 0.1,
    assetType: "STOCK",
    takeProfitPct: 0.2,
    stopLossPct: 0.08,
    purchaseDate: "",
  });

  const historicalTrade = {
    id: "dram-sold",
    date: "2026-08-01",
    ticker: "DRAM",
    action: "卖出" as const,
    shares: 1,
    unitPrice: 10,
    amount: 10,
    note: "历史流水",
  };
  const next = removeTrackedTicker(
    { ...withDram, trades: [historicalTrade] },
    "dram"
  );

  assert.deepEqual(next.stockPool, ["VOO"]);
  assert.deepEqual(
    next.positions.map((position) => position.ticker),
    ["VOO"]
  );
  assert.deepEqual(next.trades, [historicalTrade]);
});

test("replaceStockPool removes position targets for deleted pool tickers", () => {
  const withDram = upsertPositionPlan(testState(), {
    ticker: "DRAM",
    targetWeight: 0.1,
    assetType: "STOCK",
    takeProfitPct: 0.2,
    stopLossPct: 0.08,
    purchaseDate: "",
  });

  const next = replaceStockPool(withDram, "DRAM");

  assert.deepEqual(next.stockPool, ["DRAM"]);
  assert.deepEqual(
    next.positions.map((position) => position.ticker),
    ["DRAM"]
  );
});

test("normalizeTradeInput keeps trade amount and unit price to four decimals", () => {
  const trade = normalizeTradeInput({
    date: "2026-06-16",
    ticker: "SMCI",
    action: "买入",
    unitPrice: 48.12345,
    amount: 120.98765,
    note: "decimal precision",
  });

  assert.equal(trade.unitPrice, 48.1235);
  assert.equal(trade.amount, 120.9877);
});

test("recordTrade automatically tracks a newly entered holding", () => {
  const next = recordTrade(
    testState(),
    {
      date: "2026-08-29",
      ticker: "qqqm",
      action: "买入",
      shares: 2,
      unitPrice: 250,
      amount: 500,
      note: "manual entry",
    },
    "ETF"
  );

  assert.deepEqual(next.stockPool, ["VOO", "QQQM"]);
  assert.equal(next.positions.at(-1)?.ticker, "QQQM");
  assert.equal(next.positions.at(-1)?.assetType, "ETF");
  assert.equal(derivePositions(next).at(-1)?.holdingCost, 500);
});

test("trackTickerForObservation adds an overview ticker without a trade", () => {
  const current = testState();
  const next = trackTickerForObservation(current, "nvda", "STOCK");

  assert.deepEqual(next.stockPool, ["VOO", "NVDA"]);
  assert.equal(next.positions.at(-1)?.ticker, "NVDA");
  assert.equal(next.positions.at(-1)?.assetType, "STOCK");
  assert.equal(next.positions.at(-1)?.targetWeight, 0);
  assert.equal(next.trades.length, current.trades.length);
  assert.equal(derivePositions(next).at(-1)?.shares, 0);
});

test("trackTickerForObservation leaves an existing ticker unchanged", () => {
  const current = testState();
  const next = trackTickerForObservation(current, "voo", "STOCK");

  assert.deepEqual(next, current);
  assert.equal(next.positions[0].assetType, "ETF");
});

test("derivePositions removes sold shares from oldest lots first", () => {
  const [position] = derivePositions({
    ...testState(),
    trades: [
      {
        id: "first-buy",
        date: "2026-06-01",
        ticker: "VOO",
        action: "买入",
        shares: 10,
        unitPrice: 10,
        amount: 100,
        note: "",
      },
      {
        id: "second-buy",
        date: "2026-06-02",
        ticker: "VOO",
        action: "买入",
        shares: 10,
        unitPrice: 20,
        amount: 200,
        note: "",
      },
      {
        id: "sell",
        date: "2026-06-03",
        ticker: "VOO",
        action: "卖出",
        shares: 10,
        unitPrice: 15,
        amount: 150,
        note: "",
      },
    ],
  });

  assert.equal(position.shares, 10);
  assert.equal(position.costBasis, 20);
  assert.equal(position.holdingCost, 200);
});

test("ETF investment pool counts recent ETF buys only", () => {
  const state = testState();
  state.trades = [
    { id: "buy", date: "2026-08-02", ticker: "VOO", action: "买入", shares: 1, unitPrice: 150, amount: 150, note: "" },
    { id: "old", date: "2026-07-30", ticker: "VOO", action: "买入", shares: 1, unitPrice: 200, amount: 200, note: "" },
  ];
  const settings = {
    ...state.strategyProfiles[1].settings,
    recentEtfInvestmentAmount: 1000,
    recentEtfInvestmentStartDate: "2026-08-01",
  };

  assert.deepEqual(etfInvestmentPool(state, settings), {
    total: 1000,
    invested: 150,
    remaining: 850,
  });
});

test("trade number input helpers show empty values for zero and parse blanks as zero", () => {
  assert.equal(formatTradeNumberInput(0), "");
  assert.equal(formatTradeNumberInput(12.34567), "12.3457");
  assert.equal(formatTradeNumberInput(0.123456, 6), "0.123456");
  assert.equal(parseTradeNumberInput(""), 0);
  assert.equal(parseTradeNumberInput("0.1234"), 0.1234);
});

test("trade calculation derives the missing value from any two fields", () => {
  const cases = [
    {
      edits: [
        ["amount", "100"],
        ["unitPrice", "40"],
      ],
      expected: { amount: "100", unitPrice: "40", shares: "2.5" },
    },
    {
      edits: [
        ["amount", "100"],
        ["shares", "2.5"],
      ],
      expected: { amount: "100", unitPrice: "40", shares: "2.5" },
    },
    {
      edits: [
        ["unitPrice", "40"],
        ["shares", "2.5"],
      ],
      expected: { amount: "100", unitPrice: "40", shares: "2.5" },
    },
  ] as const;

  for (const testCase of cases) {
    let draft = { amount: "", unitPrice: "", shares: "" };
    let recentFields: Array<"amount" | "unitPrice" | "shares"> = [];
    for (const [field, value] of testCase.edits) {
      ({ draft, recentFields } = updateTradeCalculation(
        draft,
        field,
        value,
        recentFields
      ));
    }
    assert.deepEqual(draft, testCase.expected);
  }
});

test("trade calculation uses the two most recently edited fields", () => {
  let draft = { amount: "", unitPrice: "", shares: "" };
  let recentFields: Array<"amount" | "unitPrice" | "shares"> = [];

  ({ draft, recentFields } = updateTradeCalculation(
    draft,
    "amount",
    "100",
    recentFields
  ));
  ({ draft, recentFields } = updateTradeCalculation(
    draft,
    "unitPrice",
    "40",
    recentFields
  ));
  ({ draft, recentFields } = updateTradeCalculation(
    draft,
    "shares",
    "4",
    recentFields
  ));

  assert.deepEqual(draft, { amount: "160", unitPrice: "40", shares: "4" });
  assert.deepEqual(recentFields, ["unitPrice", "shares"]);
});

test("trade calculation rounds fractional shares and avoids non-finite results", () => {
  let draft = { amount: "", unitPrice: "", shares: "" };
  let recentFields: Array<"amount" | "unitPrice" | "shares"> = [];

  ({ draft, recentFields } = updateTradeCalculation(
    draft,
    "amount",
    "1",
    recentFields
  ));
  ({ draft, recentFields } = updateTradeCalculation(
    draft,
    "unitPrice",
    "3",
    recentFields
  ));
  assert.equal(draft.shares, "0.333333");

  ({ draft } = updateTradeCalculation(
    draft,
    "unitPrice",
    "",
    recentFields
  ));
  assert.equal(draft.unitPrice, "3");
  assert.equal(Object.values(draft).includes("NaN"), false);
  assert.equal(Object.values(draft).includes("Infinity"), false);
});

test("default tickers are only QQQ and SPY with no holdings or trades", () => {
  assert.deepEqual(DEFAULT_TRADING_DATA.stockPool, ["QQQ", "SPY"]);
  assert.deepEqual(DEFAULT_TRADING_DATA.trades, []);
  for (const position of derivePositions(DEFAULT_TRADING_DATA)) {
    assert.equal(position.shares, 0);
    assert.equal(position.assetType, "ETF");
  }
});
