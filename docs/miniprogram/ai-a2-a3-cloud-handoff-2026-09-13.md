# A2/A3 云接入交接（2026-09-13）


## 续接更新（2026-09-13 13:50，优先于全部历史记录）

- 本轮只完成本地修复、回归、文档和开发版二维码生成；usage 实测、云配置落地、手机扫码验收仍未完成。无新增 DeepSeek 请求，无提交、推送、体验版上传或发布。
- 纠正旧结论：历史 ACK 后 status=succeeded/result=RESULT_ACKED 仅证明响应不可读；旧 CloudBase store 仍保留 ai_requests.envelope。不得再称全部输入正文已清除。
- 本地已修 ACK 输入残留、重复 ACK 失败和内存 store 的 ACK 后 result 行为；保留 responseDigest 审计字段，清除 envelope/response。历史已 ACK 云记录缺失 responseDigest，不能伪造摘要或绕过校验重 ACK。
- 本地 cleanup 已支持鉴权的 Timer.Message JSON token、严格 retention 校验、事务清除请求和 payload 两份正文、旧 ACK 输入清除及孤立 payload 分页。保留 usage/turn keys/隔离元数据；不清 running，不重试 Provider。独立复核发现的前100条阻塞后续孤立数据问题已补失败回归并修复。
- cleanup 配置决策：Node.js 20.19、256 MB、目标超时60秒、保留86400000毫秒（请求 createdAt 起24小时）、每小时一次。**仅为目标，尚未在云端保存**；token 不落仓库、不在聊天输出，cleanup 不配置 DeepSeek Key。
- 本轮完整验证：gateway 20/20、小程序125/125、ai-context26/26，类型检查和构建通过；两份 bundle SHA-256 为 `a6121b7a7ab63ccbfb573d8de41538cedf50ba7405140bbdf9888a196063ff62`；cleanup 打包源码一致；diff空白检查通过，406文本文件凭据模式扫描无匹配。
- **本地新 bundle 尚未部署。云端仍是历史01:00部署的旧版（旧hash见历史记录），不得把本轮测试当云端修复证据。**
- 开发者工具原生“工具→预览”成功生成二维码，包1912 KB，界面有效期至2026-09-13 14:14。手机是否扫码启动尚未确认。预览包含临时开发代码传输，未点“上传”体验版或发布。
- 云数据库入口未能由当前AX界面找到，截图工具返回 unavailable；已请用户打开云开发数据库查询台。只读检查需在输出前投影安全字段，不能显示原始owner/OPENID、envelope、payload或response。
- 额度按UTC日期计数：上海凌晨的历史调用属于UTC 2026-09-12，核对当日2026-09-13时也需检查前日桶，不能直接断言当天3次。
- A3额外待修：页面缺少 status-only outbox恢复入口；submitPrepared的catch在ACK失败时可能将saved降级。这些未在本轮云清理补丁中改动，不能标成真机已通过。

## 安全与工作区边界

- 仓库：`/Users/yaochengzhi/Documents/股票记录app/implementation`
- 分支：`codex/mobile-phase-0-1`
- HEAD / 本轮复核基线：`e2e517cea84ec3c9b9236ba90d856ce596463efe`
- 工作区包含大量未提交 A2/A3 修改。不得 reset、checkout 覆盖、提交或推送；先运行 `git status --short` 并按现状继续。
- 不在聊天、仓库、日志或命令输出中记录 `DEEPSEEK_API_KEY`。Key 已由用户在云控制台输入，仅由 `portfolioAi` 服务端环境变量读取。
- 范围仍限 A2/A3：不做 A4 行情/候选池，不重写 Web/FastAPI，不发布小程序，不上传真实投资数据。

## 已确认的云资源

- 小程序 AppID：`wx850752552846e9ef`
- 完整云环境 ID：`cloud1-d5g33e5bq6574da06`（`cloud1` 只是界面名称）
- 私有本地绑定：`apps/miniprogram/config.local.json`（gitignored）
- `portfolioAi`：已部署，Node.js 20.19，使用“云端安装依赖（不上传 node_modules）”。
- `portfolioAiCleanup`：已部署；控制台最后看到的运行时是 Node.js 16.13，需要决定是否统一升级到 Node.js 20.19。它不需要 DeepSeek Key。
- 私有集合（控制台均为 `[ADMINONLY]`）：`ai_requests`、`ai_payloads`、`ai_usage`、`ai_access`、`ai_turn_keys`。
- 索引：`ai_payloads.expiresAt`，升序、非唯一，名称 `expiresAt_1`。
- 当前许可主体哈希：`89a30cd7e47c0d1e16c6e24430e805082d088915e725248f0d07ee522c9be5e7`。`ai_access` 中已有同 `_id`、`enabled=true`、`consentVersion=1` 的记录。不要删除另外三条旧记录，除非用户明确确认。

## portfolioAi 当前配置

环境变量名称：

- `AI_ENABLED`
- `EXPECTED_WEAPP_APPID`
- `AI_PROVIDER`
- `AI_PROTOCOL`
- `AI_BASE_URL`
- `AI_MODEL`
- `DEEPSEEK_API_KEY`
- `AI_TIMEOUT_MS`
- `AI_MAX_OUTPUT_TOKENS`
- `AI_DAILY_REQUEST_LIMIT`
- `AI_MAX_INFLIGHT_PER_USER`
- `AI_MAX_INPUT_BYTES`
- `AI_MAX_PREPARE_WINDOW_MS`
- `AI_BYOK_ENABLED`

已核对的非秘密值：`AI_ENABLED=true`、AppID 如上、provider `deepseek`、protocol `openai-compatible-chat-completions`、base URL `https://api.deepseek.com`、model `deepseek-flash`、timeout `35000`、output tokens `800`、daily requests `10`、per-user inflight `1`、input bytes `200000`、prepare window `600000`、BYOK `false`。

最终 capabilities 已从小程序上下文验证：`enabled=true`、`authorized=true`、`providerConfigured=true`、`credentialMode=sponsored`、`byokEnabled=false`，额度与上面一致；接口只返回主体 SHA-256，不返回原始 OPENID。

## 真实 DeepSeek 验证证据

使用空持仓合成快照完成了一次最小真实调用，没有发送真实持仓、笔记或交易：

- request ID：`7dcd66e0-5999-4042-a905-da3614cb1446`
- payload digest：`91b36a93b572bb1de5763de86309a400eb803a9404ab704bd69f29109ed4522c`
- response digest：`9091d7850fff31ebeaff8f96d8513e9bad0385cf2e46a0ac019ed79106498565`
- 状态：`succeeded`
- Provider：`deepseek`
- 模型（供应商响应实际标记）：`deepseek-flash`
- 协议：`openai-compatible-chat-completions`
- credential mode：`sponsored`
- 用量：input 774、output 405
- stance：`insufficient_data`
- 没有 fake 标记或 fake 回退。

此前有两次最小合成请求失败并进入 `outcome_unknown`；其中一次是因为上传了 `apps/miniprogram/dist/cloudfunctions` 中尚未同步的新 bundle。它们按设计不会自动重试，且应已计入当日额度。不要复用失败 request ID 发起生成。

成功请求已完成 ACK 验证：ACK 前 status/result 可读且摘要匹配；ACK 返回 `acknowledged=true`；ACK 后 `status=succeeded`，`result -> RESULT_ACKED`。这证明云端响应不可读、请求审计状态仍可读，但并未证明 ai_requests 中输入 envelope 已删除（见顶部纠正）。无需再发起付费模型调用。

## 本轮最新代码状态

已经实现并测试过的关键修正：

- `apps/ai-gateway/src/providers/deepseek.ts`：显式 JSON 语义契约；服务端强制写入 `schema_version/request_id/classification/mode`；模型不能伪造协议元数据；畸形语义归一为 `PROVIDER_RESPONSE_INVALID`。
- `apps/ai-gateway/src/credentials.ts`：默认 sponsored 模型改为用户指定且真实响应验证过的 `deepseek-flash`；BYOK 只保留 resolver/类型/关闭开关，没有客户端 Key UI 或不安全持久化。
- `apps/ai-gateway/src/cloudbase-store.ts`：兼容 CloudBase 单文档 `data: []` 返回；允许仅使用哈希 `_id` 的访问记录，存在 owner 时仍校验。
- `apps/ai-gateway/src/handler.ts`：capabilities 只暴露 `principalHash`，不暴露 OPENID。
- `apps/miniprogram/src/workspace/repository.ts`：新增早期本地 workspace v2 兼容读取，只从 run 已保存的 evidence/counterargument/candidate `source_ids` 恢复缺失列表；不制造来源，不放宽外部 v4/v3 备份。
- `apps/miniprogram/miniprogram/pages/settings/*`：完整备份文案已升级到 v4。

最终 gateway 检查已包含 `deepseek-flash` readiness 回归，13/13 通过；新 bundle 已构建、哈希核对并部署。部署后 capabilities 复检与既有成功请求的 status/result/ACK 验证均通过。

本地 workspace v1/v2 迁移回归已重跑通过，外部 v3/v4 备份仍严格。新 dist 已在不清空存储的情况下重新编译；模拟器的 `source_ids` 错误已消失，旧交易、个人记录、会话、分析与来源快照仍存在。

## 下一窗口按最新事实继续

1. 保留所有未提交修改，读取本文件顶部、status、ADR和cloud setup，再检查git status；不要重复已完成的旧数据迁移或清空存储。
2. 先在云数据库查询台只读核对 ai_usage 的UTC当日/前日计数与 inflight，并投影 ai_requests 的 requestId/state/digest/workspaceId/clientTurnId/日期和隔离字段的存在/一致性布尔结果；不输出原始owner，不展开正文。实际值记入status。
3. 本地补丁已可审阅，但用户禁止未经授权上传。取得云函数代码上传的明确授权后，核对本地/打包hash并部署新的 portfolioAi 与 portfolioAiCleanup，不能仅改环境变量就声称修复生效。
4. 按cloud setup落地cleanup目标配置、秘密token及Timer.Message、查询索引；鉴权token由用户安全输入。确认清理对象范围后验证仅过期正文被清除、usage/审计状态保留。不要再次调用DeepSeek。
5. 处理status列出的A3恢复实现缺口，再执行手机清单。二维码过期可重新“预览”，不要点“上传”体验版。真实AI页面调用要事先说明一次新模型调用并取得用户意向。
6. 修改代码后按需重跑gateway/weapp/ai-context检查、bundle一致性、diff空白及敏感模式扫描；更新实际事实，不沿用历史测试计数或旧hash。

## 已知剩余问题

- usage实际计数和请求隔离仍未实测；不能用历史3次调用推导当前UTC日计数。
- cleanup云端配置和本轮代码部署未完成，旧函数仍没有token且不支持Timer.Message。
- 原始ACK留下的输入仍需新cleanup在保留期后清除；旧记录已丢失的responseDigest不能凭空恢复。
- 本地恢复入口/ACK失败后saved降级问题待修；真机断网、前后台、长输入、额度耗尽、outcome_unknown及本地归档/ACK顺序未验收。
- 没有新增Provider调用，没有提交或推送，没有体验版上传或发布。
