# Release and Market Data Status

Updated: 2026-09-14 Asia/Shanghai  
Branch: `codex/mobile-phase-0-1`  
Baseline HEAD: `bb22f683026d8eaaec1bab87783e9d6197666b90`

## Round 1 Scope

This round implements Phase 0 and Phase 1 only. The launch target remains the WeChat mini program. No market-data provider, Phase 2 capabilities/consent redesign, deployment, paid model request, experience upload, or review submission was performed.

## Round 2 Scope

This round implements Phase 2 and Phase 3 locally. It adds the release-facing AI permission flow and a fail-closed market-data contract/cloud skeleton. It does not implement or call a market provider, deploy a cloud function, change cloud data, invoke a paid model, upload an experience build, or submit a release review.

## Round 3 Scope

This round implements Phase 4 and Phase 5 locally. It adds a server-only Twelve Data adapter, shared cache/lease/budget enforcement, deterministic reference valuation, and mini-program quote presentation. It does not assert commercial entitlement, run a live provider call, deploy cloud functions, change cloud data, enable market flags, upload an experience build, or submit a release review.

## Round 4 Scope

This round implements Phase 6 and Phase 7 locally. It adds market discovery/watchlists/daily charts, owner-bound frozen market receipts, AI transport/response V2, archival source bodies, workspace/outbox migration, and complete backup v5. It does not assert commercial entitlement, call a live market provider or paid model, deploy cloud functions, change cloud data, enable market flags, upload an experience build, or submit a release review.

## Round 5 Scope

This round implements every locally executable part of Phase 8 and prepares the Phase 9 deployment handoff. It adds deterministic cloud-function hashes, separate client/cloud/rollback artifacts, a release-candidate manifest, missing calendar regression coverage, and simulator evidence. It does not assert entitlement, deploy cloud functions, mutate CloudBase, invoke paid services, upload an experience build, run physical-device/two-account cloud acceptance, or submit review.

## Phase 0 - Done Locally

- Added explicit `development`, `test`, and `production` build profiles. Production permits only `cloud` or `disabled`; a missing profile fails closed and no profile defaults to fake.
- Moved the deterministic AI provider and sample-ledger factory behind development/test injection. The production runtime dependency graph contains neither module.
- Removed the sample-ledger, offline-analysis, offline-follow-up, and candidate-screen entry points from release pages. Existing demo workspaces, legacy fake runs, fixtures, and strict v1-v4 backup readers remain readable and labeled by both execution kind and data mode.
- Added `check:weapp-production`. It validates the profile, feature flags, runtime dependency graph, page event bindings, page files, and release entry points.
- The mini-program package version is the single release version source. Build output includes a key-free manifest with version, commit, dirty-worktree flag, profile, feature flags, relative runtime inputs, and measured main-package bytes. Package filenames use the same version.
- Updated the root market fallback rule: production uses real observations, timestamped real caches, or unavailable; samples are development/test only.

## Phase 1 - Done Locally

- Research and follow-up previews are read-only. Sending creates the conversation/outbox only after explicit confirmation and reuses the exact previewed context.
- Question, symbol, selection, mode, or workspace changes invalidate the confirmed draft. Prepared requests are rejected locally after their ten-minute expiry.
- Fixed the checkbox-group binding so the selected value set controls all three inclusion flags.
- Split provider submission, result retrieval, local archive, and ACK handling. ACK failure now leaves the analysis archived as `ack_pending` with `last_ack_error`; recovery retries only ACK.
- Added pending-task listing and explicit recovery. Running/outcome-unknown requests query the original request ID, succeeded requests fetch and idempotently archive once, and saved requests only complete ACK. Recovery never calls `analyze`.
- Workspace replacement continues to detach imported outbox requests, preventing automatic replay. Existing workspace pending-save barriers remain authoritative for uncertain local writes.

## Phase 2 - Done Locally

- AI capabilities now have a strict client schema and report enabled/configured/enrolled/consented/authorized states, `closed_beta` or `public` access mode, UTC usage date/count/inflight, per-user limits, global budget, credential mode, and BYOK availability. Malformed or old capability responses fail closed.
- Both access modes require a current server-recorded consent version. Closed beta retains the hashed enrollment record; public mode removes the development allow-list dependency but does not bypass consent, disable state, provider configuration, quota, or trusted WeChat identity.
- Research and follow-up require the user to preview first. On first cloud use they disclose the exact categories sent to the project cloud/model and allow cancellation before conversation/outbox creation. Declining cloud processing leaves all local features available.
- Added an atomic cross-instance AI daily budget collection and user-visible UTC usage. Existing per-user daily/inflight limits and idempotency remain in force; BYOK stays disabled.
- Settings distinguish a new empty ledger (keeps a recovery point) from explicit two-confirmation device deletion. Explicit deletion clears active financial/workspace data, recovery points, pending requests, and orphaned historical partitions under the app storage prefix. Exported files remain user-controlled; local deletion cannot cancel an already-sent cloud request, whose body remains subject to ACK/terminal retention cleanup.
- Existing source shows authenticated cleanup token handling, Timer.Message parsing, terminal-only body purge, retained usage/turn keys, and UTC usage buckets. These are locally tested properties, not evidence that the current cloud runtime, timer, indexes, or environment variables were updated.

## Phase 3 - Done Locally

- Added the pure `@portfolio/market-data` package with strict canonical instrument, QuoteV1, BarsV1, capabilities, and freshness contracts. It rejects zero/synthetic unavailable prices, invalid time ordering, future/duplicate bars, invalid OHLC, and unknown delay represented as zero.
- Added independent ledger-to-canonical mapping that preserves the ledger instrument UUID and distinguishes invalid symbols, missing/inactive listings, stock/ETF conflicts, and ambiguous multi-market candidates.
- Added a `portfolioMarket` CloudBase function skeleton with trusted AppID/OPENID context, action whitelist, server-owned access/entitlement flags, bounded search/quote/bar requests, and no client-selected provider, URL, key, owner, or permission.
- Added provider, cache, expiring holder-checked lease, and cross-instance budget ports plus CloudBase adapters and collection/index definitions. Test providers can be injected into the handler; the production cloud entrypoint injects none.
- Production without a provider returns per-instrument unavailable quotes, an empty search result, or unavailable bars. The cloud bundle contains no market credential or real/test provider and is copied beside the mini program without entering its main package.
- Added a key-free entitlement confirmation record. Every commercial display, redistribution, retention, AI-input, archive, backup-export, quota, delay, and attribution decision remains explicitly pending.

## Phase 4 - Done Locally; Live Smoke Blocked

- Added a fixed-origin, header-authenticated Twelve Data provider for the approved-code boundary of `symbol_search`, `quote`, and unadjusted daily `time_series`. Client input cannot select the provider URL, API key, feed, permission domain, or arbitrary endpoint/range.
- Provider fixtures cover null/invalid fields, US stock/ETF identity, MIC/currency conflicts, invalid previous close, source timestamps, daily timezone/finality, malformed OHLC, 401, timeout, and one bounded Retry-After-aware retry. Error bodies and credentials are not propagated.
- Added entitlement-scoped shared quote/search/bar caches, holder-checked distributed quote leases, cross-instance minute/day budgets, and per-user request limiting. Concurrent equal quote refreshes merge; last-good data keeps its original `received_at` and becomes stale after expiry.
- Added an explicit live smoke command limited to AAPL, QQQ, and one nonexistent symbol. It is currently `blocked_by_configuration` because no API key, feed declaration, timeliness/coverage declaration, attribution, or completed commercial entitlement is present.
- Recorded the current official endpoint shapes and credit semantics in `twelve-data-integration.md`. The separate paid `/splits` endpoint remains uncalled and unimplemented until its entitlement is confirmed; the product states this corporate-action limitation instead of silently adjusting the ledger.

## Phase 5 - Done Locally

- Added a strict mini-program market cloud transport plus a separate, clearable local cache for canonical mappings and quotes. It is excluded from complete backups and never writes ledger events.
- Holdings resolve by ledger UUID plus symbol/type/MIC rules. Ambiguous, missing, inactive, invalid, or type-conflicting identities receive no valuation. Late responses are discarded by request sequence.
- Extended Decimal valuation with covered market value, unrealized P/L, stock coverage, missing/non-current identities, and position weight excluding cash. Unknown cash still prevents net value; one missing/stale/incompatible quote prevents exact stock weights.
- Added a shared quote card to overview and position detail with price, market value, unrealized P/L, source time, freshness, attribution, mapping failure, and explicit corporate-action coverage wording. Fixed “no market data” copy now reflects actual disabled/unavailable/stale/current states.
- Overview refreshes in bounded batches, refreshes every 60 seconds while visible, stops and invalidates old requests on hide/unload, and retains stale last-good values during network failure. Local bookkeeping remains available without market transport.

## Phase 6 - Done Locally

- Added a market discovery page and generic instrument detail reachable independently of holdings. Search requires at least two characters, uses a 300 ms UI debounce, one-hour result cache, explicit multi-result selection, and request sequence cancellation so a late response cannot replace the current query.
- Added an empty-by-default versioned watchlist at `portfolio.wechat.watchlist.v1`. Canonical provider identities preserve STOCK/ETF type; removing a watchlist item never changes the immutable ledger or transaction history.
- Added 1M/3M/1Y unadjusted daily close-line and candlestick views. Bars remain strictly ascending in New York exchange semantics, trading-day gaps are preserved, and unavailable/unauthorized history renders an honest empty state rather than a substitute curve. Intraday controls are not exposed.
- Reused provider/feed/time/adjustment display and kept cost lines out of the unadjusted market chart. Held positions can open the same generic detail after their canonical identity is verified.
- Extended the static build manifest allowlist for both new pages and the `market-chart` component. Production packaging verifies every declared page file and event handler; all additions are present in the final artifact.

## Phase 7 - Done Locally

- Added strict `ResearchTurnEnvelopeV2` and `ResearchTurnResponseV2`. The selected receipt identity/digest is payload-protected; response identity includes request/workspace/portfolio; provider-observed manifest rows require exact external source bodies and SHA-256 digests from the same run.
- Added `prepareAnalysisSnapshot` to the controlled market action set. The server obtains quotes through its configured provider/cache, freezes them for ten minutes in the private `market_receipts_private` collection, binds owner/purpose/instruments/feed/entitlement/digest, and ignores client quote/owner/provider fields.
- The AI gateway resolves receipts only with trusted OPENID, rejects expired, cross-owner, mismatched-purpose, reused cross-run, or altered-digest receipts, binds an accepted receipt to the claimed request, and injects provider-observed quote sources into the final model context. V1 remains readable and recoverable.
- The client previews the exact frozen quote/time/timeliness before confirmation, seals the receipt into V2, verifies the response/source digests, and atomically archives every source actually referenced by that run. Clearing live market cache does not remove an old run's source evidence.
- Fake assistant turns and their paired user turns are excluded from default follow-up history. Conversation history now exposes supporting evidence, counterevidence, missing items, context mode, and expandable archived source metadata; AI text is never promoted into a market fact.
- Workspace state is v3 and outbox entries are v2. Complete backup v5 includes the versioned watchlist and archived run sources, excludes clearable market cache and live receipt bodies, and strictly reads v1-v4. Every imported outbox/receipt reference is detached, so restore and recovery cannot issue a model request; historical imported quotes remain archive evidence only.
- ACK removes the bound private receipt after local archival. The authenticated cleanup job removes unused/terminal expired receipts, retains running-request receipts, and keeps only existing minimal AI audit/quota metadata.

## Phase 8 - Local Candidate Prepared

- Release manifest v2 records and production checks recompute main-package size, page/subpackage structure, client secret boundaries, and deterministic hashes for every packaged cloud-function tree.
- Packaging now emits separate client and cloud archives, SHA-256 sidecars, a machine-readable `release-candidate.json`, and preserves the last Round 4 client as a schema-compatible rollback artifact.
- Added regression coverage for New York DST, known early-close sessions, and rejection of weekend daily bars. Simulator review exposed and fixed stale v4 backup copy/file naming and the settings navigation title.
- The complete Section 10 scenario matrix, deployment configuration, additive migration, and rollback procedure are recorded in `round-5-release-candidate.md`.
- Production source/build verification and simulator inspection are complete locally. Physical iOS/Android and live-cloud acceptance remain explicitly pending and are not represented as passed.

## Phase 9 - Handoff Prepared; Deployment Not Authorized

- The handoff lists the three cloud functions, server-only collections/permissions/indexes, environment-variable names, cleanup timer, budgets, entitlement prerequisites, deployment order, two-user isolation checks, controlled smoke steps, experience-build gates, and rollback order.
- Deployment must start with AI and market disabled, compare deployed function trees to the candidate hashes, and enable closed-beta capabilities incrementally only after entitlement and privacy approval.
- No cloud upload, environment mutation, paid model/market call, experience upload, or review submission was performed. The correct current state is “release candidate prepared,” not “deployed” or “released.”

## Data and Migration Impact

- Financial snapshot remains v2. Workspace state advances to v3, outbox to v2, and complete backup to v5; strict v1-v4 backup readers remain. Existing local v1/v2 workspace partitions migrate through explicit readers, and imported pending work is detached instead of replayed.
- Existing `ai_access` rows without `consentedAt` are treated as enrolled but not consented; the next cloud AI send requires current-version confirmation. Public mode writes only hashed ownership metadata and consent time/version.
- New server collections are `ai_global_usage`, `market_access`, `market_cache`, `market_leases`, and `market_usage`. No migration or creation was performed against the deployed CloudBase environment.
- Server market cache, entitlement data, credentials, cloud identity, and live receipt bodies are not added to backup v5.
- `portfolio.wechat.market.v1` remains the clearable quote/mapping cache and is excluded from backup. `portfolio.wechat.watchlist.v1` is included as canonical watchlist data. Explicit device deletion clears both.
- New private server storage is `market_receipts_private`; deployment must provision its owner/expiry/retention query indexes before enabling AI market sources.

## Verification

- Baseline before edits: mini program 125/125, AI gateway 20/20, AI context 26/26; typechecks, builds, public-safety, and release-readiness passed.
- New focused regressions cover draft invalidation, checkbox behavior, read-only preview, follow-up confirmation, expiry, archive-before-ACK, ACK-only recovery, and status-only recovery without duplicate generation.
- Final verification passed: mini program 132/132, AI gateway 20/20, AI context 26/26, and domain 32/32. All related typechecks and builds passed, as did public-safety, release-readiness, and `git diff --check`.
- The production check passed for version 0.3.0 with cloud transport and a 1,960,971-byte main package. The manifest truthfully marks the current uncommitted worktree as dirty.
- Round 1 local review artifact used SHA-256 `37a3d4654afe66dcce369b1e767b19b622dd7dae7474066a79e67b175e261f50` and was not uploaded or deployed.
- Round 2 verification passed: mini program 135/135, AI gateway 27/27, market-data 5/5, AI context 26/26, and domain 32/32. Related typechecks/builds, public-safety, release-readiness, production checks, and `git diff --check` passed.
- The production main package is 1,967,976 bytes. Its manifest marks the market cloud skeleton present and provider unconfigured; `portfolioMarket/market.cjs` is outside the main package.
- Round 2 local review artifact: `dist/wechat/交易日记-微信小程序-0.3.0-production.zip`, SHA-256 `12b47cd838a2c2d2c493841177efdf775b16fa21db8c7497a859677142cc9540`. It contains the client release package only; cloud functions remain separately reviewable under `apps/miniprogram/dist/cloudfunctions` and were not deployed.
- Round 3 focused red/green tests cover provider contracts/retries/current-bar finality, shared single-flight/cache/budgets, per-user limiting, strict cloud transport, stale/offline behavior, request sequencing, mapping ambiguity, unknown freshness, Decimal valuation coverage, and read-only market integration.
- Round 3 final verification passed: API 174/174, Web 74/74, mini program 144/144, AI gateway 37/37, domain 35/35, market-data 5/5, and AI context 26/26. All related typechecks, lint, Web/Cloud/miniprogram builds, public-safety, release-readiness, production-package checks, and `git diff --check` passed.
- The production mini-program main package is 1,989,154 bytes. Its manifest truthfully reports the client market transport as disabled because private `marketFunctionName` is not configured; the separately packaged cloud function contains the runtime-configured provider adapter but no credential or fixture price.
- Round 4 verification passed: API 174/174, Web 74/74, mini program 150/150, AI gateway 40/40, domain 35/35, market-data 5/5, and AI context 28/28. All related typechecks, lint, builds, public-safety, release-readiness, production checks, and `git diff --check` passed.
- The Round 4 production main package is 2,009,462 bytes (12 pages), below the 2 MiB limit. Latest locally rebuilt package SHA-256: `a62f0570bc7210bbd25b0d049a151d6fc5eb1485e9c591cac0322ae4b99df85d`.
- Round 5 fresh verification passed: API 174/174, Web 74/74, mini program 152/152, AI gateway 41/41, AI context 28/28, domain 35/35, market-data 5/5, and mobile 4/4. All related typechecks, lint, builds, public-safety, release-readiness, production-integrity checks, and the simulator acceptance described in the handoff passed.
- The Round 5 client candidate has a 2,009,527-byte main package (12 pages, no subpackages) and SHA-256 `b3ad53f1365265cb3bfeffec57ace9198c97876e40c71de3e49f72318d307b95`. The separate cloud deployment archive SHA-256 is `bd5b3ccbfd1403ea5e112adeeb3839710e66106650482dcc418d6b7f7161808b`; neither artifact was uploaded or deployed.

## Remaining External Release Gates

- No WeChat simulator or physical-device acceptance was run in this round.
- The existing FastAPI test stack emits a Starlette/httpx deprecation warning, but all API tests pass. The API npm test command now prepends the declared project virtualenv to `PATH` so executable Python scripts use the same installed requirements as the test runner.
- No cloud bundle was uploaded. The handoff's warning about the older deployed bundle remains current.
- The new AI capabilities/consent/global-budget code and `portfolioMarket` bundle are not deployed. The deployed function may still return the older capability shape, which the new client intentionally treats as unavailable until deployment is reviewed.
- Cloud usage values, request isolation, cleanup runtime/token/Timer.Message, compound indexes, new collections, and CloudBase transaction behavior remain unverified against the live environment.
- Market entitlement remains `pending_business_confirmation`; no API key, live quote, successful provider smoke, or commercial authorization is claimed. The adapter and client remain disabled until the release owner completes the entitlement record, deploys the reviewed cloud bundle, provisions consent/access rows, and explicitly configures both server flags and the private client function name.
- Privacy disclosure, WeChat service category, financial/AI feature description, certification, and review eligibility require the release owner to verify current console and legal requirements.
- Physical-device, live-cloud, quota/load, entitlement, privacy, experience-upload, two-account isolation, billing, and release-review gates remain pending. Simulator-only evidence and the exact deployment checklist are in `round-5-release-candidate.md`.
