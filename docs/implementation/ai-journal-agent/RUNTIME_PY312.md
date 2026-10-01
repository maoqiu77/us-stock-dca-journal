# Local Python 3.12 Launcher

Updated: 2026-10-01 (Asia/Shanghai). The user authorized this round's necessary project backend stops/switches/restarts, after ownership and in-flight checks. The cold-launch change below is implemented and verified. Historical paid-test procedures follow for reference only.

## Current Launcher Behavior

- Double-click `一键打开股票交易平台.command`. It executes `scripts/runtime/local_launcher.py` with the existing ignored `storage/local/agent-dev-venv/bin/python`; Python must be **3.12**. It never falls back to `.venv` or system Python, creates an environment, or installs packages automatically. The legacy `.venv` remains intact.
- Preflight checks the exact tested `requirements-agent.lock`, installed dependency constraints, Agent/API imports and Node/npm/Next availability. Missing environment, missing packages, incompatible versions or failed imports produce an explicit error and documentation pointer before starting/stopping any service. This check performs no capability probe or model request.
- Canonical API remains `http://127.0.0.1:8000`; Web remains `http://127.0.0.1:3000`. New API processes explicitly use the original `storage/local/app.db` and normal `app.main:app`; new Web processes use Next development mode.
- Reuse is per service. Every listener must have the exact expected project cwd and a verified uvicorn/Next ancestor command; API ancestors must use the selected Agent Python. Healthy services are reused. Vacant ports are started. Foreign, legacy-Python or unhealthy listeners cause a clear error without automatic termination. Health alone and stale PID files are not ownership proof. A startup lock prevents concurrent launchers racing each other.
- Each newly created service has its own process group. Enter, stdin EOF, Ctrl-C, SIGTERM, SIGHUP, startup failure/timeout and abnormal owned-service exit clean up only those groups, including reload/npm children. Reused services and their PID files are preserved. Graceful group termination has an eight-second bound before force termination of remaining live members. PID start-time checks reject a recycled leader PID; zombie-only macOS groups are treated as exited. A signal arriving during spawn is deferred until the child is registered for cleanup.
- If both services were reused, the new launcher opens the page and exits immediately. If it started a service, keep its Terminal window open. Enter closes only services created by that window; a reused frontend stays running.
- SIGKILL or machine power loss cannot run cleanup. A later launcher checks actual live ownership/health, rather than trusting PID files or killing an uncertain process. An unhealthy remaining service needs manual review of ownership and in-flight tasks.

## Environment Preparation / Repair

No environment repair was needed or performed this round. Diagnostics:

```sh
storage/local/agent-dev-venv/bin/python --version
uv pip check --python storage/local/agent-dev-venv/bin/python
```

Only when the Agent environment is missing, create it explicitly from the repository root:

```sh
uv venv --python python3.12 storage/local/agent-dev-venv
uv pip sync --python storage/local/agent-dev-venv/bin/python apps/api/requirements-agent.lock
```

For an existing incompatible environment, first inspect canonical process ownership and unfinished Agent/legacy/quant tasks. Follow AGENTS.md and obtain authorization before stopping a user-owned service or changing its active environment. Then explicitly repair/sync the Agent environment against the lock. Do not overwrite the old `.venv`, silently choose another interpreter or install dependencies into a running API environment.

## This Round's Verification

- Starting HEAD unchanged: `daa49363d91a215303b835733aeda516dd6f895d`; all Phase 0-6 uncommitted work retained. Initially 3000 belonged to this project's Next dev (listener PID 45468), 8000 to its normal Python 3.12 API/reload group (leader PID 50064). Original DB had zero unfinished Agent, legacy or quant tasks before authorized switching.
- Actual launcher reuse with both services healthy exited successfully without deleting service PID files or signalling services. Actual API cold starts selected Python **3.12.13**, while the same existing Next listener remained on 3000. Enter and SIGTERM exit checks released 8000 and removed API reload children without touching 3000. Final backend is running from the updated launcher in Terminal with the original database and normal dependencies.
- The launcher-round API suite passed **305/305** (previous 292 plus 13 launcher regressions); the final repository-wide Python 3.12 suite after closeout additions passed **319/319**. Web remains **91/91**. Launcher regressions cover missing/wrong Python, missing/mismatched dependencies, foreign/unhealthy listeners, exact cwd boundary, reload-parent ownership, reuse/PID-file preservation, partial startup/database/group selection, orphan-child cleanup, spawn-time signals and recycled PID protection. Initial macOS zombie-group and later mock-isolation failures were corrected; final suite passes.
- Actual canonical 3000 desktop/mobile checks: old calendar entries and a completed legacy session load; one unified question entry, Agent selection and legacy text mode preserved; the two exact command buttons `持仓分析` / `标的快研` absent; no horizontal overflow. Screenshots visually reviewed under ignored `storage/local/launcher-{desktop,mobile}.png`.
- First cold-start browser/archive inspection produced eight journal GETs and zero journal mutation requests in the API access log. Final normal-page refresh is also read-only. No capability-test/preview/confirm/model request was sent this round. API reports `runtime_available=true`, `enabled=true`, `automatic_probe=false`, matching existing `deepseek-chat-v1` real-provider capability; this reuses previous verification and is not a new real-model execution test.
- All seven original sessions returned 200. Row counts and content hashes of seven sessions, seven turns, eleven immutable snapshots and the single capability record matched before/after runtime switching. Privacy/model settings were not changed. No code commit, push, deployment, release work or older Streamlit edit.

## Historical Review Plan

Prepared: 2026-10-01 (Asia/Shanghai). Approval required before canonical environment changes.

The unchanged-launcher/approval-pending statements below describe earlier rounds and are superseded by the current launcher section above. Spent model budgets remain historical and grant no authorization for additional calls.

## Executed Status

Subsequent portfolio-comparison round used five bounded requests under the user's continuing authorization. After an unknown legacy response, only read-only archive serving was used on 8000 (all mutation methods rejected; no unfinished Agent runs). Actual canonical 3000 archive/source/time/desktop/mobile checks passed without more inference. That synthetic process is stopped and normal Python 3.12 API is again restored with original database/dependencies; Next dev unchanged. No active Agent/quant inference was interrupted. See PORTFOLIO_COMPARISON.md. Launcher/.venv still unchanged; no permanent cold-start switch in this round.

Latest authorized retest: the user additionally allowed necessary bounded budget increases and backend switches. Nineteen new synthetic requests were used within a 3 CNY reservation, including browser-initiated full tools and same-session date follow-up on 3000/8000. The synthetic API is stopped; normal Python 3.12 API has again been restored with the original database and normal dependencies. Next dev remains unchanged on 3000. Final normal-page check sent zero journal POSTs. See REAL_RETEST.md. The twelve-request record below is historical, not the latest budget. No further model calls this round.

The user explicitly approved both the four-request budget extension and canonical Python 3.12 switching/verification. The approved procedure is complete: actual synthetic archive/UI checks on 3000/8000 passed, the owned synthetic API was stopped, and normal Python 3.12 `app.main:app` now uses the original database on 8000. Next remains in development mode on 3000. The actual dedicated probe capability is saved locally for the unchanged current configuration. No real private data was sent to the model. All 12 authorized requests have been used; testing stops this round.

The launcher and legacy `.venv` remain unchanged. This document is a reviewed local runtime procedure, not a permanent launcher migration or deployment.

## Observed State

- HEAD: `daa49363d91a215303b835733aeda516dd6f895d`; Phase 0-5 changes remain uncommitted.
- At inspection, neither 3000 nor 8000 had a listener. Recheck ownership immediately before starting.
- Existing `.venv` is the legacy Python 3.9 environment. Leave it intact.
- Existing ignored `storage/local/agent-dev-venv` uses Python 3.12.13 and the 71-package `requirements-agent.lock`. `uv pip check` passed.
- Current model: DeepSeek / `deepseek-flash` / `chat/completions` / official `/v1` base URL; credential present. Never include the credential in review output.

## Proposed Procedure

1. Obtain approval under root AGENTS.md for starting canonical API with Python 3.12 and temporarily serving the isolated synthetic workspace on 8000.
2. Reuse 3000 if owned by this project. If vacant, start the existing Next development command on 3000. No dependency or frontend configuration change is required.
3. Run the explicit test harness with the existing Python 3.12 environment. It reads only the configured model credentials from the original database, then uses a new SQLite database under `storage/local`. Synthetic portfolio, policy, originals and market observations are explicitly injected by the test harness; this module is never imported by the production dependency graph.
4. Verify the production adapter, LangGraph, tool executor, RAG, calculation, immutable snapshots, report validation and archive. Serve the real journal routes on 8000 against that synthetic workspace and verify the complete 3000 path without browser response mocks.
5. Stop the owned synthetic API, then start normal `app.main:app` on 8000 with Python 3.12 and the original local database. No synthetic market dependency remains. Verification records are configuration/adapter bound; any recorded capability is from the real two-call dedicated-adapter probe, not from offline tests.
6. Preserve logs, test database and screenshots only under ignored `storage/local`. Leave the original launcher and `.venv` intact. Its next launch still uses legacy Python unless separately changed in a later authorized task.

Normal API command after approval:

```sh
storage/local/agent-dev-venv/bin/python -m uvicorn app.main:app \
  --reload --reload-dir apps/api --app-dir apps/api --host 127.0.0.1 --port 8000
```

The environment already exists; no package installation or lock update is planned. Stop only processes created by this procedure. If a user-owned process has appeared, request approval before interrupting it.

## Real Test Budget

- Initially maximum **8 HTTP model requests**. After seven requests and two known terminal failures, the user explicitly approved four additional requests, for a cumulative maximum of **12**. No automatic retry or protocol/provider switch.
- Maximum output **3072 tokens/request**; test admission checks bound each actual JSON request to **40 KB**. A conservative reservation of **50,000 input tokens/request** gives 400,000 input + 24,576 output tokens initially, or 600,000 input + 36,864 output tokens after the approved twelve-request extension.
- At the published peak Flash price of 2 CNY/million uncached input tokens and 8 CNY/million output tokens, the initial conservative estimate is **0.997 CNY**, increased to **1.495 CNY** for the approved twelve-request limit. This is a token reservation estimate, not a provider billing cap. Actual reported usage and completeness will be recorded; account billing is not independently verified.
- Check configuration fingerprint before each call. A disconnect/timeout/unknown result stops the test and closes further admission. No private holdings, notes, trade reasons or account identifiers may enter this harness.
- Reasoning fields remain ephemeral. Persist only counts/boolean preservation checks, provider usage, structured reports, tool events and synthetic sources.

The third full synthetic case passed using four model calls and seven actual tool calls. Total requests so far: **11/12**. Two prior failures remain archived. Canonical verification will read this actual report/source archive, then use at most the one remaining request for a separate zero-tool, insufficient-data UI send. The test harness reduces that UI run's model budget to one; it cannot replay any of the previous runs. It uses real backend routes without browser response mocks.

Sources: [DeepSeek thinking/tool roundtrip](https://api-docs.deepseek.com/guides/thinking_mode/), [DeepSeek published CNY prices](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).

## Rollback and Limits

Restoring the legacy API requires stopping the owned 3.12 process and running the same uvicorn command with `.venv/bin/python`. Existing v7 data is already supported by the legacy code; Agent execution is unavailable on Python 3.9. No database downgrade or snapshot mutation is required.

This plan covers local validation only. It does not approve commits, pushes, deployment, release work, production market refresh, or real-private-data inference tests.
