import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("./views/dashboard-view.tsx", import.meta.url),
  "utf-8"
);
const overviewSource = readFileSync(
  new URL("../charts/overview-panel.tsx", import.meta.url),
  "utf-8"
);

test("dashboard sorts held status rows by displayed return descending", () => {
  assert.match(dashboardSource, /position\.shares > 0/);
  assert.match(dashboardSource, /comparePositionReturnsDescending\(/);
  assert.match(dashboardSource, /statusRows\.map\(/);
});

test("dashboard only keeps the requested asset metrics and status fields", () => {
  assert.match(overviewSource, /总资产盈亏/);
  assert.match(overviewSource, /今日变动/);
  assert.doesNotMatch(overviewSource, /领涨|领跌|自选数量/);

  assert.match(dashboardSource, /持仓成本/);
  assert.match(dashboardSource, /技术指标/);
  assert.match(dashboardSource, /今日信号/);
  assert.doesNotMatch(dashboardSource, /账户总览|数据状态|工作流/);
  assert.doesNotMatch(dashboardSource, /currentWeight|目标仓位/);
});
