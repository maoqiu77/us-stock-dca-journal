import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectLedger } from "../src/ledger/project.ts";
import { validateLedgerCommand } from "../src/ledger/validate-command.ts";
import type { LedgerEvent, Portfolio, Instrument } from "../src/ledger/schema.ts";
const fixture = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/ledger-v1.json", import.meta.url), "utf8")) as { portfolio: Portfolio; instruments: Instrument[]; events: LedgerEvent[]; revision_cases: Array<{ id: string; event_index: number; patch: object; expected_cash: string }>; expected: { cash: string; quantity: string; remaining_cost: string; realized_pnl: string } };
const cutoff = { through_date: "2026-03-01", known_at: "2026-03-02T12:00:00Z" };
function project(events = fixture.events, portfolio = fixture.portfolio, options = cutoff) { return projectLedger(portfolio, fixture.instruments, events, options); }
function ok(result: ReturnType<typeof project>) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
function bad(result: ReturnType<typeof project>, code: string) { assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, code); }
function revision(index: number, patch: object): LedgerEvent { const original = fixture.events[index]; return { ...original, parent_revision: original.revision_id, revision_id: "60000000-0000-4000-8000-000000000001", recorded_at: "2026-02-01T12:00:00Z", ...patch } as LedgerEvent; }

test("hand calculation covers FIFO fees, cash movements, dividend and split", () => {
  const input = structuredClone(fixture);
  const value = ok(project());
  assert.equal(value.cash, fixture.expected.cash);
  assert.equal(value.realized_pnl, "47");
  assert.equal(value.positions[0].quantity, "2");
  assert.equal(value.positions[0].remaining_cost, "21");
  assert.equal(value.positions[0].unit_cost, "10.5");
  assert.deepEqual(fixture, input);
  assert.deepEqual(ok(project([...fixture.events].reverse())), value);
  assert.deepEqual(ok(project([...fixture.events, fixture.events[0]])), value);
});

test("unknown cash never becomes verified zero or buying power", () => {
  const value = ok(project(fixture.events.slice(1), { ...fixture.portfolio, cash_state: "unknown" }));
  assert.equal(value.cash, null);
  assert.equal(value.cash_state, "unknown");
  assert.equal(value.positions[0].remaining_cost, "21");
});

test("revisions are selected at known time, voided records disappear only then", () => {
  const changed = [...fixture.events, revision(4, { amount: "200" })];
  assert.equal(ok(project(changed)).cash, "1199");
  assert.equal(ok(project(changed, fixture.portfolio, { ...cutoff, known_at: "2026-01-03T00:00:00Z" })).cash, "1099");
  assert.equal(ok(project([...fixture.events, revision(4, { voided: true })])).cash, "999");
});

test("conflicting revision branches and missing ancestors cannot select a guessed winner", () => {
  const first = revision(4, { amount: "200" });
  const second = { ...first, revision_id: "60000000-0000-4000-8000-000000000002", amount: "300" } as LedgerEvent;
  bad(project([...fixture.events, first, second]), "revision_conflict");
  bad(project([...fixture.events, { ...first, parent_revision: second.revision_id }]), "missing_parent_revision");
  bad(project([...fixture.events, { ...fixture.events[0], note: "changed same revision" }]), "revision_collision");
});

test("same-day collisions, oversell, negative cash and incorrect source references fail", () => {
  bad(project(fixture.events.map((row, i) => i === 2 ? { ...row, sequence: 2 } : row)), "order_conflict");
  bad(project([...fixture.events, revision(2, { quantity: "0.5", amount: "10" })]), "oversell");
  bad(project(fixture.events.map((row, i) => i === 0 ? { ...row, amount: "1" } as LedgerEvent : row)), "negative_cash");
  bad(project(fixture.events.map((row, i) => i === 2 ? { ...row, instrument_id: "20000000-0000-4000-8000-000000000002" } as LedgerEvent : row)), "unknown_instrument");
});

test("future dated events and later recorded information stay out of historical projection", () => {
  const future = { ...fixture.events[4], record_id: "40000000-0000-4000-8000-000000000010", revision_id: "50000000-0000-4000-8000-000000000010", trade_date: "2026-04-01", sequence: 1 } as LedgerEvent;
  assert.equal(ok(project([...fixture.events, future])).cash, "1099");
  bad(project(fixture.events, fixture.portfolio, { ...cutoff, through_date: "2025-12-31" }), "before_opening");
});

test("opening state must be explicit, unique and earlier than cash movements", () => {
  bad(project(fixture.events.slice(1)), "missing_opening_cash");
  bad(project(fixture.events, { ...fixture.portfolio, cash_state: "unknown" }), "cash_state_mismatch");
  const duplicate = { ...fixture.events[0], record_id: "40000000-0000-4000-8000-000000000010", revision_id: "50000000-0000-4000-8000-000000000010", sequence: 10 };
  bad(project([...fixture.events, duplicate]), "duplicate_opening_cash");
});

test("split preserves total cost and refuses unrepresentable fractional entitlements", () => {
  const before = ok(project(fixture.events.slice(0, -1)));
  const after = ok(project());
  assert.equal(before.positions[0].remaining_cost, after.positions[0].remaining_cost);
  const rows = fixture.events.map((row, i) => i === 8 ? { ...row, numerator: "1", denominator: "3" } as LedgerEvent : row);
  bad(project(rows), "split_precision_requires_confirmation");
});

test("partial fractional sale and close/rebuy conserve remaining cost", () => {
  const rows = fixture.events.slice(0, 4).map((row, i) => i === 3 ? { ...row, quantity: "3.5", amount: "105" } as LedgerEvent : row);
  let value = ok(project(rows));
  assert.equal(value.positions[0].quantity, "0.5");
  assert.equal(value.positions[0].remaining_cost, "10.5");
  assert.equal(value.realized_pnl, "51.5");
  rows[3] = { ...rows[3], quantity: "4", amount: "120" } as LedgerEvent;
  value = ok(project(rows));
  assert.equal(value.positions[0].quantity, "0");
  assert.equal(value.positions[0].remaining_cost, "0");
  const buy = { ...fixture.events[2], record_id: "40000000-0000-4000-8000-000000000011", revision_id: "50000000-0000-4000-8000-000000000011", sequence: 5 };
  assert.equal(ok(project([...rows, buy])).positions[0].remaining_cost, "42");
});

test("executed timestamps must agree with account date and explicit same-day order", () => {
  const rows = fixture.events.map((row, i) => i === 2 ? { ...row, executed_at: "2026-01-02T23:00:00Z" } : row);
  bad(project(rows), "event_date_mismatch");
  rows[2] = { ...fixture.events[2], executed_at: "2026-01-01T18:00:00Z" };
  rows[3] = { ...fixture.events[3], executed_at: "2026-01-01T17:00:00Z" };
  bad(project(rows), "order_conflict");
});

test("command validation replays subsequent events before accepting an edit", () => {
  bad(validateLedgerCommand(fixture.portfolio, fixture.instruments, fixture.events, revision(2, { quantity: "0.5", amount: "10" }), cutoff), "oversell");
});

for (const example of fixture.revision_cases) {
  test(`shared revision fixture: ${example.id}`, () => {
    assert.equal(ok(project([...fixture.events, revision(example.event_index, example.patch)])).cash, example.expected_cash);
  });
}
