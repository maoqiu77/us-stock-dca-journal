# AI 投资上下文评测指南

这套工具用于回答一个具体问题：AI 是否正确理解并使用了你的长期投资上下文，而且建议是否符合你的投资原则。

它不评价短期涨跌，也不调用另一个 AI 自动打分。你提供人工金标准和审核结果，本地脚本负责校验标注并复算指标。

## 1. 准备私有评测文件

公开模板包含 20 个虚构案例，覆盖账户事实、长期 ETF、仓位与再平衡、交易历史、数据可信度五类场景。

先复制到本地私有目录：

```bash
mkdir -p storage/local/evaluations
cp storage/templates/ai-context-evaluation.example.yaml \
  storage/local/evaluations/ai-context-evaluation.yaml
```

`storage/local` 已被 Git 忽略。真实持仓、成本、交易流水、AI 回答和人工评分只能写入这里，不要修改公开模板来保存真实数据。

你可以把虚构案例替换成自己的代表性问题，但建议保留五个类别，每类至少 4 题。每次比较模型或提示词版本时，应使用同一份题目和金标准。

## 2. 为每道题建立金标准

每个案例先定义问题的判断边界：

```yaml
- id: long-etf-01
  category: long_term_etf
  question: QQQM 单日下跌后是否应该卖出？
  context_items:
    - id: role
      text: QQQM 是长期核心 ETF。
      priority: core
    - id: weight
      text: 当前仓位仍在目标区间。
      priority: important
  constraints:
    - id: long-term
      text: 单日波动不能直接推导长期核心 ETF 清仓。
      hard: true
  forbidden_outcomes:
    - 把 QQQM 当作短线个股。
  acceptable_response: 围绕长期逻辑和仓位判断，不因单日波动直接卖出。
  review: null
```

上下文优先级及权重固定为：

| 优先级 | 权重 | 用途 |
| --- | ---: | --- |
| `core` | 3 | 忘记后会改变结论的核心事实，例如长期角色、期限、持仓和硬边界 |
| `important` | 2 | 应影响解释或方案的重要事实，例如目标仓位、现金和交易历史 |
| `supporting` | 1 | 提升回答质量但通常不单独改变结论的辅助事实 |

硬约束 `hard: true` 表示任何一次违反都会使该案例失败，例如虚构持仓、把 `sample` 当成真实行情、建议杠杆或因单日波动清仓长期核心 ETF。

## 3. 获取 AI 回答

在平台中使用待评测的 AI Provider 和模型回答案例问题。为了保证比较公平：

- 同一次评测固定模型、提示词版本和上下文快照。
- 不在失败后追加提示来“教会”当前回答；需要重试时记录为新的评测运行。
- 保存平台实际发送的提示词和原始回答。AI 日历记录已经保存每日生成时的 `prompt` 和回答内容。
- 不把评测答案或评分标准发给被测模型。

## 4. 人工标注回答

把案例的 `review: null` 替换成审核对象：

```yaml
review:
  answer: >-
    QQQM 是你的长期核心 ETF，当前仓位仍在目标区间，单日下跌本身不构成卖出理由。
  context_assessments:
    - context_id: role
      prompt_status: provided
      answer_status: used
    - context_id: weight
      prompt_status: provided
      answer_status: used
  facts:
    - statement: QQQM 是长期核心 ETF。
      status: supported
      critical: true
    - statement: 当前仓位仍在目标区间。
      status: supported
      critical: true
  constraint_assessments:
    - constraint_id: long-term
      status: followed
  adaptation:
    long_term_goal: 2
    asset_role: 2
    account_context: 2
    evidence: 1
    uncertainty: 1
  rationales:
    - text: 长期核心 ETF 且仓位仍在目标区间。
      context_ids: [role, weight]
```

### 上下文标注

`prompt_status` 评估上游链路：

- `provided`：平台实际发送的提示词中提供了这项上下文。
- `missing`：本题需要，但实际提示词没有提供。

`answer_status` 评估模型使用：

- `used`：回答正确使用了上下文，不要求逐字复述。
- `misused`：提到了上下文，但理解或推理方向错误。
- `omitted`：回答没有使用该上下文。

每个 `context_item` 必须且只能标注一次。脚本由此分别计算提示词覆盖率、回答上下文召回率和模型利用率，区分“系统没给”与“模型收到但没用”。

### 事实标注

把 AI 回答里所有可以由投资数据核验的陈述逐项列入 `facts`：

- `supported`：由当前上下文支持。
- `unsupported`：上下文没有提供，属于无依据扩展。
- `contradicted`：与当前上下文明确矛盾。

持仓标的、股数、成本、现金、交易动作、资产角色和长期目标等错误应标记 `critical: true`。关键事实错误不能被其他高分抵消。

如果回答没有陈述任何可核验事实，保留 `facts: []`。事实精确率会显示为“无可用证据”，案例不会通过事实门槛，而不是自动获得 100%。

### 约束标注

每个约束标注为：

- `followed`：回答遵守该投资原则。
- `violated`：回答明确违反该原则。

每个约束必须且只能标注一次。任何硬约束违反都会使案例失败。

### 建议适配度

五项各打 0–2 分，总分 10 分：

| 维度 | 0 分 | 1 分 | 2 分 |
| --- | --- | --- | --- |
| `long_term_goal` | 违背长期目标 | 部分考虑 | 明确围绕长期目标 |
| `asset_role` | 混淆资产角色 | 提到但未充分使用 | 正确用于判断 |
| `account_context` | 忽略或错误 | 使用不完整 | 正确结合账户和仓位 |
| `evidence` | 无依据或编造 | 依据不完整 | 依据充分且可核验 |
| `uncertainty` | 过度确定 | 有简单提示 | 清楚说明限制和条件 |

这五项应由你本人评分，因为“是否符合我的长期投资方式”不能完全交给自动裁判。

### 建议依据

把回答中的主要建议理由拆到 `rationales`。能追溯到金标准上下文的理由填写对应 `context_ids`；空数组表示理由无法追溯。若回答没有理由，使用 `rationales: []`，可追溯率会显示为“无可用证据”。

## 5. 运行评测

输出人类可读报告：

```bash
./scripts/evaluate_ai_context.py \
  storage/local/evaluations/ai-context-evaluation.yaml
```

输出 JSON：

```bash
./scripts/evaluate_ai_context.py \
  storage/local/evaluations/ai-context-evaluation.yaml \
  --json
```

保存报告：

```bash
./scripts/evaluate_ai_context.py \
  storage/local/evaluations/ai-context-evaluation.yaml \
  --output storage/local/evaluations/report.json
```

在所有案例完成前阻止评测被当成完成：

```bash
./scripts/evaluate_ai_context.py \
  storage/local/evaluations/ai-context-evaluation.yaml \
  --require-complete
```

退出码：

- `0`：文件有效；未使用严格模式时允许存在待评分案例。
- `2`：文件无法读取、解析或通过结构校验。
- `3`：使用了 `--require-complete`，但仍有待评分案例。

## 6. 指标与通过门槛

| 指标 | 公式 | 单案例门槛 |
| --- | --- | ---: |
| 提示词覆盖率 | 已提供上下文权重 ÷ 应提供上下文权重 | 诊断指标，不单独控制通过 |
| 回答上下文召回率 | 正确使用上下文权重 ÷ 应使用上下文权重 | ≥90% |
| 模型利用率 | 正确使用且已提供的权重 ÷ 已提供权重 | 诊断指标 |
| 核心上下文召回率 | 正确使用的核心项 ÷ 核心项总数 | 诊断指标 |
| 事实精确率 | 受支持事实数 ÷ AI 投资事实总数 | ≥98% |
| 上下文幻觉率 | 无依据事实数 ÷ AI 投资事实总数 | 越低越好 |
| 约束遵守率 | 遵守约束数 ÷ 相关约束总数 | ≥95% |
| 建议适配度 | 五项人工评分之和 | ≥8/10 |
| 依据可追溯率 | 可追溯理由数 ÷ 理由总数 | 诊断指标 |

案例还必须满足关键事实错误为 0、硬约束违反为 0。数据集总指标是：

```text
AI 投资上下文适配通过率 = 通过案例数 ÷ 已完成评分案例数
```

建议用同一数据集对不同模型或提示词版本进行比较：初期达到 80%，稳定可用达到 90%，成熟达到 95%。不要用少量题目或一次高分宣称长期稳定。

## 7. 结果解读

- 提示词覆盖率低：上下文构建或数据链路需要改善，不应首先归因于模型。
- 提示词覆盖率高但模型利用率低：模型没有有效使用已提供内容，可能需要调整提示词、模型或上下文组织。
- 召回率高但事实精确率低：模型提到了很多信息，却混入错误或无依据事实。
- 事实和召回良好但适配度低：模型知道账户事实，但建议风格仍不符合你的长期投资方式。
- 硬约束违反：无论其他分数多高，都不应把该回答视为可接受。

每次更换模型、修改系统提示词或改变上下文结构后，重新运行同一套评测，保留 JSON 报告用于纵向比较。
