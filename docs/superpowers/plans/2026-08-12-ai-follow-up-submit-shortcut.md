# AI Follow-up Submit Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the AI follow-up textarea so `Control/Ctrl + Enter` submits while plain `Enter` and `Shift + Enter` create new lines.

**Architecture:** Keep the existing `submitChat` callback and send button unchanged. Extract the keyboard-combination decision into a small pure function in a platform feature utility, test that function with Node's built-in test runner, and use it from the `Textarea` `onKeyDown` handler.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node `node:test`, existing shadcn `Textarea`.

## Global Constraints

- Modify only the AI advice follow-up input behavior and its focused tests/copy.
- `Control/Ctrl + Enter` prevents the textarea default and submits.
- Plain `Enter` and `Shift + Enter` remain newline behavior.
- Keep the existing send button behavior, API calls, and mutation guards unchanged.
- Do not add browser-testing dependencies for this focused keyboard rule.

---

### Task 1: Add the shortcut behavior test

**Files:**
- Create: `apps/web/src/features/platform/ai-advice-shortcut.test.ts`
- Create: `apps/web/src/features/platform/ai-advice-shortcut.ts` (created by the implementation step after the test is written)

**Interfaces:**
- Consumes: a keyboard-like object with `key`, `ctrlKey`, and optional `shiftKey` fields.
- Produces: a test contract for `isAiAdviceSubmitShortcut(event)` returning a boolean.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/platform/ai-advice-shortcut.test.ts` with these cases:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { isAiAdviceSubmitShortcut } from "./ai-advice-shortcut.ts";

test("recognizes Control/Ctrl + Enter as the AI follow-up submit shortcut", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Enter", ctrlKey: true }),
    true
  );
});

test("keeps plain Enter available for a newline", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Enter", ctrlKey: false }),
    false
  );
});

test("keeps Shift + Enter available for a newline", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Enter", ctrlKey: false, shiftKey: true }),
    false
  );
});

test("does not submit other keys without Control/Ctrl", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Escape", ctrlKey: false }),
    false
  );
});
```

- [ ] **Step 2: Run the new test and verify it fails for the missing behavior**

Run: `npm --prefix apps/web test -- src/features/platform/ai-advice-shortcut.test.ts`

Expected: FAIL because `./ai-advice-shortcut.ts` does not exist yet; do not change the test to make this initial failure pass.

### Task 2: Implement and wire the shortcut

**Files:**
- Create: `apps/web/src/features/platform/ai-advice-shortcut.ts`
- Modify: `apps/web/src/features/platform/views/ai-advice-view.tsx:359-368`

**Interfaces:**
- Consumes: `AiAdviceKeyboardEvent` with `key: string`, `ctrlKey: boolean`, and optional `shiftKey: boolean`.
- Produces: `isAiAdviceSubmitShortcut(event: AiAdviceKeyboardEvent): boolean`.

- [ ] **Step 1: Add the minimal pure helper**

Create `apps/web/src/features/platform/ai-advice-shortcut.ts`:

```ts
export type AiAdviceKeyboardEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "shiftKey"
>;

export function isAiAdviceSubmitShortcut(
  event: AiAdviceKeyboardEvent
): boolean {
  return event.key === "Enter" && event.ctrlKey;
}
```

- [ ] **Step 2: Run the focused test and verify it passes**

Run: `npm --prefix apps/web test -- src/features/platform/ai-advice-shortcut.test.ts`

Expected: PASS with all four shortcut cases green.

- [ ] **Step 3: Wire the helper into the textarea**

Import `isAiAdviceSubmitShortcut` into `ai-advice-view.tsx` and replace the current `Enter && !shiftKey` condition with:

```tsx
onKeyDown={(event) => {
  if (isAiAdviceSubmitShortcut(event)) {
    event.preventDefault();
    submitChat();
  }
}}
```

Update the placeholder to:

```tsx
placeholder="输入追问；Control + Enter 发送，Enter 换行"
```

- [ ] **Step 4: Run focused and full frontend tests**

Run: `npm --prefix apps/web test`

Expected: PASS with the new helper tests and all existing frontend tests green.

### Task 3: Verify the frontend artifact

**Files:**
- Verify: `apps/web/src/features/platform/ai-advice-shortcut.ts`
- Verify: `apps/web/src/features/platform/ai-advice-shortcut.test.ts`
- Verify: `apps/web/src/features/platform/views/ai-advice-view.tsx`

**Interfaces:**
- Consumes: the implementation and tests from Tasks 1–2.
- Produces: a lint-clean and buildable frontend with the requested keyboard behavior.

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: ESLint exits successfully without warnings or errors caused by this change.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Next.js production build exits successfully.

- [ ] **Step 3: Review the final diff and commit the implementation**

Run: `git diff --check && git diff --stat && git status --short`

Expected: only the helper, its focused test, the AI advice view, and this implementation plan are changed after the prior design commit. Then commit with:

```bash
git add apps/web/src/features/platform/ai-advice-shortcut.ts apps/web/src/features/platform/ai-advice-shortcut.test.ts apps/web/src/features/platform/views/ai-advice-view.tsx docs/superpowers/plans/2026-08-12-ai-follow-up-submit-shortcut.md
git commit -m "fix: use control enter for AI follow-ups"
```
