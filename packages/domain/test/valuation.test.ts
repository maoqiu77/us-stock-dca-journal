import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectLedger } from "../src/ledger/project.ts";
import { valuePortfolio } from "../src/portfolio/valuation.ts";
const fixture = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/ledger-v1.json", import.meta.url), "utf8"));
const projected = projectLedger(fixture.portfolio, fixture.instruments, fixture.events, { through_date: "2026-01-02", known_at: "2026-01-03T12:00:00Z" });
assert.ok(projected.ok);
const projection = projected.value;
const options = { as_of: "2026-01-03T12:00:00Z", max_age_ms: 86_400_000 };
const quote = { instrument_id: fixture.instruments[0].id, price: "50", currency: "USD", source: "manual", as_of: "2026-01-03T10:00:00Z", received_at: "2026-01-03T10:00:01Z", quality: "manual" as const };

test("complete manual valuation computes exact net value without replacing cost", () => {
  const value = valuePortfolio(projection, [quote], options);
  assert.equal(value.status, "complete");
  assert.equal(value.net_value, "1199");
  assert.equal(value.positions[0].market_value, "100");
  assert.equal(value.positions[0].weight, "0.083402835696");
  assert.equal(projection.positions[0].remaining_cost, "21");
});

test("missing, stale, future, sample and mismatched currency quotes never imply exact weights", () => {
  for (const quotes of [[], [{ ...quote, quality: "stale" as const }], [{ ...quote, as_of: "2025-01-01T00:00:00Z" }], [{ ...quote, as_of: "2026-02-01T00:00:00Z" }], [{ ...quote, received_at: "2026-02-01T00:00:00Z" }], [{ ...quote, quality: "sample" as const }], [{ ...quote, currency: "EUR" }]]) {
    const value = valuePortfolio(projection, quotes, options);
    assert.notEqual(value.status, "complete");
    assert.equal(value.net_value, null);
    assert.equal(value.positions[0].weight, null);
  }
});

test("unknown cash and partial holdings cannot produce whole portfolio weights", () => {
  const unknown = valuePortfolio({ ...projection, cash: null, cash_state: "unknown" }, [quote], options);
  assert.equal(unknown.net_value, null);
  assert.equal(unknown.positions[0].weight, null);
  const partial = valuePortfolio({ ...projection, positions: [...projection.positions, { ...projection.positions[0], instrument_id: "20000000-0000-4000-8000-000000000002" }] }, [quote], options);
  assert.equal(partial.status, "partial");
  assert.equal(partial.positions[0].weight, null);
});

test("large valid observations use Decimal without narrowing derived values to input precision", () => {
  const value = valuePortfolio({ ...projection, positions: [{ ...projection.positions[0], quantity: "999999999999999999" }] }, [{ ...quote, price: "999999999999999999" }], options);
  assert.equal(value.positions[0].market_value, "999999999999999998000000000000000001");
  assert.equal(value.net_value, "999999999999999998000000000000001100");
});

test('equivalent timestamp offsets cannot bypass conflicting quote suppression', () => {
  const other = { ...quote, price: '60', as_of: '2026-01-03T05:00:00-05:00', received_at: '2026-01-03T05:00:01-05:00' };
  for (const quotes of [[quote, other], [other, quote]]) {
    const value = valuePortfolio(projection, quotes, options);
    assert.equal(value.net_value, null);
    assert.equal(value.positions[0].weight, null);
    assert.equal(value.positions[0].quote, null);
  }
});
