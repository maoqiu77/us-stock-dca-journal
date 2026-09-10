# npm workspace（M03）

仓库保留 apps/web、apps/api；新增 packages/domain（@portfolio/domain）。JS 唯一权威锁为根 package-lock.json，所有安装执行根 `npm ci`。Node 24，Python 使用独立 .venv，Python 依赖体系不变。

领域包导出 TypeScript 源，Node 24 运行测试，本包 `tsc --noEmit` 类型检查；生产依赖只允许明确纯库。Next 16.2.9 的安装版本 output/transpilePackages 文档已阅读；配置 domain 转译、仓库根 tracing。各应用独立维护 UI 和框架依赖。

根 dev:web/test:web/build/lint 别名保持。CI、Windows/macOS 构建工作流、README、贡献指南与本地启动器均使用根 npm ci。启动器检查根 Next 依赖是否存在。旧 Web lockfile 仅在根安装成功后删除。

发布流水线已支持 web/apps/web/server.js 的嵌套 standalone，无需改目录规则。源归档额外排除 worktree .git 指针、嵌套 node_modules、package 构建/覆盖率/私有运行内容。共享源码仍在源归档中。

## 实测（2026-09-09）

- 原 Web lock → 根 lock 的所有外部包 `(name, version)` 多重集合完全相同，无升级/删除；增加两条 workspace 链接。
- 根 npm ci 退出0；Web74项、domain边界测试1项、domain typecheck、lint、build 均退出0。
- Python release bundle layout 4项通过；public-safety 与 release-readiness 退出0。
- 实际 standalone 的 apps/web/server.js 和 node_modules/next/package.json 存在；静态资源继续由原发布流程复制。
- 实际执行源归档脚本，再检查 ZIP：259条目，无 .git/node_modules/.next/.venv/私有运行数据；根 lock 与 domain 源码存在，旧 lock 不存在。
- 将生成的源码 ZIP 解到全新 TemporaryDirectory：根 npm ci 与 domain typecheck 均退出0；不依赖当前 node_modules。
- 未在 Windows/macOS 真正打出安装发行包；上述 layout 测试与文件检查不能代替安装验证。

## M07 / M18 后续状态

增加 `apps/mobile` 和 `packages/ai-context` workspace，仍只有根 lock。M03 上述包版本集合/259条目是当时迁移检查，非当前最终树；加入移动端后最终安装与315条目源归档验证见 `validation-2026-09-09.md`。CI增加纯domain/context测试和类型检查；原生证据是独立且当前blocked的门禁。
