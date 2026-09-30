# AI 日历与研究衔接实施计划（B 包）

- 日期：2026-09-30
- 状态：用户已于 2026-09-30 授权实施；验收结果另见 B 包验收记录。
- 依据：`docs/superpowers/specs/2026-09-29-market-board-ai-journal-migration-design.md`、已验收的 A 包及 `docs/market-board-acceptance.md`。
- 范围：持仓分析、跨市场标的快研、逐轮快照与追问、个人手记、历史回看、看板跳转和量化报告关联。不改旧交易账本、量化 quick/deep 内部流程或完整多币种记账。

## 1. 实施前确认的代码边界

- 看板以 `US:XNAS:AAPL:STOCK` 等稳定 key 标识标的；`/api/market-board/detail` 返回分字段来源、时间和质量。`/capabilities` 当前只为美股返回 `1d` 与 `1mo/3mo/1y`，国内分钟 K 线仍不可用。不能把 API 接受某个周期参数误当作该周期有真实数据。
- 旧 AI 日历由 `modules/ai_advice.py` 将每天一条记录写到 `app_state.ai_advice_v1`。新会话不能写入这一 key，否则同日多任务会覆盖旧记录。旧 `GET /api/ai-advice`、生成与追问接口继续可用。
- 现有模型设置和 `call_openai_compatible_completion` 在服务端持有密钥。新任务复用这条调用链，不将密钥、完整账本或数据库发给浏览器或模型。
- 量化 `POST /api/quant-analysis/runs` 会启动任务；其解析器当前只支持 Yahoo 可识别的美国个股和 ETF。看板的国内 ETF、A 股及基金不能仅凭代码格式获得量化入口。
- 参考项目 `/Users/yaochengzhi/Documents/股票记录app/implementation` 只读。原小程序的国内基金跳转没有授权基金行情上下文；B 包必须从本项目看板契约重新组装基金事实。

## 2. 先固定的服务契约

### 实施前代码核对修订（2026-09-30）

- 量化请求没有“问题”字段。为遵守不改 quick/deep 内部流程的边界，问题只在配置页显示并保存在日历关联，不注入量化提示词；量化资格调用现有服务端解析器核验，失败关闭入口。
- 旧账本没有逐笔币种，仅有账户基准币种。持仓范围只接受目录身份与账户币种一致的已选仓位，明确此限制，不计算跨币种总额；计划、交易原因、手记及历史轮次逐项选择。
- 追问统一先预览：可选择复用本会话已确认事实（明确显示原时间）或刷新事实；新问题及历史轮次选择仍绑定新快照，避免仅用旧 snapshot id 无法绑定新问题。每轮只发送所选历史，未选择的对话不自动上传。
- 数据库 B 包升级使用独立事务和 SQLite backup，避免沿用 A 包 executescript 的隐式提交行为；新表使用 ai_journal_ 前缀。失败重试复用同一幂等键；进程中断的轮次在租约超时后显示为失败，必须重新预览，不自动重复外部调用。
- 国内周期只有在身份、时间、复权、单位及收盘状态全部验证后开放；候选源失败则保留报价/净值快研，不新增未验证 K 线适配。

新模块建议放在 `apps/api/app/modules/ai_journal/`，路由前缀 `/api/ai-journal`。输入模型 `extra='forbid'`，标的只传 catalog key，不接受浏览器传来的价格或净值作为事实。

| 请求 | 目的与结果 |
| --- | --- |
| `GET /capabilities?key=...` | 返回快研可用事实种类、已验证周期、缺失原因及独立的量化资格；基金只给净值/披露能力。资格由服务端核实身份和数据源，不由 UI 猜测。 |
| `POST /preview` | 输入 `task_type`（`portfolio_review`/`instrument_research`）、问题、可选 key、主/辅助周期、可选数量/成本/最大持仓及显式的上下文勾选项。返回 `snapshot_id`、规范化输入摘要、事实清单、缺失项、来源/观察时间/质量、预览摘要、模型标识及过期时间；不调用模型。 |
| `POST /sessions` | 用户确认时只交 `snapshot_id`、预览摘要哈希与幂等键。服务端核实未过期、模型与输入未变、快照未被替换，再按该快照调用模型；返回会话与首轮状态。 |
| `POST /sessions/{id}/turns` | 仅沿用已确认事实的追问可引用原快照；若新增行情或私有内容，先走 `/preview` 生成新快照。逐轮保存实际引用的快照与确认范围。 |
| `GET /calendar`、`GET /sessions/{id}` | 按北京时间日期列出旧日历记录、新会话、手记和量化关联；旧记录只读适配，不迁移覆盖。 |
| `POST/PUT/DELETE /notes` | 手记显式保存、修改和确认删除；删除后保留历史快照已引用的内容副本及删除标记，不无声改写旧 AI 依据。 |
| `POST /quant-links` | 仅关联用户从配置页明确启动后的量化 run id；读时核实报告存在，已删除显示“原报告已删除”。 |

`/preview` 的规范化请求摘要绑定任务类型、key、问题、周期、参数、每项私有上下文选择和模型标识。建议预览 5 分钟内有效；行情本身的时效另由观察元数据判断。过期返回稳定 `snapshot_expired`，输入或模型变化返回 `preview_changed`，不在确认时静默重新抓取事实。调用超时或模型失败保留待重试轮次和快照，不标记完成；幂等键防止重复点击产生重复会话。

## 3. 数据与隐私门槛

1. 预览服务端从 `BoardService` 取报价、净值、参考值、限额和披露。`sample`/`missing` 仅进入“不可用或示例”说明，不进入模型的真实市场事实；`stale`/`partial` 只有携带原观察时间和限制时才可作为历史/参考信息，不能描述为实时。ETF 供应商参考溢价不得写成同步 NAV 溢价；基金正式净值不得写成盘中价格。
2. 股票/ETF 的周期选择只展示经数据源验证的选项。主周期缺失直接拒绝确认，不自动切换；辅助周期不重复也不包含主周期。实施前先有界验证美股及沪深/A 股日线，再决定是否开放国内日线；分钟周期逐一验证已结束 K 线、时区、复权和成交量单位。未通过的周期保持禁用并说明原因。场外基金不用 K 线周期表单。
3. 持仓分析只读取旧账本能可靠标识为同币种/同市场的仓位；预览列出将发送的仓位与计划。币种或身份不明的记录列为排除项，不合并人民币和美元。单标的数量、成本、最大持仓是本轮假设，校验成本币种等于标的币种，不回写账本。
4. 手记、历史会话、交易原因默认不选；用户逐项选择并在预览中看到实际内容及长度。模型请求只使用已确认的摘要/事实，外部资料、旧回复和手记作为不可信数据处理。日志不得输出提示词、密钥、完整持仓或快照原文。
5. 快照保存为不可变的已确认事实、来源时间、范围和内容哈希；每轮保存快照 id、模型、状态、问题、回答与错误码。所有运行写入 `storage/local`，公开模板只放无个人信息的确定性测试样例。

## 4. 逐任务实施

### Task 1：能力矩阵与已验证行情

**文件**：`apps/api/app/modules/market_board/providers/bars.py`、`service.py`、新 `ai_journal/capabilities.py`；测试 `test_ai_journal_capabilities.py`、看板供应商测试；更新 `docs/market-board-provider-coverage.md`。

- 先用公开标的验证美股股票/ETF、沪深 ETF、A 股个股的日线；如有可靠分钟源，按周期分别记录覆盖、时间和失败行为。能力结果由已验证的数据种类和服务端资格判断，不用 `series` 路由可接受的枚举代替数据能力。
- 只在验证通过后补国内日线适配与对应 `capabilities`；不为追求表单完整而填样例 K 线。测试主周期无数据、分钟未收盘、跨时区、基金禁用周期与量化仅限已支持美国标的。

### Task 2：独立存储与可恢复迁移

**文件**：`apps/api/app/core/database.py`、新 `ai_journal/migration.py`、`store.py`；测试 `test_ai_journal_migration.py`、`test_ai_journal_store.py`。

- 升级 `user_version`，建独立 `sessions`、`snapshots`、`turns`、`notes`、`quant_links` 表，按日期与会话建索引。旧 `app_state.ai_advice_v1` 不改。迁移前用 SQLite backup API 在 `storage/local` 做可恢复备份，迁移可重复运行且不覆盖已有记录。
- 测试旧库升级、重复升级、故障回滚、并发幂等键、手记删除标记、已完成会话快照不可变；备份和测试数据均留在临时目录或 `storage/local`。

### Task 3：事实预览和范围校验

**文件**：新 `ai_journal/models.py`、`context.py`、`preview.py`、`router.py`；测试 `test_ai_journal_preview.py`、`test_ai_journal_privacy.py`。

- 定义严格 Pydantic 契约、期限和哈希；按 key 从 catalog 重新加载身份，逐字段生成事实与缺失项，公开数据和勾选的私有上下文分别列出。预览落库后返回摘要，不暴露完整未选中的账本。
- 覆盖样例/缺失隔离、旧缓存时间、基金正式净值与渠道、ETF 不同步参考值、人民币/美元分离、A/C 份额、主辅周期冲突、输入变化和预览过期。用 mock 模型断言未选手记/历史/交易原因从未进入请求。

### Task 4：确认、模型调用与逐轮追问

**文件**：新 `ai_journal/service.py`、`prompts.py`、`router.py`；最小复用 `modules/ai_settings.py` 调用入口；测试 `test_ai_journal_service.py`、`test_ai_journal_api.py`。

- 首轮及追问只使用服务端保存的快照，明确输出事实、推断、风险、缺失。基金采用净值和披露提示词；无可靠行情时只允许一般性回答，不生成虚构价格或价位。每轮保留自己的事实版本。
- 先持久化待处理状态，再调用模型并原子写回结果；重复幂等请求返回同一轮。测试超时、失败后重试、无 AI 配置、模型设置变化、过期快照、并发确认与旧 `/api/ai-advice` 契约不变。

### Task 5：日历、手记和旧记录兼容

**文件**：新 `ai_journal/calendar.py`、`notes.py`、路由；前端 `apps/web/src/features/platform/views/ai-advice-view.tsx` 的记录区局部组件；测试 `test_ai_journal_calendar.py`、相应 Web 测试。

- 以北京时间聚合同日多会话、手记和量化关联；旧日期记录经只读适配展示，原有生成/追问/清空行为仍走旧接口。手记必须显式保存；删除需确认，已引用的快照仍可回看并标记来源手记已删除。
- 测试跨日边界、同日多记录、旧记录仍可读、手记删除后快照不变、无 AI 配置仍可写本地手记。

### Task 6：看板到快研的前端流程

**文件**：`apps/web/src/features/market-board/instrument-detail.tsx`、`platform/platform-workspace.tsx`、`platform/views/ai-advice-view.tsx`，新 `features/ai-journal/` 下的编辑/预览/会话组件及 API/状态测试。

- 看板“和 AI 聊聊”传稳定 key 与预填问题到 AI 日历，进入编辑区后停止；不自动预览、调用模型或写交易。编辑器按能力显示可用周期、可选持仓参数和上下文勾选；任何输入变化清除旧预览，发送按钮只在当前预览被确认时可用。
- 保留旧日历入口与历史。快速切换标的、取消请求、失败重试、刷新恢复已保存会话、390px 窄屏和键盘交互均作真实浏览器验收。实施前阅读本项目安装的 Next.js 客户端组件/动态导入文档。

### Task 7：量化配置跳转与报告关联

**文件**：新 `ai_journal/quant_links.py`、`platform/platform-workspace.tsx`、`quant-analysis/quant-analysis-view.tsx` 的最小预填参数；测试资格和关联回归。

- 只对服务端确认可由现有量化解析器研究的美国股票/ETF显示“深入量化研究”。跳转只预填 ticker 与问题并显示现有配置页；用户按现有启动按钮确认后才调用 `POST /api/quant-analysis/runs`。
- 用户从该入口启动后保存 run id 关联；读取时按 run id 查询，不复制量化报告。原报告删除时显示“原报告已删除”，且不把量化结论自动当成后续快研事实。国内 ETF/A 股/基金不显示虚假的可启动入口。

### Task 8：全量回归与 canonical 验收

**文件**：新 `docs/ai-journal-acceptance.md`；只在发现问题时改相应业务文件。

- 运行 `npm run test:api`、`npm run test:web`、`npm run lint`、`npm run check:public-safety`、`npm run check:release-readiness`，在隔离副本构建，避免覆盖运行中的 `.next`。检查变更路径、私有数据和 `git diff --check`。
- 在现有 `http://127.0.0.1:3000` 完成看板进入快研、预览与修改失效、确认、追问、手记、旧历史、报告关联、无配置/失败状态及 390px 验收。用隔离测试库和 mock AI 进行破坏性或隐私边界测试，不碰真实持仓与记录；服务需重启时先说明并征求同意。
- 记录真实源能力缺口、未完成的周期与失败状态；只有完整通过的市场/周期才标为可用。提交只包含 B 包代码、测试、公开文档，排除 `output/`、`storage/local/` 和自动生成文件。

## 5. 交付门槛

任务 1 的真实数据能力矩阵决定后续周期控件和量化资格。若国内日线无法取得可核实的完整 bar，国内股票/ETF 的周期快研不得伪称完成；允许保留已验证的报价/净值事实预览，并在验收中明确缺口。B 包整体完成以逐轮同快照、显式私有范围、旧记录兼容及 canonical 用户流程为准，不以模型返回文字作为单独通过依据。
