# WeChat AI Journal A0/A1 Implementation Plan

> **For agentic workers:** Execute inline in this checkout. Do not start A2+, connect a real provider, push, upload, review, or publish.

**Goal:** Replace the one-note-per-day review UI with a versioned local timeline and prove the offline, clearly labeled fake-AI analysis → archive → follow-up → personal-note flow.

**Architecture:** Keep the financial v2 snapshot and J0 pending-save protocol unchanged. Add a versioned workspace root whose immutable, separately validated journal/chat/run/source/policy partitions are committed through a read-back-verified pointer; expose these through a journal service and a read-only AI-context adapter. A v3 full backup carries the financial v2 snapshot plus all workspace partitions, while v1/v2 imports create a fresh workspace and migrate legacy reviews exactly once.

**Tech Stack:** TypeScript 5.9, Zod 4, Node test runner, esbuild, native WXML/WXSS.

**Spec:** `/Users/yaochengzhi/Downloads/WECHAT_AI_RESEARCH_JOURNAL_DESIGN_AND_PLAN.md` (A0 and A1 only)

## Global Constraints

- Baseline is `d7920214ae2d4d0c8e62e802f1369f65083ca2ba`; preserve J0 and all later/local work.
- AI text never enters `Snapshot.reviews` or ledger events; AI cannot mutate holdings or confirmed policy.
- The only provider is deterministic and visibly labeled fake/demo in every view.
- No network, credentials, paid resources, uploads, pushes, reviews, or publishing.

### Task 1: Workspace and journal persistence

**Files:** create `apps/miniprogram/src/workspace/*`, `apps/miniprogram/src/journal/*`; test `apps/miniprogram/test/workspace-journal.test.ts`.

- [x] Write failing tests for legacy-review migration, rerun idempotency, old-ledger pending interception, root-switch unknown outcomes, partition corruption, personal-note revisions, and atomic run/message/journal references.
- [x] Run the focused test and confirm failures are caused by missing modules/behavior.
- [x] Add strict schemas, immutable partition commits, root-pointer verification, and journal operations.
- [x] Re-run the focused test to green.

### Task 2: Full backup v3 and compatibility

**Files:** modify workspace/journal services and `apps/miniprogram/src/service.ts`; test `apps/miniprogram/test/full-backup.test.ts`.

- [x] Write failing tests for v3 scope/manifest/reference validation, v1/v2 import, fresh-workspace restore, insufficient storage, corrupted input, and rollback preservation.
- [x] Run the focused test and confirm expected failures.
- [x] Implement v3 export/preview/restore coordination while retaining ledger-only recovery and raw-fault export.
- [x] Re-run focused and existing persistence tests.

### Task 3: AI-context v2 and fake local engine

**Files:** modify `packages/ai-context/src/*`; create `apps/miniprogram/src/ai/*`; test both packages.

- [x] Write failing contract tests for strict v2 requests/results, manifest-member citations, wrong request IDs, and research-instrument confirmation.
- [x] Write failing mini-program tests for read-only context preview/exclusions, missing facts, fake failure/timeout/cross-midnight/bad-citation scenarios, stable client turns, and duplicate-response archival.
- [x] Implement the strict v2 contract, local ContextRepository, deterministic fake provider, and archive coordinator.
- [x] Re-run both focused suites and type checks.

### Task 4: Timeline and shared-conversation UI

**Files:** modify review/position/settings/app files; create research/conversation page files; modify build and controller-binding tests.

- [x] Write failing packaged-controller and binding tests for five tabs, all entry routes, draft protection, fake labels, continuation, and unchanged ledger state.
- [x] Run them red.
- [x] Implement the timeline, AI Research home, conversation page, position/review entry links, policy confirmation, and v3 backup copy.
- [x] Build and run packaged runtime tests.

### Task 5: Evidence and documentation

**Files:** create `docs/miniprogram/ai-storage-adr.md`, `docs/miniprogram/ai-implementation-status.md`; update miniprogram README/devtools validation.

- [x] Record schema versions, keys, migration state machine, rollback rules, fake-only boundary, import path, and external pending checks.
- [x] Run all requested tests, safety/readiness checks, `git diff --check`, and a fresh WeChat build.
- [x] Compile the generated project in WeChat DevTools if the installed UI remains available; record exact result without upgrading simulator evidence to real-device evidence.
