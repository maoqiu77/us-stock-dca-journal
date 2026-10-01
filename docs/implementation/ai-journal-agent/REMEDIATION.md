# Phase 7 Remediation

Updated: 2026-10-01 (Asia/Shanghai). Authorization and execution closeout recorded.

## Frozen Run-limit Follow-up (2026-10-01)

The four Agent run-limit answers in `storage/local/semantic-review-ewongao4` were diagnosed from `verification.json`, the isolated SQLite run/event/source records, and the recorded provider calls. They all stopped before a third model request because the accumulated serialized graph messages exceeded the local 32,000-byte input preflight. Calls, tools, output tokens, provider usage, and the 90-second deadline were below their limits; the provider did not truncate or terminate the responses. The frozen 60-case result was left untouched.

The remediation adds bounded transcript compaction for repeated tool payloads, compact cache-hit payloads, a final-only turn when the request with tool schemas would exceed the input bound, structured local-limit diagnostics, and terminal `agent_run_limit` failure handling. Distinct query-dependent excerpts from the same source remain available; only repeated match payloads are compacted, and cache hits retain the first full observation. The existing 32 KB input bound, four model calls, eight tools, timeout, access checks, no-retry policy, and unknown-result handling remain in force. A local limit can no longer be persisted as a successful insufficiency answer.

The new offline-only fixture/test pair is `storage/templates/ai-journal-agent-run-limit-regression.json` and `apps/api/tests/test_ai_journal_agent_run_limit_regression.py`. It contains four fresh cases with disjoint IDs/text across the affected categories and uses distinct repeated search keys, so the regression covers graph-level compaction rather than only the executor cache. Dedicated tests also preserve different excerpts from one original and the first complete cached observation. New regressions pass **4/4**; focused Agent **51/51**; full Python 3.12 API **352/352**; Python 3.9 AI **188 total: 120 passed / 68 skipped**; Web **91/91**. Public-safety, release-readiness, and `git diff --check` pass. Five existing synthetic key literals in `test_ai_settings.py` now use the file's conventional `sk-test` mock value; the public-safety rule was not relaxed.

Final canonical 8000 read-only checks returned healthy/Agent available, SQLite schema v7 with `integrity_check=ok`, zero unfinished Agent/legacy/quant tasks, seven readable historical sessions, and matching counts/SHA256 for all six original-data groups against the rollback baseline. Canonical 3000 desktop/mobile verification rendered the failed `agent_run_limit` message from one browser-intercepted synthetic session GET, with no cancel button or horizontal overflow. It made zero write/model requests and closed the browser; it is UI-state evidence only. No canonical service was manually stopped or restarted.

The scoped change is ready for code submission. No paid request was made or is needed to prove this local repair; the available 80-request/20 CNY authorization remains unused. Frozen Agent **56/60** and legacy **60/60** results were neither replayed nor rescored, and no new real-model semantic score is claimed. Sections below retain historical phase evidence and test totals; code submission does not imply deployment or public-release approval.

## Implemented Offline

- Shared completion adapters reject Chat length, Responses incomplete and Anthropic max-token replies before extracting text, including reasoning-only replies. Journal storage no longer silently clips long answers.
- Every journal confirmation is terminal for its snapshot/idempotency key, including failures. Duplicate requests return the original turn; a deliberate new question requires a fresh preview. Store-level claim fencing also rejects a failed-turn replay.
- Transport errors without a response are classified as outcome unknown. The UI distinguishes truncation/unknown/failure and does not recommend replay. Cancelled or unknown Agent runs disclose possible ongoing provider processing/billing.
- Legacy DeepSeek text analysis explicitly uses `reasoning_effort=low`, the existing 8192-token production output budget and 120-second timeout. Agent retains its tested 6144-token budget and provider-default effort. This is a comparison of the production engines with their configuration differences recorded.
- `STOCK_APP_AI_JOURNAL_AGENT_ENABLED=0` disables Agent execution/probes without modifying saved capabilities or the database. Legacy text analysis remains available. Default remains enabled; changing a running API environment requires an authorized restart.
- New `--release-paired` uses fresh synthetic fixtures. The old unknown/truncated requests remain sealed. `verify_ai_journal_semantics.py` freezes inputs through production automatic context/candidate selection and never labels structural/retrieval success as a semantic pass. A first 22-case cohort and two targeted six-case correction cohorts were reviewed manually; receipts and reviews remain under ignored `storage/local`.
- Browser verification artifacts under `output/playwright` are gitignored. Private receipts and synthetic databases stay under `storage/local`.
- Server-side Agent completion adds a non-source filter status to final reports for historical cutoffs and explicit exclusions, so the user-facing answer cannot silently omit those boundaries.

Historical regression after the final-report filter-status change: Python 3.12 API **337/337**, Web **91/91**, and Python 3.9 AI **173 tests with 60 expected Agent skips**. Canonical 3000/8000 and the restored database passed the rollback checks below.

## Authorized Real Test: Complete

1. The user authorized up to **115 requests** and a conservative **20 CNY reservation** for synthetic data, with immediate stop on truncation, unknown outcome, failure or missing usage.
2. Actual use was **111 requests**: 75 Agent and 36 legacy, all with reported usage; no request was replayed and no provider/protocol fallback or probe was used. Inputs stayed synthetic and each serialized request stayed under 40 KB. Four requests remained unused from the authorized limit.
3. Usage across all 111 requests totaled **325,536 input** and **81,239 output** tokens, including **182,400 cached input** tokens. At the checked peak rates, the usage estimate is **0.94348 CNY**; the conservative no-cache peak estimate is **1.300984 CNY**. Provider billing is not independently verified and these are estimates, not an account spending cap.
4. The first 22-case cohort had 17 full semantic passes and 5 conservative partials for filtered/no-result cases; no forbidden claim, truncation or unknown result occurred. The targeted six-case v2 cohort had **6/6 Agent and 6/6 legacy semantic passes**. The v3 recheck had **5/6 passes and 1 cutoff explanation partial for each engine**; no forbidden claim, truncation or unknown result occurred. Reviews: `storage/local/semantic-review-qf618q9x/review.json`, `storage/local/semantic-review-tkkvf0wo/review.json` and `storage/local/semantic-review-h_0bu50g/review.json`.

Pricing source, checked 2026-10-01: [DeepSeek CNY pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/). Effort semantics: [official Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/). These provider defaults can change; requests and returned model identity must be retained without raw reasoning or keys.

Prepared commands:

```sh
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py --real --release-paired --request-limit 5
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_semantics.py --real --request-limit 105
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_semantics.py --real --dataset storage/templates/ai-journal-agent-release-semantic-v2.json --request-limit 30
```

All commands used fresh isolated workspaces and left canonical services untouched. The first numerical pair and the 22-case cohort were completed before the targeted correction cohort.

## Authorized Canonical Rollback Exercise: Complete

The user authorized the temporary API switch while keeping the 3000 Next process running. Ownership and in-flight work were checked before the switch.

1. Recheck 3000/8000 process ancestry/cwd and zero unfinished Agent, legacy and quant tasks immediately before switching. Keep the existing 3000 Next process.
2. Use SQLite's backup API to create a consistent local backup. Record table counts and immutable session/turn/snapshot/capability hashes in an ignored local receipt; do not export their content publicly.
3. Stop only the authorized launcher-owned 8000 process group. Confirm its supervisor exits and the port is free; never trust a stale PID file as ownership proof.
4. Start the legacy Python 3.9 API against the same v7 database. Health, disabled Agent capability, historical session reads and canonical text mode passed with GETs only; no database downgrade or model calls occurred.
5. Stop the exercise-owned legacy API. Restore Python 3.12 through the one-click launcher's supervisor. Recheck canonical health/capability, original data hashes and zero unfinished tasks. Retain normal launcher supervision and leave no temporary process.
6. A Python 3.12 deployment may instead downgrade by starting with `STOCK_APP_AI_JOURNAL_AGENT_ENABLED=0`. This preserves dependencies/capabilities and must be checked before restoring the enabled runtime.

## Provider Cancellation Limit

Local cancellation stops waiting and rejects late success writes. It cannot establish upstream processing or billing termination. The product states this limit, and the user has accepted it for this release review; it is no longer a release blocker. A local test still must not claim upstream cancellation was verified.

## Expanded Semantic Evaluation: Complete

- The separately authorized fresh holdout used synthetic originals only and completed **60 paired cases / 120 reviewed answers** in `storage/local/semantic-review-ewongao4`.
- The harness reserved **193 requests**: 133 Agent and 60 legacy. Every call returned valid input/output usage; no truncation, unknown result, failed execution, retry or provider/protocol fallback occurred.
- Manual review passed Agent **56/60 (93.33%)** and legacy **60/60 (100%)**. The four Agent failures were explicit run-limit answers with no substantive response; each affected category remained 4/5. Zero critical issues were found, so the frozen gate passed.
- This closes the limited semantic sample-size blocker for the authored original-memory categories. It remains a stratified synthetic corpus, not independent real-user trials, and does not prove model superiority, live market/portfolio reliability or upstream billing behavior.

## Release Decision

**暂不发布：评测门槛通过，但发布范围仍有限。** A complete consistent MSFT pair and the expanded cohort support the conclusion that both engines can pass the specified numerical/source and authored original-memory semantic checks; no superiority winner is required. Older cutoff wording partials and failed/truncated/unknown attempts remain historical findings. The user accepted the provider-side processing/billing limitation. The result does not qualify live portfolios, broad field generalization or deployment. No commit, push, deployment or public release was performed.
