# AI Journal Agent Progress

Updated: 2026-10-01 (Asia/Shanghai)

## Run-limit Remediation (2026-10-01)

- The four frozen Agent failures were inspected read-only. Each had two completed provider calls ending in `tool_calls`, four to six successful tools, complete input/output usage, and a sub-five-second runtime. The third request was never sent: the accumulated graph message serialization crossed the local 32,000-byte input preflight. The original graph turned that local sentinel into a `succeeded` run, which also caused the harness to count it as completed.
- `apps/api/app/modules/ai_journal/agent/graph.py` now compacts repeated tool match/source payloads while keeping the first full evidence, distinct query-dependent excerpts from the same original, and all source/tool IDs. It switches to a final-only model turn when the request with tool schemas would exceed the input bound. `runtime.py` records the precise local limit reason and returns compact cache hits without changing access checks. `manager.py` stores any unrecoverable budget sentinel as failed `agent_run_limit`; the web API explains that it will not be resent.
- Added the disjoint four-category fixture `storage/templates/ai-journal-agent-run-limit-regression.json`, offline graph/cached-observation/distinct-excerpt regressions, a local-limit diagnostic, and manager finalization coverage. New regressions pass **4/4**; focused Agent **51/51**; full Python 3.12 API **352/352**; Python 3.9 AI **188 total: 120 passed / 68 skipped**; Web **91/91**. Public-safety, release-readiness, and `git diff --check` pass. Five pre-existing synthetic key literals in `test_ai_settings.py` now use the same file's `sk-test` convention without weakening the scanner.
- Final read-only canonical 8000 verification passed health/capability, SQLite schema v7 and `integrity_check=ok`, zero unfinished Agent/legacy/quant tasks, all seven historical session reads, and all six original-data count/SHA256 comparisons against `storage/local/release-rollback/before.json`.
- Canonical 3000 desktop/mobile verification used one browser-intercepted synthetic session GET to show failed `agent_run_limit` as “分析未完成” with its Chinese no-automatic-resend explanation. The page showed no cancel button or horizontal overflow, made zero write/model requests, and the browser was closed. Screenshots remain local in `output/playwright/run-limit-closeout-{desktop,mobile}.png`; this is UI-state evidence, not a real inference test.
- Independent final review found no blocking issue and confirmed that frozen `verification.json` / `comparison.json` SHA256 values match the initial baseline. This offline evidence is sufficient for the shared local root cause, and the scoped change is ready for code submission without new paid model requests. No paid request was made, no frozen 60-case receipt was changed or replayed, and no canonical service was manually stopped or restarted. Source edits were picked up by the existing uvicorn reload process; its supervisor and the existing Next listener were retained. Agent **56/60** and legacy **60/60** remain the frozen scores; this repair claims no new real-model semantic score and no deployment or public-release approval. The current 80-request/20 CNY authorization remains unused.

Sections below retain historical phase decisions and test totals; the current remediation results are recorded above.

## Phase 7.4: Release and Rollback Review

## Expanded Paired Semantic Evaluation: Complete

- Ran the frozen `release-expanded-holdout-v1` fixture against both production engines using fresh synthetic SQLite workspaces. All **60/60 pairs** completed with **193 requests**: 133 Agent and 60 legacy; every call reported valid usage, with no truncation, unknown result, failed execution, retry or fallback.
- Reviewed all **120 answers** against the frozen originals, required claims, forbidden claims and time/currency/scope boundaries. Agent passed **56/60 (93.33%)**; legacy passed **60/60 (100%)**. The four Agent failures were run-limit answers with no substantive response, one each in business conditions, note time, contradictory sources and multiple sources. Each affected category remained 4/5; zero critical issues.
- Paired outcomes were 56 both-pass and 4 legacy-only. The frozen semantic gate passed. This closes the limited authored original-memory sample-size blocker, but does not show Agent superiority or generalize to real-user trials, live portfolios or market-provider behavior.
- Reported usage and timing are archived in `storage/local/semantic-review-ewongao4/comparison.json`: Agent 569,628 input / 78,839 output tokens over 133 requests; legacy 138,656 input / 32,823 output over 60 requests. Median/p95 duration: Agent 7,309.5/12,189 ms; legacy 2,982/8,422 ms.
- Full receipt, review template, completed review and comparison are private ignored artifacts. Canonical 3000/8000 and the original database were left unchanged; read-only post-run health/hash checks passed. API 346/346, AI 182 tests with 63 skips and Web 91/91 passed.

- HEAD remains `daa49363d91a215303b835733aeda516dd6f895d`; the Phase 0-7 work is still uncommitted. Canonical 3000 belongs to this project's Next dev process (listener PID 45468), and 8000 to this project's launcher-supervised Python 3.12 uvicorn reload group (parent PID 52346). Editing two API test files triggered the existing watcher to replace child PID 55605 with 58647; no service was manually stopped or restarted. Post-reload health/capability/in-flight checks passed.
- Read-only 8000 checks returned health `ok`, the existing fingerprint-bound Agent capability (`enabled=true`, `automatic_probe=false`), SQLite schema v7 and `quick_check=ok`. The original database had zero queued/running/cancel-requested Agent runs, zero pending/running legacy turns and seven historical sessions. No model endpoint, preview or confirmation was called.
- Canonical 3000 browser review confirmed the AI question field, Agent/text-analysis selector, expandable hand-note editor and historical calendar/session content. Selecting text analysis changed only the local draft. Retired selection controls and the two analysis entry buttons were absent. The browser was closed after the read-only check.
- Offline verification: Python 3.12 full API **323/323**, Web **91/91**, and Python 3.9 legacy AI suite **159 tests, 54 skipped, no failures**. Added a synthetic regression proving that an unavailable Agent creates a terminal disabled run while a subsequent turn in the same conversation still uses the legacy completion. An Agent-execution-only test now skips correctly on Python 3.9. `git diff --check` passed.
- Migration review found v6 backup, savepoint rollback and immutable-snapshot coverage. The current original DB is v7 and passes integrity check; no migration or downgrade was run on it. Launcher unit tests cover reuse, per-service ownership, startup failure and abnormal-exit group cleanup; prior canonical cold-start/Enter/SIGTERM evidence remains in `RUNTIME_PY312.md`. This round did not interrupt the user-owned canonical runtime to repeat those lifecycle tests.
- Rollback is manual: after ownership and in-flight review, stop only the authorized API group, start the old `.venv` uvicorn against the same v7 database, and keep 3000. Python 3.9 disables Agent execution while retaining legacy conversations and historical v7 reads. The current one-click launcher rejects a Python 3.9 API listener, so returning to launcher supervision requires restoring the Python 3.12 API. No canonical rollback switch was performed this round.
- Public-safety scan found no key/private-key signature or newly untracked database/export in the scoped source, tests, docs and public fixtures. `storage/local` remains ignored. Existing untracked `output/` artifacts are outside the public fixture boundary and must be explicitly excluded from any later commit/release review.
- **Recommendation: do not release.** The Phase 7 paired legacy answer was truncated and broad generated-answer semantic review is incomplete. The user accepts the unverified external provider cancellation/billing behavior as a known limitation; the manual canonical rollback has since been exercised end to end. No model request, replay, manual service restart, commit, push or deployment occurred.

## UI Cleanup: Unified Conversation Options Removed

- Removed the obsolete "标的与资料" section from the embedded AI calendar composer, including market selection, instrument search/results, private-context checkboxes and the "纳入本轮原文" control. The separate "持仓分析" and "标的快研" buttons remain absent.
- Preserved the unified AI question entry, Agent/text-analysis selector, automatic workspace context, note editing/deletion, historical session recovery and the existing legacy text path.
- Canonical `http://127.0.0.1:3000` verification after closing first-run onboarding and opening AI 日历 found no matches for `标的与资料`, `搜索标的`, `纳入本轮原文`, `持仓分析` or `标的快研`. Existing calendar/legacy session content remained readable. Desktop and 390x844 mobile screenshots are saved under untracked `output/playwright/`; these artifacts must be excluded from publication.
- Web tests remain **91/91** and targeted lint passed. A standalone `tsc -p apps/web/tsconfig.json --noEmit` remains blocked by pre-existing test imports ending in `.ts`; the repository does not enable `allowImportingTsExtensions`, so shared TypeScript configuration was not changed.
- No model request, canonical service restart, commit, push, deployment or release operation was performed. The existing Phase 0-7 changes remain uncommitted.

## Scope and Baseline

- Current scope: Phase 0-7 planning/evaluation and dedicated DeepSeek integration retained. The root local launcher now persistently selects/validates the existing Agent Python 3.12 environment; canonical API cold start/reuse/cleanup and original-data UI reads passed with zero new model calls. Current API **322/322**, Web **91/91**. Portfolio and Phase 7 paired comparisons remain incomplete because legacy outputs were unavailable or truncated; no winner is claimed. Phase 7 release gates remain open. See RUNTIME_PY312.md, PORTFOLIO_COMPARISON.md, CLOSEOUT.md, PHASE7_PLAN.md and PHASE7_PAIRED_COMPARISON.md.
- Phase 0/1 sections below retain the first round's delivery record. The new Phase 2/3 section describes current behavior.
- Plan baseline: `84579eeb1b64c167228d1add5695e3aa8f8ada18`.
- Actual starting HEAD: `daa49363d91a215303b835733aeda516dd6f895d`.
- Branch created from actual HEAD: `codex/ai-journal-agent-phase-0-1`.
- Read root and Web AGENTS.md, plus installed Next 16.2.9 `use-client` documentation.
- Baseline comparison: six changed files concerned calendar display, prompts and their tests. Verified Web composer/API/state -> FastAPI router/service -> context/store wiring before editing. Those existing changes remain intact.
- Existing untracked `output/` and `构建/` were retained. No commits, pushes, deployment or paid model calls were made. The older Streamlit project and mini-program cloud functions were not edited.

## Phase 0: Complete

- Added optional Python >=3.12 Agent dependency input and an exact compatibility lock. Existing `requirements.txt`, `.venv`, launcher and default production imports remain on the legacy path.
- Installed the lock into ignored `storage/local/agent-dev-venv` for verification: Python 3.12.13, LangGraph 1.2.12, langchain-core/openai 1.6.6, Pydantic 2.13.5 and OpenAI SDK 2.54.0. OpenAI remains within the existing `>=2.48,<3` constraint.
- Model capability records are keyed by the existing configuration fingerprint. Offline verification cannot set `tool_calling=true`. There is no paid automatic probe or public capability-writing endpoint.
- Credential-free fake model and offline evaluation entry verify empty-content tool calls, call-ID linkage and imports of the installed Agent libraries. They do not implement the production graph.
- `/api/ai-journal/agent-capabilities` is read-only and always disables execution in this phase.

| Protocol/provider family | Legacy text path | Agent execution | Real model validation |
| --- | --- | --- | --- |
| `chat/completions` | Retained | Disabled | Not performed |
| `responses` | Retained | Disabled | Not performed |
| Anthropic `messages` | Retained | Disabled | Not performed |
| DeepSeek extensions | Existing text provider retained | Disabled; dedicated adapter required | Not performed |
| Third-party / `auto` | Existing text path retained | Disabled; no implicit protocol switching | Not performed |

## Phase 1: Complete

- Added versioned Agent preview options, defaulting to `engine=llm`. Requests still forbid browser-supplied facts, scope and evidence.
- Agent scope is generated from resolved target/selected position identities and the verified Web US daily-period whitelist. Symbols in question text grant no access. Scope and frozen sources are part of the immutable snapshot digest.
- Selected notes and nonempty trade reasons are frozen with entity identity, revision, content hash and timestamps. Excluded records are removed from both Agent candidates and private context. Candidate count/body limits are enforced without expanding legacy selection limits.
- `suggest_related` returns an explicit not-ready error; automatic candidate selection/retrieval belongs to Phase 4. Refresh permission may be represented in scope but execution is disabled. Historical snapshot reuse requires frozen market policy and retains observation times.
- Evidence/Report contracts validate classification, payload hashes, timezone awareness, calculation inputs and references to observed sources. Historical AI answers are separately tagged `ai_generated` and cannot be registered as Evidence. These checks do not prove natural-language entailment.
- Added v7 run/source/event/capability tables, queue index and savepoint migration; updated schema version and pre-upgrade backup condition. Old snapshot update/delete triggers remain intact.
- Agent confirmation atomically creates one turn and one run. In this phase the wired endpoint records terminal `failed / agent_execution_not_ready`; it does not call the legacy completion or enqueue an unattended task. Same snapshot/key returns the original run even after failure or expiry.
- Storage includes atomic queue claiming, lease-token checks, cancellation, and transactional result/source/event/answer persistence for later worker integration. No worker, graph or provider adapter is wired. Cancellation invalidates a token so late success writes fail.
- Added typed run read/cancel responses and optional session/turn metadata. Run responses exclude lease tokens and raw source bodies.
- Frontend types remain compatible with old sessions. Request comparison normalizes Agent defaults and property ordering, preserving confirmation for legacy drafts.

## Changed Files

| Area | Files |
| --- | --- |
| Database | `apps/api/app/core/database.py` |
| Existing journal | `apps/api/app/modules/ai_journal/{models,migration,router,service,store}.py` |
| New Agent foundations | `apps/api/app/modules/ai_journal/agent/{__init__,capabilities,contracts,evaluation,migration,scope,store}.py` |
| Optional dependencies | `apps/api/requirements-agent.in`, `apps/api/requirements-agent.lock` |
| Backend tests | `apps/api/tests/test_ai_journal_agent_foundations.py` |
| Web contracts/comparison/tests | `apps/web/src/features/ai-journal/{api,state,state.test}.ts` |
| Progress | `docs/implementation/ai-journal-agent/PROGRESS.md`, `BLOCKERS.md` |

## Verification

Run from the repository root unless stated otherwise:

```sh
uv pip compile apps/api/requirements-agent.in --python-version 3.12 --output-file apps/api/requirements-agent.lock
uv venv --python python3.12 storage/local/agent-dev-venv
uv pip sync --python storage/local/agent-dev-venv/bin/python apps/api/requirements-agent.lock
uv pip check --python storage/local/agent-dev-venv/bin/python
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m app.modules.ai_journal.agent.evaluation
PATH="$PWD/storage/local/agent-dev-venv/bin:$PATH" PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m unittest discover -s apps/api/tests -p 'test_ai*.py'
PATH="$PWD/.venv/bin:$PATH" PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_ai*.py'
PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_database_migration.py'
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m compileall -q apps/api/app/modules/ai_journal
npm --prefix apps/web run test
npx tsc --noEmit --allowImportingTsExtensions -p apps/web/tsconfig.json
git diff --check
```

From `apps/web`: `npx eslint src/features/ai-journal/api.ts src/features/ai-journal/state.ts src/features/ai-journal/state.test.ts`.

Results:

- Dependency resolution/sync/check: 71 compatible packages; Agent imports and offline evaluation passed. Fake roundtrip: two calls; `real_model_tested=false`.
- Python 3.12 AI tests: **80/80 passed**. Python 3.9 legacy environment: **79 passed, 1 explicitly skipped** because optional Agent libraries are absent.
- New foundation tests prohibit socket networking. Covered forged request facts/scope, excluded notes, content/classification integrity, atomic source registration, unknown references, scope hashing, concurrent idempotent confirmation, token ownership, cancellation, transactional results, v6 backup, old-session readability, v6 rollback and nested v5 rollback.
- Database migration regression: **1/1 passed**. Compileall passed.
- Web tests: **87/87 passed**. Targeted ESLint, TypeScript with the flag above, and whitespace checks passed.
- Initial broad AI CLI run without the repository's PATH setup had five failures because child `python3` could not import PyYAML; rerunning with the existing test-script PATH convention resolved all five. No dependencies were changed in `.venv`.
- Plain `tsc --noEmit` reports TS5097 for existing `.ts` test imports and the new test following that convention. The explicit `--allowImportingTsExtensions` check passed; repository-wide TypeScript configuration was not changed.
- Initial ESLint invocation from the root could not locate the Web config; the command from `apps/web` passed.
- Used the project launcher after confirming both canonical ports had no listener. Playwright verified `http://127.0.0.1:3000`: existing calendar/history readable, both entry buttons present, unselected-private-context portfolio preview succeeds, confirmation button becomes enabled despite new server defaults, draft editing invalidates the preview, and quick research opens its identity search. No model confirmation was clicked.
- Canonical `8000` capability response confirmed all protocols disabled and `automatic_probe=false`. This turn's browser and launcher-owned services were closed after verification; no user-owned runtime was interrupted. Browser artifacts and runtime backups remain local/ignored.

## Phase 2: Implemented, Offline Verified

- Standard OpenAI Chat/Responses adapter preserves AI/tool messages and usage. It uses `max_retries=0`, locks the endpoint, disables automatic previous-response linkage and sets Responses `store=False`. Existing base URL normalization is reused; `http_socket_options=()` preserves environment proxy handling.
- Execution requires Python >=3.12, optional libraries and a real-provider capability record matching the current configuration fingerprint and adapter version. Only OpenAI/custom standard protocols have adapters; Anthropic and DeepSeek extensions remain disabled. There is no implicit provider/protocol fallback.
- Added explicit `POST /api/ai-journal/agent-capabilities/test`, requiring `confirmed=true` and an endpoint. Its two bounded requests contain fixed synthetic echo data only. Privacy/configuration are checked before and after each call. Loading/previewing never performs a paid probe. This endpoint was NOT invoked against a real provider this round.
- Six tools connect to confirmed frozen sources: positions, policy, selected original-record search, market facts, closed daily series and deterministic indicators. Identity checks occur in both executor and adapter; market tools perform no runtime provider requests.
- Memory search is bounded lexical matching within explicitly selected originals (six rows / 9 KB). Candidate suggestion, BM25/aliases and expanded RAG remain Phase 4; no whole-library scan or embedding request was added.
- Series are revalidated with the repository's `Series` model. Sample/missing, unfinished, naive/future bars and forged/unobserved OHLC are rejected. Decimal MA5/20/60 and 20-final-bar ranges use source IDs; missing MA60 is null and ranges are not named support/resistance.
- Verified real ledger semantics: `costBasis` is weighted average remaining UNIT cost, `holdingCost` is total cost, and selected position `cost` comes from unit `costBasis`. Policy weights/stop-loss/take-profit values are 0-1 ratios. Tool responses state these units explicitly.
- Access checks reread privacy, selected note revision/body/deletion, trade reasons, position quantity/cost/currency/type, policy, run ownership/cancellation and configuration fingerprint. Checks apply before/after inference/tools and on cache hits. Historical AI answers remain context, never Evidence.
- Refresh remains disabled; historical market identity/time remain frozen.

## Phase 3: Implemented, Offline Verified

- Per-run LangGraph model/tool/validation loop lets the model choose zero or multiple tools from actual results; no fixed tool pipeline. Invalid final output gets at most one repair.
- Bounds: four model calls, eight accepted tool calls including cache hits, three external tools (refresh disabled), three tools per reply, 32 KB model input, 3072 output tokens, 14 KB tool output, 90-second run deadline, 25-second model and 15-second tool timeout.
- While awaiting a model, access/cancellation is checked every 250 ms; revocation cancels the local async await. Upstream processing/charging may still continue. Transport timeout/disconnection is terminal `outcome_unknown`, never automatic replay.
- `JournalAgentManager` is managed by existing startup/shutdown hooks. SQLite is the queue source. Transactional claims/tokens enforce two active runs per database, one per session and one at a time per worker.
- Available frozen Agent confirmation atomically queues turn/run and returns immediately. Unavailable configurations retain an explicit disabled terminal run. Duplicate confirmations return the original task, including terminal failures.
- Reservations/request-in-flight state persist before outbound calls. Owned progress writes save actual tool events, observed sources and usage. Missing usage is null/unknown; partial reported totals and reservations remain available without implying zero cost.
- Success archives structured report, natural-language answer, usage, sources and events atomically. No model-message log, internal/encrypted reasoning or credentials are persisted. Responses reasoning blocks remain ephemeral for roundtrip.
- Cancellation invalidates ownership and blocks late success. Recovery changes expired leases only to `outcome_unknown`; healthy other-process leases are untouched. Shutdown terminates only this manager's owned run. No cross-process checkpoint/resume or uncertain-request replay is implemented.

## Phase 2/3 Files

- New: `apps/api/app/modules/ai_journal/agent/{adapters,analytics,graph,manager,model,prompts,runtime,tools}.py`.
- Updated: `apps/api/app/modules/ai_journal/agent/{__init__,contracts,store}.py`, `apps/api/app/modules/ai_journal/{models,router,service}.py`, `apps/api/app/main.py`.
- New test: `apps/api/tests/test_ai_journal_agent_execution.py`.
- Updated: this document and `BLOCKERS.md`. Prior-round changes remain intact. No dependencies, Web UI, mini-program code or canonical environment were changed this round.

## Phase 2/3 Verification

```sh
PATH="$PWD/storage/local/agent-dev-venv/bin:$PATH" PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m unittest discover -s apps/api/tests -p 'test_ai*.py'
PATH="$PWD/.venv/bin:$PATH" PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_ai*.py'
PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_quant_analysis_manager.py'
PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_api_contracts.py'
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m compileall -q apps/api/app/modules/ai_journal
npm --prefix apps/web run test
git diff --check
```

- Python 3.12 AI suite: **101/101 passed**, including 21 new execution tests. New tests block socket networking and explicitly inject synthetic models or `httpx.MockTransport`.
- Python 3.9 compatibility suite: **79 passed, 22 optional-Agent tests skipped**. This is not Agent execution verification.
- Quant manager: **3/3 passed**; API contracts: **6/6 passed**; Web: **87/87 passed**. Compileall and whitespace checks passed.
- Actual ChatOpenAI serialization against mock transports verified empty-content calls, call-ID/results, usage, Responses `store=False`, no `previous_response_id`, and encrypted reasoning roundtrip. These are offline tests, NOT provider integration.
- Real graph/adapter/manager/SQLite integration with synthetic models verified autonomous memory-only tool choice, indicator sources, archival, queued idempotency, multiworker claims, database/session concurrency, healthy/expired leases, shutdown ownership, source edits/deletion/privacy revocation, in-flight cancellation and unknown-result non-replay.
- Initial timeout test hit the budget precheck threshold; a 200 ms allowance isolated timeout behavior and passed. A LangChain keepalive warning revealed disabled environment proxy detection; preserving default proxy handling resolved it.
- Reused user-started canonical `3000`/`8000` after identifying ownership; did not stop/restart services or upgrade Python. Initial browser navigation encountered a process change/connection resets; reloading restored canonical `3000`. AI calendar/history and both buttons rendered; an unselected-private-context portfolio preview succeeded and enabled confirmation. No model confirmation or real capability test was submitted.
- Canonical capability API correctly reports `runtime_available=false`, `enabled=false`, `verification=unverified`, `automatic_probe=false`. This reflects Python 3.9 and an unverified model, and is not live Agent integration success.

## Prior Phase 3 Stop Record

The Phase 3 round stopped before Phase 4-7. The later authorized Phase 4/5 round is recorded below.

**Through Phase 3 delivery, no real model requests were made.** The subsequent minimal real test is recorded below. Canonical Agent execution remains disabled. Legacy preview/confirmation, privacy, immutable snapshots, history and completion remain operational.

## Minimal Real Compatibility Test: 2026-10-01

- User explicitly authorized the minimal real compatibility test. Rechecked root AGENTS.md, HEAD (`daa49363d91a215303b835733aeda516dd6f895d`), worktree and current configuration; retained all existing edits.
- Current configured provider/model: `deepseek` / `deepseek-flash`, `chat/completions`. Existing privacy policy allowed inference. Credentials were read locally and were not printed or copied into artifacts.
- Executed the existing two-call `probe()` validation with an explicitly injected diagnostic ChatOpenAI factory in isolated Python 3.12.13. The production adapter still rejects DeepSeek; this diagnostic does not bypass that gate in production or save a capability record.
- Command: `PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python storage/local/agent-real-compatibility-test.py`. Diagnostic script is gitignored under `storage/local`; no API service restart, configuration change or database capability write.
- **REAL PROVIDER PASS:** first response contained exactly one `echo_capability` tool call with the expected synthetic value and an ID; the second request included the matching ToolMessage and returned exactly the expected value without further tools. Only fixed synthetic messages/tool results were sent; no holdings, notes, trading records or conversation history.
- Exactly two requests; no retry/fallback. Provider-reported usage: first 320 input + 70 output = 390 tokens; second 114 input + 25 output = 139 tokens; total **529 tokens**. Reported reasoning tokens: 27 and 20. Monetary charge/account billing was not independently verified.
- No `reasoning_content` was present in the parsed additional fields in this run. This does not establish preservation of DeepSeek extension fields or compatibility with other reasoning modes.
- **Still NOT real-tested:** DeepSeek dedicated adapter, multi-step production graph/report/evidence archival, cancellation/timeouts against this provider, portfolio/RAG, Responses, other models/providers and the canonical Web Agent workflow. No production capability was enabled. Canonical Python 3.9 remains a separate blocker.

## Accepted Phase 5 Direction

- User approved replacing the two independent portfolio/research buttons with a unified conversation entry. Intent determines the operation; preserve old session/task metadata compatibility.
- User explicitly requested automatic reading of holdings and related workspace data without a per-request data-authorization step. This supersedes the document's earlier per-request manual data selection requirement for the future unified Agent flow.
- Implement that direction in the later Phase 4/5 round: derive a bounded workspace scope server-side, automatically freeze the data used and record source provenance. Privacy mode remains effective; only necessary context is sent to the configured model. Keep immutable snapshots and old sessions; retain the existing LLM path.
- Exact instrument ambiguity still requires clarification. Model intent is not permission for trading or uncontrolled external requests.
- No Phase 4/5 implementation or button removal was performed in this minimal-test round. Existing preview/confirmation behavior is currently unchanged; the automatic-data flow must be adapted and tested in that implementation round.

## Phase 4: Implemented, Offline Verified

- User's latest direction supersedes the plan's two-button/per-request authorization design. Added a `conversation` task and `auto_context` option; older portfolio/research request types and the existing LLM adapter remain supported. Old snapshots/sessions were not rewritten.
- Server-side automatic scope reads current verified workspace holdings/plans and selects related original notes/trade reasons locally. It checks privacy before selection and freezes the bounded result. A holdings signature detects newly added/changed holdings as well as edits to selected records. Automatic LLM requests check private revisions before inference and before saving the result; Agent keeps its existing in-flight revocation checks.
- No per-request data authorization step in the unified UI. Sending automatically creates a server snapshot and uses the existing digest/idempotent confirmation API. Manual preview/confirm endpoints remain available for old callers. No browser-supplied facts, evidence or tool scope are accepted.
- Local BM25 ranking uses Chinese characters/bigrams, English terms and instrument aliases. It searches original records beyond the UI's recent-record list, freezes at most 24 originals / 40 KB, and returns at most six / 9 KB per tool search. Long originals return bounded matching excerpts with original character offsets; full archived originals/hashes remain unchanged. Explicit inclusions over the candidate capacity are rejected, not silently truncated. Query rewrites and before/after filters can only rerank that frozen candidate set; selected-only historical filtering never adds related records. No embedding/model/network call for retrieval and no historical AI output in the memory corpus.
- Added optional `memory_before` for original-version filtering. Revised/deleted/excluded/future records are omitted; trade date alone cannot establish an earlier reason version. Current positions/market data are explicitly not historical account reconstruction. Manual original inclusion and per-item exclusion remain available.
- Conversation targets are matched only against the verified local directory using explicit codes/names/aliases. Ambiguous exchange/type requires an explicit selection; no guessed exchange or question-driven remote directory lookup. Existing explicit instrument search remains available. The model chooses operations/tools inside this resolved scope.
- Added `calculate_portfolio_exposure`: requires already observed position/quote source IDs, uses Decimal arithmetic and records calculation parents. Reports holding cost (quantity times remaining unit cost), trading-quote valuation, within-currency weights and concentration. Missing quotes make that currency's total valuation/weights unknown; currencies are never merged. Cash, fees and external accounts stay unknown. Formal NAV is not silently used as a trading quote.
- Added a scoped news/fundamentals tool contract returning explicit unavailable state. It performs no network requests. Runtime market refresh remains disabled.

## Phase 5: Implemented, Canonical Synthetic UI Verified

- Replaced the two independent buttons with one conversation composer. It automatically reads current context, with optional instrument selection, original inclusion/exclusion and a read-only snapshot view. Model engine is visible: legacy text analysis remains usable; unavailable Agent is disabled, with no silent Agent-to-LLM fallback or paid capability probe.
- Sessions poll while queued/running and refresh on reconnect/focus. Only actual completed tool events are displayed; zero-source results do not claim data was obtained. Cancel queries the existing run and never creates a replacement.
- Browser session state stores session/snapshot identifiers, not source bodies or model secrets. A lost confirmation response is recovered through a new read-only snapshot-to-session lookup. Refresh/reconnect never re-POST a confirmation or rerun an unknown task. A new conversation is an explicit action.
- Added structured report rendering, cited-source Sheet, technical metric cells (including missing MA60), observation/version times, calculation-input navigation and collapsed older-run reports. Deleted/edited-note flags are separate read-time metadata; archived source bodies and snapshot digests remain unchanged. Legacy `answer` is retained.
- Follow-ups preserve request assumptions/engine/selection fields and include the latest necessary completed question/answer, tagged `ai_generated` in Agent context. Automatic conversations resolve current private data again and do not reuse old market observations as current data. Prior question terms help local candidate selection. Legacy explicit market snapshot reuse remains supported.
- Calendar recognizes `AI 对话` for new tasks and retains old labels. Pending/failed session entries can be opened to inspect/recover the existing task. Existing hand-note editing/deletion and legacy record reading remain available.

## Phase 4/5 Changed Files

| Area | This round's files |
| --- | --- |
| Automatic selection | New `apps/api/app/modules/ai_journal/automatic.py`, new `agent/memory.py` |
| Agent calculations/tools | `agent/{adapters,analytics,scope,store,tools}.py` |
| Journal contracts/wiring | `apps/api/app/modules/ai_journal/{models,context,service,router,store,calendar}.py` |
| Unified Web composer/report | `apps/web/src/features/ai-journal/{embedded-composer,run-panel}.tsx` (`run-panel` new), `{api,state}.ts` |
| Existing page/calendar wiring | `apps/web/src/features/platform/views/ai-advice-view.tsx` |
| Verification | New `apps/api/tests/test_ai_journal_agent_memory_portfolio.py`, updated foundation/execution tests, Web `state.test.ts` and `platform/product-readiness.test.ts` |
| Progress/blockers | This file and `BLOCKERS.md` |

Earlier uncommitted changes and untracked user output/plan files were preserved. No dependency lock, launcher, public model adapter, mini-program or older Streamlit changes in this round. No commit, push or deployment.

## Phase 4/5 Verification

```sh
PATH="$PWD/storage/local/agent-dev-venv/bin:$PATH" PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m unittest discover -s apps/api/tests -p 'test_ai*.py'
PATH="$PWD/.venv/bin:$PATH" PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_ai*.py'
PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_api_contracts.py'
PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_database_migration.py'
PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_quant_analysis_manager.py'
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m compileall -q apps/api/app/modules/ai_journal
npm --prefix apps/web run test
npx tsc --noEmit --allowImportingTsExtensions -p apps/web/tsconfig.json
git diff --check
```

- Python 3.12: **111/111 passed**, including ten new tests for old-reason recall, aliases, exclusion/deletion/version time filters, bounded explicit selections/long original excerpts, automatic holdings/policy scope, privacy/new-position/edit revocation, ambiguous identities, currency/missing valuation, source-parent/tool prerequisites, read-only recovery, minimal AI history and immutable archived-source deletion metadata. New tests prohibit socket networking.
- Python 3.9: **88 passed, 23 explicitly skipped**. The skipped Agent executor test requires Python 3.12 `asyncio.timeout`; this is not production Agent verification. API contracts **6/6**, migration **1/1**, quant manager **3/3** passed.
- Web **89/89 passed**; targeted ESLint, TypeScript with the existing test-import flag, compileall and whitespace checks passed.
- Updated old phase assertions for implemented retrieval/eight scoped tools/new unified entry. First local runs exposed these obsolete assertions plus a test helper using the wrong executor method and a missing TS nullable annotation; corrections passed the final suites. A first browser rerun used the previous mobile viewport and a later one matched hidden archived report text; test navigation/locators were corrected.
- Playwright on **canonical `http://127.0.0.1:3000`** verified the actual unified composer with the real local API: old buttons absent, text engine visible and real capability still disabled. No model confirmation submitted on the unmocked page.
- On that same canonical page, explicitly injected **synthetic API responses** verified queued/running polling, refresh restoring the same run, transient disconnection/reconnect, structured report, source drawer, follow-up session/history, cancellation, and confirmation-response loss recovered through GET only. Exactly **three previews and three confirmation POSTs** for three intentional sends; reload/disconnection/recovery added none. This is UI behavior verification, **not real-provider Agent integration**.
- Inspected desktop (1440x1000) and mobile (390x844) screenshots; mobile document has no horizontal overflow. Source Sheet was separately checked after its transition completed. Synthetic test script is `output/playwright/phase45-ui-check.js`; this round's screenshots were moved to gitignored `storage/local/phase45-ui` to retain the private-data boundary. Nothing was committed. Browser injections/session markers were removed and the test browser closed.

## Runtime Recovery and Current Stop

- During checks the original user-started Next process exhausted memory; the original launcher subsequently exited and its API stopped. Requested and received explicit permission separately to restore `3000` and the original Python 3.9 API on `8000`. No live user-owned service was killed.
- Restored frontend with a temporary 4 GB Node heap limit. An initial restored process repeated nonexistent old `.pnpm` module references and exhausted memory again. Preserved its generated `.next` cache under ignored `storage/local/next-cache-before-phase45`; a clean-cache restoration succeeded. No dependency/configuration source change. Runtime logs are ignored `storage/local/{web-phase45-clean,api-phase45}.log`.
- Canonical API retains the original `.venv`/Python 3.9; optional Python 3.12 stays isolated. Agent remains disabled because runtime/provider verification requirements are not met. Existing DeepSeek minimal two-call test evidence is unchanged.
- **No real model requests in Phase 4/5.** Full graph/RAG/report workflow, provider extension preservation and private-data inference remain **NOT real-tested**. No real private data was submitted to a model by this round's tests.
- Stop after Phase 5. Phase 6/7 were not implemented. Next prerequisite is a suitable canonical Agent runtime and a dedicated, actually verified DeepSeek adapter (or an explicitly selected supported provider), followed by a small synthetic end-to-end real test. Read `BLOCKERS.md` before continuing.

## DeepSeek Adapter and Real Synthetic Integration

This section supersedes the earlier runtime/provider blockers. HEAD is still `daa49363d91a215303b835733aeda516dd6f895d`, branch `codex/ai-journal-agent-phase-0-1`. All earlier uncommitted Phase 0-5 edits and user output/plan files remain intact. No commit, push, deployment or release operations.

### Implementation

- Added dedicated `deepseek-chat-v1` using AsyncOpenAI, `max_retries=0`, a locked Chat Completions endpoint, 25-second timeout, 3072 output tokens and scoped client cleanup. Standard OpenAI/Responses and legacy LLM paths remain separate.
- Preserve raw assistant messages, null/empty content, raw JSON tool arguments, call IDs and provider reasoning extensions in graph memory. Every tool result must match one outstanding call; duplicate, missing and orphan results fail before outbound inference. Usage preserves reasoning/cache counts; absent usage remains unknown.
- Select the adapter and verification version from current provider/official DeepSeek host. Configuration fingerprint, real-provider verification and adapter version gate execution. Capability reads report the dedicated version; loading never performs a paid probe. DeepSeek Responses/Anthropic/other protocols remain disabled.
- Real testing exposed two orchestration failures: five parallel calls exceeded the graph's three-call limit; a later case attempted exposure without an observed trading quote and failed final report validation. Neither run was replayed. Both terminal runs remain in the synthetic archive. Their final invalid report body was not retained, so its precise schema/citation error is not retrospectively asserted.
- Added explicit model/tool budgets to the prompt, the actual Report JSON Schema including length/array limits, clearer observed position/quote ID descriptions and calculation prerequisites. One allowed structure repair receives bounded field/type diagnostics without echoing invalid input. Source and calculation gates remain enforced.
- After inspecting successful real outputs, added guidance separating note version/trade/market times and stating that workspace reads are already authorized. These final wording changes have offline verification only; no additional paid retest was performed after the budget ended.
- Added explicit opt-in synthetic test harness. It reads only current model configuration from the original database; credentials stay in process memory. All portfolio/policy/original/market fixtures and runtime writes use a separate ignored SQLite workspace. The harness is outside production imports, shares an admission budget across explicit cases, stops further admission on uncertain results, and never resumes/replays a failed graph.

### Real Verification Scope and Budget

- Configuration checked first: official DeepSeek `/v1`, `deepseek-flash`, `chat/completions`, existing privacy policy permitted inference. No credentials or real private records were sent to a model or included in public artifacts.
- Initial limit: 8 requests, approximately 1 CNY conservative reservation. After 7 requests and two known failures, the user approved four additional requests, making the cumulative limit **12** and conservative reservation **1.495 CNY**. This is an estimate, not a provider billing cap.
- **12/12 actual requests**: dedicated echo probe 2; first known-failed full case 1; second known-failed full case 4; corrected full case 4; canonical UI insufficient-data case 1. No retries, provider/protocol switching, timeout or unknown-result replay.
- All 12 responses included a real reasoning field. The full successful loop returned previous assistant reasoning fields on each subsequent request (1, then 2, then 3 prior assistant messages); tool results used matching IDs. Reasoning was neither displayed as an answer nor stored in SQLite.
- Successful full case: **4 model calls, 7 successful tools, 8 observed sources**, local RAG returned a hand note and a trade reason. Actual order was positions/policy/memory -> market facts/series -> exposure/indicators -> final report. The model chose the tools; no fixed pipeline or fake model replies were injected.
- Decimal results independently matched: USD market value **200**, holding cost **120**, within-currency weight **1**, cash unknown; MA5 **18**, MA20 **10.5**, MA60 **null**. Calculations cite actual input sources. Report schema/citations pass and report/answer/events/usage/sources archive transactionally. Duplicate confirmation returns the same run.
- Provider-reported cumulative usage: **26,743 input + 7,044 output = 33,787 tokens**, including 12,928 cache-hit input tokens. Published-price estimate: approximately **0.0423 CNY off-peak / 0.0845 CNY peak**. Monetary account billing was not independently checked. Usage is complete for these received responses.
- Synthetic SQLite, usage/preservation booleans, capability receipt and screenshots are ignored under `storage/local/deepseek-verification-ujp4tnrf`. No raw model conversation or reasoning log was saved.

### Canonical UI and Runtime

- User explicitly approved canonical Python 3.12 switching and synthetic UI verification after reviewing `RUNTIME_PY312.md`. Ports were vacant before starting; process ownership was verified before every stop. Only owned synthetic services were stopped.
- Next development server stayed on **3000** with the normal **8000** rewrite. No 3001 or alternative frontend was started. The real journal backend routes temporarily served the isolated synthetic workspace on 8000; **no browser response mocks**.
- Canonical UI read the real successful archive and both terminal failures, displayed seven actual tool events, cited originals, structured report, missing MA60, full source drawer and calculation-input navigation. Desktop 1440x1000 and mobile 390x844 screenshots were inspected; mobile has no horizontal overflow. A closing-Sheet transition affected an initial screenshot; it was recaptured after the transition without changing frontend code.
- New UI send -> preview -> confirmation -> queued/running polling -> real one-call insufficient-data report -> archive passed. That test alone had one remaining request, so the harness explicitly reduced its run budget to one and disabled tools at the final-only graph step. It does not establish a separate full multi-tool run initiated from the browser.
- UI request tracing recorded **one preview POST + one confirmation POST**, and 26 GETs during checks. Reload restored the same session; offline/reconnect created no new task or model request. Historical full report reading and reload added no POSTs.
- Removed synthetic session markers and closed test browsers. Stopped synthetic API. Restored normal `app.main:app` on **8000**, Python **3.12.13**, original `storage/local/app.db`, production market dependencies. No queued Agent/private or quant inference work was present before restoration.
- Saved the actual dedicated-adapter probe capability to the original local database after checking the current fingerprint/version. Canonical capability response now confirms `enabled=true`, `runtime_available=true`, `automatic_probe=false`, adapter `deepseek-chat-v1`. Final canonical 3000 check confirmed Agent mode, unified composer and readable old calendar, with **zero model POSTs** and no real-private-data inference.
- `.venv`, dependency lock and launcher remain unchanged. The current API uses `storage/local/agent-dev-venv`; a later cold launch through the unchanged launcher still selects legacy Python 3.9. See runtime plan/remaining blockers. Services remain available on the canonical URLs; no deployment occurred.

### Changed Files This Round

- New: `agent/deepseek.py`, `apps/api/tests/test_ai_journal_deepseek.py`, `scripts/verify_ai_journal_deepseek.py`, `docs/implementation/ai-journal-agent/RUNTIME_PY312.md`, `output/playwright/deepseek-canonical-check.js` (synthetic UI check only).
- Updated: `agent/{model,manager,prompts,graph,tools}.py`, `apps/api/app/modules/ai_journal/router.py`, `PROGRESS.md`, `BLOCKERS.md`. No Web implementation or unrelated files edited.

### Offline Verification

- Python 3.12 AI suite: **118/118 passed** (seven new dedicated-adapter tests). Covers actual SDK MockTransport serialization, three-message reasoning extension preservation, zero retries on HTTP/transport errors, malformed arguments/missing usage, configuration/version/protocol gates, production manager/SDK/graph/SQLite archival, and bounded repair diagnostics.
- Python 3.9 compatibility: **88 passed, 30 optional Agent tests skipped**. This is legacy compatibility, not Agent execution evidence.
- `uv pip check` for the existing 71-package Python 3.12 lock passed. Final compileall for journal modules/test harness and `git diff --check` passed.
- No new Web code was changed; this round's Web evidence is the actual canonical browser path above, plus the retained earlier Web suites.

### Remaining Limits

- Structural citation membership is not semantic entailment. The real report conflated a 2020 trade date with a 2026 hand-note version, and the zero-tool response asked again for data access already granted. Prompt guidance was added; broad semantic evaluation and a paid retest of the final wording remain unperformed.
- No real-private-data inference, real upstream cancellation/disconnection injection, DeepSeek Responses, other providers/models, cross-currency real portfolio, market refresh, news/fundamentals or broad reliability qualification. Phase 6/7 remain pending. Stop this round.

## Phase 6: Offline Evaluation and Reliability

Resumed on 2026-10-01 at the same HEAD/branch. Existing uncommitted Phase 0-5/DeepSeek and user files preserved. No new paid-model authorization requested or used; previous 12/12 budget remains exhausted. No environment/configuration change or user-service restart.

### Changes

- Public synthetic corpus: 30 originals, 40 labeled questions including 34 positive cases and six deletion/exclusion/time/no-match cases. Evaluator runs the production candidate query, frozen scope and bounded BM25 retrieval in an isolated in-memory database, without credentials or real workspace access.
- Macro Recall@5 **1.00** for the 34 positives; candidate recall 1.00, all six negative cases pass. This is curated retrieval coverage, not precision, generalization, answer entailment or a model-effect score.
- CLI prepares a paired legacy/Agent review template with identical frozen originals and explicit date filters. Answer, semantic/calculation review, usage/cost and duration remain null until actual paired output/review exists. The fixture contains originals only; actual paired portfolio/market calculation comparison remains outstanding.
- Memory tool views now distinguish actual trade dates, known hand-note version timestamps and snapshot availability. Trade reason version time remains unknown. Snapshot/source payloads are not changed or backfilled.
- Sixteen added tests cover evaluation regressions/invalid labels, unknown paired metrics, time attribution, separate input assumptions, actual local model-await deadline, injected upload instructions/unknown URL tool, final-round tool rejection, unread old-AI citations, out-of-scope periods/future observations, two executing managers, deletion before execution, expired in-flight receipt/no replay, archive transaction fault and unconfirmed preview expiry.
- Acceptance matrix and remaining semantic limits are documented in `EVALUATION.md`. Citation validation still proves integrity/membership, not every statement's truth. No automatic retries or protocol fallback added.

### Verification

```sh
PATH="$PWD/storage/local/agent-dev-venv/bin:$PATH" PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python -m unittest discover -s apps/api/tests -p 'test_*.py'
PATH="$PWD/.venv/bin:$PATH" PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p 'test_ai*.py'
storage/local/agent-dev-venv/bin/python scripts/evaluate_ai_journal_agent.py
storage/local/agent-dev-venv/bin/python scripts/evaluate_ai_journal_agent.py --comparison-template
npm run test:web
npm run check:public-safety
git diff --check
```

- Final Python 3.12 full API suite: **285/285 passed** (AI subset now 134). Python 3.9 AI subset: **93 passed / 41 skipped**. Web **89/89 passed**. Comparison template has 40 pairs with zero filled model answers.
- Initial new evaluation mutation test returned recall 0.5 because the trade ticker still matched NVDA after replacing the body. Corrected the mutation to remove both matching body and ticker; evaluator then reports recall 0 and failure as intended. No production retrieval rule was altered to improve the fixture score.
- Canonical 3000 read-only Playwright check after normal hot reload: unified question entry, Agent selected, old two buttons absent, historical calendar readable, no horizontal overflow, journal GETs succeed and zero model POSTs. API still reports enabled/runtime_available with dedicated `deepseek-chat-v1` and automatic_probe=false. Browser closed; screenshot only in ignored `storage/local/phase6-canonical-composer.png`.
- Public safety and whitespace checks pass. No build/cache mutation, launcher change, live fault injection, paid request, real-private-data inference, commit, push, deployment or release operation.

### Files This Round

- Updated: `apps/api/app/modules/ai_journal/agent/{memory,evaluation}.py`, `apps/api/tests/test_ai_journal_agent_{execution,memory_portfolio}.py`, `PROGRESS.md`, `BLOCKERS.md`.
- New: `apps/api/tests/test_ai_journal_agent_evaluation.py`, `scripts/evaluate_ai_journal_agent.py`, `storage/templates/ai-journal-agent-evaluation.json`, `docs/implementation/ai-journal-agent/EVALUATION.md`.

### Stop and Remaining Work

Phase 6 local retrieval/reliability work is verified; Phase 6 semantic review and actual paired legacy/Agent effect/cost/latency comparison remain pending. Final date/authorization prompt plus time metadata need a newly authorized small synthetic real retest. Paid multi-turn tool follow-up/upstream failure injection are not verified. Cold launcher still selects Python 3.9. Phase 7 remains unopened. Stop after this round.

## Phase 6 Real Retest Preparation

Historical preparation record; its approval-pending state is superseded by the executed results below.

The user requested the next step and asked whether real retesting can proceed. Configuration was checked locally: existing Python 3.12.13, DeepSeek `deepseek-flash`, official `/v1`, fixed Chat Completions, credential present and matching verified dedicated-adapter fingerprint/version. No key printed. HEAD/worktree and canonical service ownership checked; services remain running.

- Prepared `REAL_RETEST.md`: maximum nine additional requests, two Agent turns plus one frozen-input legacy comparison, output cap 3072 and 40 KB input per request, 1.50 CNY reservation (conservative peak estimate 1.121184 CNY at currently checked public pricing). This is a proposed new budget, not an extension implicitly inherited from the spent twelve requests.
- Extended the explicit synthetic harness with `--semantic-retest`. Reuses matching capability without a probe, fixes distinct 2020 trade/2026 note dates, preserves same-session follow-up and compares the legacy prompt/HTTP path against identical frozen originals. All writes target a fresh ignored workspace. No server, environment switch or canonical interruption.
- Global reservation covers both Agent and legacy HTTP calls. Unknown outcomes close admission; any terminal Agent failure stops later cases. Semantic review stays pending and missing required tools do not receive a passing execution score. Usage, returned model, finish reason and elapsed time are recorded without raw reasoning. Legacy uses test-only 25-second/3072-token limits, disclosed for comparison.
- Preparation command passed with zero requests; first prepared workspace is ignored `storage/local/deepseek-verification-u1kjctab`. Three offline harness tests verify session/frozen-input handling, no false tool-success claim, unknown-first-run stop, and blocking a ninth HTTP request when only eight are reserved. Final Python 3.12 AI suite: **137/137 passed**. Compileall, whitespace and public safety checks pass. Initial harness tests exposed macOS temporary-path symlink normalization and an incomplete mocked raw assistant message; the normalized path and complete synthetic wire messages pass the final tests.
- Current status: **new nine-request approval pending; zero real requests in this preparation**. The approval request was sent through the user-input tool. No automatic retry, commit, push, deployment or Phase 7 work.

## Phase 6 Real Retest: Executed and Stopped

- User approved the initial nine-request budget and then allowed necessary bounded budget extensions/backend switching. Announced current-round limit: **19 model requests / 3 CNY reservation**; **19/19 used**. The previous twelve-request round is separate. No failed-run replay, automatic retry, repeated probe or protocol/provider switch.
- Checked Python 3.12.13, DeepSeek `deepseek-flash`, official `/v1`, fixed Chat Completions and matching dedicated-adapter capability. Alias responses do not pin immutable upstream weights. All inference inputs were synthetic; keys and raw reasoning were excluded from archives.
- First synthetic cohort used six calls: date answer archived with semantic findings, then full follow-up failed because the final reasoning/report output hit the 3072-token cap. Eight tools/calculations ran; harness stopped and skipped legacy comparison. Failure and usage remain preserved.
- DeepSeek output allowance increased to **6144**, standard adapters stay 3072. Shared cap selection now drives both wire limit and production reservation; overall reservation bound remains 145000. Added budget regression. Prompt distinguishes note saved/modified version from initial writing and prohibits quotes/MAs as proof of demand/earnings; no repeated workspace read authorization.
- Fresh backend cohort: date question two calls/three tools/four sources, same-session full follow-up four calls/seven tools/eight sources, matched frozen-input legacy comparison one call. Calculations correct; review retained ambiguous date/business wording and legacy speculation. No blanket quality superiority claim.
- Final prompt tested on canonical **3000/8000** without response mocks: a new full conversation used four calls/eight tools/eight sources; date follow-up used two calls/two memory calls/two sources. Actual report, citations/calculation parents, archive and source drawer passed. Date answer explicitly rejects inferring initial writing from later version time; missing fundamentals prevent proving original business conditions.
- Exactly two preview and two confirmation POSTs. Same-session refresh and browser offline/reconnect added no replay. Desktop/mobile screenshots inspected with no overflow. Incorrect browser GET poll route was corrected; independent correct-route GET, SQLite succeeded records and screenshots prove success, not the asynchronous polling predicate.
- Usage complete for all nineteen received responses: 68866 input tokens (37760 cached), 16719 output (8673 reasoning). Summed HTTP duration 79.773 s; estimated published-price cost **0.0987372-0.1974744 CNY**, not independently audited billing. Initial paired memory question: Agent 9.521 s / 0.011075-0.022150 CNY vs legacy 7.950 s / 0.008599-0.017197 CNY; different prompt packing and one case prevent broad efficiency conclusions.
- Ownership-checked synthetic API stopped after terminal runs; admission receipt explicitly closed in post-shutdown review because SIGTERM bypassed final cleanup. Normal Python 3.12 API restored with original database/dependencies; existing Next dev retained. Synthetic session markers cleared, restored 3000 composer/calendar checked with zero journal POSTs, test browser closed.
- Final verification: **API 289/289**, **Web 89/89**, compileall/public safety/whitespace pass. HEAD unchanged; all existing uncommitted work retained. No commit, push, deployment, build/cache mutation or Phase 7 operation.

### Files in This Real Round

- Updated production: `apps/api/app/modules/ai_journal/agent/{model,deepseek,runtime,manager,prompts}.py`.
- Verification: `scripts/verify_ai_journal_deepseek.py`, `apps/api/tests/test_ai_journal_{deepseek,agent_foundations,semantic_harness}.py`, `output/playwright/phase6-real-retest-ui.js`.
- Records: `REAL_RETEST.md`, `EVALUATION.md`, `RUNTIME_PY312.md`, this document and `BLOCKERS.md`. Usage receipts, synthetic SQLite/reports/review/screenshots remain ignored under `storage/local`.

Remaining: broader semantic coverage, paired calculation evaluation, real upstream interruption/cancellation and permanent Python 3.12 cold-launch selection. Details and review findings in REAL_RETEST.md. Stop this round.

## Phase 6 Portfolio Comparison Attempt

- New user-requested next step under the existing broad budget/runtime authorization. Announced **five requests / 1 CNY reservation**, separate from prior 19/12 rounds. Matching DeepSeek Flash/official Chat Completions/Python 3.12 configuration checked. New isolated synthetic workspace, no probe or real-private-data model input.
- `--portfolio-comparison` runs one four-call Agent turn plus one legacy call with identical question, frozen originals, positions/policy and quote/closed series. Legacy prompt/path preserved with explicit test-only 25 s / 6144 output bound. Three additional offline harness regressions cover actual local calculations/matching frozen inputs, unknown Agent stop and unknown legacy/no retry.
- Agent succeeded: **four calls/eight tools/eight sources**. Reviewed six requested numerical fields: 200 USD market value, 120 USD cost, observed-currency weight 1, MA5 18, MA20 10.5, MA60 null. Cash/account-wide exposure/fundamentals unknown; no permission repetition or unread citations. Source payloads/calculation parents/times checked, not just citation membership.
- Legacy attempted once, no response/usage at the 25-second boundary; archived `failed / model_failed` with unknown upstream result/cost. Harness closed admission; **5/5 reserved requests used**, no replay. Original receipt lacks exception class; new code records transport failure type for future cases without inventing it for this one. Paired answer quality/cost cannot be compared.
- Agent reported 14653 input/4625 output tokens (9728 cached, 3272 reasoning), 21.245 s summed HTTP / 21.488 s full-case duration. Agent-only estimated cost **0.02361956-0.04723912 CNY**; legacy and total actual cost remain unknown. Details in PORTFOLIO_COMPARISON.md.
- Added closed-workspace `--read-only-existing` serving: refuses unfinished Agent runs and all mutation methods. Canonical 3000/8000 archive/report/source/calculation parents/legacy failure/calendar and desktop/mobile verified; eight journal GETs, zero UI POSTs, test preview POST rejected 403. Five-request receipt unchanged. No model replay or response mocks.
- Found and fixed technical cutoff time mismatch: new backend calculation Evidence uses final closed bar time; frontend card/source drawer uses payload cutoff for existing archives, missing/invalid cutoff stays unknown. Existing immutable snapshots unchanged. Backend regression plus two Web regressions added; final 3000 shows Sep 30 cutoff rather than Oct 1 retrieval. No new model call after timestamp-field correction.
- Normal Python 3.12 original-database API restored after ownership-checked synthetic shutdown, Next dev retained. Browser session markers cleared, normal canonical page checked with zero journal POSTs and browser closed. Original DB had no active Agent/quant inference before switching.
- Final **API 292/292**, **Web 91/91**, TypeScript/targeted ESLint/compileall/whitespace/public safety pass. HEAD unchanged; no commit, push, deployment or Phase 7.

Files: `scripts/verify_ai_journal_deepseek.py`, `apps/api/app/modules/ai_journal/agent/tools.py`, `apps/api/tests/test_ai_journal_{semantic_harness,agent_execution}.py`, `apps/web/src/features/ai-journal/{run-panel.tsx,evidence.ts,evidence.test.ts}`, `output/playwright/phase6-portfolio-archive.js`, `PORTFOLIO_COMPARISON.md`, `EVALUATION.md`, `BLOCKERS.md`, `RUNTIME_PY312.md` and this progress record. Synthetic receipts/review/SQLite/screenshots remain ignored in `storage/local`.

Paired portfolio evaluation remains incomplete; no winner inferred from a missing legacy answer. Remaining controlled Agent upstream fault/cancellation, held-out semantic coverage and cold-start Python selection unchanged. Stop this round.

## Local Launcher Python 3.12: Completed

- User authorized necessary project backend stops/switches/restarts after ownership and in-flight checks; requested zero real model calls and no release operations. Starting/final HEAD remains `daa49363d91a215303b835733aeda516dd6f895d`. Existing Phase 0-6 changes retained without rollback or reimplementation.
- Root `一键打开股票交易平台.command` now delegates to `scripts/runtime/local_launcher.py` with the existing ignored `storage/local/agent-dev-venv/bin/python`. Requires Python 3.12, exact tested lock, compatible installed requirements and successful Agent/API imports. Missing/incompatible environment fails clearly; no `.venv` mutation, system-Python fallback or automatic package installation.
- Canonical listeners are validated by exact cwd and actual uvicorn/Next ancestor command. Healthy services are reused individually; vacant services start against the original database in normal production API / Next dev mode. Foreign, wrong-Python or unhealthy services produce an error without automatic termination. Startup locking handles concurrent launches. PID files are bookkeeping, never a kill instruction.
- Newly started services use separate process groups. Enter/EOF, Ctrl-C/SIGTERM/SIGHUP, startup failure/timeout and abnormal owned-child exit clean up their reload/npm children; reused services/PID files are preserved. Shutdown is bounded, macOS zombie-only groups are ignored, spawn-time signals cannot leave an unregistered child, and recycled leader PIDs are rejected.
- Actual canonical API cold starts used Python 3.12.13 and `storage/local/app.db`; existing Next listener PID 45468 remained throughout. Actual Enter and SIGTERM shutdown released 8000 and removed reload children. Final API runs from the updated launcher in Terminal, leaving the usual keep-window-open lifecycle available to the user. No temporary port/service left behind.
- Original database before switching: zero unfinished Agent/legacy/quant tasks. All seven original sessions returned 200. Counts/content hashes of seven sessions, seven turns, eleven immutable snapshots and one verified capability matched before/after. Privacy, sources, snapshots, model settings and existing LLM path preserved.
- Canonical 3000 desktop/mobile visually verified: old calendar/legacy session readable, unified question entry and Agent selection retained, exact old two command buttons absent, no horizontal overflow. First cold-start access log showed eight journal GETs, zero mutation requests. Final normal-page refresh remained read-only. Screenshots are ignored under `storage/local`; no real-private-data model request or capability probe.
- Final full API **305/305** (292 plus 13 focused launcher regressions), Web **91/91**; Bash syntax, compile checks, whitespace and public safety pass. Initial orphan cleanup exposed macOS zombie-only group EPERM; PID-identity additions initially exposed mocks intercepting diagnostic `ps`; both corrected and final suite passes.
- Changed this round: root launcher; new `scripts/runtime/local_launcher.py`, `apps/api/tests/test_local_launcher.py`; `PROGRESS.md`, `BLOCKERS.md`, `RUNTIME_PY312.md`. No dependency lock, old `.venv`, old Streamlit, frontend feature code, commit, push, deployment or release change.

Cold-start Python selection blocker resolved. Unknown legacy portfolio result/cost remains unknown and was not replayed; no Agent winner claimed. Controlled real upstream interruption/cancellation and broader held-out/semantic/paired comparison coverage remain outstanding. SIGKILL/power loss cannot run supervisor cleanup; an unhealthy survivor requires manual ownership/task review. Stop this round; Phase 7 unopened.

## Phase 6 Closeout: Completed

- New public synthetic fixture `phase6-closeout-msft-fractional-60-v1` used 3.5 MSFT shares, 7.24 USD remaining unit cost, an 11.5 USD frozen quote and 60 closed daily bars. No real private data was sent.
- Agent completed **4 requests / 8 tools / 8 sources**. Manual review found holding cost **25.34**, market value **40.25**, observed USD weight **1**, MA5/20/60 **58 / 50.5 / 30.5**; cash, account-wide weight, initial writing time and fundamentals remained unknown. Schema and observed-citation checks passed.
- Legacy made one request and returned a 6144-token `finish_reason=length` response. It was not a valid answer, was not archived as successful, and was not retried. All **5/5** reservations were consumed and admission closed; actual billing remains unknown.
- Final verification passed: API **319/319**, Web **91/91**, public safety, compileall, Bash syntax and whitespace checks. Canonical 3000/8000 remain healthy; `phase6-closeout` browser session is closed. No commit, push, deployment or Phase 7 work.
- Phase 6 conclusion is limited to this synthetic Agent numerical/source result. It does not claim Agent superiority or complete the paired legacy comparison. Remaining limits are broader semantic/held-out coverage and controlled upstream interruption/cancellation.

## Phase 7 Planning: Started

- Added `PHASE7_PLAN.md` for release preparation and rollback review. This is planning only; no Phase 7 implementation, real model call, service switch, commit, push or deployment occurred.
- The plan separates held-out semantic quality, fair paired comparison, reliability/recovery, canonical runtime/data-boundary checks and release rollback gates.
- New model requests require a separate explicit budget authorization. The unknown legacy request and the truncated Phase 6 closeout response remain excluded from any future comparison.

## Phase 7.1: Held-out Offline Retrieval: Complete

- Added `storage/templates/ai-journal-agent-phase7-heldout.json` with 22 new synthetic cases: 17 positive and 5 deletion/exclusion/future/revision/no-match cases. Its original IDs are disjoint from the existing evaluation corpus.
- Ran the production candidate-freeze and BM25 retrieval evaluator with network access blocked: candidate recall **1.00**, Recall@5 **1.00**, `passed=true`, `real_model_tested=false`.
- Added a regression that checks fixture independence and network prohibition. Focused evaluation suite: **6/6 passed**.
- This is retrieval evidence only. Generated semantic entailment, numerical calculation quality, provider reliability, paired comparison and release readiness remain pending.

## Phase 7.2: Paired Evaluation Preparation: Complete

- Generated a 22-case paired review template from the held-out corpus. Agent and legacy receive the same frozen original inputs, date filters and exclusions; positions and market observations remain empty for this retrieval-only template.
- Template outputs, source reviews, calculation reviews, usage, cost and duration remain unknown until a separately authorized real run. The unknown and truncated Phase 6 requests are excluded and will not be replayed.
- Added a regression for frozen-input identity and null-result preservation. Focused evaluation suite: **7/7 passed**.
- No model call, budget reservation, service switch, commit, push or deployment occurred. Next gate is explicit authorization for a new bounded paired run, if it is still needed after review.

## Phase 7.2: Real Paired Run: Stopped Without Replay

- User authorized a new maximum of 5 requests / 1 CNY for synthetic data. New AAPL fixture `phase7-paired-aapl-fractional-40-v1` ran once; no prior unknown or truncated request was replayed.
- Agent succeeded with **4 requests, 7 tools and 8 sources**. Manual review matched holding cost **36.19**, market value **50.60**, observed USD weight **1**, MA5/20/60 **38 / 30.5 / null**; dates, missing fundamentals, cash and account-wide weight were handled correctly. All report citations and calculation parents were archived.
- Legacy used the fifth request and returned a 6144-token `finish_reason=length` response. It was not a valid paired answer, was not archived as successful and was not retried. Admission closed with `stopped_no_replay`.
- Estimated combined token cost is approximately **0.08-0.09 CNY**; actual billing is unknown. Full review is in `PHASE7_PAIRED_COMPARISON.md`. No canonical service switch, private data, commit, push or deployment occurred.
- Phase 7.2 real execution stops here. Paired quality remains incomplete; further model calls need a new authorization.

## Phase 7.3: Offline Reliability: Complete for Current Scope

- Loopback transport suite passed **3/3** for partial response disconnect, read timeout without SDK retry and local cancellation with a peer that may continue independently.
- The final Python 3.12 API suite passed **322/322**, retaining lease fencing, duplicate confirmation, expiry/unknown handling, late-write rejection and archive transaction rollback coverage.
- No external provider fault injection was attempted. Upstream cancellation/processing/billing behavior remains unknown and is not presented as verified.

## Phase 7.4: Authorized Real Closeout: Complete

- User authorized up to **115 synthetic-data model requests**, a conservative **20 CNY reservation**, and a temporary 8000 rollback exercise while keeping the canonical 3000 Next process running. No commit, push, deployment or public release was authorized or performed.
- Actual inference used **111 requests**: 10 numerical/source comparison requests, 65 requests for the 22-case held-out semantic cohort, 18 requests for the v2 six-case targeted semantic regression and 18 requests for the v3 filter-status recheck. All 111 returned usage; there were no new unknown, failed or truncated outcomes, no replay, no probe and no provider/protocol fallback. Four authorized requests remained unused.
- Aggregate reported usage was **274,161 input / 69,952 output tokens**, including **148,608 cached input tokens**. The checked peak-rate estimate is **0.8167 CNY** and a conservative no-cache peak bound is **1.1079 CNY**. Actual provider billing remains unverified.
- Manual semantic review: the 22-case cohort has 17 full passes and five conservative partials for deleted/excluded/future/revised no-result cases; no forbidden claim or unsafe action was observed. The targeted v2 cohort passes 6/6 for Agent and 6/6 for legacy. The v3 filter-status recheck passes 5/6 for both engines; `r2-cutoff` remains a conservative partial because the answer did not explain the historical cutoff filter. Reviews are stored in ignored `storage/local/semantic-review-*/review.json`.
- Prompt guidance now explicitly distinguishes user notes from assistant records, treats words inside source text as data rather than permission state, rejects unsupported company-specific facts, and keeps trade dates separate from unknown reason-version times. The targeted cohort verified those corrections.
- Authorized rollback completed: the legacy API was temporarily served against the same v7 database, then the Python 3.12 launcher restored. The final receipt reports schema 7, integrity ok, zero unfinished Agent/legacy/quant tasks, seven readable historical sessions, matching original hashes and Agent enabled. 3000 remained running and 8000 is now launcher-supervised.
- Final regression after the closeout: Python 3.12 API **334/334**, Web **91/91**; Python 3.9 AI **170 passed / 59 expected Agent skips**. Release status remains **暂不发布** because the complete paired winner and provider cancellation/billing evidence are still unavailable.
- Post-change regression after exposing filter status in Agent `missing`: Python 3.12 API **336/336**, Web **91/91**; Python 3.9 AI **112 passed / 60 expected Agent skips**. Canonical health/capability stayed healthy, the restored rollback receipt still reports schema 7, integrity ok, matching hashes and zero unfinished tasks, and no model call was made. The provider cancellation/billing limitation is accepted; remaining blockers are the incomplete paired winner and semantic coverage/cutoff explanation gap.
- Final-report filter-status regression: Python 3.12 API **337/337**, Web **91/91**; Python 3.9 AI **113 passed / 60 expected Agent skips**. Historical cutoff/exclusion status is now appended server-side without source citations or filtered text. No model call, commit, push, deployment or release occurred.

## Expanded Paired Evaluation: Prepared, Awaiting Paid Authorization

- Corrected the current release summary: the complete consistent MSFT pair at `storage/local/deepseek-verification-lanogzvf` passes the specified numerical/source checks for both engines. Rechecked both original answers, eight Agent sources and calculation parents. A broad superiority winner is not required or claimed. The failed IBM fixture and older truncated/unknown attempts remain preserved.
- Froze 60 fresh original-memory cases, 65 originals and 12 categories with five cases each. IDs and exact texts are disjoint from earlier corpora. Production candidate/retrieval evaluation reports Recall@5 **0.93**, with ten empty negative/filter cases and no forbidden source; four top-five recall gaps remain visible.
- Extended the existing synthetic harness with both prompt hashes, dataset/input hashes, alternating engine order, five-request full-pair admission and immediate stop on missing usage. Added an offline review template/compiler requiring reviewer notes and preserving unknown results. No production model/prompt configuration changed.
- Prepared zero-request receipt and manual review template under `storage/local/semantic-review-3gjzzz_w`. This historical preparation record proposed a new 300-request/50 CNY allowance; the subsequent authorized execution and review are recorded at the top of this file and in `EXPANDED_PAIRED_PLAN.md`.
- Corrected 111-request aggregate usage to **325,536 input / 81,239 output / 182,400 cached input tokens**, including the v3 receipt. Peak-rate estimate **0.94348 CNY**, no-cache peak estimate **1.300984 CNY**; actual billing unverified.
- No new real model request, canonical service switch, commit, push, deployment or public release occurred.
