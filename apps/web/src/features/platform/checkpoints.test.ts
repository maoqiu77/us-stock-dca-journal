import test from "node:test";
import assert from "node:assert/strict";
import { applyCheckpoint, projectCheckpoint, validateCheckpoints, type Checkpoint } from "./checkpoints.ts";
import { DEFAULT_TRADING_DATA, type TradingDataState } from "./trading-data.ts";

const state: TradingDataState = { ...structuredClone(DEFAULT_TRADING_DATA), schemaVersion: 1, stockPool: ["SYNTH"], positions: [], trades: [{ id: "t1", date: "2026-10-01", ticker: "SYNTH", action: "买入", shares: 10, unitPrice: 10, amount: 100, note: "合成" }] };
const checkpoint: Checkpoint = { id: "cp-1", kind: "position_checkpoint", observedAt: "2026-10-03T01:00:00Z", recordedAt: "2026-10-03T01:01:00Z", throughDate: "2026-10-02", baseRevision: "r1", scope: "partial", historyComplete: false, source: { kind: "screenshot", reference: "synthetic.png" }, rows: [{ ticker: "SYNTH", market: "US", currency: "USD", assetType: "STOCK", shareClass: "ordinary", instrumentId: "US:SYNTH:STOCK:USD:ordinary", quantity: "10", totalCost: "100" }], retainedTickers: [], baseline: state.trades.map(row => ({ ...row })) };

test("checkpoint is idempotent and projects later trades without creating one", () => {
  const next = applyCheckpoint(state, checkpoint);
  assert.equal(next.trades.length, 1);
  assert.deepEqual(applyCheckpoint(next, checkpoint), next);
  assert.deepEqual(projectCheckpoint(next, "SYNTH")?.shares, 10);
});

test("checkpoint rejects changed pre-cutoff history", () => {
  const next = applyCheckpoint(state, checkpoint);
  const changed = { ...next, trades: next.trades.map(row => ({ ...row, amount: 101 })) };
  assert.throws(() => validateCheckpoints(changed), /流水已变化/);
});
