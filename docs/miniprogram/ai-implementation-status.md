# A0/A1 实施状态

- 日期：2026-09-12
- 报告基线：`d7920214ae2d4d0c8e62e802f1369f65083ca2ba`
- 本地核对：开始时 HEAD 正是该基线，分支 `codex/mobile-phase-0-1`，工作树无更晚修改
- 当前交付：基线之上的未提交 A0/A1 修改；未 reset、未提交、未推送、未上传、未审核、未发布
- 范围：只执行 A0、A1；A2 及之后没有实现

## 阶段结果

| 任务 | 状态 | 实际交付与边界 |
| --- | --- | --- |
| A0-01 基线与契约 | completed | 核对指定基线、AGENTS、现状和 J0；冻结 workspace v1、research v2、full backup v3，见 [ai-storage-adr.md](ai-storage-adr.md)。domain 金融语义未改。 |
| A0-02 本地迁移 | completed | 独立五分区、不可变 generation、manifest 校验、根指针待核验协议；旧 review 一次性迁入 personal_note，J0 pending 拦截、幂等、损坏和未知结果有自动测试。 |
| A0-03 复盘页面 | completed | 单段复盘升级为按日期的多条时间线；个人记录追加修订，AI 与交易为独立卡型，交易只读，AI 卡继续同一会话。旧 `saveReview` 仅为兼容回归保留，页面不再用它。 |
| A0-04 完整备份与恢复 | completed | v3 显式包含六类数据；兼容 v1/v2 导入并新建 workspace；恢复点、引用校验、容量拒绝和故障原文导出保留。 |
| A1-01 页面与会话 | completed | 五页签新增“AI 投研”，新增 conversation 页；持仓、投研、复盘复用同一引擎及 mode/journal date/workspace/client turn 身份。 |
| A1-02 计划与上下文 | completed | 复用 policy schema 的确认入口；从 domain 投影读取当前事实、选定个人记录和交易理由；显示预算、排除项和缺失信息；未持有研究代码需由独立本地目录确认。候选筛选明确不可用。 |
| A1-03 契约与 fake Provider | completed | ai-context v2 与 v1 分离；严格请求、最终 manifest、来源和结果引用；确定性 fake 支持成功、失败、超时、跨午夜和错误引用。所有视图保留 fake/demo 标识，真实 Provider 能力固定为未配置。 |
| A1-04 本地归档原型 | completed | run/message/source/journal ref 一体提交、重复响应幂等；分析后自动归档、同会话追问、再写个人记录的模拟器闭环通过。 |

## 修改范围

主要生产文件：

- `apps/miniprogram/src/journal/model.ts`
- `apps/miniprogram/src/workspace/repository.ts`
- `apps/miniprogram/src/workspace/backup.ts`
- `apps/miniprogram/src/ai/engine.ts`
- `apps/miniprogram/src/repository.ts`
- `apps/miniprogram/src/service.ts`
- `packages/ai-context/src/research-v2.ts`
- `packages/ai-context/src/index.ts`
- `apps/miniprogram/miniprogram/app.json`
- `apps/miniprogram/miniprogram/pages/research/*`
- `apps/miniprogram/miniprogram/pages/conversation/*`
- `apps/miniprogram/miniprogram/pages/review/*`
- `apps/miniprogram/miniprogram/pages/position-detail/*`
- `apps/miniprogram/miniprogram/pages/settings/*`
- `apps/miniprogram/scripts/build.mjs`
- `apps/miniprogram/package.json`、`package-lock.json`

新增/更新测试：

- `apps/miniprogram/test/workspace-journal.test.ts`
- `apps/miniprogram/test/full-backup.test.ts`
- `apps/miniprogram/test/ai-engine.test.ts`
- `apps/miniprogram/test/runtime.test.mjs`
- `packages/ai-context/test/research-v2.test.ts`

## 数据兼容与回退

- 金融主数据仍为 v2；J0 保存语义和待核验键保持原样。
- 新工作区为 v1；旧 `reviews` 迁入人工原文但不删除或改写金融快照。迁移映射和根指针防止重开时重复。
- 新导出为完整 v3；v1/v2 可继续导入，但只有金融数据和旧 review，导入后建立全新的 workspace instance。
- v3 恢复对 financial/workspace、manifest 和所有交叉引用先校验后替换。恢复失败保留当前数据；正常替换保留上一次金融与工作区恢复点。
- 回退旧代码前必须先私人保存 v3；旧代码不能理解或保留 chat/run/source/policy。安全的数据回退方法见 [ai-storage-adr.md](ai-storage-adr.md)。

## 微信工具实测

导入路径：`/Users/yaochengzhi/Documents/股票记录app/implementation/apps/miniprogram/dist`。

在 Stable 2.02.2608070、游客 `touristappid` 模拟器中重新编译，10 个页面和 5 个页签可打开。用已有合成 QQQ 账本实际完成：只读上下文预览（9 股、成本 951.00 USD，并明确缺现金/实时价/已确认计划）→ fake 分析 → 自动归档 → 同会话追问“还缺什么信息？”→ 复盘时间线显示两条 AI 引用 → 新增个人记录“个人记录：继续观察，不修改持仓。”。所有 AI 页面均显示离线合成/非真实 AI 标签。

这只证明桌面开发者工具中的离线流程。控制台仍有既有游客/SDK 错误，不能宣称零错误；未做真机、真实 AppID、文件选择/分享或云网络验证，也未使用或上传真实投资数据。

## 自动验证

最终验证结果以本文件末次更新为准：

| 命令 | 结果 |
| --- | --- |
| `npm run check:weapp` | passed：类型检查、1887.6 KiB / 10 页面构建、119/119 测试 |
| `npm run test -w @portfolio/domain` | passed：32/32 |
| `npm run typecheck -w @portfolio/domain` | passed |
| `npm run test -w @portfolio/ai-context` | passed：23/23 |
| `npm run typecheck -w @portfolio/ai-context` | passed |
| `python3 scripts/check_public_safety.py` | passed（本机没有 `python` 别名，使用 `python3`） |
| `python3 scripts/check_release_readiness.py` | passed |
| `git diff --check` | passed |

测试使用合成账本和内存存储。故障注入覆盖工作区迁移、J0 pending、根切换未知/安全重试、分区损坏、空间不足、备份引用、fake 失败/超时/跨午夜/错误引用和重复归档；没有在微信宿主中破坏真实存储。

## A2/A3 真实联调前需要用户准备

1. 自己有权限的小程序 AppID；每次构建后核对游客配置没有覆盖它。
2. 一个与小程序接入匹配的云开发环境、权限方式，以及明确的计费/额度上限。
3. 只选一个真实模型 Provider，准备 Base URL、API Key、模型名、协议说明、timeout 和最大输出。Key 只进入服务端秘密配置，不发到仓库或聊天。
4. 明确同意首版外发范围：当前任务相关持仓事实、用户主动选择的理由/笔记/目标和有限对话；默认不上传完整账户备份。
5. 一台实际手机，用于扫码、前后台、断网/恢复、键盘安全区和文件导入/分享验证。

A4 开放个股资料或候选筛选前，还要另行确定市场/研究数据源的权限、时效、成本、字段和候选池；模型 Provider 不能替代真实市场数据源。
