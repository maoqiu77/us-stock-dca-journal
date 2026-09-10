# 微信小程序 MP0 / MP1 优化执行记录

本轮仅执行 MP0、MP1；不执行 MP2 及以后阶段，不推送或发布。
需求来源：用户提供的 `WECHAT_MINIPROGRAM_REVIEW_AND_CODEX_PLAN.md`（2026-09-10）。

## 基线

- 分支：`codex/mobile-phase-0-1`，独立 git worktree。
- 起始 HEAD：`f5cca9092d36c8b2620e7e125b1a3cd8fea59248`，与审查 SHA 相同。
- 开始时 `git status --short` 为空，无用户未提交修改。
- Node `24.16.0`；复用现有已安装 workspace 依赖及唯一根锁文件，没有执行依赖更新。
- 基线 `npm run check:weapp`：类型检查、构建、22 项测试通过；主包 1790.6 KiB，5 页面。
- 基线 domain 测试 32/32、ai-context 测试 20/20，两个包类型检查通过。
- 没有读取本地真实投资数据、改动 3000/8000 服务或调用网络模型。

## 问题复现（修改前，本轮实际运行）

使用文档附录 A 的固定 runtime、Map 内存存储及合成买入记录：

```text
preview=2, records=2, tradeCount=2, cost="21.00"
时钟回拨 1 秒：本地账本损坏或不兼容，已停止写入；请在设置中恢复有效备份。
```

根因核对：service 自行选择叶节点时未按 revision_id 幂等；model 在每次 read 时用当前墙钟拒绝已保存 recorded_at，且 domain 的 known_at 过滤会让直接删除该校验的补丁漏算持仓。修复需要同时统一有效修订与读取/投影时点。

## 任务表（本轮完成）

所有任务的起止 HEAD 均为 `f5cca9092d36c8b2620e7e125b1a3cd8fea59248`。结束交付是该 HEAD 上的**未提交工作区差异**，不是新的提交 SHA；分支仍为 `codex/mobile-phase-0-1`。本轮没有提交、推送、合并或发布。

表中 `src/`、`test/`、`miniprogram/` 均相对 `apps/miniprogram/`。回退代码与回退数据的具体步骤见下方。

| 任务 | 状态 | 实际文件 | 验证结果 | 回退方式 |
| --- | --- | --- | --- | --- |
| MP0-01 基线与状态 | completed | docs/miniprogram/task-status.md、README.md、本文件 | 74 项基线通过；旧“未提交”描述改为历史说明 | 独立工作区检出起始 HEAD；保留本轮文档 |
| MP0-02 修订一致性 | completed | src/model.ts、src/service.ts、test/acceptance.test.ts、boundaries.test.ts | 相同修订幂等，碰撞拒绝且备份不变；列表、预览、概览均为 1 笔 / 21.00 | 同上；备份保留完整审计链 |
| MP0-03 时钟与损坏 | completed | src/model.ts、src/repository.ts、src/service.ts、相关页面、test/persistence.test.ts、boundaries.test.ts、runtime.test.mjs | 回拨 1 秒/跨日仍读取及导出；首页暂停金额，详情显示明确时点；校准后可写；外部未来数据仍拒绝 | 校准设备时间；先导出 v2；不改写原日期 |
| MP0-04 恢复失败边界 | completed | src/repository.ts、src/runtime.ts、settings 页面、test/persistence.test.ts、service.test.ts | 恢复点先核验；主写及回读失败不虚报；容量预检查；坏 JSON 可直接取回原文 | 导出原文；使用有效备份/替换前恢复点 |
| MP1-01 期初与迁移 | completed | src/model.ts、src/repository.ts、src/service.ts、opening 页面、app.json、合成 v1 fixture | v1 严格解析、确定性迁移与原文保护；v2 期初；统一日期；期初不计买卖 | v2 不可直接降级；保留迁移副本及升级前 v1 备份 |
| MP1-02 更正与顺序 | completed | src/service.ts、entry/records/opening/revision-detail 页面、test/optimization-service.test.ts、boundaries.test.ts | record_id 不变、追加修订；过期版本/预览拒绝；同日插入与重排一次提交；方向/标的更正完整回放 | 导出完整 v2 后回退代码；不删除修订来“修复” |
| MP1-03 详情与预览 | completed | src/service.ts、overview/entry/opening/position-detail 页面、test/runtime.test.mjs、optimization-pages.test.mjs | 清仓详情、历史可卖量、费用/支出预览；股票类型沿用；跨标的预览展示两侧变化；亚美分金额保留精度 | 保留 v2 数据；独立测试环境回退源码 |
| MP1-04 独立财务验收 | completed | test/fixtures/*.json、acceptance.test.ts、optimization-service.test.ts、boundaries.test.ts、runtime.test.mjs | 期初→买卖→更正→重启→备份恢复手算一致；清仓再买、期初更正/作废与故障回归通过 | 合成数据可重建；不涉及真实数据 |
| 既有根脚本及 domain 修订语义 | verified_existing | package.json、packages/domain/src/ledger/project.ts（均未改） | 根检查脚本可用；domain 去重、分叉、缺祖先、历史 cutoff 测试通过 | 无需回退 |
| 微信编译器 / iOS / Android | pending_external | 本文外部验收清单 | 未运行微信开发者工具、模拟器视觉和真机；Node VM 不替代平台验收 | 本轮未发布 |

## 实现约定与交叉检查

| 任务关联 | 契约 / 检查结论 |
| --- | --- |
| MP0-01 自检 | 旧状态改为历史说明，旧验证报告保留原样。 |
| MP0-02 自检；与 MP0-03 / MP1-02 | 列表统一由 domain input_head 选择，不另建不一致的叶节点规则。 |
| MP0-03 自检；与 MP0-04 / MP1-01 | 已存事实结构校验独立于墙钟；外部导入仍拒绝未来数据，可信本地恢复不以墙钟误报损坏。 |
| MP0-04 自检；与 MP1-01 | 替换前恢复点与迁移原文副本分开；写入后回读确认，不承诺异常等于没写入。 |
| MP1-01 自检；与 MP1-02 / MP1-03 | v2 显式允许期初；统一期初日；期初在列表区分，买卖计数不含期初。 |
| MP1-02 自检；与 MP1-03 / MP1-04 | 预览完整回放；提交检查版本；同日重排一次提交，复用 domain FIFO。 |
| MP1-03 自检；与 MP1-04 | 金额用 Decimal；可卖量为选定日期/顺序前持仓；清仓详情保留实现盈亏。 |
| MP1-04 自检 | 测试预期使用文档独立手算常量，不由生产投影反推。 |

普通实现选择使用上述计划边界；不扩大到联网、自动云同步或发布。所有新增持久化格式必须显式版本化。


## 本轮最终验证（新运行结果）

环境：Node `24.16.0`、npm `11.13.0`。以下命令均在 implementation 根目录执行，退出码均为 0。

| 命令 | 实际结果 |
| --- | --- |
| `npm run check:weapp` | TypeScript 通过；构建通过；**71 测试通过 / 0 失败 / 0 跳过**；8 页面，主包 **1824.7 KiB**，无外部运行期导入 |
| `npm run test -w @portfolio/domain` | 32 通过 / 0 失败 |
| `npm run typecheck -w @portfolio/domain` | 通过 |
| `npm run test -w @portfolio/ai-context` | 20 通过 / 0 失败 |
| `npm run typecheck -w @portfolio/ai-context` | 通过 |
| `python3 scripts/check_public_safety.py` | 通过 |
| `python3 scripts/check_release_readiness.py` | 通过；此脚本不表示微信平台发布资格通过 |
| `git diff --check` | 通过 |

共 **123 项相关测试通过**。原 74 项回归保留，原录入控制器测试按新增“先预览、再保存”交互更新，仍验证保存失败与重复点击。

没有修改 domain/ai-context 生产代码、workspace 依赖、根锁文件、Web/API、旧 Expo 或私有数据。没有重跑不受本次改动影响的 Web/API 全套测试与 Web 构建。没有安装依赖或调用真实模型。

独立代码审查与最后一次限定增量复查均未发现新的关键/重要问题。审查没有冒充额外测试或真机证据。

### 财务验收

预期来自 `test/fixtures/mp1-hand-calculation.json` 的手工常量，不由生产算法生成。

| 步骤 | 数量 | 剩余成本 | 已实现盈亏 | 有效买卖数 |
| --- | --- | --- | --- | --- |
| 期初 10 股，确认成本 1000 | 10 | 1000.00 | 0.00 | 0 |
| 买 2 × 120，费 1 | 12 | 1241.00 | 0.00 | 1 |
| 卖 3 × 130，费 1 | 9 | 941.00 | 89.00 | 2 |
| 更正买入价为 125 | 9 | 951.00 | 89.00 | 2 |
| 重启 / v2 备份恢复 | 9 | 951.00 | 89.00 | 2 |

另测：期初 2 股成本 200，全部以 120 卖出、费 1，清仓盈亏 39；再买 0.5 股 × 110、费 1，成本 56，历史盈亏仍 39。期初成本 `1000.0001` 的备注更正不会四舍五入重写原成本。`0.0001` 成交金额及手续费在预览中不显示为 0.00。

### 回归与故障证据

- F01 修改前实际计数 2/2/2，成本 21.00；新增 acceptance 测试曾以 `2 !== 1` 失败。修复后预览、列表、概览计数均 1；不同内容同 revision 拒绝且备份字节不变。新 record_id 的真实重复买入仍分别计账。
- F02 修改前回拨 1 秒误报“损坏”。固定 runtime 测试覆盖一秒/跨日回拨、正常备份、当前安全投影、历史显式 cutoff、上海 UTC 午夜前日期及校准恢复；未来修订链仍完整验证。
- v1 主数据在切换 v2 前先保存并回读核验迁移原文；迁移备份失败时主数据原文保持不变。v1 不放宽支持期初，未知未来版本拒绝。
- 主存储写入失败、恢复点写入失败、回读不一致、回读抛错、空间不足分别覆盖。宿主“已写入后抛错”只有回读字节完全一致才视为成功；无法确认时提示待核验，不宣称旧账本一定未更新。
- 旧恢复点在主数据损坏时仍保留；坏 JSON 可独立复制/导出原文。外部未来备份拒绝；可信本地恢复按结构验证。
- 更正导致后续超卖、方向/标的变更破坏历史均拒绝且持久化原文不变。序号不连续的导入数据按实际顺序处理；等时间戳的修订历史及错误定位按父子关系处理。
- 页面测试使用真实打包核心及受限 Node VM（无 Intl/DOM/Node 运行时依赖、禁动态代码生成），覆盖预览、保存、失败、重启、正常/故障备份入口。它不是 WXML 编译器或真机。

## 数据兼容、容量与回退

| 存储位置 | 语义 |
| --- | --- |
| `portfolio.wechat.v1` | 沿用原 key，正文的 `version` 明确为 2；旧程序会拒绝，不静默读错 |
| `portfolio.wechat.v1.previous` | 上一次替换之前的有效原文；不是每笔交易的自动备份 |
| `portfolio.wechat.v1.migration-v1` | 首次本地 v1→v2 切换前保护的 v1 快照原文；不包含升级之后的新记录 |
| 微信文件系统中的手工导出 | 独立于上述键值存储；文件创建/分享失败单独提示 |

本轮没有实现草稿持久化。应用 800 KiB（包含导出封装）、2000 修订、500 标的、1000 天复盘限制保持；替换预检按宿主存储信息保守估算恢复点余量，不能保证实际写入成功。不会自动删除旧交易、修订、恢复点或用户文件。

安全回退顺序：

1. 先用本版导出完整 v2 备份，私人保存；若结构损坏则先导出原始故障数据。校准时钟不需要降级数据。
2. 普通误替换可在设置中恢复上一次替换前的账本；此操作覆盖当前内容，先导出，恢复点本身保留。
3. 代码回退在独立工作区检出起始 HEAD，保留本轮改动及备份。本轮没有执行回退命令或丢弃任何文件。
4. 旧版不能读取 v2。需要测试旧版时，在独立环境恢复升级前 v1 完整备份；迁移 key 保存的是快照原文，须按 v1 备份封装并校验后使用。不得删掉 v2 新字段伪装降级，也不能把旧迁移副本当作包含最新数据的备份。
5. 保留原环境及完整 v2 文件，重新使用本版后可继续恢复。自动 v2→v1 降级不在本轮范围。

## 外部验收与下一步

本轮 MP0、MP1 的代码和本地主机验收均已完成，没有尚未完成的本轮代码任务。以下平台项全部为 `pending_external`：

- 微信开发者工具实际编译、8 路由跳转与模拟器视觉。
- iOS / Android 微信的数字键盘、小数精度、长金额、安全区及前后台/重启。
- 真机文件导入、备份分享、空间不足和宿主写入后回读行为。
- 真机时钟回拨、校准后的金额及操作提示。

具体下一步是在微信开发者工具导入本轮构建目录或测试包，以合成数据执行上述用例，记录工具/基础库/设备版本和结果。MP2 及之后阶段本轮未启动；不自动开始下一轮、上传体验版或发布。


## 本轮本地测试包

- 构建目录：`apps/miniprogram/dist`（导入包含 project.config.json 的目录）。
- 测试包：`dist/wechat/交易日记-微信小程序-0.1.0-测试版.zip`。沿用现有打包脚本文件名；内容为本轮 MP0/MP1、v2 数据格式。
- SHA-256：`e3568650b3fa9d19aa52436f1c9580bd6f06324037fcfbd6e8582ce6bf1e4f4d`。
- `npm run package -w @portfolio/miniprogram` 退出码 0；压缩文件 CRC、白名单 41 个文件、8 页面路由与旁置 SHA-256 校验通过。无私有配置、账本导出或测试数据打入包。
- 现有系统 zip 按 UTF-8 文件名字节打包；Python 默认 CP437 解码首次把中文使用说明误读为乱码，明确 `metadata_encoding='utf-8'` 后白名单校验通过。跨平台打包脚本改造仍属 MP3，本轮未提前执行。若解压工具误识别中文说明文件名，选择 UTF-8；工程路由文件均为 ASCII。
- 构建及压缩文件均为 gitignored 本地产物，未进入提交。
