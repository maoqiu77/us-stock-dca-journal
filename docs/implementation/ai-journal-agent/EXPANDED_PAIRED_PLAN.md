# Expanded Paired Evaluation

Updated: 2026-10-01 (Asia/Shanghai). Real execution and manual review complete.

## Expanded Cohort Result

- Workspace: `storage/local/semantic-review-ewongao4`; fixture hash and prompt hashes are retained in `verification.json` and `comparison.json`.
- All **60/60 pairs** completed with reported usage: **193 requests** total, 133 Agent and 60 legacy. No truncation, unknown result, failed execution or missing usage occurred; no request was replayed.
- Manual review covered all **120 answers**. Agent passed **56/60 (93.33%)**; legacy passed **60/60 (100%)**. Agent's four failures were run-limit answers with no substantive response, one each in business conditions, note time, contradictory sources and multiple sources. Each affected category remained **4/5**, meeting the predeclared per-category minimum.
- Paired outcomes: **56 both pass**, **4 legacy-only pass**, **0 neither pass**. Critical issues: **0**. The frozen semantic gate is **passed** for this synthetic cohort.
- Reported usage: Agent **569,628 input / 78,839 output tokens** across 133 requests; legacy **138,656 input / 32,823 output tokens** across 60 requests. Median/p95 durations were Agent **7,309.5 / 12,189 ms** and legacy **2,982 / 8,422 ms**. These are measured configuration-specific values, not a cost or quality superiority claim.
- The result supports closing the limited semantic-sample blocker for original-memory boundary behavior. It does not establish model superiority, live portfolio/market reliability, broad field generalization or upstream cancellation/billing behavior.

## Corrected Comparison Baseline

A complete Agent/legacy comparison exists. The preserved MSFT fixture `release-paired-msft-consistent-45-v2` produced two complete answers on identical frozen sources and question. Its manually reviewed receipt is `storage/local/deepseek-verification-lanogzvf/review.json`. Rechecking the original answers, eight Agent sources and calculation parents confirms:

| Check | Agent | Legacy |
| --- | --- | --- |
| Quantity 4.75 / unit cost 11.28 USD / total cost 53.58 USD | Pass | Pass |
| Quote 45 USD / market value 213.75 USD | Pass | Pass |
| Observed USD subset weight 100%, account weight unknown | Pass | Pass |
| MA5 43 / MA20 35.5 / MA60 unavailable with 45 bars | Pass | Pass |
| Trade date vs note version vs unknown reason-writing time | Pass | Pass |
| Missing cash and business evidence remain unknown | Pass | Pass |

Agent used four requests, eight tools and eight sources, 15,324 input / 2,664 output tokens, and 13,278 ms. Legacy used one request, 4,284 input / 3,439 output tokens, and 14,624 ms. Both reported usage. These are measured single-case values, not latency or cost superiority evidence. Agent included an unsupported fee-category example; the earlier review preserves it as a minor wording issue.

The preceding IBM pair also completed, but had semantic faults and inconsistent fixture prices. It stays in the failure inventory and is not replayed or silently counted as a pass. Older truncated/unknown attempts remain sealed.

**Conclusion:** both engines passed the specified numerical/source checks on one consistent synthetic case. There is no supported broad winner. A comparison can conclude a tie or a tradeoff; proving an Agent winner is not a release requirement.

## Frozen New Cohort

Fixture: `storage/templates/ai-journal-agent-expanded-holdout.json`.

- 60 new cases, 65 new originals, 12 categories with five cases each.
- IDs and exact original texts are disjoint from baseline, Phase 7 held-out and targeted v2 fixtures.
- 50 positive cases and 10 no-match/filter cases.
- Production candidate freezing and BM25 Recall@5: **0.93**, with all 10 negative/filter cases empty and forbidden sources absent. Four positive cases have incomplete top-five recall; retain these findings.
- Required claims and forbidden claims are authored before model execution. No provider answer or prompt tuning informed this new cohort.
- Scope is original-memory semantics, including language and evidence boundaries. This does not newly validate live portfolios, multiple-position calculations, news adapters or market-provider reliability.
- This is a stratified synthetic sample. Related cases are not independent real-user trials; do not pool tuned v2/v3 results into its pass rate.

| Category | Cases |
| --- | --- |
| Business conditions vs verified company facts | 5 |
| Missing numbers vs thresholds or observed values | 5 |
| Trade dates vs reason-writing time | 5 |
| Note version vs first writing or market time | 5 |
| Ownership and attributed opinions | 5 |
| Permission words inside original text | 5 |
| Untrusted upload, key, order and source instructions | 5 |
| Contradictory originals and incompatible quantities | 5 |
| Multiple independent sources | 5 |
| Currency, cost, subset and account boundaries | 5 |
| Deleted, excluded, future, revised and unversioned sources | 5 |
| Unmatched identifiers | 5 |

## Review Method

Run each case against both production engines with identical frozen originals, facts, missing states and assumptions. Agent keeps its production four-call/eight-tool bounds and 6144 output tokens; legacy keeps its production 120-second timeout, 8192 output tokens and low reasoning effort. Record these differences instead of claiming configuration equality.

Alternate engine order across cases. Save the dataset hash, both prompt hashes, input identity hashes, model identity, all request usage and durations. Reserve a whole five-request pair before admitting a new case; a smaller remaining allowance is left unused.

Every answer is reviewed manually for source support, time/currency/scope meaning and question coverage. Each dimension is pass, partial or fail. Review all substantive claims, not just citations. Require answer hashes, reviewer identity, evidence notes and issue severity. Unreviewed fields stay null. The review compiler rejects changed answers/prompts/inputs and never infers semantic success from execution or retrieval.

Report per-engine and per-category pass counts, both-pass/one-pass/neither-pass pairs, input/output tokens, request counts and median/p95 durations. Usage absence or partial cohorts cannot close the gate. Token counts are directly comparable usage; estimated prices are separate from actual billing.

## Predeclared Gate

The new cohort meets its semantic gate only when:

1. All 60 pairs complete with usage and all 120 answers are reviewed.
2. Each engine fully passes at least 54/60 cases.
3. Each engine fully passes at least 4/5 in every category.
4. No critical unsupported financial/date/account claim, filtered-text exposure, instruction execution or fabricated citation is observed.

A partial is not a full pass. Gate failure remains failure; don't tune the prompt and rescore the same cohort as held-out. Corrections may be tested on a separately labeled regression set, followed by a fresh hold-out if needed. The gate records reviewed evidence and does not itself authorize publication.

## Admission and Stop Rules

The previous authorization allowed 115 requests; 111 were used. Four remain, which cannot cover this cohort. **No new paid requests have been made.**

Proposed additional allowance: **up to 300 requests**, with a conservative **50 CNY reservation**. At the checked peak Flash rates (2 CNY per million uncached input tokens, 8 CNY per million output tokens), the harness's 40 KB serialized input and at most 8192 output-token admission limits give a nominal all-limit estimate of 43.6608 CNY for 300 requests; 50 CNY includes margin. Tokenization/wire overhead and provider pricing/billing are not independently enforceable account caps. Expected usage is materially lower; actual usage must be recorded.

Pricing checked 2026-10-01: [official DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).

Stop the entire cohort on truncation, unknown outcome, failed execution, missing/invalid usage, configuration changes or admission exhaustion. Never retry or fall back to another protocol. Record incomplete pairs in the denominator and preserve their receipts. A subsequent execution needs a new explicit plan; old uncertain requests remain sealed.

The provider's processing/billing behavior after local cancellation is an accepted limitation. Retain the product disclosure and local no-replay controls.

## Prepared Artifacts

- Dataset and expected claims: `storage/templates/ai-journal-agent-expanded-holdout.json`.
- Zero-call production prepare receipt: `storage/local/semantic-review-3gjzzz_w/verification.json`.
- Manual review template: `storage/local/semantic-review-3gjzzz_w/review-template.json`.
- Execution script: `scripts/verify_ai_journal_semantics.py`.
- Offline compiler: `scripts/review_ai_journal_comparison.py`.

Approved execution would create a fresh isolated workspace. It reads the current verified provider configuration, uses only synthetic inputs, and leaves canonical 3000/8000 and the original database running. No service switch, commit, push, deployment or public release is part of this plan.

```sh
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_semantics.py --prepare-only --dataset storage/templates/ai-journal-agent-expanded-holdout.json --request-limit 300
# Run --real only after the new request limit and reservation are authorized.
```
