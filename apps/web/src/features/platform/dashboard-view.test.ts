import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./views/dashboard-view.tsx", import.meta.url),
  "utf-8"
);

test("dashboard sorts target status rows by displayed return descending", () => {
  assert.match(source, /comparePositionReturnsDescending\(/);
  assert.match(source, /statusRows\.map\(/);
});

test("dashboard summary cards use matching compact responsive grids", () => {
  const compactGrids = source.match(
    /CardContent className="grid grid-cols-2 gap-1\.5 sm:grid-cols-6"/g
  );

  assert.equal(compactGrids?.length, 2);
  assert.equal(source.match(/<Card size="sm" className="h-full">/g)?.length, 2);
  assert.match(source, /flex h-14 min-w-0/);
});
