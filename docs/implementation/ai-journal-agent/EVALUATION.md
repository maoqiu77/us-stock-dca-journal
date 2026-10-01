# Phase 6 Evaluation Evidence

Updated: 2026-10-01 (Asia/Shanghai)

## Run-limit Remediation Evidence (2026-10-01)

The expanded 60-case receipt remains frozen. Read-only inspection identified a local graph preflight failure: the accumulated UTF-8 serialization of `messages_to_dict` crossed the 32,000-byte model-input limit before the third Agent request in each of the four failed cases. Recorded model/tool counts, provider usage, finish reasons, and durations rule out model truncation, transport timeout, token limits, and tool/deadline exhaustion. The prior graph then persisted its deterministic insufficiency sentinel as a successful run, which was a state-classification error.

The implementation now compacts repeated tool match payloads and cache results while retaining observed source IDs, message linkage, and different query-dependent excerpts from the same original. A final-only turn is requested when the request with tool schemas would exceed the input bound; local limit reasons are recorded, and an unrecoverable `budget_exhausted` state is failed. The input and other safety bounds remain unchanged; no retry or unknown outcome is converted into success.

The disjoint offline regression fixture `storage/templates/ai-journal-agent-run-limit-regression.json` covers the four affected categories with four new cases. Its distinct repeated-search loop proves the graph compacts overlapping evidence and reaches a cited final answer within 3 model calls and 6 tools. Additional regressions preserve different excerpts from one original and the first full observation across a compacted cache hit. New regression tests pass **4/4**, focused Agent **51/51**, full Python 3.12 API **352/352**, Python 3.9 AI **188 total: 120 passed / 68 skipped**, and Web **91/91**. Public-safety, release-readiness, and `git diff --check` pass.

The final read-only canonical 8000 check passed health/capability, SQLite v7 `integrity_check=ok`, zero unfinished Agent/legacy/quant tasks, seven historical session reads, and all six original-data count/SHA256 comparisons against the rollback baseline. On canonical 3000, a single browser-intercepted synthetic session GET verified desktop/mobile failed `agent_run_limit` wording, absence of a cancel button, and no horizontal overflow. The browser made zero write/model requests and was closed. This checks presentation, not generated-answer quality; canonical services were not manually stopped or restarted.

This evidence is sufficient for the shared local root cause and repair, and the scoped change is ready for code submission without new paid model requests. It does not provide a new real-model semantic score: the original Agent **56/60** and legacy **60/60** results remain frozen and were not rerun. Subsequent sections preserve historical evaluation evidence and test totals; code submission is separate from release approval.

Independent final review found no blocking issue. The two frozen artifacts under `storage/local/semantic-review-ewongao4` still match the initial read-only SHA256 baseline:

- `verification.json`: `11ae471c35bd60135eff26bfa92b08fffb46adb73e262620b0908241af6a3f71`.
- `comparison.json`: `6cc5b3243405d4638d9924f31cc5dd1280d3d0d7b3c7fef6dd5c3de8e4ffa228`.

## Status

Offline retrieval/reliability and reviewed real synthetic canonical tool loops pass within the limits below. The expanded Phase 7 cohort used 193 additional requests and reviewed 60 pairs: Agent passed 56/60, legacy 60/60, with zero critical issues and the frozen semantic gate passed. A complete consistent MSFT pair passes numerical/source checks for both engines; older failed, truncated and unknown attempts remain preserved. There is no supported broad superiority claim and none is required for a comparison. The 60-case/12-category original-memory cohort had Recall@5 0.93 before execution. Live rollback was executed and restored; provider-side cancellation/billing is an accepted limitation. See `EXPANDED_PAIRED_PLAN.md`.

Keep three conclusions separate:

- Model availability: dedicated DeepSeek integration and final canonical multi-tool/multi-turn cases passed with the matching verified configuration. A provider alias does not pin immutable model weights.
- Structure and execution: schema/citation integrity, tool restrictions, budgets, transactions, concurrency and no-replay fault checks pass offline.
- Product effect: retrieval labels pass on the curated corpus. Final real UI samples correctly distinguish dates and fundamental-evidence limits; earlier semantic findings are preserved. A valid source ID does not prove a statement is supported, and the small reviewed sample is not broad entailment validation.

## Retrieval Corpus

Public synthetic fixture: `storage/templates/ai-journal-agent-evaluation.json`.

- 30 originals, 40 questions: 34 positive queries and 6 negative/filter cases.
- Chinese, traditional Chinese and English aliases; old trade reasons; multiple relevant originals; date windows; deletion, exclusion, future/revised versions; unknown trade-reason version; unrelated query.
- Evaluation invokes production `candidates`, `build_scope` and `retrieve`. It includes the 24-original frozen candidate bound, excerpt/byte limits and the first five of at most six tool results. No provider, credential or real workspace access. SQLite is in memory.
- Macro Recall@5 over the 34 positive cases: **1.00**, exceeding the initial 0.85 target. Candidate recall also 1.00. All six negative cases returned no matches; forbidden originals were absent.
- Labels specify originals that must be retrieved, not an exhaustive relevance label for every returned document. This is not a precision measurement, a held-out generalization result or a semantic answer score. Several top-five lists also contain other originals, visible in the report.
- Removing a labeled original's matching text/ticker makes the evaluation fail; unknown labels, duplicate case IDs and datasets not explicitly marked synthetic are rejected.

```sh
storage/local/agent-dev-venv/bin/python scripts/evaluate_ai_journal_agent.py
storage/local/agent-dev-venv/bin/python scripts/evaluate_ai_journal_agent.py --comparison-template
```

The second command prepares identical frozen original inputs, date filters and review criteria for `legacy_llm` and `agent`. Its forty-pair template still has null answers/measurements and sends no requests. Separate real receipts now cover a 22-case original-memory cohort and a six-case targeted semantic regression; those reviews do not establish broad entailment or a winner. The corpus supplies no portfolio/market observations, so it cannot measure numerical calculation quality.

## Acceptance Coverage

The matrix records offline synthetic coverage. Separate live synthetic evidence below supplements it; neither is live-provider fault injection or a guarantee about generated prose.

| Plan scenario | Evidence and limit |
| --- | --- |
| Ask why a past purchase was made | `test_tool_result_drives_next_action_without_market_tools`, old-reason RAG labels; real date follow-up selected memory and cited both originals. Some earlier real date runs also read holdings/policy unnecessarily. |
| Trend: series before calculation | `test_six_tools_are_scoped_and_indicators_require_observed_series`; unobserved input rejected; calculation parent IDs checked. |
| MA60 with only 20 bars | Same test: MA20=10.5, MA60=null; technical missing-field contract. |
| Cash unknown / USD and CNY | `test_currency_exposure_cost_weights_and_missing_prices`: unknown cash, within-currency weights, no across-currency total. Free-text claims still need review. |
| Input-box cost assumption | `test_user_cost_assumption_stays_separate_from_original_position_and_ledger`: cost 17/shares 3 stays in assumptions; original cost 12/shares 10 unchanged. |
| No news/fundamentals | `test_ungranted_period_and_future_observation_cannot_reach_report_sources`: explicitly unavailable, no source/provider call. Generated causal explanations require review. |
| Injected original text | `test_injected_original_cannot_expand_executor_or_upload`: original containing upload instructions is data; model-requested URL tool rejected; executor unchanged. |
| place_order / arbitrary URL | Unknown tools rejected by executor; socket calls prohibited in tests. |
| Unread or old AI citation | `test_unread_old_ai_citation_rejected_despite_valid_schema`, `test_false_citation_gets_only_one_repair`: at most one repair, terminal validation failure. |
| Out-of-scope identity/period | Scoped-series test and new ungranted-period test: reader not called. |
| Future evidence/history | Evidence admission rejects future quotes; RAG labels reject future/revised notes and historically unknown trade-reason versions. No news source adapter exists. |
| Note edit/delete / access revocation | Existing frozen/cached-access tests plus `test_deleted_queued_original_stops_before_any_model_call`: cancelled before model creation. |
| Same key / two workers | Concurrent confirmation test plus `test_two_managers_execute_one_run_only_once`: one actual injected model execution. |
| Provider timeout/process loss | Actual graph deadline cancels local await, reserves one request and marks unknown usage. Expired in-flight receipt remains outcome_unknown, unclaimable, same confirmation returns same run. Simulated transport/lease loss only. |
| Cancellation and late reply | Existing manager/store fencing tests reject late success and preserve terminal cancellation. No guarantee upstream processing/charging stops. |
| Four continuing tool rounds | `test_final_budget_step_rejects_more_tools_before_execution`: four model calls, no fourth tool execution. Existing cache/tool-budget test also caps eight tools. |
| Model/protocol unavailable | Fingerprint/version/protocol gating tests keep unsupported Agent disabled; legacy path tests pass. |
| Old snapshots/sessions | v6 backup/upgrade/read tests and canonical historical calendar read. No mutable backfill. |
| Expiry | New unconfirmed-preview expiry test creates no run. Prior duplicate-confirmation test still returns same run after expiry. |
| Archive storage fault | New injected SQLite event-write failure rolls back success status, answer, sources and events in the finish transaction. Prior persisted progress is not erased. |

## Observed Semantic Faults

Previous live output confused a 2020 trade date with a 2026 note version and asked for workspace authorization already granted. The prompt guidance remains in place. This round adds `time_semantics` to memory tool views:

- `trade_date`: actual trade date only for trade reasons.
- `original_version_at`: known note version time; unknown for trade reasons.
- `snapshot_available_at`: availability of this frozen snapshot.
- `as_of_meaning`: note version time or snapshot time that does not establish a trade/reason version date.

Regression tests check these fields and unchanged original payloads. They and the final prompt guidance have now been real-retested: the canonical date follow-up explicitly rejects inferring initial writing from later saved/modified version time, and the full report leaves demand/earnings unknown without fundamentals. Earlier reports still contained ambiguous/unsupported wording, preserved in the review. No generic semantic validator was added; unsupported prose can still pass structural citation validation.

## Verification

- Latest Python 3.12 API suite: **337/337** passed, including provider tests, migrations, launcher regressions, semantic/comparison-harness checks, output reservation, final-report filter-status regression and final-bar technical Evidence timestamp regression.
- Latest Python 3.9 AI compatibility: **113 passed, 60 optional-runtime skips**; no Agent execution claim in that environment.
- Web: **91/91** passed, including archived indicator cutoff and missing/invalid cutoff regressions. Technical card/source drawer use calculation payload time rather than source retrieval time; old snapshots stay immutable.
- Canonical 3000/8000: approved temporary synthetic API, actual four-call/eight-tool full send plus two-call date follow-up; report/source/archive, same session, refresh/offline reconnect and desktop/mobile checks passed without mocks or replay. Two previews/two confirmations. Incorrect GET polling route was corrected; correct-route GET/SQLite/screenshots independently establish success. Normal Python 3.12 original-database API restored; final normal-page check had zero journal POSTs. Browser closed; all screenshots remain ignored.
- Public safety and whitespace checks pass. Existing FastAPI lifespan deprecation warnings and legacy LibreSSL warning remain unrelated.

## Outstanding

Phase 7.1 held-out retrieval adds 22 cases (17 positive, five negative/filter cases) with disjoint source IDs and Recall@5 **1.00** through the production candidate/freeze/retrieval path. The authorized 22-case real cohort used 65 requests: 17 full semantic passes and five conservative partials for filtered/no-result cases, with no forbidden claim or incomplete request. A targeted six-case v2 cohort used 18 requests and passed **6/6 for both engines** after prompt corrections. A v3 filter-status recheck used another 18 requests and passed 5/6 for both engines; `r2-cutoff` remains partial because neither engine explicitly explained that the later version was filtered by the historical cutoff. The new 60-case cohort used 193 requests and passed its frozen gate: Agent 56/60, legacy 60/60, each category at least 4/5, zero critical issues. These results remain descriptive semantic evidence on authored synthetic originals, not broad field entailment or model superiority. The `after` filter is applied during retrieval, while the bounded candidate list can retain older rows for later filtering.

The first paired memory and numerical attempts remain historical records; truncated/unknown outputs were not replayed. Prompt corrections for date semantics, permissions, record ownership and unsupported company facts are covered by the targeted v2 review and the expanded cohort. Rechecked complete MSFT pair: both engines pass the specified numerical/source checks, with usage and duration recorded and an Agent wording issue preserved. The expanded cohort closes the authored original-memory sample gate, but universal entailment, live portfolio reliability and model superiority are not inferred. The live rollback exercise is complete and its receipt preserves v7 data and hashes. Provider cancellation/billing is accepted. No release qualification, commit, push or deployment.

Latest portfolio attempt is documented separately in PORTFOLIO_COMPARISON.md. The subsequent closeout case used Agent four calls/eight tools/eight sources and reviewed 6/6 requested numerical fields (25.34 holding cost, 40.25 market value, observed weight 1, MA5 58, MA20 50.5, MA60 30.5). The legacy request returned only a 6144-token `finish_reason=length` response and was not retried or counted as a valid answer. Agent-only estimated cost is approximately 0.021-0.043 CNY for the closeout calls; actual billing and a paired quality/cost winner remain unknown. The latest post-change regression is 336/336 API plus 91/91 Web; canonical archive/runtime checks remain healthy.
