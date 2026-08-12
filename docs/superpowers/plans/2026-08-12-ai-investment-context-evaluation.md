# AI Investment Context Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, deterministic evaluation toolkit that measures whether AI answers accurately use and respect the user's long-term investment context.

**Architecture:** Keep scoring in a focused Python module under the FastAPI application so it is directly unit-testable. Add a thin CLI that loads YAML or JSON, validates human annotations, computes a report, and optionally writes it under an explicit path. Ship only fictional public evaluation cases; users copy them into `storage/local` before adding private answers.

**Tech Stack:** Python 3.9, standard library, PyYAML, unittest, YAML/JSON.

## Global Constraints

- Do not add a frontend page, backend route, database table, or external model call.
- Keep real answers and portfolio data under `storage/local`; public templates must remain fictional.
- Weights are fixed at `core=3`, `important=2`, and `supporting=1`.
- A case passes only with fact precision at least 0.98, weighted answer recall at least 0.90, constraint compliance at least 0.95, adaptation at least 8/10, zero critical factual errors, and zero hard-constraint violations.
- Undefined ratios must remain `null`; they must never silently become 100%.

---

### Task 1: Deterministic scoring core

**Files:**
- Create: `apps/api/app/modules/ai_context_evaluation.py`
- Test: `apps/api/tests/test_ai_context_evaluation.py`

**Interfaces:**
- Consumes: a parsed mapping with top-level `schema_version`, `evaluation_name`, and `cases`.
- Produces: `evaluate_dataset(dataset: dict[str, Any]) -> dict[str, Any]` and `validate_dataset(dataset: Any) -> list[str]`.

- [ ] Write failing unit tests with hand-computed literals for one passing case, one failing case, aggregation, undefined ratios, incomplete cases, and invalid annotation references.
- [ ] Run `PYTHONPATH=apps/api .venv/bin/python -m unittest apps.api.tests.test_ai_context_evaluation -v` and confirm failures are caused by the missing module.
- [ ] Implement schema validation, per-case scoring, aggregate scoring, threshold gates, and stable rounded output.
- [ ] Rerun the focused test and confirm all cases pass.

### Task 2: Local command-line workflow

**Files:**
- Create: `scripts/evaluate_ai_context.py`
- Test: `apps/api/tests/test_ai_context_evaluation_cli.py`

**Interfaces:**
- Consumes: YAML or JSON path plus `--json`, `--output PATH`, and `--require-complete`.
- Produces: readable stdout or JSON report; exit 2 for invalid input and exit 3 for incomplete strict evaluation.

- [ ] Write subprocess tests for readable output, JSON output, invalid input, strict incomplete behavior, and explicit report writing.
- [ ] Run the focused CLI tests and confirm they fail because the script does not exist.
- [ ] Implement the CLI as a thin wrapper around the scoring module, without network or database access.
- [ ] Rerun both evaluation test files and confirm they pass.

### Task 3: Public 20-case evaluation kit

**Files:**
- Create: `storage/templates/ai-context-evaluation.example.yaml`
- Create: `docs/ai-context-evaluation.md`
- Modify: `README.md`
- Test: `apps/api/tests/test_ai_context_evaluation_template.py`

**Interfaces:**
- Consumes: the schema and CLI from Tasks 1–2.
- Produces: 20 fictional, unscored cases and instructions for copying them to `storage/local` and adding human review annotations.

- [ ] Write a failing template integration test that loads the YAML through the real validator, requires exactly 20 unique cases and five required scenario categories, and confirms all reviews are initially empty.
- [ ] Run the template test and confirm it fails because the template is missing.
- [ ] Add the fictional cases, reviewer instructions, formulas, annotation example, and README entry.
- [ ] Run the template test and CLI against the template; confirm 20 incomplete and 0 scored cases are reported.

### Task 4: Verification and privacy boundary

**Files:**
- Modify only files required to fix verification failures introduced by Tasks 1–3.

**Interfaces:**
- Consumes: all completed artifacts.
- Produces: fresh verification evidence and a clean scoped diff.

- [ ] Run `npm test`.
- [ ] Run `npm run lint` and `npm run build`.
- [ ] Run `npm run check:public-safety` and `npm run check:release-readiness`.
- [ ] Run the CLI on the public template, review `git diff --check`, inspect `git status --short`, and confirm no file under `storage/local` is tracked.
