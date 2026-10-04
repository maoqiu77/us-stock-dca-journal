import test from "node:test";
import assert from "node:assert/strict";
import { migrateCheckpoint } from "./checkpoints.ts";
import { DEFAULT_TRADING_DATA, type TradingDataState } from "./trading-data.ts";

test("legacy migration requires verified provenance", () => {
  const state: TradingDataState = { ...structuredClone(DEFAULT_TRADING_DATA), stockPool: ["SYNTH"], trades: [] };
  const base = { id: "migration-1", kind: "position_checkpoint" as const, observedAt: "2026-10-03T00:00:00Z", recordedAt: "2026-10-03T00:01:00Z", throughDate: "2026-10-02", baseRevision: "r1", scope: "partial" as const, historyComplete: false as const, rows: [{ ticker: "SYNTH", market: "US" as const, currency: "USD" as const, assetType: "STOCK" as const, shareClass: "ordinary", instrumentId: "US:SYNTH:STOCK:USD:ordinary", quantity: "2", totalCost: "20" }], retainedTickers: [], baseline: [] };
  assert.throws(() => migrateCheckpoint(state, { ...base, source: { kind: "migration", reference: "备注" } as never }), /已核验/);
  const next = migrateCheckpoint(state, { ...base, source: { kind: "migration", reference: "verified:broker-export-1" } });
  assert.equal(next.checkpoints?.[0].source.reference, "verified:broker-export-1");
});
