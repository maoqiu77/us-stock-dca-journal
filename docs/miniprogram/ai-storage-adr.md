# AI 日记工作区与完整备份 ADR

- 状态：A2/A3 历史真实合成请求已验证；本地 ACK/cleanup 修正已回归但未部署，usage/云配置/A3恢复和真机验收未完成
- 日期：2026-09-13
- 基线：`e2e517cea84ec3c9b9236ba90d856ce596463efe`
- 适用版本：小程序 `0.3.0`

## A2 版本升级决策

金融快照仍严格保持 v2，J0 待核验键、人工交易预览和确认流程不变。新工作区为 v2，新完整备份为 v4。已发布的 workspace v1 和完整备份 v3 继续由独立严格 schema 解析，不放宽 v3 的 `source_ids` 要求。

workspace v2 在原五个分区外增加 `outbox` 第六分区，且所有分区仍使用不可变 generation、manifest、pending before/next 和根指针回读协议。新键前缀为 `portfolio.wechat.workspace.v2`；v1 只读成功后在内存中迁移，再以 v2 新 generation 切换，不原地改写旧分区。

| 新增或变更实体 | v2/v4 含义 |
| --- | --- |
| source snapshot | 每次 prepare 生成不可变 UUID；分开保存 `origin_entity_id`、`origin_revision`、正文、时点与 SHA-256 `content_digest`。 |
| analysis run | `execution_kind: fake | real` 与 `data_mode: demo | personal` 分开；保存完整 final manifest、Provider 公开执行元数据与来源完整性状态。 |
| old fake run | 保留原记录并标为 `legacy_unverified`；不用当前账本或笔记伪造已丢失的历史来源。 |
| outbox turn | 固定 request/client-turn/message/run 身份、已确认 envelope、digest、状态、最后查询时间和恢复信息。 |
| full backup v4 | 明示包含 outbox；不含 Key、认证材料、服务端许可或云环境配置。 |

outbox 状态为 `prepared`、`submitting`、`running`、`outcome_unknown`、`remote_succeeded`、`local_save_pending`、`saved`、`failed`、`expired`、`detached`。只有本地根指针回读确认归档后才可 ack。导入 v4 时，所有非终态远程任务保留审计内容但改为 `detached`，清除远程绑定，不自动重发。迟到响应必须同时匹配当前 owner、workspace instance、conversation、request ID 和 payload digest，否则隔离。

v4 恢复沿用金融与工作区双恢复点。写入后回读未知时保留 pending，只能核验或重试原提交，不重建 prepare、不换 request ID、不再次调用 Provider。回退到不理解 v4 的代码前，必须私人保留 v4 和升级前 v3；旧代码不能保留 outbox 或真实 run 元数据。

## 决策

金融账本继续使用既有严格 v2 `Snapshot`、J0 待核验保存协议和 domain 计算。使用独立的本地工作区 v2，分别持久化 journal、chat、run、source、policy、outbox；AI 文本和对话不写入金融快照、交易事件或旧 `reviews`。所有持仓变化仍只能由现有人工预览、确认的账本流程产生。

新完整备份为严格 v4，显式声明并包含 financial、journal、conversations、analysis_runs、sources、policies、outbox 七类数据。v1/v2 备份仍可导入，导入时建立新的工作区实例，并把旧 `reviews` 一次性迁移为 `personal_note`；旧格式本身不会被伪装成“完整备份”。

## 版本、实体与引用

| 契约 | 版本 | 关键内容 |
| --- | --- | --- |
| financial snapshot | v2（保持不变） | portfolio、instrument、ledger revision、旧 reviews |
| workspace / partitions | v2 | instance、generation、migration；journal/chat/run/source/policy/outbox |
| journal entry | v1 | 稳定 `id`、追加式 `revision_id` / `parent_revision`、日期、类型、引用、分类 |
| conversation / message / run | workspace v2（run schema v2） | workspace 归属、client turn、execution_kind、data_mode、来源与 Provider 元数据 |
| research request/result | v2 | 与 ai-context v1 分离；严格 request、manifest 和引用校验 |
| full backup | v4 | financial v2 加完整 workspace v2，包含 outbox，明确排除凭据与云端配置 |

日记类型为 `personal_note`、`user_decision`、`trade_ref`、`analysis_ref`、`conversation_ref`。人工原文标记为 `user_original`，AI 引用标记为 `ai_reference`，交易只读引用标记为 `ledger_reference`。个人记录编辑会追加新修订，不覆盖原修订；时间线只展示当前 head。

`analysis_ref` 只保存到 run 的引用，不复制 AI 全文。run 指向 conversation，message 通过 conversation、run、parent message、client turn 建立关系。归档在同一次工作区状态提交中写入用户消息、AI 消息、run、source 和 journal 引用；重复的 run/message 身份只会得到已有结果，不产生第二份归档。

## 存储键与提交协议

当前固定键前缀是 `portfolio.wechat.workspace.v2`（旧 v1 前缀只用于迁移读取）：

| 键 | 用途 |
| --- | --- |
| `.root` | 当前已提交工作区的根指针 |
| `.previous` | 最近一次完整替换前的工作区根指针 |
| `.pending-v2.before` | 根切换前指针 |
| `.pending-v2.next` | 待切换的新根指针 |
| `.pending-v2` | 根切换提交屏障与 replacement 标记 |
| `.instance.<instance>.<revision>.<partition>` | 不可变分区正文 |
| `.instance.<instance>.<revision>.manifest` | 分区 key、字节数、校验值和 generation 清单 |

每次保存先生成并回读核验六个不可变分区，再写并核验 manifest，然后依次暂存 before、next 和提交屏障，最后切换 `.root` 并回读判定结果。根等于 next 才算确认成功；根仍等于 before 时只能重试同一个 next；无法读取或出现第三个值时停止新写入，不重新生成分析或修订。普通提交确认后尽力清理不再引用的旧 generation；清理失败不反转已确认结果。

旧 J0 金融账本存在 pending 时，工作区迁移和基于账本的写入被阻止，必须先使用既有“核验保存结果/安全重试原提交”。工作区 pending 独立提供核验和安全重试，二者不会互相冒充。

## 迁移、恢复与回退

首次读取且没有工作区根指针时：

1. 先要求金融账本已有稳定 portfolio/device 身份，并确认 J0 没有 pending。
2. 生成新的 workspace instance。
3. 按旧 review 日期迁入 `personal_note`，保存日期到新 entry ID 的迁移映射。
4. 用根指针协议提交；之后只读取该根，不再次迁移，因此重开不会重复记录。

A0/A1 和 A2 开发过程中曾产生未带 run `source_ids` 的预发布本地 v1/v2 分区。最终版读取这种本地分区时，仅从该 run 已存 evidence/counterargument/candidate 引用重建来源清单，随后仍要求这些来源存在；外部 v3/v4 备份缺少该字段则严格拒绝，不走此兼容路径。两条本地兼容读取路径均有回归测试；模拟器验收状态见 A2/A3 状态文档。

导入 v1/v2 时先严格校验金融数据，准备新的 workspace 并迁移旧 review；导入 v3/v4 时同时严格校验 financial、所有工作区实体和交叉引用，再改写为新的 workspace instance。只有金融替换和工作区根切换都达到可核验状态后界面才报告成功。恢复前的金融快照和工作区根分别保留为恢复点。

回退时优先使用设置页“恢复上一次替换前的数据”。已经产生 v4 数据后，代码降级并不等于数据降级：先私人保存 v4 完整备份及升级前 v3。旧代码无法安全保留 outbox、真实 run 和 Provider 元数据。需要运行旧版本时，应在独立测试环境恢复升级前备份，保留当前环境的 v4，日后回到支持 v4 的版本再恢复。

## 容量、损坏与安全边界

- 每个工作区分区上限 800 KiB；恢复和提交会进行宿主容量预检，但仍以真实写入和回读为最终结果。
- manifest 保存每个分区的 UTF-8 字节数和内容校验；缺失、损坏、未知版本或引用不完整都 fail closed，不覆盖当前根。
- 文件导入正文不进入页面 `setData`；导入文件上限仍由页面限制控制。剪贴板仅适合较小备份。
- v4 是明文完整备份，明确包含交易、人工笔记、对话、AI 分析、来源快照和计划；只能私人保管。
- 离线演示使用确定性的 fake Provider，标签为“离线合成演示 · 非真实 AI / 非投资建议”。A2/A3 可显式配置云 transport，经服务端身份、许可和配额校验后调用真实 Provider；Key 只在服务端读取，失败不会静默切换 fake。真实行情仍未接入。
- 上下文是只读投影，只选择当前任务相关持仓事实、用户主动选择的笔记/理由和已确认计划。现金、实时价格和未确认目标保持缺失；AI 输出不能作为事实来源自证。

## 被否决的做法

- 不把 AI 结果写进 `Snapshot.reviews`：会覆盖/混淆用户原文并挤占金融账本提交空间。
- 不把 chat/run 合成一个自由文本数组：无法做引用核验、幂等归档和完整恢复。
- 不在 A0/A1 接真实模型、云端存储或市场数据：身份、预算、外发范围和服务端幂等属于 A2/A3。
- 不允许模型调用账本写入：AI 只给出带来源的解释，交易与目标仍需用户明确操作。


## 2026-09-13 收尾核对与正文保留修正

旧ACK接口的RESULT_ACKED只证明响应不可读；部署版ai_requests仍保存输入envelope。当前本地补丁将ACK处理统一为清除envelope和response，保留responseDigest、请求摘要、状态、隔离标识和ACK时间；严格匹配的重复ACK无需重读已删除的payload。已被旧版删除而未保留的响应摘要不自动推定，不绕过校验补ACK。

cleanup保留时间确定为服务器createdAt起24小时（AI_PAYLOAD_RETENTION_MS=86400000）。到期的非running请求在事务中清除两份正文；未ACK成功任务转expired，acked/outcome_unknown保持原审计状态。payloadPurgedAt防止已处理记录反复占用批次；孤立payload按expiresAt加保留期处理，并以_id游标分页。usage和turn-key不删除，防止清理绕过配额或幂等。运行中的超时任务需要单独核验，cleanup不擅自释放inflight或再次调用模型。

目标部署为Node.js20.19、256MB、60秒、每小时一次；Timer.Message携带JSON token并与CLEANUP_JOB_TOKEN严格匹配，不能只信任客户端可伪造的Type=Timer。无DEEPSEEK_API_KEY。本轮没有配置或部署这些云端变更；代码测试通过不构成云端清理证据。事务回滚/冲突重试和索引仍需真实云验证；大规模孤立数据扫描需在增长时引入可恢复运行游标。

usage按UTC日期分桶，上海凌晨历史请求不等于UTC当日额度。实际计数/隔离核对因云控制台入口未接入仍待完成。开发版预览二维码已生成（界面到期2026-09-13 14:14），但手机扫码、断网恢复、前后台、长输入、额度和归档/ACK流程尚未验证。源代码另有待修缺口：status-only outbox恢复入口缺失，ACK失败可能降级已saved任务。未新增模型请求，未体验版上传/发布或提交推送。完整本轮验证见status文档。
