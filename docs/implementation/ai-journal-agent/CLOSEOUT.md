# Phase 6 Closeout

Updated: 2026-10-01 (Asia/Shanghai). Phase 6 closed for this round; Phase 7 remains unopened.

## New Paired Case

Public synthetic fixture: `storage/templates/ai-journal-agent-closeout.json`, ID `phase6-closeout-msft-fractional-60-v1`. This is a new case, not a replay of the unknown NVDA legacy request. The previous request/result/usage remains sealed and unknown.

- MSFT 3.5 shares, remaining unit cost 7.24 USD, transaction quote 11.5 USD. Market value 40.25 USD, holding cost 25.34 USD, weight 1 within the observed USD holding only.
- Sixty weekday synthetic closed daily bars, close values 1 through 60, ending 2026-09-28 20:00 UTC. MA5=58, MA20=50.5, MA60=30.5. Split-adjusted bars are separate from the unadjusted valuation quote and do not establish actual profit/loss or fundamentals.
- Trade date 2019-03-12; note saved/modified version 2026-08-17. First writing time of the trade reason is unknown. Current cloud renewal/profit conditions, cash and account-wide weight remain unknown.
- Both engines use the identical question, private context, frozen quote/series, missing fields and source payloads. Engine/memory-mode metadata and snapshot IDs/times differ; prompts and tool packing remain different by design. Compare source content, numerical claims, dates, missing information, latency and reported usage. Citation membership alone earns no semantic pass.
- Agent production bounds stay four model calls, eight tools, 25 seconds per model call and 90 seconds total. Legacy uses its normal 120-second completion timeout; the old test-only 25-second limit is not reused. Both wire output bounds are 6144 tokens for this experiment, disclosed as a legacy test override. Different deadlines prevent treating completion rates as a fair broad reliability comparison.
- Existing ledger rounds trade amounts to cents. The fixture uses a cent-exact amount; initial 7.25 USD unit-cost preparation exposed normalization to another remaining-unit-cost value, and was replaced with 7.24 before any real request. No production ledger rules were changed.

## Executed Real Budget

The authorized limit was **five HTTP model requests**: four Agent requests plus one legacy request, with no capability probe. All **5/5** reservations were consumed and admission was closed. The actual JSON request limit was 40 KB and output limit 6144 tokens. This estimates token cost, not an independently enforceable provider billing cap.

Pricing checked 2026-10-01 against [DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/). Actual known usage and cache details will produce a disclosed cost range; unknown usage/cost remains unknown, never zero. The provider alias does not pin immutable model weights.

Credentials are read only from the original local configuration, before switching this standalone test process to a fresh ignored `storage/local` SQLite workspace. Original holdings, diary, account identifiers and private journal bodies are never loaded into the test prompt. Original database and canonical runtime are not switched by this command. No production sample provider is added.

```sh
# Preparation record; completed with zero requests.
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py \
  --prepare-only --closeout-comparison --request-limit 5

# Executed once under the authorization above; do not replay.
PYTHONPATH=apps/api storage/local/agent-dev-venv/bin/python scripts/verify_ai_journal_deepseek.py \
  --real --closeout-comparison --request-limit 5
```

Transport timeout/disconnection, terminal Agent failure or unknown outcome closes admission. No retry, second cohort, protocol/provider fallback, spent-budget reuse or unknown-run replay. Only received answers will be manually reviewed; a successful tool execution does not imply a successful semantic answer.

## Offline Transport Checks

`test_ai_journal_agent_http_faults.py` uses the actual production DeepSeek adapter, OpenAI SDK and LangGraph against an explicitly injected loopback HTTP peer. It sends no request to a real provider and uses no real key or private data.

- Partial HTTP body then socket closure: one request, terminal unknown transport, missing usage preserved.
- Actual HTTP read timeout: one request with a test-only 0.1-second SDK timeout, no SDK retry.
- Access cancellation during a waiting HTTP request: local await ends; the synthetic peer can still finish after cancellation. This demonstrates that local cancellation cannot establish upstream processing/charging stopped. Existing store/manager tests cover terminal persistence, duplicate confirmations and rejected late writes.

These are real local socket tests, not controlled failures at the external provider. External cancellation/billing behavior and broad model reliability remain unverified.

## Actual Results

The Agent completed four requests in one run: **8 successful tool calls, 8 archived sources, and a valid structured report**. Reported usage was 14,760 input tokens and 2,641 output tokens, including 9,856 cached input tokens and 972 reasoning tokens. The run took 13.464 seconds. Manual review checked source payloads and calculation parents, not citation membership alone:

- Holding cost: **25.34 USD** for 3.5 shares at 7.24 USD remaining unit cost.
- Market value: **40.25 USD** at the frozen 11.5 USD quote.
- Observed USD holding weight: **1**; cash and account-wide weight remain unknown.
- MA5/MA20/MA60: **58 / 50.5 / 30.5** from the 60 closed bars.
- Trade date, note version time and bar cutoff remain distinct. Initial writing time, fundamentals, renewal/profit conditions and real-time status remain unknown.
- `report_schema_valid=true` and `unobserved_citation_count=0`.

The legacy path made its single request and returned output with `finish_reason=length` at the 6144-token cap. Its `ValueError` result was not archived as a valid answer and was not retried. The request was received with 5,046 prompt tokens and 6,144 completion/reasoning tokens; provider billing is not independently verified. Estimated combined token cost is approximately **0.045-0.090 CNY**, while actual billing remains unknown.

This is a reviewed single synthetic fractional-position case. It demonstrates the Agent's numerical/source behavior on this fixture; it does not establish Agent superiority, a paired quality winner, or broad reliability. The previous unknown legacy request remains sealed and was not replayed.

## Final Verification

The isolated test workspace was closed. Canonical 3000/8000 were left on the normal project runtime: Next development mode on 3000 and the original-database Python 3.12 API on 8000. The `phase6-closeout` Playwright session was closed, and no temporary service or browser session remains.

- Python 3.12 full API suite: **319/319** passed.
- Web suite: **91/91** passed.
- Public safety, compileall, Bash syntax and `git diff --check` passed.
- No further model calls, private-data inference, commit, push, deployment or release action occurred.

Remaining limits are controlled upstream interruption/cancellation, broader held-out semantic coverage and a paired legacy answer for this closeout fixture. Phase 7 remains unopened.
