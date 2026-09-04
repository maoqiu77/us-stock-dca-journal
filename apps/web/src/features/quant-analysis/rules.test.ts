import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateAnalysisCalls,
  groupAnalysisRuns,
  normalizeAnalystsForDate,
} from "./rules.ts";

test("quant analysis estimates quick and deep AI calls", () => {
  assert.equal(estimateAnalysisCalls("quick", ["technical"]), 9);
  assert.equal(
    estimateAnalysisCalls("deep", ["technical", "fundamentals", "news"]),
    21
  );
});

test("historical dates remove current-only fundamentals and social analysis", () => {
  assert.deepEqual(
    normalizeAnalystsForDate(
      ["technical", "fundamentals", "social", "macro"],
      "2026-08-28",
      "2026-08-29"
    ),
    ["technical", "macro"]
  );
  assert.deepEqual(
    normalizeAnalystsForDate(["technical", "social"], "2026-08-29", "2026-08-29"),
    ["technical", "social"]
  );
});

test("history groups ticker and effective date while keeping newest version first", () => {
  const groups = groupAnalysisRuns([
    { id: "v1", ticker: "AAPL", effectiveDate: "2026-08-28", version: 1 },
    { id: "v2", ticker: "AAPL", effectiveDate: "2026-08-28", version: 2 },
    { id: "qqq", ticker: "QQQ", effectiveDate: "2026-08-28", version: 1 },
  ]);

  assert.equal(groups.length, 2);
  const apple = groups.find((group) => group.ticker === "AAPL");
  assert.deepEqual(apple?.runs.map((run) => run.id), ["v2", "v1"]);
});
