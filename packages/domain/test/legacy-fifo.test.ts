import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveLegacyPositions } from "../src/legacy-v1/fifo.ts";
import type { LegacyLedgerInput } from "../src/legacy-v1/types.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/legacy-ledger-v1.json", import.meta.url), "utf8")) as {
  cases: Array<{ id: string; input: LegacyLedgerInput; expected: { web: { shares: number; costBasis: number; holdingCost: number } } }>;
};
for (const example of fixture.cases) {
  test(`shared legacy FIFO: ${example.id}`, () => {
    const before = structuredClone(example.input);
    const [actual] = deriveLegacyPositions(example.input, 0.1);
    assert.deepEqual({ shares: actual.shares, costBasis: actual.costBasis, holdingCost: actual.holdingCost }, example.expected.web);
    assert.deepEqual(example.input, before);
    assert.deepEqual(deriveLegacyPositions(example.input, 0.1), [actual]);
  });
}

test("adapter supplies default target while explicit zero and plan dates survive", () => {
  const state: LegacyLedgerInput = { stockPool: ["SYNTH", "OTHER"], positions: [{ ticker: "SYNTH", targetWeight: 0, assetType: "ETF", takeProfitPct: 0.2, stopLossPct: 0.1, purchaseDate: "2026-01-01" }], trades: [] };
  assert.deepEqual(deriveLegacyPositions(state, 0.25), [
    { ticker: "SYNTH", targetWeight: 0, assetType: "ETF", takeProfitPct: 0.2, stopLossPct: 0.1, purchaseDate: "2026-01-01", shares: 0, costBasis: 0, holdingCost: 0 },
    { ticker: "OTHER", targetWeight: 0.25, assetType: "STOCK", takeProfitPct: 0, stopLossPct: 0, purchaseDate: "", shares: 0, costBasis: 0, holdingCost: 0 },
  ]);
});
