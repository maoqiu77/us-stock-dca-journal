# 外部阻塞与未完成项

## 真实视觉服务与识别样本

- 状态：`BLOCKED_EXTERNAL`
- 缺少：用户 CloudBase 环境中的函数配置、私有上传权限、定时触发器、DeepSeek 视觉授权/凭证，以及经授权的无隐私回归截图。
- 已完成：provider 边界、私有 task/file owner 校验、结构/MIME/尺寸/像素限制、严格输出 schema、配额/超时/幂等、清理兜底、可编辑审核和原子导入。
- 不能声称：真实图片已完整解码、用户云环境已成功识别、真实识别精度/成本/延迟已达标，或定时器已实际删除对象。
- 最小下一步：在非生产测试环境配置私有变量与最小权限，用授权脱敏样本执行 P2-06；保存请求状态、识别差错和对象删除证据，不使用真实账户截图。

## 微信开发者工具 / 真机视觉验收

- 状态：`BLOCKED_EXTERNAL`
- 缺少：已连接的微信开发者工具与真机授权。
- 已完成：14 页面 test/production 构建、WXML handler 检查、页面控制器与 packaged runtime 回归。
- 不能声称：320/375/430、大字体、长名称、键盘、安全区、滚动定位和 sticky 按钮在真机通过。
- 最小下一步：打开 `apps/miniprogram/dist`，用脱敏测试账本检查截图选择/审核、AI 手记月历、会话删除与转存笔记状态。

## 非 US/USD 真实交易与行情

- 状态：`BLOCKED_EXTERNAL`，属于 Phase 4 范围。
- 当前边界：CNY/USD checkpoint 按币种隔离；非 US/USD 可保存 `unverified` 当前持仓；真实交易 domain 与现有行情仍受原许可/目录约束。
- Phase 4 本轮未开始，不声称新增全市场行情或真实交易支持。

## 明确停止边界

- Phase 4 及之后任务：`NOT_STARTED`。
- 生产部署、付费模型调用、Git commit/push：`NOT_RUN`，符合本轮限制。
