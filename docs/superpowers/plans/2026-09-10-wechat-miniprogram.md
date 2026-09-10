# 微信小程序测试版 Implementation Plan

> For agentic workers: 按 executing-plans 在当前已隔离工作区内执行；用户已授权规划并执行。

**Goal:** 产出无 AppID 也可导入微信开发者工具的离线记账小程序与测试指南。
**Architecture:** 原生页面 + 单独 CommonJS 共享业务 bundle + wx 本地快照存储；复用 domain。
**Tech Stack:** WXML/WXSS、JavaScript 页面、TypeScript 核心、esbuild、node:test。
**Spec:** ../specs/2026-09-10-wechat-miniprogram-design.md

## Global Constraints

单账户 USD；现金未知；不完整历史；无网络/密钥/真实数据迁移；备份 800 KiB；保留既有未提交修改；不把主机检查当真机验证。

## W0.1 可保存的账本和复盘

Files: apps/miniprogram/src/{model,repository,service}.ts，test/service.test.ts。
Interfaces: createService(storage, runtime)；snapshot()/overview()/records()/saveTrade(input)/voidTrade(id)/saveReview(date,text)/exportBackup()/previewBackup(text)/restoreBackup(text)/recoverPrevious()。

- [x] 先写行为测试：买2股×10+费1，卖0.5股×14−费0.2，余1.5股成本15.75、已实现1.55；超卖失败且原快照不变。
- [x] 运行 node --test apps/miniprogram/test/service.test.ts，确认新功能未实现。
- [x] 实现版本化 strict schema、Decimal 输入规范化、完整回放；存储加载校验/单次提交，损坏与容量报错。
- [x] 验证更早买入作废导致后续超卖时拒绝；笔记重启存在；备份校验与覆盖前恢复点；写入异常不改变已保存快照。

## W0.2 微信工程和产品页面

Files: apps/miniprogram/{package.json,project.config.json,tsconfig.json}，scripts/build.mjs，src/runtime.ts，miniprogram/app.*，miniprogram/pages/{overview,records,entry,review,settings}/*。
Interfaces: pages 通过 lib/core.js 单例 service 访问业务，视图数据转换只在 service，wx API 只在适配层与页控制器。

- [x] 建立 bundle 运行测试：无 Intl/DOM/Node 的 VM 中启动真实核心，录入/重启读取；非法输入和存储失败不导航为成功。
- [x] 使用精确版本构建依赖；将核心编译到 dist/miniprogram/lib/core.js，拷贝页面与工程配置；检测本地相对资源存在和总包大小。
- [x] 实现四页签与独立表单、确认作废、日期笔记、备份预览确认及恢复点、显式示例导入。
- [x] 执行 typecheck/build/test 与核心、上下文回归；小程序 XML 模板校验和控制器交互测试。

## W0.3 方向切换与交付

Files: docs/miniprogram/{README,task-status,validation-2026-09-10}.md，README.md，docs/mobile/task-status.md，上级两份旧规划，package.json/package-lock.json，.github/workflows/ci.yml，.gitignore。

- [x] 根目录新增 build:weapp/test:weapp/check:weapp；CI 增加小程序检查，保留旧端命令兼容。
- [x] 旧规划首部标记已被小程序规划替代；提供后续阶段、导入步骤、合成数据手工验收与真实设备未验收说明。
- [x] 运行 check:weapp、共享包测试/类型检查、public-safety、release-readiness 和 diff --check，记录实际结果。
- [x] 生成可直接解压导入的测试包，交付绝对路径与待用户安装工具后的步骤。

本轮不自动提交已有混合改动，不安装微信开发者工具、不注册账号、不上传审核。验收后更新复选框与实际证据。
