# Phase 7 发布准备与回退计划

Updated: 2026-10-01 (Asia/Shanghai). Phase 7.1 retrieval, the bounded Phase 7.2 paired attempt, Phase 7.3 offline reliability review and the authorized real semantic/rollback closeout are recorded below. No commit, push, deployment or public release occurred.

## Run-limit Remediation Update

The four frozen Agent run-limit outcomes were traced to the local 32,000-byte serialized message preflight before a third model request. The recorded provider calls all had complete usage and `tool_calls` finish reasons; no provider retry, timeout, truncation, or usage ambiguity occurred. The old `budget_exhausted` sentinel was incorrectly archived as a successful turn.

The repair adds bounded duplicate-payload compaction, a final-only transition when the request with tool schemas would exceed the input bound, explicit local-limit diagnostics, and terminal failed-run classification. Different query-dependent excerpts from one original and the first full cache observation remain available. The safety bounds and no-retry/unknown-result rules remain unchanged. A new disjoint four-case offline fixture covers business conditions, note time, contradictory sources, and multiple sources. The new regression suite passes **4/4**, including repeated-search, distinct-excerpt, and cache-retention checks; focused Agent **51/51**; full Python 3.12 API **352/352**; Python 3.9 AI **188 total: 120 passed / 68 skipped**; Web **91/91**. Public-safety, release-readiness, and `git diff --check` pass.

Final canonical 8000 read-only checks passed health/capability, SQLite schema v7 `integrity_check=ok`, zero unfinished Agent/legacy/quant tasks, seven historical session reads, and all six original-data count/SHA256 comparisons against the rollback baseline. Canonical 3000 desktop/mobile checks rendered failed `agent_run_limit` wording using one browser-intercepted synthetic session GET; no cancel button, overflow, write request, or model request occurred, and the browser was closed. This is UI-state evidence only. No canonical service was manually stopped or restarted.

The scoped remediation is ready for code submission, with no new paid model request required. The 80-request/20 CNY authorization remains unused. The frozen 60-case artifacts were not touched, replayed, or rescored, and no new real-model semantic score is claimed. Historical phase totals below remain historical; readiness for code submission is separate from deployment/public-release approval.

Phase 7.4 review is complete. **Release recommendation: 暂不发布 with the expanded semantic gate passed but scope limits retained.** The new 60-case cohort produced 56/60 Agent passes and 60/60 legacy passes, with four Agent run-limit failures, zero critical issues and every category at least 4/5. A complete consistent numerical pair already exists; a superiority winner is not required. The user accepted the provider cancellation/billing limitation. See `EXPANDED_PAIRED_PLAN.md`.

## Current Baseline

- HEAD: `daa49363d91a215303b835733aeda516dd6f895d`.
- Phase 0-6 changes remain uncommitted and must be preserved.
- Latest Python 3.12 full API suite: **352/352** after the run-limit remediation; focused Agent **51/51**; new regression **4/4**; Python 3.9 AI **188 total: 120 passed / 68 skipped**; Web **91/91**.
- Canonical frontend: `http://127.0.0.1:3000` (Next development server).
- Canonical API: `http://127.0.0.1:8000` (the project launcher using `storage/local/agent-dev-venv`, Python 3.12).
- Unified AI conversation, old calendar/sessions, legacy text path and privacy/immutable-snapshot rules remain required.
- The embedded AI calendar composer has been simplified to the unified conversation entry: obsolete market/instrument/private-source selection controls and the two old analysis buttons are removed, while automatic context, Agent/text analysis, notes and session recovery remain.
- The previous unknown legacy request is sealed. It must not be replayed. The Phase 6 closeout legacy response was truncated and is not a valid paired answer.

## Historical Authorized Closeout Update

- The user authorized up to **115 synthetic-data model requests** and a conservative **20 CNY reservation**, plus a temporary canonical API rollback and restoration while keeping 3000 running. Actual model use was **111 requests** (75 Agent, 36 legacy); every request had usage, and no unknown, failed or truncated result occurred in this cohort. Four requests remained unused from the authorized limit.
- Usage was **274,161 input / 69,952 output tokens**, including 148,608 cached input tokens. The checked peak-rate estimate is **0.8167 CNY**; a no-cache peak bound is **1.1079 CNY**. Actual provider billing is not independently verified.
- The first 22-case semantic cohort has 17 full passes and 5 conservative partials for deleted/excluded/future/revised no-result cases. The targeted six-case v2 prompt-regression cohort passes **6/6 Agent and 6/6 legacy**; the v3 filter-status recheck has **5/6 passes and one cutoff explanation partial for each engine**. The earlier truncated comparison remains sealed and is not replayed. Manual review files are in ignored `storage/local` receipts.
- The rollback receipt reports schema v7, integrity `ok`, zero unfinished Agent/legacy/quant tasks, seven historical sessions readable, original hashes matching, and Agent enabled after restoration. Next 3000 and API 8000 are project-owned and healthy.

## Objective

Establish whether the Agent implementation is ready for a separately approved release decision, with a tested rollback path and an explicit statement of remaining limits. Phase 7 may produce a release recommendation; this plan does not authorize production deployment or public release.

## Workstreams

### 7.1 Held-out semantic evaluation

- Freeze a new synthetic evaluation set that is not used to tune prompts or retrieval labels.
- Include Chinese and English queries, old trade reasons, revised/deleted notes, date semantics, missing fundamentals, multi-currency holdings, missing quotes, fractional positions and injected instruction text.
- Score source support and answer meaning separately. A valid source ID is not a semantic pass.
- Require manual review for causal claims, date claims, account-wide weights, profit/renewal claims and any statement that goes beyond observed evidence.
- Keep the current curated Recall@5 result as baseline evidence; do not overwrite it with held-out results.

### 7.2 Fair paired comparison

- Define a new synthetic case and matching frozen inputs for Agent and legacy.
- Do not replay either the unknown legacy request or the truncated Phase 6 closeout request.
- Set the request count, timeout, output cap and cost reservation before execution. A new real-provider run requires explicit user authorization.
- Report answer completeness, source support, numerical correctness, latency and usage/cost separately. A missing or truncated answer produces an incomplete comparison, not a winner.

### 7.3 Reliability and recovery

- Retain the existing loopback tests for partial response, read timeout, local cancellation, lease expiry, duplicate confirmation, late writes and archive transaction rollback.
- Add only bounded local/provider-adapter fault cases needed for release decisions. Do not claim that local cancellation stops upstream processing or billing unless the provider supplies evidence.
- Verify unknown outcomes close admission, preserve usage/reservation uncertainty and never trigger automatic replay or protocol fallback.
- Verify restart/recovery leaves old sessions, immutable snapshots, sources and legacy answers readable.

### 7.4 Canonical runtime and data boundary

- Recheck process ownership before any restart. Never stop a foreign or user-owned listener automatically.
- Verify cold start, per-service reuse, failure cleanup and abnormal-exit cleanup through the Python 3.12 launcher. The old `.venv` must remain untouched.
- On canonical 3000, verify the unified conversation entry, Agent/legacy mode selection, old calendar/session reading, hand-note editing and absence of the retired `持仓分析` / `标的快研` buttons.
- On canonical 8000, verify health, capability state, read-only historical runs and no unfinished Agent/legacy/quant work before any test switch.
- Keep all test databases, receipts and screenshots under ignored `storage/local`.

### 7.5 Release and rollback review

- Confirm Agent can be disabled while the legacy path still serves existing and new conversations.
- Confirm rollback means selecting the legacy runtime/configuration and preserving v7 data; it must not downgrade the database or mutate immutable snapshots.
- Run public-safety checks for keys, private records, local SQLite files and generated artifacts.
- Produce a reviewable change list, test matrix, runtime ownership record, known-limit list and concrete rollback steps.

## Acceptance Gates

Phase 7 is ready for a release decision only when every applicable gate below is recorded as pass or an explicitly accepted limitation:

| Gate | Required evidence | Current state |
| --- | --- | --- |
| Existing regression | API/Web suites and public-safety checks pass | Pass: API 352/352, focused Agent 51/51, new regression 4/4, Web 91/91, Python 3.9 AI 188 total/120 passed/68 skipped; public-safety and release-readiness checks pass |
| Data boundary | No private data or secrets in fixtures/artifacts | Scoped public fixtures/source scan passed; existing untracked `output/` must be excluded from publication |
| Semantic quality | Held-out manual review with unsupported claims reported | Frozen expanded gate passed: Agent 56/60, legacy 60/60, zero critical issues; the current offline repair adds no real-model semantic score. Earlier 22-case/v2/v3 findings remain historical evidence |
| Paired comparison | Both engines return reviewable answers on a new case | Pass for one consistent MSFT pair: both passed numerical/source checks; old failures/truncations retained; no broad winner inferred |
| Unknown/retry policy | No automatic replay or fallback after timeout/disconnect/unknown | Pass offline; external provider behavior remains limited |
| Runtime ownership | 3000/8000 ownership, cold start/reuse/cleanup verified | Pass: 3000 retained; authorized 8000 rollback and Python 3.12 restoration passed |
| Legacy fallback | Legacy path works with Agent disabled | Pass: new same-session synthetic fallback test on Python 3.12 and Python 3.9 |
| Rollback | Documented and tested without data downgrade | Pass: live temporary switch/restoration preserved v7 data, seven sessions and original hashes |

No single gate may be silently inferred from another gate. In particular, structural validation, retrieval recall and provider availability do not prove semantic correctness or release readiness.

## Phase 7.4 Review Record

- HEAD is unchanged at `daa49363d91a215303b835733aeda516dd6f895d`; all earlier work remains uncommitted. Next listener PID 45468 and Python 3.12 uvicorn reload parent PID 52346 are project-owned. Editing two API tests triggered the existing watcher to replace child PID 55605 with 58647; there was no manual service stop or switch. Post-reload health/capability/in-flight checks passed.
- API GET health and capability checks passed; capability is bound to the current verified configuration, and `automatic_probe=false`. SQLite read-only checks found schema v7, `quick_check=ok`, seven sessions and zero unfinished Agent or legacy turns. No probe, preview, confirmation, model request or replay occurred.
- Canonical 3000 Playwright check confirmed the unified question entry, both analysis modes, historical calendar/session display, hand-note editor and absence of retired market/instrument/source controls and old analysis buttons. Browser closed after review; no note or conversation was submitted.
- Offline tests: full Python 3.12 API 323/323, Web 91/91, legacy Python 3.9 AI 159 tests with 54 expected Agent skips, and `git diff --check`. The new fallback regression confirms a disabled Agent turn followed by a successful legacy LLM turn in the same conversation using a synthetic completion. Launcher failure/cleanup and v6-to-v7 migration/immutability tests remain in the passing suite.
- Rollback runbook: verify ownership and zero in-flight Agent/legacy/quant work; retain a local backup of `storage/local/app.db`; stop only the authorized 8000 API group; start `.venv/bin/python -m uvicorn app.main:app --reload --reload-dir apps/api --app-dir apps/api --host 127.0.0.1 --port 8000` against the same v7 DB; verify health, disabled Agent capability and old-session GETs without inference. The synthetic legacy completion has already been tested offline. Keep 3000. To resume one-click launcher supervision, stop the authorized legacy API and restore the tested Python 3.12 launcher runtime. Never downgrade the database, rewrite snapshots or treat a failed/unknown request as replayable.
- This runbook was reviewed and its compatibility tested offline; it was not executed against the user-owned canonical API. The one-click launcher deliberately refuses to reuse the legacy Python listener, so manual operation is required during that rollback state. SIGKILL/power loss still require ownership and in-flight review before cleanup.
- Publication inventory must exclude ignored `storage/local` and the pre-existing untracked `output/` artifacts. Scoped source/fixture secret signatures and untracked database/export checks found no new public-data boundary violation. A final publication diff and artifact review are still required before any release.
- Open release gate: execution and manual review of the new 60-case/12-category semantic cohort. A complete consistent MSFT pair is already reviewed; a superiority winner is not required. Provider cancellation/billing evidence is an accepted limitation. The supervised live rollback gate is closed. The conclusion is **暂不发布** pending the new evidence; this plan does not authorize commits, pushes or deployment.

## Phase 7.1 Result

- Fixture: `storage/templates/ai-journal-agent-phase7-heldout.json`, marked `split=phase7-heldout` and using IDs/text distinct from the existing evaluation fixture.
- Scope: 22 cases, 17 positive and 5 deletion/exclusion/future/revision/no-match cases. It covers new company themes, aliases, a trade reason, currency/time boundaries and untrusted instruction text.
- Command: `PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/evaluate_ai_journal_agent.py --input storage/templates/ai-journal-agent-phase7-heldout.json`.
- Result: candidate recall **1.00**, Recall@5 **1.00**, `passed=true`, `real_model_tested=false`; the six-case baseline and this five-case held-out negative set remain separate.
- Regression: `test_ai_journal_agent_evaluation.py` now verifies held-out IDs are disjoint from the baseline and blocks network access. Focused result: **6/6 passed**.
- Limitation: this measures production candidate freezing and retrieval ranking only. It does not evaluate generated answer entailment, numerical calculations, provider behavior or release readiness. The evaluator's `after` filter is applied at retrieval time; candidate rows may still contain earlier sources, so this case does not claim candidate-level post-filter exclusion for `after` windows.

## Phase 7.2 Offline Preparation

- Generated the paired review template with `--comparison-template` from the held-out fixture. It contains 22 cases with identical frozen original inputs for `legacy_llm` and `agent`.
- Every engine answer, source review, calculation review, token count, cost and duration remains `null`; `real_model_tested=false` and status remains `awaiting_paired_outputs_and_review`.
- Added a regression that checks expected sources are contained in each frozen input and that no market/position data is invented by the template.
- Focused evaluation suite after this addition: **7/7 passed**.
- Real paired execution remains a separate authorization gate. It must use a new request/cost limit, must not replay the unknown or truncated Phase 6 requests, and must stop without retry after an unknown or incomplete result.

## Phase 7.2 Result

- New authorized run completed with fixture `phase7-paired-aapl-fractional-40-v1`: **4 Agent requests / 7 tools / 8 sources** succeeded; one legacy request returned a 6144-token truncated response.
- Agent manual review passed the requested numerical/source checks: 36.19 USD holding cost, 50.60 USD market value, observed weight 1, MA5/20/60 38/30.5/null, distinct dates and unknown fundamentals. All 8 citations and both calculation parent sets resolved to archived sources.
- Legacy output was not valid, not archived as successful and not retried. The five-request admission closed with `stopped_no_replay`; no quality/cost winner is claimed.
- Full record: `PHASE7_PAIRED_COMPARISON.md`. Further real calls require a new authorization.

## Phase 7.3 Offline Reliability Result

- Existing loopback fault suite: **3/3 passed**. It covers partial response/socket closure, actual SDK read timeout with no retry and local cancellation while the synthetic peer may still finish.
- The broader API regression also passed **322/322**, including lease fencing, cancellation, duplicate confirmation, late-write rejection, expiry recovery and archive transaction rollback.
- These are controlled local transport/storage tests. They do not prove that an external provider stopped processing or billing after cancellation, and no external fault injection was attempted.
- Phase 7.3 remains offline-complete for the current scope; external provider behavior remains a release limitation.

## Authorized Closeout Supersession

The later authorized closeout supersedes pending-status wording in the historical preparation/result sections above. It used 111 of 115 authorized requests, completed the v2 and v3 six-case targeted semantic reviews, executed and restored the live rollback path, and includes a complete reviewed MSFT numerical pair. Provider cancellation/billing is accepted. The fresh expanded semantic cohort was subsequently authorized, executed and reviewed; its result is recorded below. See `REMEDIATION.md`, `EXPANDED_PAIRED_PLAN.md` and the latest `PROGRESS.md` entry.

## Expanded Cohort Result

The later authorization completed the fresh `release-expanded-holdout-v1` cohort in `storage/local/semantic-review-ewongao4`: 60/60 pairs, 193 requests, 120 manual reviews, Agent 56/60 (93.33%), legacy 60/60 (100%), four legacy-only pairs, zero critical issues, and the frozen gate passed. The four Agent failures were explicit run-limit answers; no request was replayed. The result closes the limited authored semantic-sample gate while retaining the synthetic-corpus and no-superiority limitations.

## Execution Order

1. Freeze this plan and create the held-out synthetic fixture without model calls.
2. Add offline semantic/reliability tests and run the existing full regression suite.
3. Review the offline report and decide whether a new paid synthetic comparison is necessary.
4. If necessary, obtain a separate request limit and cost authorization, then run one bounded cohort with no replay.
5. Recheck canonical 3000/8000 and the launcher after all code changes; stop temporary services and browsers.
6. Produce a release recommendation or a documented “not ready” result.
7. Only after explicit user instruction, consider commit, push, deployment or public release.

## Stop Conditions

Stop the Phase 7 run immediately when any of the following occurs:

- A model request has an unknown transport/result state.
- A response is truncated, lacks required evidence, or makes an unsupported high-impact claim.
- The configured request/cost budget is reached.
- A listener is foreign, unhealthy, or has an unfinished user-owned task.
- A test would require real private data, an unbounded provider request, automatic retry or protocol fallback.
- A migration, rollback or public-safety check fails.

The stop result must record what was attempted, what remains unknown and why no replay or automatic cleanup was performed beyond owned resources.

## Deliverables

- `PHASE7_PLAN.md` kept current with gate status.
- A held-out evaluation fixture and reproducible offline report.
- Reliability/runtime verification records and any narrowly scoped code changes.
- Updated `PROGRESS.md`, `BLOCKERS.md` and `EVALUATION.md`.
- A release recommendation with rollback steps, or an explicit not-ready report.
