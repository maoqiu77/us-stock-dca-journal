# AI provider settings implementation plan

**Goal:** Let beginners select an AI provider and enter a key; retain advanced custom endpoints and models.
**Architecture:** A backend provider catalog supplies frontend presets. Local version 3 settings keep independent provider profiles and a flattened active profile for existing consumers. One completion dispatcher supports Chat Completions, Responses and Anthropic Messages.
**Tech stack:** Existing FastAPI, requests/OpenAI SDK, Next.js, React Query and shadcn controls; no new dependencies.
**Spec:** Approved conversation design, with advanced fields collapsed for official providers.

## Constraints
- Work in this project only; preserve storage/local and masked public key responses.
- Reuse canonical hot-reload services at 127.0.0.1:3000 and :8000; no runtime restart.
- Third-party first, DeepSeek second, then Kimi, GLM, OpenAI, Claude, Qwen, MiniMax, SiliconFlow.
- Explicit protocols never silently fall back; automatic mode falls back only for unsupported endpoints.

## Tasks
- [x] Add behavioral tests in apps/api/tests/test_ai_providers.py: legacy migration, per-provider saved credentials, URL-change credential isolation, protocol dispatch, native Claude images and error handling. Run with PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p test_ai_providers.py.
- [x] Add apps/api/app/modules/ai_providers.py for verified presets and native message conversion; extend ai_settings.py and api_models.py with provider/protocol/profiles and public catalog. Tests must prove that saving only a DeepSeek key selects its official address and models and never reuses a custom key.
- [x] Pass provider/protocol through ai_advice.py, position_import.py, quant_analysis/execution.py and reflection.py, including repair requests. Update regression tests for deliberate fallback semantics changes.
- [x] Extend platform/api.ts types and ai-model-settings-view.tsx. Provider select first, password second for officials, custom address visible, models/protocol in expandable advanced section. Show short status text, keep draft profiles separate, provide model suggestions and optional discovered models.
- [x] Run affected backend tests, frontend tests/typecheck/lint, inspect diff. Verify official/custom switching, unsaved-key isolation, advanced settings and save/reload on canonical 3000 using synthetic intercepted settings so real saved credentials remain intact.


## Verification completed
- Backend: 155 unittest cases passed, including 17 provider/configuration/HTTP-contract tests. Synthetic settings tests use isolated in-memory persistence.
- Frontend: 60 tests passed. Type checking passed with `--allowImportingTsExtensions` for the repository's existing `.ts` test imports; ESLint passed on changed frontend files.
- Canonical 3000 browser: official/custom switching, independent unsaved keys, native Claude protocol, OpenAI Responses/Chat selection, synthetic test errors, intercepted save/reload, URL-change credential isolation, and 390px dropdown bounds verified.
- Browser save/test writes were intercepted; existing saved credentials were not changed. No actual vendor generation was performed with real credentials.
- Independent read-only review found no actionable bugs. `git diff --check` passed.
- Existing environment emits urllib3 LibreSSL and FastAPI lifecycle deprecation warnings; this feature introduces no dependency or configuration changes.

## Preset source references
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing/
- Kimi: https://platform.kimi.com/docs/get-api-key
- GLM: https://docs.bigmodel.cn/cn/guide/models/text/glm-4.7
- OpenAI: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- Claude: https://platform.claude.com/docs/en/models/overview
- Qwen: https://help.aliyun.com/en/model-studio/model-calling-in-sub-workspace
- MiniMax: https://platform.minimax.io/docs/token-plan/cursor (ordinary OpenAI-compatible API endpoint shown in the configuration example)
- SiliconFlow: https://docs.siliconflow.cn/docs/userguide/quickstart and https://www.siliconflow.com/models/qwen3-8b
