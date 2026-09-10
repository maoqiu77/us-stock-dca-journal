# M18 只读上下文契约

`@portfolio/ai-context` 只依赖 domain 与 zod，不含 SQL、网络、Provider SDK、密钥访问、模型意图调用或账本写 port。运行时 strict schema 拒绝额外字段；Facts 必须携带 id/revision/type/asOf 来源与 freshness/completeness，AI/导入原文保留 untrusted excerpt 标签。Manifest 核对 policy portfolio、上下文来源完整性及 known_at；未知目标和资料缺失保持显式状态。

ProviderResponse 仅为 `ai_generated` 提议；grounded_summary 必须引用来源。当前 schema 不证明模型陈述真实性，后续 M20–M26 仍须核对引用是否来自发送 manifest、事实一致性、预算和授权。不能将 parse 成功作为模型可信结论或写账本操作。

有限 intent 分类仅使用调用者提供的已确认实体目录、显式 ticker/别名、页面实体、简单问句关键词。别名冲突/未知 ticker/相对日期/非法或倒置日期返回 needs_clarification；页面实体只填补缺省。对相对时间不偷偷调用系统日期；要求明确范围。完整 YYYY-MM-DD 才识别为日期，不宣称通用自然语言理解。

共享 fixture 的 NVDA/QQQ 问句和 UUID 全部虚构，不是既有20案例的计分或准确率证明。测试包括大小写共享别名、ticker与另一标的别名混用、来源缺失/未来来源/AI伪事实、只读结果类型和包依赖方向。
