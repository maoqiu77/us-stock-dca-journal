# Round 5 Release Candidate and Deployment Handoff

Updated: 2026-09-14 Asia/Shanghai  
Branch: `codex/mobile-phase-0-1`  
Baseline commit: `bb22f683026d8eaaec1bab87783e9d6197666b90`  
Release state: **local release candidate; not deployed; not uploaded; not submitted for review**

## Candidate artifacts

The machine-readable source of truth is `dist/wechat/release-candidate.json`. The manifest records the dirty-worktree state because Rounds 1–5 have not been committed.

| Artifact | SHA-256 | Purpose |
|---|---|---|
| `交易日记-微信小程序-0.3.0-production.zip` | `b3ad53f1365265cb3bfeffec57ace9198c97876e40c71de3e49f72318d307b95` | Client review/import package; 2,009,527-byte main package, 12 pages, no subpackages |
| `交易日记-微信云函数-0.3.0-production.zip` | `bd5b3ccbfd1403ea5e112adeeb3839710e66106650482dcc418d6b7f7161808b` | Server deployment review package; not deployed |
| `交易日记-微信小程序-0.3.0-round4-rollback.zip` | `a62f0570bc7210bbd25b0d049a151d6fc5eb1485e9c591cac0322ae4b99df85d` | Schema-compatible Round 4 client rollback |

The production manifest independently binds these cloud function trees:

| Function | Tree SHA-256 | Bytes / files |
|---|---|---|
| `portfolioAi` | `0efcc8b8e3cacc61a0e198e45268b59c253a1d00cd1d49090132c08c39b99dc6` | 424,820 / 4 |
| `portfolioAiCleanup` | `122fd3e7090c15bb0611bd0f17958556bcacf54946cadd5e82cc2f25fff94b2f` | 4,667 / 3 |
| `portfolioMarket` | `615881aa386d6ff2a4a37fcf98f723c9c0c95042c4324bce4d64c9bb00209e52` | 407,301 / 4 |

Rebuilds may change ZIP hashes because ZIP stores file timestamps. The tree hashes are deterministic for comparing deployed function contents.

## Acceptance matrix

| Required scenario | Local evidence | State |
|---|---|---|
| Missing production AI/market config | Production dependency/config check plus simulator unavailable states | Passed locally |
| Historical fake and real AI mixed | `ai-engine.test.ts`, fake history excluded from follow-up facts | Passed locally |
| Edit after preview | `release-pages.test.mjs`, `ai-engine.test.ts` | Passed locally |
| Archive succeeds but ACK fails | `ai-engine.test.ts`, ACK-only recovery | Passed locally |
| Restart after unknown analyze outcome | `ai-engine.test.ts`, status/result only, no second analyze | Passed locally |
| Partial/unknown local save | pending-save and workspace-journal tests | Passed locally |
| Partial quote batch | market handler and valuation tests | Passed locally |
| Provider 429/outage | bounded Retry-After retry and last-good stale-cache tests | Passed locally |
| Cache timestamp integrity | shared cache test preserves `received_at` and updates `served_at` | Passed locally |
| Weekend, DST, early close | provider rejects weekend rows, computes New York DST, and recognizes known 13:00 closes | Passed locally |
| Switch instrument/page/background | market request sequence and page lifecycle tests | Passed locally |
| Unknown cash | deterministic valuation tests suppress total assets/cash-inclusive weights | Passed locally |
| Split or price-basis conflict | domain valuation suppresses exact weights and never edits ledger events | Passed locally |
| Missing/halted/delisted bars | strict empty/unavailable chart behavior, no generated bars | Passed locally |
| Different feed/range/adjustment | entitlement scope and cache-key boundaries; production only exposes regular/unadjusted daily requests | Passed locally |
| Tampered quote/provider source | Transport V2 body/manifest/digest validation | Passed locally |
| Cross-user receipt/result | AI gateway trusted-OPENID tests | Passed locally |
| Display allowed but AI/archive denied | market capabilities keep quote and AI-source permissions independent | Passed locally |
| Old/corrupt/future backups | strict v1–v5 migration and no-replacement failure tests | Passed locally |
| Imported pending request | imported outbox detached; recovery performs zero transport calls | Passed locally |
| Production artifact is not deployment proof | manifest and this handoff keep build/deploy/device/review states separate | Passed locally |

## Simulator and device evidence

WeChat Developer Tools Stable 2.02.2608070 with base library 3.17.2 loaded the production `dist` project on an iPhone 12/13 Pro simulator. The following were inspected without changing the financial ledger:

- Overview retained the local ledger, showed unknown cash, zero market coverage, and no invented quote or total assets.
- Market search accepted a two-character query and returned “行情搜索未配置”; the watchlist remained empty with no sample symbol.
- AI research produced a read-only context preview, showed missing cash/plan/quote, labeled legacy fake/demo history, and did not expose a send action while capabilities were unavailable.
- Settings showed version 0.3.0, device-local storage wording, v5 backup wording, and the service status boundary.

An earlier simulator-control bridge injection emitted `getActiveAppWindow` errors from its own automation frame. After the production rebuild restarted the session, the developer console reported 0 errors; the remaining warnings were Developer Tools preload/hot-reload notices rather than mini-program stack failures.

Not verified: physical iOS, physical Android, experience-build cloud behavior, file share/restore on a real device, live provider/model calls, and two-account cloud isolation.

## Deployment prerequisites

Do not deploy or enable market data until `market-entitlement.json` is completed and approved for external display, redistribution, cache/history retention, AI input, local archive, plaintext backup export, and attribution. Do not place secrets in this file, git, chat, screenshots, client config, or backup exports.

All collections must deny direct mini-program reads/writes and be accessed only by trusted cloud functions:

- `ai_requests`, `ai_payloads`, `ai_usage`, `ai_global_usage`, `ai_access`, `ai_turn_keys`
- `market_access`, `market_cache`, `market_leases`, `market_usage`, `market_receipts_private`

Create/verify the compound indexes in `cloudbase-indexes.md` before enabling traffic. In particular, cleanup requires request state/created/purged queries and receipt expiry/accepted-request/retention queries.

### Client-only configuration

`config.local.json` accepts only `appid`, `cloudEnvId`, `aiFunctionName`, `aiTransport`, and `marketFunctionName`. It must never contain provider URLs or credentials. Keep `marketFunctionName` absent until the market function and entitlement are verified.

### `portfolioAi` server configuration

`EXPECTED_WEAPP_APPID`, `AI_ENABLED`, `AI_ACCESS_MODE`, `AI_PROVIDER`, `AI_PROTOCOL`, `AI_BASE_URL`, `AI_MODEL`, `DEEPSEEK_API_KEY`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_DAILY_REQUEST_LIMIT`, `AI_GLOBAL_DAILY_REQUEST_LIMIT`, `AI_MAX_INFLIGHT_PER_USER`, `AI_MAX_INPUT_BYTES`, `AI_MAX_PREPARE_WINDOW_MS`, `AI_BYOK_ENABLED`.

### `portfolioMarket` server configuration

`EXPECTED_WEAPP_APPID`, `MARKET_ACCESS_MODE`, `MARKET_CONSENT_VERSION`, `MARKET_ENABLED`, `MARKET_PROVIDER`, `TWELVE_DATA_API_KEY`, `MARKET_FEED`, `MARKET_ENTITLEMENT_DOMAIN`, `MARKET_COVERAGE`, `MARKET_TIMELINESS`, `MARKET_DELAY_SECONDS`, `MARKET_QUOTE_ACCESS`, `MARKET_BARS_ACCESS`, `MARKET_SEARCH_ACCESS`, `MARKET_AI_SOURCE_ACCESS`, `MARKET_ARCHIVE_ACCESS`, `MARKET_ATTRIBUTION`, `MARKET_QUOTE_BATCH`, `MARKET_SEARCH_RESULTS`, `MARKET_MAX_BARS`, `MARKET_QUOTE_CACHE_SECONDS`, `MARKET_STALE_RETENTION_SECONDS`, `MARKET_USER_REQUESTS_PER_MINUTE`, `MARKET_MINUTE_UNITS`, `MARKET_DAILY_UNITS`, `MARKET_CATALOG_VERSION`.

### `portfolioAiCleanup` server configuration

`CLEANUP_JOB_TOKEN`, optionally `AI_PAYLOAD_RETENTION_MS=86400000`. Target runtime is Node.js 20.19, 256 MB, 60-second timeout, hourly timer. The timer `Message` must carry the token as JSON; `DEEPSEEK_API_KEY` must not be present.

## Ordered deployment and verification

1. Approve entitlement/privacy/service-category records and capture a recoverable CloudBase backup or export before schema additions.
2. Add the server-only collections and indexes. This is additive; do not rewrite existing ledger, request, or analysis records.
3. Deploy `portfolioAi`, `portfolioMarket`, and `portfolioAiCleanup` from the reviewed cloud archive with `AI_ENABLED=false` and `MARKET_ENABLED=false`.
4. Compare deployed function contents with the deterministic tree hashes above. Verify `capabilities` rejects wrong AppID/untrusted identity and truthfully reports both services disabled.
5. Enter secrets only in the cloud console, apply conservative per-user/global budgets, and create closed-beta access/consent rows for two test users.
6. Enable AI first for the test users; verify V1 recovery and V2 request/result/ACK without duplicate provider calls. Run one controlled empty-ledger model smoke only after explicit cost approval.
7. Enable permitted market capabilities one at a time. Run the bounded AAPL/QQQ/nonexistent-symbol smoke, verify attribution/timeliness/coverage, shared public cache isolation from holdings, and actual billing counters.
8. Verify two users cannot read each other's request, payload, receipt, result, or ACK state. Verify cleanup leaves running requests intact and removes eligible terminal bodies/receipts.
9. Add `marketFunctionName`, rebuild and re-hash the client, then upload an experience build. Complete physical iOS/Android, file backup/restore, network-loss, foreground/background, and privacy-copy acceptance.
10. Only the release owner, or an explicitly authorized operator, submits WeChat review. Record build, deployment, experience acceptance, review submission, and public release as separate states.

## Rollback and migration

- Before any rollback, set `MARKET_ENABLED=false` and, when needed, `AI_ENABLED=false`; preserve request/audit data and wait for in-flight work to reach a known state.
- The Round 4 client rollback above understands workspace v3, outbox v2, and complete backup v5. It is the earliest safe binary rollback for data written by this candidate.
- Do not roll back to binaries that cannot read these schemas. For older clients, export v5 and use an isolated read-only recovery/conversion path rather than opening the live local store.
- Server changes are additive. New collections/indexes may remain after a client rollback. Do not delete them as part of emergency rollback; retain audit/idempotency/usage data and let authenticated cleanup enforce retention.
- A server rollback must preserve V1 and V2 recovery for requests already accepted. If that cannot be guaranteed, leave the compatible server deployed with feature flags disabled.
