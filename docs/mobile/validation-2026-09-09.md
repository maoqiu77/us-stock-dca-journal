# 本轮交接验证（2026-09-09）

工作分支 `codex/mobile-phase-0-1`，基线 HEAD `e661b1d1efce7b2e88d327e34eda0fe98199b859`。所有变更尚未提交，位于隔离 worktree；原桌面 checkout 未切换、未重启用户服务。

## 最终验证

| 检查 | 结果 |
| --- | --- |
| 根 npm ci（正常 lifecycle） | 退出0，1220 installed / 1225 audited |
| API unittest 全量，临时 data home/DB | 174/174，退出0 |
| Web tests | 74/74，退出0 |
| Domain tests / typecheck | 32/32 / 退出0 |
| AI context tests / typecheck | 20/20 / 退出0 |
| Mobile 主机门禁 tests / typecheck | 1/1 / 退出0；不代表 native 能力 |
| Web lint / build | 均退出0 |
| Expo install --check | Dependencies are up to date，退出0 |
| Expo modules autolinking verify | Everything is fine，退出0 |
| Metro iOS/Android production export | 两平台均退出0；最终入口 index.js，586/584 modules |
| Metro sourcemap 检查 | 两平台各仅 Mobile React 路径；无 native-capabilities 探针 |
| 根 lock RN 版本集合 | 仅 0.83.10；Web React19.2.4 / Mobile19.2.0 |
| public-safety / release-readiness / git diff --check | 均退出0 |
| 源归档 ZIP 检查 | 315条目；无 .git、依赖、Web/mobile构建、原生捕获、密钥或私有数据；只有根JS锁 |
| native:android / native:ios / check:native-evidence | **均退出1，blocked**；真实工具链和设备证据缺失 |

`release-readiness` 是旧桌面发布检查；其成功不表示 M27 或 Mobile 发布门禁通过。生成的 ZIP 仅用于检查归档过滤，不作为可用 Mobile 安装包交付。

npm audit 当前报告24项（1 low、15 moderate、7 high、1 critical）；M00 原基线已有15项。未运行 audit fix 或升级无关旧业务依赖，不将本轮测试通过解释为依赖安全审计通过。

## 审查及修复

独立代码审查覆盖隐私入口、domain财务与历史边界、M18只读契约。发现并修复三个问题：等价时区报价未判冲突、大小写别名未判歧义、显式ticker吞掉另一标的别名。每项先用合成测试复现失败，再修复并重跑相关完整测试。

## 恢复入口

先按照 native-capabilities.md 准备完整 Xcode/模拟器和 Android JDK/SDK/设备，继续 **M07**。补齐原生 storage/transport harness 和实测证据后才能开始 M08；不能从 M19 或后续业务绕过。任务范围仍仅原计划 M00–M27，Future Backlog 不执行。
