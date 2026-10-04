import test from "node:test";
import assert from "node:assert/strict";
import { dueRecords, recordDraft, sourceHref, type UserRecord } from "./user-records.ts";

const sample = (changes: Partial<UserRecord> = {}): UserRecord => ({ ...recordDraft(), id: "synthetic", version: 1, confirmed_at: "2026-10-03T00:00:00Z", effective_at: "2026-10-03T00:00:00Z", source: null, source_available: false, ...changes });

test("due list includes only active decisions, oldest first, never policies", () => {
  assert.deepEqual(dueRecords([sample({ id: "later", review_date: "2026-10-04" }), sample({ id: "due", review_date: "2026-10-03" }), sample({ id: "cancel", status: "cancelled", review_date: "2026-01-01" }), sample({ id: "done", status: "completed", review_date: "2026-01-01" }), sample({ id: "policy", kind: "investment_policy", review_date: "2026-01-01" }), sample({ id: "old", review_date: "2026-10-01" })], "2026-10-03").map(item => item.id), ["old", "due"]);
});
test("unconfirmed drafts contain no AI answer, source navigation has identity only", () => {
  const draft = recordDraft(undefined, { turnId: "turn", scope: "SYNTH" });
  assert.equal(draft.reason, "");
  assert.equal(draft.source_turn_id, "turn");
  const item = sample({ source: { turn_id: "turn", session_id: "session", snapshot_id: "snapshot", instrument_key: "US:SYNTH", observed_at: "2026-10-03" }, source_available: true });
  assert.equal(sourceHref(item), "/?view=ai&session=session#turn-turn");
  assert.equal(sourceHref({ ...item, source_available: false }), null);
  assert.equal(recordDraft(item).source_turn_id, "turn");
});
