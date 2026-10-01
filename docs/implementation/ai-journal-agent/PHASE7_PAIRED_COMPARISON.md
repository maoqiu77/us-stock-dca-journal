# Phase 7.2 配对评测记录

Updated: 2026-10-01 (Asia/Shanghai). This is a new synthetic paired run under a separate authorization. It does not replay either prior unknown or truncated request.

## Authorization and Fixture

- User authorization: at most **5 model requests / 1 CNY**, only synthetic data.
- Fixture: `storage/templates/ai-journal-agent-phase7-paired.json`, ID `phase7-paired-aapl-fractional-40-v1`.
- AAPL 2.75 shares, remaining unit cost 13.16 USD, frozen quote 18.40 USD, 40 closed daily bars ending 2026-09-29 20:00 UTC.
- Expected values: holding cost 36.19 USD, market value 50.60 USD, observed USD weight 1, MA5 38, MA20 30.5, MA60 null.
- Trade date 2021-04-19, note version 2026-08-24. Initial reason writing time, cash, account-wide weight and fundamentals remain unknown.
- All inputs were synthetic. No original holdings, diary bodies, account identifiers or private records were sent. The original API and Web services were not switched.

## Offline Preparation

- `--prepare-only --phase7-paired --request-limit 5` completed with zero requests and reused the already verified capability record without probing.
- Semantic harness regression: **9/9 passed**. It verifies the new fixture, 5-request admission, 120-second legacy timeout, frozen inputs and no automatic replay.

## Actual Run

Command, executed once:

```sh
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py \
  --real --phase7-paired --request-limit 5
```

Receipt workspace is ignored local data: `storage/local/deepseek-verification-qvfe5bha`.

| Measurement | Agent | Legacy |
| --- | --- | --- |
| Requests | 4 | 1 |
| Result | Succeeded | Received output, `finish_reason=length`; invalid/truncated |
| Tools / archived sources | 7 / 8 | 0 / 0 |
| Duration | 11.090 s | 29.465 s |
| Input / output tokens | 14,677 / 2,204 | 3,773 / 6,144 |
| Cached input tokens | 9,728 | 256 |
| Reported model | `deepseek-flash` | `deepseek-flash` |

All five reservations were consumed. The legacy response hit the 6,144-token output cap and raised the harness truncation error after receipt. Its answer was not archived as valid and was not retried. Admission closed with `stopped_no_replay`.

## Agent Review

Manual review used the stored report, source payloads and calculation parent IDs:

- Holding cost **36.19 USD** for 2.75 shares at 13.16 USD unit cost.
- Market value **50.60 USD** at the 18.40 USD observed quote.
- Weight **1** only within the observed USD holding; cash and account-wide weight remain unknown.
- MA5/MA20/MA60 **38 / 30.5 / null** from the 40 final bars.
- Trade date, note version time and last-bar cutoff are distinct. The report correctly says first writing time cannot be determined.
- Service retention and profit quality remain unverified because no fundamentals source was present. Price, market value and moving averages were not used as proof.
- All 8 report citation IDs resolve to archived sources. Both derived calculation records reference archived position/quote or series parents. `report_schema_valid=true` and `unobserved_citation_count=0`.

The Agent result passes the numerical/source review for this one synthetic case. It does not prove broad semantic entailment or Agent superiority.

## Cost and Limits

Using the already documented public Flash pricing assumptions, the combined token estimate is approximately **0.08-0.09 CNY**. Actual provider billing is not independently verified. This remained within the authorized 1 CNY reservation.

The paired quality/cost comparison is incomplete because the legacy answer is truncated. The prior unknown request remains sealed. This run does not validate external provider cancellation, broader held-out answer semantics or release readiness.

## Final State

- No automatic retry, replay, provider fallback or protocol switch.
- No temporary server or browser was started; canonical 3000/8000 remained healthy.
- Final Python 3.12 API regression after the new harness tests: **322/322**; Web remains **91/91**.
- No private data, commit, push, deployment or release action.
- Phase 7.2 real execution is stopped. Further model calls require a new explicit authorization.

## Follow-up Offline Reliability

After the paired run, the existing loopback reliability suite passed **3/3** and the full API suite passed **322/322**. No external provider fault injection or new model request was made.
