import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ledgerEventSchema, portfolioSchema, instrumentSchema, policySchema } from "../src/ledger/schema.ts";
import { decimalStringSchema, decimal, decimalText } from "../src/ledger/money.ts";
const fixture = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/ledger-v1.json", import.meta.url), "utf8"));

test("all supported source events and USD account round-trip as decimal strings", () => {
  assert.deepEqual(portfolioSchema.parse(fixture.portfolio), fixture.portfolio);
  assert.deepEqual(instrumentSchema.parse(fixture.instruments[0]), fixture.instruments[0]);
  for (const event of fixture.events) assert.deepEqual(ledgerEventSchema.parse(JSON.parse(JSON.stringify(event))), event);
  assert.equal(decimalText(decimal("0.1").plus(decimal("0.2"))), "0.3");
});

test("facts reject floats, ambiguous notation, unbounded precision and invalid dates", () => {
  for (const value of [NaN, Infinity, 1, "NaN", "Infinity", "1e3", "-1", "-0", "01", "+1", " 1", "1.0", "1.", "0.0000000000001", "9".repeat(19)]) {
    assert.equal(decimalStringSchema.safeParse(value).success, false, String(value));
  }
  for (const patch of [{ quantity: "0" }, { quantity: "-1" }, { amount: "39" }, { amount: "40.00001" }, { fee: "-1" }, { kind: "short" }, { currency: "EUR" }, { trade_date: "2026-02-30" }, { executed_at: "2026-01-01T24:01:00Z" }, { recorded_at: "2026-01-01T12:00:00+25:00" }, { sequence: -1 }, { parent_revision: fixture.events[2].revision_id }]) {
    assert.equal(ledgerEventSchema.safeParse({ ...fixture.events[2], ...patch }).success, false, JSON.stringify(patch));
  }
});

test("unknown cash and unconfirmed goals remain unknown", () => {
  assert.equal(portfolioSchema.parse({ ...fixture.portfolio, cash_state: "unknown" }).cash_state, "unknown");
  assert.equal(portfolioSchema.safeParse({ ...fixture.portfolio, base_currency: "EUR" }).success, false);
  assert.equal(portfolioSchema.safeParse({ ...fixture.portfolio, history_complete: true }).success, false);
  assert.equal(portfolioSchema.safeParse({ ...fixture.portfolio, timezone: "Mars/Base" }).success, false);
  assert.equal(policySchema.parse({ portfolio_id: fixture.portfolio.id, status: "unknown" }).status, "unknown");
  assert.equal(policySchema.safeParse({ portfolio_id: fixture.portfolio.id, status: "confirmed", max_single_weight: "0.2" }).success, false);
});

test("opening holdings are not trades and split accepts no cash amount", () => {
  assert.equal(ledgerEventSchema.parse(fixture.events[1]).kind, "opening_position");
  assert.equal(ledgerEventSchema.safeParse({ ...fixture.events[1], price: "10" }).success, false);
  assert.equal(ledgerEventSchema.safeParse({ ...fixture.events[8], amount: "100" }).success, false);
  assert.equal(ledgerEventSchema.safeParse({ ...fixture.events[8], denominator: "0" }).success, false);
  assert.equal(instrumentSchema.safeParse({ ...fixture.instruments[0], market: "HK" }).success, false);
});

test("confirmed policy rejects malformed, duplicate or overallocated targets safely", () => {
  const policy = { portfolio_id: fixture.portfolio.id, status: "confirmed", id: fixture.portfolio.id, revision_id: fixture.events[0].revision_id, confirmed_at: "2026-01-01T12:00:00Z", effective_from: "2026-01-01", max_single_weight: "0.8", horizon: null, targets: [] };
  for (const value of ["NaN", "1e3", "-1", "1.01"]) {
    assert.equal(policySchema.safeParse({ ...policy, max_single_weight: value }).success, false);
  }
  assert.equal(policySchema.safeParse({ ...policy, targets: [
    { instrument_id: fixture.instruments[0].id, weight: "0.6" },
    { instrument_id: "20000000-0000-4000-8000-000000000002", weight: "0.6" },
  ] }).success, false);
  assert.equal(policySchema.safeParse({ ...policy, targets: [
    { instrument_id: fixture.instruments[0].id, weight: "0.2" },
    { instrument_id: fixture.instruments[0].id, weight: "0.2" },
  ] }).success, false);
});
