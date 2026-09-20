# Phase 2 + Phase 3 验收记录

## 自动化证据

| 范围 | 命令 | 结果 |
|---|---|---|
| Phase 2/3 小程序专项 | `npm run typecheck -w @portfolio/miniprogram && node --test apps/miniprogram/test/full-backup.test.ts apps/miniprogram/test/release-pages.test.mjs apps/miniprogram/test/journal-phase3.test.ts apps/miniprogram/test/holdings-phase2.test.ts apps/miniprogram/test/vision-transport.test.ts` | exit 0；35/35 |
| AI 网关全检查 | `npm run check:ai-gateway` | exit 0；typecheck/build 通过；50/50 |
| 视觉无每日上限回归 | `npm test -- --test-name-pattern='vision|CloudBase vision|null daily limit' && npm run typecheck && npm run build`（`apps/ai-gateway`） | exit 0；53/53；连续 5 次识别通过，并发上限仍为 1 |
| 云函数语法 | `node --check apps/ai-gateway/cloud/portfolioAi/index.js && node --check apps/ai-gateway/cloud/portfolioAiCleanup/index.js` | exit 0 |
| 页面回归修复专项 | `npm run build:test -w @portfolio/miniprogram && node --test apps/miniprogram/test/optimization-pages.test.mjs apps/miniprogram/test/runtime.test.mjs` | exit 0；31/31 |
| 最终小程序全检查 | `npm run check:weapp` | exit 0；typecheck 通过；180/180；production build 2021.4 KiB / 14 pages |
| 页头窄屏修复回归 | `npm run check:weapp && npm run check:production -w @portfolio/miniprogram` | exit 0；181/181；production 2070353 bytes / 14 pages；开发者工具 320/375/430px、26 号字体下持仓“＋”和标的详情“校准”完整可见；Android 新包待验 |

## Phase 2 用例映射

| ID | 结果 | 证据/限制 |
|---|---|---|
| H09/H10 | PASS | `holdings-phase2.test.ts`：revision 变化拒绝；仅更新所选行，未出现持仓原样保留。 |
| H11/H12 | PASS | 多账户/歧义留在审核；盈亏平衡价不作为平均成本，必须手工修正。 |
| H13/H14 | PASS | Phase 1+2：校准后真实交易只叠加一次；已知成本变未知需显式批准。 |
| H15 | PASS | 注入存储失败后主 snapshot 未出现半批数据。 |
| H16 | PASS | 审核页可确认 `unverified` 标的，不生成报价映射。 |
| V01/V02 | PASS | `release-pages.test.mjs`：拒绝外发时 recognize 调用为 0；账本提交只能在审核后进行。 |
| V03 | PASS | `vision-handler.test.ts`：task owner 与精确 file path 不匹配均拒绝。 |
| V04 | PARTIAL | 自动化验证签名、结构、声明 MIME、字节数、尺寸和像素上限；未接入真实图片解码库/云环境，完整解码验收未声称通过。 |
| V05/V06 | PASS | 严格对象 schema 拒绝 Markdown、坏 JSON、未知字段、任意 ID 与执行字段。 |
| V07/V10 | PASS | 数字型代码、`truncated:true`、21 行均拒绝，不猜前导零、不静默截断。 |
| V08/V11 | PASS | 超时/429/取消标准化；同 recognition request 只 claim/provider 一次。 |
| V09 | PASS（自动化） | 成功/失败/取消清理及 cleanupPending/过期兜底有 handler/store 测试；真实云定时器未部署。 |
| V12 | PASS（当前授权样本） | `cloud1` 已真实调用 DeepSeek 视觉并仅产生审核草稿；未导入持仓，定时清理仍记录在 `BLOCKERS.md`。 |

## Phase 3 用例映射

| ID | 结果 | 证据 |
|---|---|---|
| J01/J03 | PASS | `journal-phase3.test.ts` 使用 UTC `15:59:59`/`16:00:00` 固定映射到上海相邻日期，不依赖设备时区。 |
| J02 | PASS | 同 conversation 跨日消息分别可从两天 history 找到。 |
| J04 | PASS | 旧日期笔记保留 `legacyDayKey`，`createdAt` 为 null，不编造时间。 |
| J05/J06 | PASS | 本地个人笔记不调用模型；AI 文本编辑后创建新个人笔记，AI 原文不覆盖。 |
| J07/J13 | PASS | 删除个人原文按 source lineage 清除派生结果；`legacy_unverified` 派生结果保守失效。 |
| J08 | PASS | prepared request 绑定 workspace instance + privacy epoch；删除后迟到结果归档失败。 |
| J09/J10/J14 | PASS（既有回归） | AI schema/source manifest、未知事实与上下文预算的原有测试继续通过。 |
| J11 | PASS | `release-pages.test.mjs`：持仓/看板仅写一次性 intent，AI 手记消费后清除且 preview/prepare 调用为 0。 |
| J12/H18 | PASS | 删除会话后新 v7 备份不含正文/派生文本；交易数量与 snapshot 不变。 |
| D01 | PASS | v7 roundtrip + 明确 v6 兼容测试；旧 v1–v5 测试继续通过。 |
| U03/U04/U05 | PASS（自动化） | 三 Tab、旧路由 intent、禁用服务态和无 demo 生产构建检查继续通过。 |

## 人工/真实环境验收

2026-09-20 P2-06 非生产联调前核查：`npm run typecheck -w @portfolio/ai-gateway` 通过；`node --test apps/ai-gateway/test/{vision-handler,vision-cloud-store,deepseek-vision,cleanup-cloud}.test.ts apps/miniprogram/test/vision-transport.test.ts` 为 15/15 通过。这些是本地模拟/边界回归，不是云端或真实识别精度证据。现有客户端配置指向既往 A2/A3 云环境，未确认其为隔离的非生产环境；本地未发现获授权的 P2-06 截图样本或可用的 CloudBase 部署通道。本次没有上传图片、部署函数、调用 DeepSeek 或触发定时清理。P2-06 保持 `BLOCKED_EXTERNAL`。

2026-09-20 用户随后授权在现有 `cloud1` 免费开发环境进行合成样本联调。已重新构建并部署 `portfolioAi`、`portfolioAiCleanup`，云端更新时间分别为 12:45:58、12:46:07；`portfolioAi` 保持 Node.js 20.19，并新增 `AI_VISION_ENABLED=true`、`AI_VISION_MODEL=deepseek-flash`。已创建 `vision_tasks` 集合，权限为“仅创建者可读写”；拒绝使用会暴露其他用户识别草稿的公开权限。重新加载后截图导入页仍报告服务不可用，尚缺 `vision_upload_keys`、`vision_usage` 的创建/核验及能力成功回执，因此未上传合成图片、未调用视觉模型、未写持仓，也未产生真实识别/删除证据。P2-06 仍为 `BLOCKED_EXTERNAL`，不能标记 PASS。

2026-09-20 后续核验：用户授权两张本地截图仅用于识别测试。`cloud1` 存储权限实际选中“仅创建者可读写”，`portfolioAiCleanup` 已部署但定时触发器显示“空”。在微信开发者工具的小程序截图导入页选择第一张授权图并确认识别后，真实 `cloud.callFunction` 到达云端，在 `createHoldingUpload` 阶段报 `DATABASE_COLLECTION_NOT_EXIST: vision_upload_keys`；因此尚未上传该图、未调用 DeepSeek、未生成识别草稿，也未验证对象删除。控制台集合清单仅有 `vision_tasks`，没有 `vision_upload_keys` 和 `vision_usage`。两集合需要在用户隔离权限下补齐后重试；本条不构成 P2-06 PASS。

2026-09-20 P2-06 实测收口：已在 `cloud1` 创建 `vision_upload_keys`、`vision_usage`，创建时均选择“仅创建者可读写”。真实调用暴露并修复两项 CloudBase 兼容问题：读取文档携带的 `_id` 不可原样 `set`，以及完成任务时嵌套审核草稿不能用原局部 `update` 写入；已增加不记录图片/模型原文的阶段级错误码及回归测试。修复版 `portfolioAi` 部署后，两张用户授权图片均成功生成严格审核草稿，未提交持仓：股票图正确识别 QQQM/VOO/SMH/NOK/MRVL 及数量 `0.9145/0.1479/0.0587/10/0.5205`，成本留空；基金图正确识别“嘉实全球产业升级股票(QDII)A”“建信新兴市场优选混合(QDII)A”，数量留空且页面提示确认，没有用市值反推数量。基金成功任务证据为 `state=completed`、`errorCode=null`、`objectCleaned=true`、`cleanupPending=false`，对象存储列表为空；股票图也成功进入审核页。未点击“检查导入”或写入持仓。`portfolioAiCleanup` 仍无定时触发器，因此这里只验证了请求结束后的即时删除，没有完成过期对象的云端定时清理验收。

2026-09-20 识别次数变更实测：视觉 task store 的每日上限改为可关闭，`portfolioAi` 测试环境固定传入 `dailyLimit: null`，不再受旧 `AI_VISION_DAILY_LIMIT` 环境变量影响；每用户 `maxInflight=1` 保留。首次仅改默认值后云端仍报原限额，未误判为完成；重新固定关闭并部署后，在当天已超过原 3 次的条件下再识别授权股票图，成功进入 5 行审核页，不再返回 `VISION_RATE_LIMITED`。未点击导入。

- 微信开发者工具 320/375/430、大字体、键盘、安全区：`RUN_WITH_FAILURES`。开发者工具 2.02.2608070 中，430px 首页和底部安全区显示正常，26 号字体能重新渲染；375px 切换页面后曾回到首页但底部出现下一页表单切片；320px 从首页进入手动添加时新页横向排在旧页右侧，只显示窄条，确认存在严重横向溢出/转场异常。手动添加普通 390px 下可滚到数量、成本与“检查”按钮，按钮不被底部安全区遮挡；模拟器点击输入框未弹出真实系统软键盘，键盘遮挡仍需真机。
- Android 真机：用户已扫码打开预览包并提供首页截图。底部三 Tab、持仓卡片、长页面纵向内容与系统底部安全区均可见，用户反馈其他部分正常；但页头右侧绿色“＋”按钮整体越过屏幕右边界，只剩按钮左部，和开发者工具 320/375px 的横向溢出一致。首页真机 U01 判定 FAIL。键盘、前后台、截图审核及其他页面安全区仍待继续。
- Android 真机键盘：用户确认手动添加表单中系统键盘弹出正常，数量输入、页面滚动以及底部主按钮均可达，未被键盘遮挡。截图审核和前后台仍待继续。
- Android 真机新增截图：标的详情页“记一笔”右侧的“校准”按钮也越过屏幕右边界，确认页头问题不只在持仓首页。随后本地将两个页头操作区移至标题下方，在开发者工具 320/375/430px、26 号字体下复核两页按钮完整可见；尚未上传新预览包或在 Android 真机复验，不能将真机 U01 改为 PASS。
- 真实 CloudBase 私有上传与 DeepSeek 视觉调用：`PASS（两张授权样本）`；请求结束即时删除有任务元数据和空存储列表证据。云端定时清理仍为 `NOT_RUN`。
- 用户授权的两张截图逐行识别精度：`PASS（当前样本）`；股票 5/5 代码与数量匹配且成本未臆造，基金 2/2 名称匹配且数量未反推。前导零、多账户、截断、盈亏平衡价专项样本仍未实测。

因此不能把 Phase 2 的真机 UI 标记为 `VERIFIED`；真实视觉两张样本和即时删除已通过，但 UI 至少存在页头添加按钮横向溢出，且定时清理、键盘及完整真机矩阵仍未完成。


## Phase 4 + Phase 5 — 2026-09-20

实际基线 `6588ccf5f5f3035d0414e88313b4196f491263ea`，最终本地修改未提交。

| 验证 | 结果 |
|---|---|
| `npm run check:weapp` | PASS：typecheck、199/199 tests、14 页 production build |
| `npm run check:market-data` | PASS：typecheck、6/6 tests，含 NAV/IOPV 身份/币种/日期/零分母校验 |
| `npm run check:ai-gateway` | PASS：typecheck、54/54 tests、云端 bundle 构建 |
| `npm run check:weapp-production` | PASS：2087576 bytes，小于 2097152；密钥/fixture 边界、云包 hash、页面 handler AST 校验 |
| `npm run check:public-safety` | PASS |
| `git diff --check` | PASS |
| 微信开发者工具 | 实际打开本地 dist 的看板：关注空态、国内 ETF 无数据状态；AI 手记比较入口与最多 8 条原文选项可见。iPhone X、26 号字体，没有点击发送 AI。 |
| 完整真机/三尺寸/云端比较 | NOT_RUN / BLOCKED_EXTERNAL；不能以自动化替代真实验收 |

新增回归覆盖：旧自选单工作区认领及原字节回退、另一个工作区不能继承、存储失败不改变内存自选、恢复自选备份、同名跨交易所不同 ID；刷新合并、实际零涨幅、缓存时间与离线重启；相关跨日原文、8 条范围裁剪、2–3 候选唯一性；跨工作区 intent 丢弃、比较只准备草稿。已有删除/迟到结果/伪造来源、迁移/备份/金融等价性回归同时通过。

未新增账本版本或改写真实金融数据。自选旧键保留，只允许首个工作区认领；回退旧程序可继续读取旧键；新版自选变更应先通过完整备份保留。国内 NAV/IOPV 计算目前只有契约和合成单测，未接真实源、未展示虚构数字。


## 公开版补齐回归（2026-09-20）

小程序 201/201、网关 57/57、行情 6/6 测试；相应 typecheck/build；production 2094135 bytes、public-safety、diff check 全部 PASS。

新增验收包括：官方协议字段转换、未来公告剔除、零涨幅、前导零、NAV 错误不猜溢价、白名单未配置不请求、公开授权/缓存到期关闭、请求合并、国内云协议校验、目录到持仓和完整备份往返、国内 AI 只发送身份与原文而不发送未授权行情。

尚无真实 Provider 价格样本、已部署的国内 action 或模型比较成功回执。官方无 token 探测仅证明 HTTPS 可达。设备检查按 DEVICE_ACCEPTANCE.md 执行，既有本机状态不得升级为真机 PASS。


## Phase 6 + Phase 7 最终核验（2026-09-21）

本节是当前结论；上方历史运行与云部署记录保留作历史，不能当作本轮实测。未发布、未推送。`PASS_LOCAL` 仅项目自动化通过，不代表真机/云权限/数据许可。所有 H/V/J/M/D/U 共 62 项逐项列出。测试路径默认 `apps/miniprogram/test/`；gateway 为 `apps/ai-gateway/test/`。

自动化：小程序 **232/232**，网关 **90/90**，行情 **6/6**，领域 **35/35**，AI 上下文 **28/28**，API **174/174**，Web **74/74**；相关 typecheck/build、production、public-safety 通过。主包 **1,623,251 bytes / 14页**。[原始日志与构建身份](evidence/phase67)、[操作/回滚/阻塞交接](PHASE67_HANDOFF.md)。

| ID | 本轮结果 | 项目证据 | 限定说明 |
|---|---|---|---|
| H01 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H02 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H03 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H04 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H05 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H06 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H07 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H08 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H09 | PASS_LOCAL | holdings-phase2.test.ts / release-pages.test.mjs | 批次revision、部分替换、审核歧义、成本确认、失败不半写 |
| H10 | PASS_LOCAL | holdings-phase2.test.ts / release-pages.test.mjs | 批次revision、部分替换、审核歧义、成本确认、失败不半写 |
| H11 | PASS_LOCAL | holdings-phase2.test.ts / release-pages.test.mjs | 批次revision、部分替换、审核歧义、成本确认、失败不半写 |
| H12 | PASS_LOCAL | holdings-phase2.test.ts / release-pages.test.mjs | 批次revision、部分替换、审核歧义、成本确认、失败不半写 |
| H13 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H14 | PASS_LOCAL | holdings-phase2.test.ts / release-pages.test.mjs | 批次revision、部分替换、审核歧义、成本确认、失败不半写 |
| H15 | PASS_LOCAL | holdings-phase2.test.ts / release-pages.test.mjs | 批次revision、部分替换、审核歧义、成本确认、失败不半写 |
| H16 | PASS_LOCAL | holdings-phase2.test.ts / release-pages.test.mjs | 批次revision、部分替换、审核歧义、成本确认、失败不半写 |
| H17 | PASS_LOCAL | holdings-phase1.test.ts | checkpoint、缺成本/报价、多币种、格式、幂等、交易校准冲突 |
| H18 | PASS_LOCAL | holdings-phase1.test.ts / journal-phase3.test.ts | 移除持仓保留历史；删除会话不改交易 |
| V01 | PASS_LOCAL | release-pages.test.mjs | 取消/拒绝不调用识别；项目页面控制器 |
| V02 | PASS_LOCAL | release-pages.test.mjs | 取消/拒绝不调用识别；项目页面控制器 |
| V03 | PARTIAL | vision-handler.test.ts / vision-cloud-store.test.ts (gateway) | owner/task绑定；真实双账号云 ACL 未测 |
| V04 | PARTIAL | vision-handler.test.ts (gateway) | 字节签名/MIME/尺寸合成测试；完整真实解码/恶意图片矩阵未测 |
| V05 | PASS_LOCAL | vision-handler.test.ts / deepseek-vision.test.ts (gateway) | 严格输出、数值代码、截断、请求幂等；不代表真实识别精度 |
| V06 | PASS_LOCAL | vision-handler.test.ts / deepseek-vision.test.ts (gateway) | 严格输出、数值代码、截断、请求幂等；不代表真实识别精度 |
| V07 | PASS_LOCAL | vision-handler.test.ts / deepseek-vision.test.ts (gateway) | 严格输出、数值代码、截断、请求幂等；不代表真实识别精度 |
| V08 | PASS_LOCAL | vision-handler.test.ts / deepseek-vision.test.ts (gateway) | 严格输出、数值代码、截断、请求幂等；不代表真实识别精度 |
| V09 | PARTIAL | vision-handler.test.ts / cleanup-cloud.test.ts (gateway) | 成功/取消/失败清理模拟通过；本轮真实定时器未测 |
| V10 | PASS_LOCAL | vision-handler.test.ts / deepseek-vision.test.ts (gateway) | 严格输出、数值代码、截断、请求幂等；不代表真实识别精度 |
| V11 | PASS_LOCAL | vision-handler.test.ts / deepseek-vision.test.ts (gateway) | 严格输出、数值代码、截断、请求幂等；不代表真实识别精度 |
| V12 | NOT_RUN_CURRENT | 历史 P2-06 记录 | 本轮未调用真实视觉模型；历史两样本证据不升级为本轮通过 |
| J01 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J02 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J03 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J04 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J05 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J06 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J07 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J08 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J09 | PASS_LOCAL | ai-engine.test.ts / packages/ai-context/test | 来源校验、未知事实、上下文范围；隔离 fake/合成测试 |
| J10 | PASS_LOCAL | ai-engine.test.ts / packages/ai-context/test | 来源校验、未知事实、上下文范围；隔离 fake/合成测试 |
| J11 | PASS_LOCAL | release-pages.test.mjs | intent仅草稿，不发送模型 |
| J12 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J13 | PASS_LOCAL | journal-phase3.test.ts / phase67-recovery.test.ts | 上海日界线、原文/派生删除、迟到拒绝、日历与备份集成 |
| J14 | PASS_LOCAL | ai-engine.test.ts / packages/ai-context/test | 来源校验、未知事实、上下文范围；隔离 fake/合成测试 |
| M01 | PASS_LOCAL | packages/market-data/test/reference.test.ts | 约5%/零分母/币种身份/NAV/IOPV边界；源数据非实测 |
| M02 | PASS_LOCAL | packages/market-data/test/reference.test.ts | 约5%/零分母/币种身份/NAV/IOPV边界；源数据非实测 |
| M03 | PASS_LOCAL | packages/market-data/test/reference.test.ts | 约5%/零分母/币种身份/NAV/IOPV边界；源数据非实测 |
| M04 | PASS_LOCAL | packages/market-data/test/reference.test.ts | 约5%/零分母/币种身份/NAV/IOPV边界；源数据非实测 |
| M05 | PARTIAL | market-transport.test.ts / gateway eastmoney-provider.test.ts | 基金净值与场内字段区分；现场全标的核对未测 |
| M06 | PARTIAL | market-discovery.test.ts / market-client.test.ts / packages/market-data/test | 真实零/缺失、时段与缓存故障合成回归；真机断网未测 |
| M07 | PARTIAL | market-discovery.test.ts / market-client.test.ts / packages/market-data/test | 真实零/缺失、时段与缓存故障合成回归；真机断网未测 |
| M08 | PARTIAL | market-discovery.test.ts / market-client.test.ts / packages/market-data/test | 真实零/缺失、时段与缓存故障合成回归；真机断网未测 |
| D01 | PASS_LOCAL | full-backup.test.ts / persistence.test.ts / acceptance.test.ts / phase67-recovery.test.ts | v1–v7、来源、自选、回执、原文；恢复后重复批次不重放 |
| D02 | PASS_LOCAL | phase67-recovery.test.ts / pending-save.test.ts / full-backup.test.ts | 逐写点中断、根切换前后重启、容量不足、暂存损坏拒绝 |
| D03 | PASS_LOCAL | phase67-recovery.test.ts / pending-save.test.ts / full-backup.test.ts | 逐写点中断、根切换前后重启、容量不足、暂存损坏拒绝 |
| D04 | PARTIAL | evidence/phase67/rollback.log | 开始时旧service读取已完成事务数据相等；进行中不得降级，更旧版本未测 |
| D05 | PASS_LOCAL | ai-engine.test.ts / service.test.ts / runtime.test.mjs | 保留已有demo与用户记录，生产禁载入；没有按内容猜测清除 |
| U01 | PARTIAL | 本轮开发者工具操作记录 / PHASE67_HANDOFF.md | 320/375/430字体26部分页面；键盘/全页面/真机尚未完成 |
| U02 | PARTIAL | 本轮开发者工具操作记录 / PHASE67_HANDOFF.md | 320/375/430字体26部分页面；键盘/全页面/真机尚未完成 |
| U03 | PASS_LOCAL | release-pages.test.mjs / runtime.test.mjs / check-weapp-production.mjs | 三Tab、旧路由、无Key本地可用、首次无持仓/生产无演示入口；新设备首次启动待测 |
| U04 | PASS_LOCAL | release-pages.test.mjs / runtime.test.mjs / check-weapp-production.mjs | 三Tab、旧路由、无Key本地可用、首次无持仓/生产无演示入口；新设备首次启动待测 |
| U05 | PASS_LOCAL | release-pages.test.mjs / runtime.test.mjs / check-weapp-production.mjs | 三Tab、旧路由、无Key本地可用、首次无持仓/生产无演示入口；新设备首次启动待测 |
