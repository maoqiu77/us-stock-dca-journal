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

test("dashboard includes observed tickers and sorts rows by displayed return", () => {
  assert.match(dashboardSource, /position\.shares > 0/);
  assert.match(dashboardSource, /const statusRows = derivedPositions/);
  assert.match(dashboardSource, /未持仓/);
  assert.match(dashboardSource, /!isHeld/);
  assert.match(dashboardSource, /删除观察标的/);
  assert.match(dashboardSource, /removePosition\(position\.ticker\)/);
  assert.match(dashboardSource, /comparePositionReturnsDescending\(/);
  assert.match(dashboardSource, /statusRows\.map\(/);
  assert.match(dashboardSource, /暂无跟踪标的，请到交易记录录入交易或选择仅观察。/);
});

test("dashboard only keeps the requested asset metrics and status fields", () => {
  assert.match(overviewSource, /总资产盈亏/);
  assert.match(overviewSource, /今日变动/);
  assert.doesNotMatch(overviewSource, /领涨|领跌|自选数量/);

  assert.match(dashboardSource, /持仓成本/);
  assert.match(dashboardSource, /技术指标/);
  assert.match(dashboardSource, /技术状态/);
  assert.doesNotMatch(dashboardSource, /今日信号/);
  assert.doesNotMatch(dashboardSource, /账户总览|数据状态|工作流/);
  assert.doesNotMatch(dashboardSource, /currentWeight|目标仓位/);
});
