# AIContext v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated Chinese AI advice prompt with a compact English `AIContext v2`, while preserving Chinese user text and requiring Simplified Chinese answers.

**Architecture:** Add pure normalization helpers beside the existing AI advice orchestration so daily generation and chat reuse one versioned context object. Keep API and persistence contracts unchanged; serialize only the normalized object into English prompts and budget the conversation messages sent to the provider.

**Tech Stack:** Python 3, FastAPI, unittest, existing OpenAI-compatible Responses/chat-completions client.

## Global Constraints

- Preserve `/api/ai-advice/generate`, `/api/ai-advice/chat`, and the saved AI record schema.
- Do not modify or expose `storage/local` private runtime data.
- Fixed prompt instructions, headings, enum values, and JSON keys use English.
- User questions, custom names, and free-text notes remain verbatim.
- Both system and user task instructions require `Respond in Simplified Chinese`.
- ETF MA60/MA120 and ordinary stop loss are background context and do not independently block funded drawdown purchases.
- Sample or unavailable data cannot support precise trigger prices.

---

### Task 1: Normalize account, strategy, trades, and market decisions

**Files:**
- Modify: `apps/api/app/modules/ai_advice.py`
- Test: `apps/api/tests/test_ai_advice_prompt.py`

**Interfaces:**
- Produces: `build_ai_context_v2(...) -> dict[str, Any]`.
- Produces internal helpers for normalized positions, trade aggregation, and ticker-keyed market decisions.
- Consumes existing summary, state, positions, settings, strategy config, risk config, quotes, signals, intraday context, and Beijing context.

- [ ] Add a failing test using literal fixtures that asserts version/language metadata, estimated-cash provenance, role-specific ETF policy, at most 20 recent trades, buy/sell enums, and one merged market row per ticker.
- [ ] Run `python -m unittest apps.api.tests.test_ai_advice_prompt.AiAdvicePromptTest.test_ai_context_v2_normalizes_and_merges_inputs -v` and confirm it fails because `build_ai_context_v2` is absent.
- [ ] Implement the smallest pure normalization layer that passes the fixture without changing API or persistence records.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Replace daily and chat prompts with compact English instructions

**Files:**
- Modify: `apps/api/app/modules/ai_advice.py`
- Test: `apps/api/tests/test_ai_advice_prompt.py`

**Interfaces:**
- `build_external_advice_prompt(...) -> str` serializes `AIContext v2` once.
- `build_chat_context_prompt(...) -> str` serializes the same context with a chat-specific English task.
- `daily_advice_system_prompt() -> str` and `chat_system_prompt() -> str` provide English system boundaries.

- [ ] Add failing behavioral tests that assert both prompt modes identify `AIContext v2`, contain `Respond in Simplified Chinese`, preserve a Chinese user question, omit legacy duplicated headings/raw full trade history, express ETF/stock priority correctly, and prohibit precise prices for sample data.
- [ ] Run the focused prompt tests and confirm failures against the current Chinese duplicated prompt.
- [ ] Implement shared English system/task text and serialize only the normalized context.
- [ ] Replace the inline Chinese system messages in daily generation and chat with the shared English helpers.
- [ ] Re-run focused prompt and provider payload tests; update old assertions only where the intended v2 contract replaced them.

### Task 3: Budget chat history and run adjacent verification

**Files:**
- Modify: `apps/api/app/modules/ai_advice.py`
- Test: `apps/api/tests/test_ai_advice_prompt.py`
- Verify: `apps/api/tests/test_ai_settings.py`
- Verify: `apps/api/tests/test_api_contracts.py`

**Interfaces:**
- Produces: `budget_conversation_messages(messages, max_chars=12000, max_message_chars=4000) -> list[dict[str, str]]`.
- Latest user question must be retained; initial daily report is represented by a bounded summary; old middle messages are removed first.

- [ ] Add failing tests with long literal messages that assert total sent history stays within 12,000 characters, each entry stays within 4,000 characters, truncation is marked, and the latest user question remains intact.
- [ ] Run the focused budget tests and confirm they fail because the helper is absent or chat still uses `[-10:]`.
- [ ] Implement deterministic budgeting and wire it into `create_ai_chat_reply` while retaining the full saved message list.
- [ ] Run `python -m unittest apps.api.tests.test_ai_advice_prompt apps.api.tests.test_ai_settings apps.api.tests.test_api_contracts -v`.
- [ ] Run `python -m compileall -q apps/api/app apps/api/tests` and `git diff --check`.
- [ ] Generate a v2 prompt from local runtime state and report only character counts and section counts, never private values.
