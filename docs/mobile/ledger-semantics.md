# 账本口径与兼容边界

## Legacy v1（M01）

公开夹具 `contracts/fixtures/legacy-ledger-v1.json` 全部虚构，标的 SYNTH 仅用于测试；预期由手算给出，不调用生产算法生成。

| 案例 | 独立计算 |
| --- | --- |
| 多批部分卖出 | 10×10 + 10×20，卖12股，剩8×20=160，单位成本20 |
| 清仓再买 | 原10股全部卖完，再买2×40，剩成本80 |
| 碎股 | 0.5×12 + 0.25×20，卖0.625，剩0.125×20=2.5 |
| 同日 | 同日2×10、2×20、卖3，按输入稳定顺序剩1×20 |
| 乱序 | 输入先次日卖1、再前日买2；推导按日期剩1股，但校验报第1行超卖；排序后校验无错误 |
| 入口精度 | shares=1、price=amount=12.3456：Web入口金额12.3456、Python12.35；单位成本随之不同，两端最终显示成本均12.35 |
| 截图覆盖 | 原2×10，快照3×30；新增合成卖2×10与买3×30，推导成本90。它不能证明用户实际卖出/买入 |

阶段必须区分：Web 对每笔调用 normalizeTradeInput 后推导；Python 对每笔 sanitize_trade 后推导。不能比较不同规范化阶段，再声称跨端完全一致。份额6位、价格4位、Web入口金额4位、Python入口金额2位；两端持仓成本输出2位。旧实现使用浮点。

旧现金为 max(totalAssets − holdingCost, 0)，不是现金流水余额、购买力或净资产。持仓单位成本是剩余 FIFO 成本除以份额，旧文档的平均成本减仓描述不准确。旧算法对超卖数量截断，但校验可报告错误；M01 不修改它。

旧快照只能说明当时用户提供了持仓汇总；合成流水不能进入新模型作为真实成交。旧清仓再买后的 purchaseDate 仍可能保持最初买入日；它不是完整 lot 日期档案。

## 新模型契约（M05；投影由 M06 实现）

单账户 USD 多头/碎股。事实持久化为受限 Decimal string，拒绝非法数值；明确 trade_date、可选 executed_at、同日 sequence、recorded_at 与 revision。排序冲突要求确认，不按随机 ID 猜测。

opening_cash / opening_position 与 buy / sell 分开；新期初仅聚合确认成本，之后 FIFO，历史标为不完整。现金允许 unknown，不默认为0；费用、现金分红和手工 split 明确记为事件。目标须用户确认，可为空。

新模型不双写旧 Web 账本。schema_version=1 是独立领域版本，与旧 DB user_version=4 无关；SQL 在 M09 落地。

Decimal 字符串为非负、无指数、无前导/尾随零的规范表示（如0、12.34）；最多18位整数、12位小数。现金/成交总额/费用/期初总成本最多4位小数；数量/价格最多12位。买卖金额必须等于 quantity×price 按4位 ROUND_HALF_UP 舍入的结果；费用另列。输入不得是 JS number，不自动容错截断。

内部使用固定 decimal.js 10.6.0 的独立80位精度构造器；不影响其它消费者全局设置。JSON事实保持字符串，投影输出最多12位，不回写事实。Zod固定4.4.3；strict schema拒绝未知字段和事件、非USD/非US、非法日期/时区、负数量、精度越界与金额不一致。[Decimal官方API](https://mikemcl.github.io/decimal.js/)、[Zod官方API](https://zod.dev/api)。

portfolio 明确 opening_date、cash_state、history_complete、cost_method；false history_complete 对应 opening_aggregate_then_fifo。instrument 独立UUID，身份必须确认。事件包含 record/revision/parent/device、trade_date、可选executed_at、sequence、recorded_at、用户确认来源、voided与note；领域不生成UUID或读取当前时间。

policy未知时只有unknown状态，不生成目标；confirmed必须有ID/版本/确认时间/生效日期。权重在0–1，目标不能重复或总和超过1，可留空。

## 新账本投影（M06）

调用必须显式提供 through_date 和 known_at：先按 recorded_at 过滤当时可知版本，沿 parent_revision 选唯一有效叶节点，再按事件日期截取；最新更正回放与当时所知回放因此可以分别计算。重复同一 revision 幂等，内容碰撞/分叉/缺祖先拒绝，不以更新时间或随机ID选赢家。

同账户每一天 sequence 唯一，按 trade_date/sequence 排序；有 executed_at 时必须属于账户时区的该日期，已知执行时间必须与明确序号一致，矛盾返回 order_conflict 要求确认。未提供时间时不假定午夜成交。

现金 reconciled 必须有唯一的明确 opening_cash，且在现金变动之前；unknown 保持null，不输出已核实购买力。期初持仓只在opening_date、对应证券交易之前导入一次；不完整历史才允许期初聚合成本。不得计算期初之前的伪历史。

买入费用计入lot成本，卖出费用减少净回款，FIFO消耗成本得已实现损益；现金另由所有有限事件记账。分红只改现金，split改份额不改总成本。不支持需现金补差的零股公司行为：拆股结果超出12位可表示份额时返回 split_precision_requires_confirmation，不自动造现金或舍入份额。

估值保留source/as_of/received_at/quality，手工/缓存可计算，sample/未知/未来/错币种不用。过期或部分缺价可展示最后观测市值，但net_value和全组合weight为null；未知现金同样不能给出精确净值/权重。输入事实18位整数上限不用于截断可能更大的派生市值。

手算综合夹具：期初现金1000、持仓2股成本20；买2股×20+费2，卖3股×30−费2。FIFO售出成本41，已实现47，余1股成本21；入金100、出金50、分红4、费用1后现金1099；2:1拆股后2股成本仍21。更正入金200后现金1199，作废原入金后999，历史known_at之前仍1099。
