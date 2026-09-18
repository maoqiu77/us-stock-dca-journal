# CloudBase Collections and Index Review

All collections are server-only. This file defines the intended queries; it is not evidence that an index exists in the deployed environment.

| Collection | Identity / query | Required behavior |
|---|---|---|
| `ai_requests` | hashed owner + request ID; cleanup by `state, createdAt, payloadPurgedAt` | Private request identity and terminal-body cleanup |
| `ai_payloads` | same request hash; cleanup by `expiresAt, _id` | Private request body retention |
| `ai_usage` | hashed owner + UTC date | Per-user daily count and inflight |
| `ai_global_usage` | UTC date hash | Cross-instance global daily budget |
| `ai_access` | hashed owner | Enrollment and current consent version |
| `ai_turn_keys` | hashed owner + workspace + client turn | Idempotency |
| `market_access` | hashed owner | Closed-beta enrollment only |
| `market_cache` | provider/entitlement/feed/instrument/session/range/adjustment/schema hash | Shared public market cache within one entitlement domain |
| `market_leases` | same cache-key hash | Expiring holder-checked single-flight lease |
| `market_usage` | entitlement scope + UTC date hash | Cross-instance market budget |
| `market_receipts_private` | hashed owner + receipt ID; cleanup by `expiresAt, acceptedRequestId` and `retainedUntil, acceptedRequestId` | Owner-bound frozen quote bodies; never shared through the public cache |

Before deployment, create or verify the compound indexes requested by CloudBase for the AI payload and private receipt cleanup scans. Cache and lease expiry, holder matching, and budget reservations must be exercised against CloudBase transactions; local memory tests do not prove cloud transaction or index behavior.
