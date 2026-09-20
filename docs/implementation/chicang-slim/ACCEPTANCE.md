# Phase 2 + Phase 3 验收记录

## 自动化证据

| 范围 | 命令 | 结果 |
|---|---|---|
| Phase 2/3 小程序专项 | `npm run typecheck -w @portfolio/miniprogram && node --test apps/miniprogram/test/full-backup.test.ts apps/miniprogram/test/release-pages.test.mjs apps/miniprogram/test/journal-phase3.test.ts apps/miniprogram/test/holdings-phase2.test.ts apps/miniprogram/test/vision-transport.test.ts` | exit 0；35/35 |
| AI 网关全检查 | `npm run check:ai-gateway` | exit 0；typecheck/build 通过；50/50 |
| 云函数语法 | `node --check apps/ai-gateway/cloud/portfolioAi/index.js && node --check apps/ai-gateway/cloud/portfolioAiCleanup/index.js` | exit 0 |
| 页面回归修复专项 | `npm run build:test -w @portfolio/miniprogram && node --test apps/miniprogram/test/optimization-pages.test.mjs apps/miniprogram/test/runtime.test.mjs` | exit 0；31/31 |
| 最终小程序全检查 | `npm run check:weapp` | exit 0；typecheck 通过；180/180；production build 2021.4 KiB / 14 pages |

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
| V12 | PASS | 真实 provider 未调用，外部阻塞记录在 `BLOCKERS.md`。 |

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

- 微信开发者工具与真机 320/375/430、大字体、键盘、安全区：`NOT_RUN`。
- 真实 CloudBase 私有上传、定时删除与 DeepSeek 视觉调用：`BLOCKED_EXTERNAL`，本轮未部署、未使用凭证、未产生费用。
- 真实授权截图精度样本（前导零、多账户、截断、盈亏平衡价）：`BLOCKED_EXTERNAL`。

因此不能把 Phase 2 的真实识别或真机 UI 标记为 `VERIFIED`；当前结论仅覆盖本地类型检查、事务/安全单测、页面控制器测试和生产构建。
