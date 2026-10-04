import test from "node:test";
import assert from "node:assert/strict";
import { beijingDay, calendarCells, shiftMonth } from "./calendar.ts";

test("calendar uses Beijing midnight and Monday-first weeks", () => {
  assert.equal(beijingDay(new Date("2026-10-01T16:01:00Z")), "2026-10-02");
  const cells = calendarCells("2026-10");
  assert.deepEqual(cells.slice(0, 4), [null, null, null, "2026-10-01"]);
  assert.equal(cells.at(-1), "2026-10-31");
  assert.equal(calendarCells("2028-02").filter(Boolean).length, 29);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});
