# ETF Drawdown Investment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every configured ETF invest a shared recent-funds pool in cumulative 52-week drawdown tiers while preserving only extreme ETF profit-taking.

**Architecture:** Add 252-session drawdown metrics, persist the shared funding amount/start date in strategy settings, and move ETF allocation into the signal aggregation layer so all ETFs share one bounded allocation pass. Keep stock evaluation on the existing signal path and derive budget consumption solely from recorded trades.

**Tech Stack:** FastAPI, Python/pandas, Next.js/React, TypeScript, shadcn/ui, Node test runner, unittest/pytest.

## Global Constraints

- All `assetType=ETF` positions use the new behavior; stocks remain unchanged.
- The platform remains manual-only and never places trades.
- Runtime data stays in `storage/local`; no private data enters templates or git.
- Preserve unrelated dirty-worktree changes.

---

### Task 1: Persist and expose the ETF funding pool

**Files:**
- Modify: `apps/api/app/modules/trading_data.py`
- Modify: `apps/web/src/features/platform/trading-data.ts`
- Modify: `apps/web/src/features/platform/views/strategy-view.tsx`
- Test: `apps/api/tests/test_trading_data.py`
- Test: `apps/web/src/features/platform/trading-data.test.ts`

**Interfaces:**
- Produces settings `recentEtfInvestmentAmount: number` and `recentEtfInvestmentStartDate: string`.
- Produces derived pool totals from recorded ETF buys on or after the start date.

- [ ] Add failing sanitization and derived-balance tests for zero/default values, amount persistence, valid ISO start dates, and ETF-only buy consumption.
- [ ] Run the targeted Python and TypeScript tests and confirm the new assertions fail because the fields/helpers do not exist.
- [ ] Add backend/frontend setting types, defaults, sanitization, engine mapping, pool derivation, amount input, summary values, and a start-new-round action that writes today's local date.
- [ ] Run the targeted tests until they pass.

### Task 2: Calculate 52-week drawdown cycles

**Files:**
- Modify: `apps/api/app/modules/indicators.py`
- Test: `apps/api/tests/test_trading_data.py`

**Interfaces:**
- Produces `High252`, `Drawdown252`, and `High252Date` in latest metrics.

- [ ] Add failing tests using deterministic closes to verify the latest 252-session high, drawdown, latest high date, and short-history fallback.
- [ ] Run the focused test and confirm the metrics are absent.
- [ ] Implement rolling 252-session high/drawdown plus latest-high-date extraction without changing existing 20/60-day metrics.
- [ ] Run the focused tests until they pass.

### Task 3: Allocate shared ETF drawdown suggestions

**Files:**
- Modify: `apps/api/app/modules/research.py`
- Modify: `apps/api/app/modules/signal_engine.py`
- Test: `apps/api/tests/test_trading_data.py`

**Interfaces:**
- Consumes positions, trades, account cash, `Drawdown252`, `High252Date`, and funding-pool settings.
- Produces per-ETF allocation inputs whose sum is bounded by shared budget, cumulative tier entitlement, target gaps, cash, and ETF weight limit.

- [ ] Add failing signal tests for MA120/stop-loss bypass, 5/10/15/20% cumulative tiers, crossed tiers, cycle trade consumption, and two-ETF shared allocation.
- [ ] Run focused backend tests and confirm failures describe the old trend-gated ETF behavior.
- [ ] Add a pure allocation helper in `research.py`, gather metrics before allocation, and pass each bounded allocation into `evaluate_add_signal`; retain the old stock route unchanged.
- [ ] Run focused backend tests until they pass.

### Task 4: Restrict ETF selling to extreme profit-taking and excess weight

**Files:**
- Modify: `apps/api/app/modules/signal_engine.py`
- Test: `apps/api/tests/test_trading_data.py`

**Interfaces:**
- ETF extreme exits: `RSI14 >= 85` or `return_from_cost >= 1.0`, trimming 20% of current shares.
- Stock exit order and thresholds remain unchanged.

- [ ] Add failing tests proving ETF stop loss, MA120 and ordinary take-profit do not sell, while RSI 85/profit 100% sell 20% and stock stop loss still sells.
- [ ] Run focused tests and confirm failures come from existing ETF sell precedence.
- [ ] Split ETF and stock sell conditions minimally and add explicit ETF reasons/risk notes.
- [ ] Run focused tests until they pass.

### Task 5: Surface the new signal context and verify regressions

**Files:**
- Modify: `apps/web/src/features/platform/types.ts`
- Modify: `apps/web/src/features/platform/views/dashboard-view.tsx`
- Modify: `apps/web/src/features/platform/views/strategy-view.tsx`
- Test: `apps/web/src/features/platform/product-readiness.test.ts`

**Interfaces:**
- Displays 52-week drawdown, tier entitlement, shared pool total/spent/remaining, and manual suggestion amount.

- [ ] Add failing frontend source/behavior assertions for funding controls and 52-week signal labels.
- [ ] Run the focused frontend tests and confirm the UI contract is missing.
- [ ] Update API types and shadcn-based views with semantic tokens and `gap-*` layouts.
- [ ] Run backend tests, frontend tests, lint, and production build; inspect failures and fix only affected behavior.
- [ ] Review the final diff against the design, verify no private data or unrelated files were included, and report any remaining limitations.
