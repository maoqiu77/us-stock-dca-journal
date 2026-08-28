import assert from "node:assert/strict";
import test from "node:test";

import { buildHoldingConclusion } from "./holding-conclusion.ts";

const position = {
  ticker: "MRVL",
  targetWeight: 0,
  assetType: "STOCK" as const,
  takeProfitPct: 0,
  stopLossPct: 0,
  purchaseDate: "2026-08-01",
  shares: 10,
  costBasis: 80,
  holdingCost: 800,
};

test("combines a bullish rating with a profitable current holding", () => {
  const result = buildHoldingConclusion({
    ticker: "MRVL",
    effectiveDate: "2026-08-28",
    rating: "增持",
    position,
    latestPrice: 88,
  });

  assert.match(result.positionSummary, /持有 10 股/);
  assert.match(result.positionSummary, /单位成本 \$80\.00/);
  assert.match(result.positionSummary, /浮盈 \$80\.00（10\.00%）/);
  assert.match(result.decisionSummary, /继续持有，可谨慎分批买入/);
});

test("does not let a loss override a sell rating", () => {
  const result = buildHoldingConclusion({
    ticker: "MRVL",
    effectiveDate: "2026-08-28",
    rating: "卖出",
    position,
    latestPrice: 72,
  });

  assert.match(result.positionSummary, /浮亏 \$80\.00（10\.00%）/);
  assert.match(result.decisionSummary, /考虑卖出持仓/);
  assert.match(result.decisionSummary, /不要只因等待回本而继续持有/);
});

test("gives a concise entry conclusion when there is no holding", () => {
  const result = buildHoldingConclusion({
    ticker: "MRVL",
    effectiveDate: "2026-08-28",
    rating: "买入",
  });

  assert.equal(result.positionSummary, "当前没有 MRVL 持仓。");
  assert.match(result.decisionSummary, /可考虑分批买入/);
});

test("does not calculate profit or loss without a real quote", () => {
  const result = buildHoldingConclusion({
    ticker: "MRVL",
    effectiveDate: "2026-08-28",
    rating: "持有",
    position,
  });

  assert.match(result.positionSummary, /无法可靠计算浮动盈亏/);
  assert.match(result.decisionSummary, /继续持有/);
});
