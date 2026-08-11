# Trade Entry Three-Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to enter any two of trade amount, unit price, and fractional shares while the form automatically recalculates the third field from the two most recently edited fields.

**Architecture:** Add a pure, testable three-field recalculation helper beside the existing trade number helpers in `trading-data.ts`. Keep UI draft values as strings, track the two most recently edited numeric fields in the view, and pass all three parsed values through the existing add/update flow without changing persistence or API schemas.

**Tech Stack:** TypeScript, React 19, Next.js 16, Node test runner, ESLint

## Global Constraints

- Fractional shares are rounded to at most 6 decimal places.
- Trade amount and unit price are rounded to at most 4 decimal places.
- Empty, zero, negative, and non-finite values are not valid calculation inputs.
- Do not change the backend API, SQLite schema, CSV import format, position-cost algorithm, or historical data.
- Use existing shadcn inputs, semantic Tailwind tokens, and `gap-*` layout utilities.

---

### Task 1: Pure Three-Field Recalculation

**Files:**
- Modify: `apps/web/src/features/platform/trading-data.ts:424-451`
- Test: `apps/web/src/features/platform/trading-data.test.ts`

**Interfaces:**
- Consumes: existing `parseTradeNumberInput(value: string): number` and numeric rounding conventions.
- Produces: `TradeCalculationField`, `TradeCalculationDraft`, and `updateTradeCalculation(draft, editedField, editedValue, recentFields)` returning `{ draft, recentFields }`.

- [ ] **Step 1: Write failing table-driven tests for each two-field combination**

Add tests with hand-calculated literals: amount `100` plus unit price `40` yields shares `2.5`; amount `100` plus shares `2.5` yields unit price `40`; unit price `40` plus shares `2.5` yields amount `100`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix apps/web test -- src/features/platform/trading-data.test.ts`

Expected: FAIL because `updateTradeCalculation` is not exported.

- [ ] **Step 3: Implement the minimal pure helper**

Use this public shape:

```ts
export type TradeCalculationField = "amount" | "unitPrice" | "shares";
export type TradeCalculationDraft = Record<TradeCalculationField, string>;

export function updateTradeCalculation(
  draft: TradeCalculationDraft,
  editedField: TradeCalculationField,
  editedValue: string,
  recentFields: TradeCalculationField[]
): { draft: TradeCalculationDraft; recentFields: TradeCalculationField[] };
```

Move the edited field to the end of a de-duplicated recent-field list, keep only the last two fields, and calculate the remaining field only when both retained inputs parse as positive finite numbers. Format amount and unit price to 4 decimal places and shares to 6 using a shared internal formatter that removes trailing zeroes.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm --prefix apps/web test -- src/features/platform/trading-data.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing tests for recalculation order and invalid inputs**

Cover this sequence with literal expectations: edit amount `100`, unit price `40`, then shares `4`; the last edit must preserve unit price `40`, preserve shares `4`, and recalculate amount to `160`. Also assert that clearing one field does not produce `NaN` or `Infinity`, and that calculated shares round `1 / 3` to `0.333333`.

- [ ] **Step 6: Run RED, make the smallest correction, then run GREEN**

Run: `npm --prefix apps/web test -- src/features/platform/trading-data.test.ts`

Expected: the new tests fail before the correction and all focused tests pass afterward.

### Task 2: Integrate the Helper Into Transaction Entry

**Files:**
- Modify: `apps/web/src/features/platform/views/data-management-view.tsx:63-176`
- Modify: `apps/web/src/features/platform/views/data-management-view.tsx:408-560`
- Modify: `apps/web/src/features/platform/views/data-management-view.tsx:613-640`

**Interfaces:**
- Consumes: `TradeCalculationField`, `updateTradeCalculation`, `formatTradeNumberInput`, and the existing `addTrade`/`updateTrade` functions.
- Produces: a visible `trade-shares` numeric input and submission payloads containing numeric `amount`, `unitPrice`, and `shares`.

- [ ] **Step 1: Extend draft and interaction state**

Add `shares: string` to `TradeDraft` and `initialTradeDraft`. Track `recentTradeFields` as `TradeCalculationField[]`. Add one change handler that calls `updateTradeCalculation` and updates both returned values.

- [ ] **Step 2: Replace the estimated-shares display with an editable field**

Add a shadcn `Input` labeled “股数”, using `type="number"`, `min="0"`, and `step="0.000001"`. Update the card description to explain that any two fields calculate the third. Keep the note field in the same responsive three-column grid and remove the obsolete “预计股数” text.

- [ ] **Step 3: Submit and edit all three numeric values**

Parse `tradeDraft.shares`, require all three parsed values to be positive before enabling the button, and include `shares` in `normalizedTradeDraft`. On submit, cancel, deleting the edited row, or selecting a row for editing, reset `recentTradeFields` to `[]`. When selecting a row, populate `shares` with `formatTradeNumberInput(trade.shares)`.

- [ ] **Step 4: Run affected verification**

Run:

```bash
npm --prefix apps/web run test
npm --prefix apps/web run lint
npm --prefix apps/web run build
git diff --check
```

Expected: all commands exit 0; the build type-checks the UI integration.

- [ ] **Step 5: Inspect the focused diff and commit**

Confirm every changed production line implements the approved interaction and no private data is added. Then run:

```bash
git add apps/web/src/features/platform/trading-data.ts apps/web/src/features/platform/trading-data.test.ts apps/web/src/features/platform/views/data-management-view.tsx docs/superpowers/plans/2026-08-11-trade-entry-three-field.md
git commit -m "feat: support flexible trade quantity entry"
```
