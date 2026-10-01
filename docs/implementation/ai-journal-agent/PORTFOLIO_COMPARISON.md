# Phase 6 Portfolio Comparison Attempt

Updated: 2026-10-01 (Asia/Shanghai). Status: Agent reviewed and canonical archive verified; paired output incomplete. Stop model calls this round. Phase 7 remains unopened.

## Authorization and Configuration

The user asked for the next step and previously explicitly allowed necessary budget extensions and backend switching. Announced new-round limit: **five model HTTP requests / 1 CNY reservation**, at most four Agent calls plus one legacy call. This is separate from the previous nineteen-request and earlier twelve-request rounds. No repeated probe, automatic retry, unknown-run replay or protocol/provider switching.

Checked existing Python 3.12.13, DeepSeek `deepseek-flash`, official `https://api.deepseek.com/v1`, fixed Chat Completions, credential present and matching `deepseek-chat-v1` capability. Keys were never printed. Provider model alias does not pin immutable model weights.

Each outbound JSON payload is bounded to 40 KB and 6144 output tokens. With a conservative 50000 input-token allowance/request, five calls reserve 250000 input + 30720 output tokens. Published peak Flash rates yield a conservative estimate **0.745760 CNY**, within the 1 CNY reservation. This is not an account billing cap. Pricing checked against [DeepSeek CNY pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).

## Fixed Inputs and Method

New isolated synthetic SQLite workspace under ignored `storage/local`. NVDA: ten shares, remaining unit cost 12 USD, trading quote 20 USD. Plan: target weight 30%, stop loss 10%, take profit 20%. Twenty closed daily bars with closes 1 through 20. Original trade reason and note describe long-term compute demand and conditional continued demand/earnings; no actual fundamentals, news or cash observations exist.

Both engines receive the same question: calculate market value, holding cost, within-currency weight and MA5/20/60; identify cash/account-wide/missing fields, verify original business conditions and name sources/times. The legacy snapshot is copied from the Agent snapshot: question, private context, frozen quote/series, missing fields and original source payloads are equal. Only engine/memory mode, ID/digest and snapshot creation/expiry differ. Legacy retains its existing prompt and one-call completion path; the test explicitly overrides timeout/output to 25 seconds/6144 tokens. Agent uses production tools and citation validation. Different prompt packing remains a comparison limitation.

Preparation made zero requests. Offline regressions run production local tools with a scripted model, verify matching question/frozen series, avoid falsely claiming tool success without tools, and stop after unknown Agent or legacy outcomes.

```sh
# Preparation only.
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py \
  --prepare-only --portfolio-comparison --request-limit 5

# Historical execution command; this round's five-request budget is exhausted.
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py \
  --real --portfolio-comparison --request-limit 5
```

## Actual Results

| Measurement | Agent | Legacy |
| --- | --- | --- |
| Attempted model requests | 4 | 1 |
| Result | Succeeded and archived | No complete response at 25-second boundary; failed record / unknown upstream outcome |
| Tool events / archived sources | 8 successful / 8 | No tools or answer |
| End-to-end measured case duration | 21.488 s | 25.150 s until terminal failure |
| Summed received HTTP duration | 21.245 s | Unknown completion duration |
| Reported input / output tokens | 14653 / 4625 | Unknown |
| Cached input / reasoning output tokens | 9728 / 3272 | Unknown |
| Estimated off-peak/peak cost | 0.02361956-0.04723912 CNY | Unknown |
| Answer calculation review | 6/6 requested fields correct on this fixture | Not measurable |

All **5/5** requests were reserved before their HTTP attempts. Agent calls returned `deepseek-flash`; the legacy call has no returned model/usage receipt. **Total actual cost remains unknown**, not the Agent subtotal. The original legacy failure receipt did not retain exception class; the harness now records error class and distinguishes transport-unknown outcomes in future tests. No error class was invented for this receipt. The existing legacy turn records `failed / model_failed`; that is not proof upstream inference stopped or was free. No legacy replay was sent.

Manual review checked actual report text, original payloads, observation/version times and calculation parent IDs:

- Market value **200 USD**, total holding cost **120 USD**, weight **1 within the observed USD holdings**. Not total-account weight.
- **MA5=18**, **MA20=10.5**, **MA60=null** with insufficient bars. The daily series explicitly has unknown timeliness/cache miss; the report correctly does not call it real-time.
- Cash, account-wide exposure and actual demand/earnings remain unknown. Prices/MAs do not prove the original operating conditions. No repeated request for workspace access.
- Target/stop/take-profit ratios correctly interpreted; trade date and note version distinguished. No unread citation; reasoning and credentials excluded from archive.

The Agent result is reviewed on one synthetic, single-position/single-currency fixture. The legacy answer is absent, so there is no paired quality/cost winner or broad numerical/semantic guarantee.

## Canonical Check and Time Correction

Temporarily served this closed, reviewed workspace on canonical 8000 in a new **read-only archive mode**. All methods except GET/HEAD/OPTIONS are rejected; a preview POST returned 403. Serving refuses unfinished Agent runs. The existing canonical Next dev on 3000 was reused, with no browser response mocks or new inference.

Actual page checks: Agent report/MA values, source drawer and calculation input source, same session after refresh, legacy failure present in calendar, desktop/mobile with no horizontal overflow. Recorded eight journal GETs, zero UI POSTs; model receipt stayed at five requests. Screenshots were reviewed; a capture taken during drawer-close animation was replaced after waiting for the dialog to be hidden.

This check discovered that the indicator card displayed source retrieval time rather than the last closed bar's cutoff. Fixed the card and technical source drawer to use the immutable calculation payload's `as_of`; missing/invalid cutoff displays unknown. Newly calculated technical Evidence now uses that same last-bar time. Backend regression verifies source read time differs from indicator cutoff; Web regressions cover old archived records and missing/invalid timestamps. Existing snapshots/source payloads were not mutated. The backend timestamp change was verified offline, and display of the existing real archive was verified on 3000; no extra model retest was made after that field correction.

Synthetic API stopped after ownership verification. Normal Python 3.12 `app.main:app` restored on 8000 with original database/dependencies. Existing Next dev remains on 3000. Synthetic browser markers cleared, restored normal page checked with zero journal POSTs, test browser closed. Original database had no Agent runs and eleven completed quant runs before switching; no active inference was interrupted.

## Final Verification and Limits

- API **292/292**, Web **91/91**; TypeScript with existing `--allowImportingTsExtensions` convention, targeted ESLint, compileall, whitespace and public safety checks pass.
- HEAD unchanged, all existing uncommitted work retained. No real-private-data model inference, commit, push, deployment or release.
- Paired calculation comparison remains incomplete because the legacy call did not return. Future evaluation must use a separately defined new case; the uncertain call must not be automatically replayed.
- Real Agent upstream cancellation/fault injection, broader held-out semantic coverage and persistent Python 3.12 cold-launch selection remain outstanding. A natural legacy unknown response is not a controlled Agent fault-injection test.
