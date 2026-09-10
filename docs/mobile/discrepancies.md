# Phase 0–1 差异登记

执行依据：用户指定的 CODEX_MOBILE_IMPLEMENTATION_PLAN.md（M00–M27）。架构评审的长期建议不作为新增任务授权。2026-09-09 开始核查。

## D001 — 当前项目目录只有文档（已解决）

- 证据：原工作目录中仅有两份用户提供的 Markdown，`git status --short` 返回 128（not a git repository）。
- 只读查找确认相邻的 `股票交易平台-next` remote 为计划指定的 `maoqiu77/us-stock-dca-journal`，HEAD 精确匹配 `e661b1d1efce7b2e88d327e34eda0fe98199b859`，工作树干净。
- 处置：从该 HEAD 创建 `codex/mobile-phase-0-1` 分支，隔离 worktree 位于当前项目下 `implementation/`。没有复制原运行数据、改变原分支或操作旧 Streamlit 项目。
- 影响：下文所有仓库相对路径以 `implementation/` 为根；原两份文档保留在上级目录。

## D002 — 系统 Python 与 CI 不同（已解决）

- 证据：系统 `python3` 为 3.9.6；CI 配置为 Python 3.12。
- 处置：本机已有 `python3.12`（3.12.13），用它创建独立 `.venv`，后续 Python 检查使用 `.venv/bin/python`。未升级系统解释器或修改依赖范围。

## 文档范围差异（以实施计划裁定，无新增功能）

- 架构评审 §6 将流式/语音/提醒列为 Should；实施计划明确首版不要求流式，Future Backlog 将这些列入 Phase 2。本轮不实现。
- 架构评审 §7 将 Flutter 列为第二选择；M07 要求原生能力失败记录并停止，不允许自行换架构。本轮不切换技术栈。
- 架构评审 §10.1 提及第四层记忆契约、§13 提及本地聚合统计；实施计划没有对应当前任务，不据此新增摘要契约或统计模块。
- 根 AGENTS 的 sample 行情兜底属于现有 Python/Web；M12 明确 Mobile 无价为 unknown，仅手工/缓存估值。保留旧行为，Mobile 依计划执行。

## 已知代码差异核查

| 项目 | 当前源码证据 | 本轮处置 |
| --- | --- | --- |
| 平均成本旧文档 / FIFO 代码 | docs/design/legacy-feature-map.md 数据口径；trading_data.py derive_positions；trading-data.ts derivePositions | M01 留存，M04 保持兼容，M06 新模型 FIFO |
| Web 金额 4 位 / Python 2 位 | normalizeTradeInput；sanitize_trade amount round(..., 2) | M01 witness，不在抽取时统一 |
| 推导排序 / 校验输入顺序 | derive_positions sorted(date)；validate_trading_state 原数组遍历 | M01 最小案例；新模型显式序号 |
| 现金估算 | account_summary；dynamicCash | 不能当真实现金；M10/M17 用户确认 |
| 截图合成买卖 | replacePositionSnapshot；importPositionSnapshots | M17 期初切入，归档不重放 |
| 当日对话与覆盖 | ai_advice.py 当日 records/messages | 保留旧 Web；Mobile 独立会话 |
| privacyMode 未拦截 | ensure_external_ai_allowed 不使用 state；默认 external-ai-ready | M02 修复，不改变默认 |
| 隐藏图表/策略 | platform-workspace.tsx 未挂载 ChartWorkspace/StrategyView | 保留源码，不恢复导航 |
| quote 字段错配 | market.py changePercent；ai_advice.py 白名单 changePct/updatedAt | M12/M20 新契约 |
| 已有轻 Monorepo | 根 workspaces 仅 apps/web，Web 子 lockfile | M03 工具链；M04 小范围抽取 |

上述为源码核查；合成输入的运行验证与测试结果另记 baseline / M01，不把旧审查的测试结果作为本轮通过证据。

M01 已完成上述财务 witness：Python 17项/Web 74项通过。新增兼容性观察：旧 purchaseDate 在清仓再买时可沿用首次买入日期；M04 保留，不当作新模型的 lot 来源。仅补充旧口径记录，不扩大任务为历史修复。

## M02 隐私字段语义

local-only 拦截每日生成、追问、OCR、研究提交/恢复、反思及共同HTTP/SDK推理入口；错误为403。共同入口每次读取当前策略，协议重试前重查。既有 external-ai-ready 与未配置默认保持。

此旧字段仅控制 AI 推理，不声称关闭行情网络。用户主动触发设置页连接测试时，仍可查询模型和发送固定的两句公共探测文本；transport 只允许该精确固定内容例外，附加/替换私人文字即回到隐私检查，不提供任意内容绕过。

M03 检索发现 CONTRIBUTING.md:24 也包含旧安装命令，虽未在预期文件列表中单列，但属于 M03「更新所有安装引用」明确范围，已只改该命令。M02 新测试的虚构长 key 字面量触发旧扫描正则，改为短假值并重跑隐私9项/扫描通过；没有放宽扫描器。

## D003 — M07 原生工具链缺失（blocked）

完整 Xcode/simctl 与 Android SDK/JDK 均不可用，见 native-capabilities.md。按 M07「SQLCipher或安全transport不可达时停止并记录；不可明文降级」停止受影响链路。先准备候选壳与失败关闭门禁，保留两平台 blocked；不改为 Expo Go/浏览器证明或改架构。M18 只依赖 M05/M01，按依赖登记独立完成。M08–M17、M19–M27 尚未开始。
