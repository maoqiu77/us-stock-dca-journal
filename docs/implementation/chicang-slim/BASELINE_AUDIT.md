# 持仓手记代码与数据边界审计

审计更新：2026-09-20。基线分支 `codex/mobile-phase-0-1`，基线提交 `895316355f79e921ba16700005e60ae880f06916`。仓库是 linked worktree；用户提供的实施计划与既有 Phase 0/1 未提交修改均被保留。

## 技术栈与真实边界

- 小程序仍是原生 WXML/WXSS/JavaScript 页面 + TypeScript/esbuild 领域层，没有重写技术栈；`dist` 仅由构建生成。
- 金融域继续使用真实 event revision 与 `opening_aggregate_then_fifo`。当前持仓 checkpoint 不生成买卖、成交额或现金流。
- 截图导入最终复用 Phase 1 checkpoint writer：一批选中行对应一次金融 revision 和 receipt，任何验证/存储失败都不暴露半批数据。
- AI/手记继续使用同一 workspace partitions、conversation/messages/runs/sources/outbox，不新增第二套聊天数据库。

## Phase 2 数据流

```text
本地 chooseMedia
  → 当次外发确认
  → 服务端签发 owner-bound 私有 cloudPath
  → 上传并绑定精确 fileID
  → 服务端读取/校验图片并调用 provider
  → 严格 review_required 草稿
  → 用户逐行选择/修正/确认差异
  → previewHoldingImport / saveHoldingImport
  → 单 snapshot checkpoint + receipt
```

模型输出没有 instrument ID、写库权或执行权；未匹配项必须由目录候选确认或保存为明确 `unverified`。截图对象不进入账本或完整备份，成功/失败/取消均进入删除流程，删除失败由过期清理重试。

## Phase 3 日期、删除与迟到响应

- 消息日期统一由 ISO 时间按 UTC+8 计算；旧仅日期笔记保留原 `journal_date` 和 `legacyDayKey`，不虚构发送时间。
- 月历只建立日期索引，会话本身不绑定单日，因此同一主题可跨日继续。
- 删除会话/个人手记会物理删除相应正文，并按 source/run 关系清除派生消息、分析引用与 outbox；交易/持仓 snapshot 不参与该事务。
- workspace `privacy_epoch` 每次隐私删除递增。AI prepare 捕获 epoch；归档时同时核对 workspace instance、epoch 与 conversation 存在性，防止迟到结果写回。
- AI 内容转存先复制到可编辑草稿，再新建个人手记，不修改 AI 原文，也不默认把 AI 输出当作用户观点。

## 存储、迁移与备份

- 金融 snapshot 保持 v3，包含 checkpoints、holding assets、receipts 与 revision。
- workspace v3 增加向后默认的 `privacy_epoch` 和 deletion receipts；旧分区仍可读。
- 完整备份升级为 v7，增加 privacy deletion 范围，明确排除原图和视觉临时任务；严格 v1–v6 导入继续支持，v6 有单独回归。
- 恢复仍先验证完整引用并使用 recovery point/workspace root switch，不会混合半态；导入 outbox 保持 detached，不自动联网重放。

## 安全与运行事实

- 本轮测试使用合成字节与假 provider，仅验证边界和失败语义；没有读取真实截图、密钥或账户数据。
- `npm run check:ai-gateway` 已通过 50/50；小程序最终全检查结果记录在 `ACCEPTANCE.md`。
- 未部署云函数、未调用付费模型、未推送 Git、未生成假行情、未伪造历史交易。
- Phase 4 未开始；真实视觉联调与真机截图单独标记外部阻塞。
