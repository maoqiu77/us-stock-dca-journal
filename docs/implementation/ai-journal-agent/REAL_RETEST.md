# Phase 6 Real Synthetic Retest

Updated: 2026-10-01 (Asia/Shanghai). Status: executed and manually reviewed; normal canonical API restored. Stop this round; Phase 7 is unopened.

## Checked Configuration

- Existing Python 3.12.13 optional environment; no installation or environment change.
- DeepSeek `deepseek-flash`, official `https://api.deepseek.com/v1`, fixed `chat/completions`.
- Credential present; never printed or written to test artifacts.
- Configuration fingerprint matches the previous real `deepseek-chat-v1` capability. Reuse it; no repeated paid probe. Check the fingerprint before every request and after every response.
- `deepseek-flash` is a provider alias. Record the returned model identifier; configuration equality does not establish immutable upstream model weights.
- HEAD remains `daa49363d91a215303b835733aeda516dd6f895d`; preserve existing uncommitted changes.

## Approved Budget and Actual Usage

The user approved the initial nine-request / 1.50 CNY plan, then explicitly allowed necessary bounded budget extensions and backend switching. The announced current-round limit became **19 requests / 3 CNY reservation**. All **19/19** were used: six in the first workspace, thirteen in a fresh successful workspace including six canonical UI calls. The previous twelve-request integration round is separate. No automatic retries, failed-case replay, protocol/provider switch or repeated capability probe occurred.

Actual JSON requests are capped at 40 KB. The first six requests used a 3072 output-token cap. Following a known truncated response, DeepSeek's cap was raised to **6144**, including the bounded legacy comparison; standard adapters remain 3072. Production per-call reservation now uses the selected cap while retaining the 145000 overall token-reservation bound. With 50000 reserved input tokens/request, six calls at 3072 and thirteen at 6144 yield a conservative peak estimate of **2.686432 CNY**, within the 3 CNY reservation. This is not a provider-account spending cap.

All nineteen responses included usage: **68866 input tokens**, including **37760 cache-hit tokens**, and **16719 output tokens**, including **8673 reasoning tokens**. Summed HTTP durations: **79.773 seconds**, not total end-to-end runtime. Published off-peak/peak rates give **0.0987372-0.1974744 CNY**. Actual account billing was not audited. Raw reasoning and credentials are not stored.

Price checked on 2026-10-01: [DeepSeek CNY pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).

## Fixed Synthetic Inputs

Only a separate SQLite workspace under ignored `storage/local/deepseek-verification-*` is used. Synthetic NVDA position: 10 shares at unit cost 12 USD; quote 20 USD; plan target 0.3, take profit 0.2, stop loss 0.1; twenty closed daily bars with closes 1 through 20. Cash, actual demand/earnings and news are unknown.

Trade date: **2020-01-01**. The trade reason's version timestamp is **unknown**. Related original note version: **2026-09-01T00:00:00+00:00**. Snapshot time is the test's current time. These dates must remain distinct.

1. First question: why NVDA was bought; retrieve original trade reason and note; identify trade date, note version and unknown trade-reason version. Expected: memory tool, both originals, no repeated request for workspace access. Market tools are unnecessary for this question.
2. Follow-up in the same session: holdings/policy, market quote/series, exposure and technical calculations; assess whether the original conditions are now established. Expected: market value 200 USD, holding cost 120 USD, within-currency weight 1, MA5=18, MA20=10.5, MA60=null. Missing cash and fundamental evidence remain unknown; quote/MA alone cannot verify demand/earnings.
3. Existing legacy LLM route answers the first question using the **identical frozen private context/market observations/missing fields**. Legacy prompt shape remains unchanged; test-only timeout/output overrides are 25 seconds/6144 tokens for bounded comparison. No tools. Token usage is captured at the HTTP boundary because the existing text return omits usage. Different prompt packing and available evidence at request time limit conclusions about efficiency.

## Execution and Review

```sh
# Preparation only; reads model configuration but sends no model request.
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py \
  --prepare-only --semantic-retest --request-limit 9

# Historical execution command; the current round's budget is exhausted.
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py \
  --real --semantic-retest --request-limit 9
```

The backend cases used production preview/confirm, dedicated adapter, LangGraph, executor, memory, calculations and archive. The approved canonical stage then temporarily served the successful synthetic database on 8000 and reused the existing Next development page on 3000, without browser response mocks. Synthetic records do not appear in the restored normal database.

An unknown result/transport error closes further admission. Any terminal failed Agent turn stops remaining cases. Failed/unknown runs cannot be replayed by semantic mode. Keep the failure receipt and review it. Successful confirmation is checked for idempotence; same-session follow-up must contain exactly one minimal prior turn.

## Results and Manual Review

| Case | Model calls | Result |
| --- | --- | --- |
| First workspace: date question | 2 | Archive succeeded; prose incorrectly inferred later initial writing. |
| First workspace: full follow-up | 4 | Eight tools and calculations ran; final output hit 3072 tokens, truncated JSON failed. Harness stopped before legacy comparison. No retry. |
| New workspace: date question | 2 | Three tools/four sources; dates distinguished, but summary still ambiguously called the note a later record and suggested quote-based business verification. Findings preserved. |
| New workspace: same-session full follow-up | 4 | Seven tools/eight sources; expected calculations and missing fundamental evidence correctly reported. |
| Matched frozen-input legacy question | 1 | Completed; speculated that the trade date was a placeholder and initial note writing was later. |
| Canonical page: new full conversation, final prompt | 4 | Eight successful tools/eight sources, including explicit unavailable fundamentals/news; structured report, source drawer and archive passed. |
| Canonical page: date follow-up, same session | 2 | Two memory calls/two sources; explicitly says later version time cannot prove later initial writing. Archive passed. |

The failed and semantically faulty reports remain archived. Prompt corrections distinguish initial writing from saved/modified versions and require fundamental originals for demand/earnings conclusions. Final UI samples report the expected 200 USD market value, 120 USD holding cost, within-currency weight 1, MA5=18, MA20=10.5 and MA60=null; cash/account-wide weight and fundamental conditions remain unknown. No repeated workspace authorization appeared. One full-report phrase, "成本内市值", remains awkward; numeric fields are correct. These reviewed samples do not establish general prose entailment.

The paired first question used 6128 input/1958 output tokens across two Agent calls versus 2516 input/1552 output in one legacy call. HTTP durations were **9.521 s vs 7.950 s**; estimated cost ranges **0.011075-0.022150 CNY vs 0.008599-0.017197 CNY**. Both had semantic findings before the final prompt correction. This single original-memory comparison establishes neither general quality superiority nor calculation/cost efficiency. A paired portfolio/calculation comparison remains outstanding.

## Canonical Verification and Restoration

- Real 3000 sends created exactly two previews and two confirmations. Full tool send and date follow-up succeeded in the same session. Refresh and brief browser offline/reconnect added no confirmation or model replay. Desktop/mobile screenshots and the source drawer were inspected; no horizontal overflow.
- The browser script initially used the wrong GET polling route. It was corrected to `/api/ai-journal/runs/{id}`. The asynchronous polling predicate is not used as success evidence: independent correct-route GET, SQLite terminal records and actual report screenshots establish success. No resubmission occurred.
- Both UI runs were terminal before stopping the ownership-checked synthetic API. SIGTERM ended that process before its final receipt cleanup; post-shutdown review explicitly closed the already exhausted admission record. All request/usage/failure records were retained.
- Normal Python 3.12 API now serves the original database on 8000 with normal dependencies. Existing Next dev remains on 3000. Synthetic browser session markers were cleared; restored unified composer, absent old buttons and readable calendar were checked with zero journal POSTs. Test browser closed.
- Final API suite **289/289**, Web **89/89**, compileall, public safety and whitespace checks pass. No commit, push, deployment or release action.

Remaining: real upstream failure/cancellation injection (browser offline is not upstream interruption), broader held-out semantic coverage, paired portfolio/calculation evaluation and persistent Python 3.12 cold-launch selection. Launcher/.venv remain unchanged. All live inference inputs were synthetic; no real private-data inference was performed.
