# AI 日记工作区与完整备份 ADR

- 状态：A0/A1 已实现，A2 及之后未开始
- 日期：2026-09-12
- 基线：`d7920214ae2d4d0c8e62e802f1369f65083ca2ba`
- 适用版本：小程序 `0.2.0`

## 决策

金融账本继续使用既有严格 v2 `Snapshot`、J0 待核验保存协议和 domain 计算。新增独立的本地工作区 v1，分别持久化 journal、chat、run、source、policy；AI 文本和对话不写入金融快照、交易事件或旧 `reviews`。所有持仓变化仍只能由现有人工预览、确认的账本流程产生。

新完整备份为严格 v3，显式声明并包含 financial、journal、conversations、analysis_runs、sources、policies 六类数据。v1/v2 备份仍可导入，导入时建立新的工作区实例，并把旧 `reviews` 一次性迁移为 `personal_note`；旧格式本身不会被伪装成“完整备份”。

## 版本、实体与引用

| 契约 | 版本 | 关键内容 |
| --- | --- | --- |
| financial snapshot | v2（保持不变） | portfolio、instrument、ledger revision、旧 reviews |
| workspace / partitions | v1 | instance、generation、migration；journal/chat/run/source/policy |
| journal entry | v1 | 稳定 `id`、追加式 `revision_id` / `parent_revision`、日期、类型、引用、分类 |
| conversation / message / run | v1 | workspace 归属、入口、上下文模式、client turn、run、fake/demo 标记 |
| research request/result | v2 | 与 ai-context v1 分离；严格 request、manifest 和引用校验 |
| full backup | v3 | financial v2 加完整 workspace v1，范围声明全部为 true |

日记类型为 `personal_note`、`user_decision`、`trade_ref`、`analysis_ref`、`conversation_ref`。人工原文标记为 `user_original`，AI 引用标记为 `ai_reference`，交易只读引用标记为 `ledger_reference`。个人记录编辑会追加新修订，不覆盖原修订；时间线只展示当前 head。

`analysis_ref` 只保存到 run 的引用，不复制 AI 全文。run 指向 conversation，message 通过 conversation、run、parent message、client turn 建立关系。归档在同一次工作区状态提交中写入用户消息、AI 消息、run、source 和 journal 引用；重复的 run/message 身份只会得到已有结果，不产生第二份归档。

## 存储键与提交协议

固定键前缀是 `portfolio.wechat.workspace.v1`：

| 键 | 用途 |
| --- | --- |
| `.root` | 当前已提交工作区的根指针 |
| `.previous` | 最近一次完整替换前的工作区根指针 |
| `.pending-v1.before` | 根切换前指针 |
| `.pending-v1.next` | 待切换的新根指针 |
| `.pending-v1` | 根切换提交屏障与 replacement 标记 |
| `.instance.<instance>.<revision>.<partition>` | 不可变分区正文 |
| `.instance.<instance>.<revision>.manifest` | 分区 key、字节数、校验值和 generation 清单 |

每次保存先生成并回读核验五个不可变分区，再写并核验 manifest，然后依次暂存 before、next 和提交屏障，最后切换 `.root` 并回读判定结果。根等于 next 才算确认成功；根仍等于 before 时只能重试同一个 next；无法读取或出现第三个值时停止新写入，不重新生成分析或修订。普通提交确认后尽力清理不再引用的旧 generation；清理失败不反转已确认结果。

旧 J0 金融账本存在 pending 时，工作区迁移和基于账本的写入被阻止，必须先使用既有“核验保存结果/安全重试原提交”。工作区 pending 独立提供核验和安全重试，二者不会互相冒充。

## 迁移、恢复与回退

首次读取且没有工作区根指针时：

1. 先要求金融账本已有稳定 portfolio/device 身份，并确认 J0 没有 pending。
2. 生成新的 workspace instance。
3. 按旧 review 日期迁入 `personal_note`，保存日期到新 entry ID 的迁移映射。
4. 用根指针协议提交；之后只读取该根，不再次迁移，因此重开不会重复记录。

A0/A1 开发过程中曾产生未带 run `source_ids` 的预发布本地分区。最终版读取这种本地分区时，仅从该 run 已存 evidence/counterargument/candidate 引用重建来源清单，随后仍要求这些来源存在；外部 v3 备份缺少该字段则严格拒绝，不走此兼容路径。开发者工具原数据已实际验证可继续读取。

导入 v1/v2 时先严格校验金融数据，准备新的 workspace 并迁移旧 review；导入 v3 时同时严格校验 financial、所有工作区实体和交叉引用，再改写为新的 workspace instance。只有金融替换和工作区根切换都达到可核验状态后界面才报告成功。恢复前的金融快照和工作区根分别保留为恢复点。

回退时优先使用设置页“恢复上一次替换前的数据”。已经产生 v3 数据后，代码降级并不等于数据降级：先私人保存 v3 完整备份；旧版本只能读取它原本支持的 v1/v2，不能安全保留会话、分析和多条时间线。需要运行旧版本时，应在独立测试环境恢复升级前备份，保留当前环境的 v3，日后回到 0.2.0 再恢复。

## 容量、损坏与安全边界

- 每个工作区分区上限 800 KiB；恢复和提交会进行宿主容量预检，但仍以真实写入和回读为最终结果。
- manifest 保存每个分区的 UTF-8 字节数和内容校验；缺失、损坏、未知版本或引用不完整都 fail closed，不覆盖当前根。
- 文件导入正文不进入页面 `setData`；导入文件上限仍由页面限制控制。剪贴板仅适合较小备份。
- v3 是明文完整备份，明确包含交易、人工笔记、对话、AI 分析、来源快照和计划；只能私人保管。
- A1 只有确定性的本地 fake Provider，标签固定为“离线合成演示 · 非真实 AI / 非投资建议”。没有网络调用、Key、真实行情或模型；未配置真实 Provider 时不会静默生成伪装结果。
- 上下文是只读投影，只选择当前任务相关持仓事实、用户主动选择的笔记/理由和已确认计划。现金、实时价格和未确认目标保持缺失；AI 输出不能作为事实来源自证。

## 被否决的做法

- 不把 AI 结果写进 `Snapshot.reviews`：会覆盖/混淆用户原文并挤占金融账本提交空间。
- 不把 chat/run 合成一个自由文本数组：无法做引用核验、幂等归档和完整恢复。
- 不在 A0/A1 接真实模型、云端存储或市场数据：身份、预算、外发范围和服务端幂等属于 A2/A3。
- 不允许模型调用账本写入：AI 只给出带来源的解释，交易与目标仍需用户明确操作。
