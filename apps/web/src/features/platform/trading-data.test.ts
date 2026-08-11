import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRADING_DATA,
  derivePositions,
  formatTradeNumberInput,
  normalizeTradeInput,
  parseTradeNumberInput,
  removeTrackedTicker,
  replaceStockPool,
  updateTradeCalculation,
  upsertPositionPlan,
  type TradingDataState,
} from "./trading-data.ts";

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

test("removeTrackedTicker removes a ticker from positions and stock pool", () => {
  const withDram = upsertPositionPlan(testState(), {
    ticker: "DRAM",
    targetWeight: 0.1,
    assetType: "STOCK",
    takeProfitPct: 0.2,
    stopLossPct: 0.08,
    purchaseDate: "",
  });

  const next = removeTrackedTicker(withDram, "dram");

  assert.deepEqual(next.stockPool, ["VOO"]);
  assert.deepEqual(
    next.positions.map((position) => position.ticker),
    ["VOO"]
  );
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
