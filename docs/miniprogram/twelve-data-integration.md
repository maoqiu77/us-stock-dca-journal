# Twelve Data Integration Record

Reviewed: 2026-09-13. This is an engineering contract record, not proof of commercial entitlement.

## Approved-code boundary

- The server has a fixed `https://api.twelvedata.com` origin and authenticates with the recommended `Authorization: apikey …` header. Client input cannot select an origin, provider, credential, feed, entitlement domain, or endpoint.
- Implemented endpoints are `/symbol_search`, `/quote`, and `/time_series`. `/time_series` is fixed to daily bars, an allow-listed range, at most 400 returned bars, exchange-local dates, and `adjust=none` so the app does not silently mix split-adjusted history with an unadjusted ledger.
- `/splits` is documented as a separate corporate-actions endpoint costing 20 API credits per symbol and requiring Grow (individual) or Venture (business) or above. It is not called until its product entitlement and retention/display rights are confirmed. The client therefore displays the explicit limitation that corporate actions are not automatically verified.
- Official endpoint discovery, nullable fields, header authentication, rate-limit handling, and daily timezone behavior were checked against [Twelve Data API documentation](https://twelvedata.com/docs). The current endpoint reference lists `/quote` at 1 credit per symbol and `/symbol_search` at 1 credit per request; `/time_series` is also accounted per requested symbol. Official credit accounting states that endpoint weight is charged per symbol and resets per minute; actual account quotas remain server configuration, not code constants: [Credits](https://support.twelvedata.com/en/articles/5615854-credits).
- Stock daily bars are exchange-local and the timezone parameter is ignored for daily/weekly/monthly intervals. Intraday timezone behavior is documented separately: [Timezones](https://support.twelvedata.com/en/articles/5745849-timezones).

## Response and failure rules

- Search accepts only US/USD, America/New_York common stocks and ETFs with a valid MIC. Ledger UUIDs remain unchanged; unresolved, inactive, ambiguous, or asset-type-conflicting mappings do not receive a quote.
- Quote event time comes from the provider timestamp. Invalid/zero price, mismatched symbol/MIC/currency, invalid previous close, future clock, and malformed data are quarantined. No unavailable/error response is converted to zero.
- A current daily bar is marked unfinished before the New York regular-session close. Invalid or duplicate OHLC rows are rejected by the shared schema.
- Read requests make at most two total attempts. `Retry-After` is honored for 429; credentials and upstream response text are not placed in normalized errors or smoke output.
- Shared CloudBase cache keys include provider, entitlement domain, feed, instrument/range, adjustment, and contract version. Holder-checked leases merge equal quote refreshes. Minute and UTC-day budgets are transactionally shared across instances. Expired last-good quotes retain their original `received_at` and can only be served as stale.

## Live smoke

`npm run smoke:market -w @portfolio/ai-gateway` is the only live command. It requires explicit server environment values for the API key, feed, timeliness, coverage, attribution, and delayed-feed seconds. It queries only AAPL, QQQ, and an intentionally nonexistent symbol; it never reads a portfolio or runs during normal tests.

Current result: `blocked_by_configuration`. No Twelve Data key or confirmed product/feed entitlement is present. The entitlement checklist in `market-entitlement.json` remains authoritative, and all market feature flags must remain disabled until it is completed.
