# A2/A3 Status

Updated: 2026-09-13 13:50 Asia/Shanghai. Scope remains A2/A3; no A4, release, commit, or push.

## Code and current verification

- Implemented: immutable source snapshots and SHA-256 digests; daily-review targets; bounded follow-up history; explicit unheld-instrument identity; transport envelope v1; workspace v2/outbox; full backup v4; CloudBase transport/store; identity isolation; idempotency; quota; DeepSeek JSON adapter and approved-model readiness validation.
- Fixed during handoff continuation: SHA-256 no longer depends on host `TextEncoder`; UTF-8 tests cover Chinese, emoji, unmatched surrogates and multiple blocks against Node crypto. Research preparation/archive failures now report failure and never claim a generated result or navigate to an empty conversation.
- Fixed the remaining simulator migration failure: pre-release local workspace **v1**, as well as v2, can recover missing run `source_ids` from stored citations. External v3/v4 backups remain strict. The v1 regression verifies old partition bytes are preserved and valid v3 still imports.
- `npm run check:ai-gateway`: passed, 20/20 tests and bundle build.
- `npm run check:weapp`: passed, 125/125 tests and typecheck/build. Main package 1911.6 KiB, 10 pages, cloud transport and configured AppID.
- `npm run typecheck -w @portfolio/ai-context` and package tests: passed, 26/26.
- Gateway bundle and packaged `portfolioAi/gateway.cjs` SHA-256 both `a6121b7a7ab63ccbfb573d8de41538cedf50ba7405140bbdf9888a196063ff62`.
- Simulator recompiled without clearing storage: settings shows 2 valid trades, 2 personal notes, 1 conversation, 2 analyses and 1 source snapshot; `source_ids` error is gone and full backup is available. Latest settings labels show A2/A3 0.3.0 and explain cloud context transmission.

## Existing real-cloud evidence

The earlier session deployed CloudBase functions and private collections in `cloud1-d5g33e5bq6574da06` for AppID `wx850752552846e9ef`. It verified capabilities from mini-program identity and one real DeepSeek call using an empty synthetic portfolio. This session has not made a new paid request or uploaded real investment data.

- Request: `7dcd66e0-5999-4042-a905-da3614cb1446`, status `succeeded`.
- Payload digest: `91b36a93b572bb1de5763de86309a400eb803a9404ab704bd69f29109ed4522c`.
- Response digest: `9091d7850fff31ebeaff8f96d8513e9bad0385cf2e46a0ac019ed79106498565`.
- Provider/model: `deepseek` / `deepseek-flash`; sponsored; OpenAI-compatible Chat Completions; input 774 / output 405; stance `insufficient_data`.
- This is direct cloud-call evidence, not proof of a full real-provider UI/archive workflow. The direct ACK lifecycle is verified below.

## Deployment and ACK verification

- Latest `portfolioAi` deployment used cloud dependency installation. Cloud function list confirms 已部署, updated 2026-09-13 01:00:14.
- Post-deployment capabilities recheck passed from the mini-program identity: enabled, authorized and provider configured; sponsored credential mode; BYOK disabled; daily 10, inflight 1, input 200000 bytes and output 800 tokens.
- Before ACK, both `status` and `result` returned the existing succeeded request and matching response digest. No new provider generation was invoked.
- After explicit user confirmation, ACK returned `acknowledged=true`. A subsequent status query still returned `succeeded`, while result returned `RESULT_ACKED`, verifying response unavailability while audit status remained available. This did NOT prove that every input copy was erased: the deployed store retains ai_requests.envelope. The local correction below has not been deployed.

## Continuation: local ACK/cleanup corrections (not deployed)

- Three new failing regressions reproduced CloudBase ACK retaining the input envelope, repeated CloudBase ACK failing after response deletion, and the memory store returning a partial result after ACK. Fixed both stores to erase envelope/response, retain responseDigest, and accept only matching repeat ACK. Handler status exposes the retained digest. The old already-ACKed cloud record has no retained responseDigest; do not invent one or weaken validation to re-ACK it.
- Cleanup now authenticates both direct event.token and Timer.Message JSON token, rejects invalid retention before database access, clears terminal request bodies and matching payloads transactionally, and clears legacy ACK input after retention. Successful unacknowledged requests become expired; acked/outcome_unknown states remain audit facts. Usage and turn keys are untouched; running requests are deliberately excluded.
- Retention decision: 86400000 ms from server request createdAt (24 hours). Orphan payloads use expiresAt plus retention. Terminal requests are bounded to 100 per run, marked payloadPurgedAt to advance later runs; orphan candidates use stable _id pagination so retained rows do not hide later orphans.
- Independent review found the first-page orphan starvation bug; a failing 100-retained-plus-one-orphan regression now passes. Tests also cover SDK transaction object/null reads. Real SDK rollback/conflict retry behavior still needs cloud validation; very large orphan scans can exceed the configured function timeout and need an operational cursor strategy if scale grows.
- Full local checks: gateway 20/20 + typecheck/build, miniprogram 125/125 + typecheck/build, ai-context 26/26 + typecheck. Packaged cleanup source matches local source. Credential-pattern scan of 406 text files (tracked/nonignored/untracked plus generated JS/CJS/JSON, excluding private settings) found no matches; this is a pattern scan, not a guarantee. git diff --check passed.
- **The new local bundle hash above differs from the deployed 01:00 bundle. No cloud code upload/deployment was performed in this continuation.**

## Remaining cloud and acceptance checks

- `portfolioAiCleanup` configuration was inspected: Node.js 16.13, 256 MB, 3-second timeout, empty environment-variable table (neither CLEANUP_JOB_TOKEN nor AI_PAYLOAD_RETENTION_MS configured). No changes saved. Current code therefore rejects cleanup with UNAUTHORIZED_CLEANUP. Runtime upgrade, token setup and trigger verification remain pending. Do not expose token values or add the DeepSeek key to cleanup.
- Cloud usage counts and request isolation metadata remain unverified this turn: the available automation exposed only the developer-tools project window, and its screenshot API was unavailable. Asked user to open the cloud database query console. Never retrieve raw owner/OPENID or bodies into visible query output; project safe fields and server-computed presence/equality flags. Quota dates use UTC, so inspect 2026-09-13 and the prior 2026-09-12 bucket for the earlier Shanghai after-midnight calls; do not assume the current day count is three.
- Cloud configuration decision is to align cleanup with Node.js 20.19, retain 256 MB, use a target timeout of 60 seconds, retention 86400000 and an hourly timer. These are target values, not saved settings. Token entry, trigger Message configuration, required query indexes, code deployment and a controlled cleanup verification remain pending; do not add DEEPSEEK_API_KEY.
- Developer Tools native Tools → Preview generated a QR code: displayed package 1912 KB, expiry 2026-09-13 14:14. Phone scan/launch has not been confirmed. Preview performs the tool's temporary development-code transfer; the separate Upload/experience-version and release actions were not used.
- Phone checklist remains pending: normal real AI page flow (one additional paid call, not authorized/executed this turn), offline/reconnect, background/foreground, long input, quota-exhausted wording, outcome_unknown recovery, and local archive-before-ACK. No phone success claim is made from simulator/unit-test evidence.
- Source inspection also found that the current UI has no status-only outbox recovery action, and submitPrepared's catch can downgrade a locally saved turn when ACK fails. These are open A3 recovery implementation issues, not merely a missing phone test; do not repeatedly click Send to emulate recovery. They were not changed in this ACK/cleanup patch.
- All existing uncommitted work was preserved. No new provider call, cloud configuration mutation, commit, push, experience-version upload or release.

See [cloud handoff](ai-a2-a3-cloud-handoff-2026-09-13.md) for prior non-secret configuration and evidence. No Key or raw OPENID belongs in these documents.
