> **已切换主路线（2026-09-10）：** 用户改为微信小程序，以下是历史 App 任务快照，不再据此继续 Expo 构建链。M07 的原生阻塞不适用于新路线。当前状态见 [微信小程序](../miniprogram/task-status.md)。

# Phase 0–1 任务状态

范围仅 M00–M27；Phase 2–4 不执行。原始计划与架构评审位于 worktree 上级目录。

| Task | 状态 | 记录 |
| --- | --- | --- |
| M00 | completed | 起始 HEAD e661b1d1efce7b2e88d327e34eda0fe98199b859；API 161、Web 65、lint/build/public-safety/release-readiness 均退出 0。文件：baseline.md、discrepancies.md、task-status.md；无业务变更；无完成提交。 |
| M01 | completed | 共享 legacy-ledger-v1.json、ledger-semantics.md 与两端原测试文件；Python test_trading_data.py 17/17、Web 74/74，退出0。只添加行为断言与文档，没有更改算法；起始/当前 HEAD 同 M00，无提交。 |
| M02 | completed | 新 privacy_policy.py/test_privacy_policy.py；修改 ai_advice/ai_settings/position_import/quant manager/reflection。先复现5项缺口，再验证9项隐私用例及全 API 174/174（临时DB环境），退出0。外发默认与Provider兼容行为保留；无真实key调用。起始/当前 HEAD 同M00，无提交。 |
| M03 | completed | 根 package/lock、domain最小包、Next config、CI/发布/归档/启动器与README/CONTRIBUTING；见workspace.md实测。Web74、domain1、typecheck/lint/build、layout4、安全/发行检查、全新解包npm ci均通过；旧锁移除，Web版本集合不变，无提交。 |
| M04 | completed | 新legacy-v1/types.ts、fifo.ts与8项财务测试；Web facade消费@portfolio/domain/legacy-v1；更新两包manifest/根lock。domain9、typecheck、Web74、Python17、build均退出0。旧舍入/日期/默认形状不变；无提交。 |
| M05 | completed | 新ledger/schema.ts、money.ts、ports.ts、ledger-schema.test.ts、ledger-v1.json；更新domain入口/依赖/根lock/口径文档。domain14项、typecheck、Web74项退出0；schema覆盖9事件/Decimal/日期/未知现金/目标；无旧库或业务行为切换，无提交。 |
| M06 | completed | 新project.ts、validate-command.ts、valuation.ts与财务/估值行为测试；更新domain入口、共享fixture与口径说明。domain32项与typecheck退出0（含审查发现的等价时区报价冲突回归）；涵盖费用/FIFO/分红/split/修订/历史/未知现金/估值，输入不可变。无旧Web算法切换，无提交。 |
| M07 | blocked | Android工具链已安装，API36模拟器本地debug构建及加密/存储/中文/TLS预检已执行；修复FTS关闭连接双释放。iOS按用户要求延后，双平台门禁仍退出1。见 android-validation-2026-09-10.md / native-evidence.json；未继续依赖链。 |
| M08–M17 | blocked / not_started | 前置 M07 未通过；没有实现安全存储、迁移或产品流程。 |
| M18 | completed | 新 ai-context 包、契约/有限intent/readonly ports 与合成fixture；20项测试和typecheck退出0，domain32项通过。审查发现的大小写歧义和混合ticker/别名遗漏已先复现再修复。无提交。 |
| M19–M27 | blocked / not_started | 等待 M13/M17 等原生前置链路；没有 Provider/内测发布。 |

旧 Web 只做已授权隐私修复和兼容 domain 抽取；没有切换至新账本，没有真实数据迁移、真实 Provider 请求或发布操作。所有改动尚未提交；M00–M27 尚未全部完成。

最终全量验证见 [validation-2026-09-09.md](validation-2026-09-09.md)。当前可运行源码已通过主机回归；整个 Phase 0–1 因 M07 原生前置未满足而尚未完成。
