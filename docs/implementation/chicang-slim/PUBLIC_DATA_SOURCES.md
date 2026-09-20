# 公开版数据源核验与接入（2026-09-20）

用户已明确准备公开给其他用户使用。本次直接访问 GitHub API / 仓库原文件及供应商官方文档，未购买套餐、注册账号、接受合同、获取用户凭证或部署生产。

## 2026-09-20 看板扩展（当前实现）

- 默认美股目录：30 只常用股票/ETF，来源代码见 `packages/market-data/src/popular.ts`；是人工整理目录，不是假价格，也不声称实时热门排名。首次升级补齐一次，之后删除、重排、清空和备份恢复保持用户选择。
- 新增无 token 美股报价：`MARKET_PROVIDER=eastmoney` 或未设置时启用。30 项已实际请求成功；已支持公开目录搜索并重新核实非默认标的身份，ORCL/UBER/BND 搜索与报价实测通过。NASDAQ/NYSE 普通股和 ETF 可动态添加；来源将 NYSE American/Arca 混称 AMEX，未核实 MIC 的非默认 AMEX 标的不猜测映射。`MARKET_ENABLED=false` 可关闭。AppID/OpenID、用户访问记录、限频及服务端预算仍保留。
- 美股 AI 行情归档、历史 K 线在公开接口模式关闭，不把公开价格自动发送给模型。
- 国内 ETF 扩为 16 只纳指/标普产品，批量核对代码、交易所与名称；指数使用 SPX、NDX100（不是纳斯达克综合指数 NDX）、NQ00Y 当月连续合约。
- 溢价使用来源 f402 折价率的相反数，明确“来源参考溢价，估值时点未知”；不会标为已验证的实时 IOPV。官方 NAV 与这项来源估值分开。
- 份额和增减来自上交所/深交所同源、相邻报告日；原接口单位万份转换为份，UI 再按万份展示。16 项真实探测均取得份额及增减。缺失时不猜测日期或增量。
- 60 日分位已有相同来源日观察值去重和分位计算，按 120 天过期缓存保留最近观察值；必须与交易所报告最近 60 个交易日逐日对应，任何缺口均显示缺失和样本数。尚未取得完整历史回填，也未核实截图应用的分位口径，不能声称该列现已有数值。
- 30 个默认头像来自 FMP 的 `https://financialmodelingprep.com/image-stock/{symbol}.png`，已验证 PNG 并打包到客户端。新增非默认标的使用对应符号的远程头像，失败显示代码，不伪造品牌图案。
- 当前改动未部署云函数。开发者工具已验证默认列表、头像、管理按钮与上移/下移；真实云端报价和真机链路仍需部署后验收。

## 当前选择：无需 token 的公开接口

用户补充为非商业使用，要求采用当前可直接获取的数据。国内默认已改为东方财富公开接口（最初支持 513500、017730，现扩展见上节）。实时核对目录名称；ETF 使用 fltt=2 的参考价格与行情日期，基金使用正式净值与净值日。公告日未知，溢价不计算。服务端缓存 300 秒，失败显示不可用。无需 TUSHARE_TOKEN；不代表取得数据再分发授权或稳定性保证。尚未部署云函数。

`CN_MARKET_PROVIDER=eastmoney`（未设置时默认此模式）；`CN_MARKET_ENABLED=false` 可关闭。原有 AppID/OpenID、用户访问记录与限频仍保留；公开访问还需按现有流程配置 MARKET_ACCESS_MODE 和用户 consent 记录。美股现可选无 token 公开接口；AI 模型仍需服务端凭证。

以下 Tushare 配置仅在 `CN_MARKET_PROVIDER=tushare` 时适用。

## 查到什么

| 项目 | 已核实信息 | 本项目处理 |
|---|---|---|
| [AKShare](https://github.com/akfamily/akshare) | 仓库 MIT；README 声明数据仅供学术研究；`fund_etf_em.py`、`fund_em.py` 调用东方财富接口 | 未安装 Python 服务；自行实现公开接口适配，代码许可不是行情转授权 |
| [efinance](https://github.com/Micro-sheep/efinance) | 仓库 MIT；README 明确“仅供学习交流使用，不得用于商业用途”；基金 getter 使用东方财富移动端接口 | 未引入该 SDK；参考其公开接口研究 |
| [Tushare](https://github.com/waditu/tushare) | 有官方 REST API 与基金目录、正式 NAV、ETF 日线；HTTP 文档与 SDK 可交叉核对 | 已自行编写小型 TypeScript HTTPS 适配器；没有引入 Python 或复制整个开源库。默认不启用，需独立确认公开展示与缓存许可 |
| [TickFlow](https://tickflow.org) | 官网有 A/美/港行情 API，个人套餐与免费历史日 K 入口 | 仅作候选；没有核实其 QDII 净值覆盖及公开再分发许可，不声称免费方案满足需求 |
| [Twelve Data](https://twelvedata.com/business) | 当前仓库已有 US adapter；现有 `market-entitlement.json` 仍为待确认 | 继续复用；不自动开通商业权限 |

官方字段依据：

- [fund_basic](https://tushare.pro/document/2?doc_id=19)：目录、场内 E / 场外 O、份额代码、状态。当前文档列出至少 2000 积分。
- [fund_nav](https://tushare.pro/document/2?doc_id=119)：`unit_nav`、`nav_date`、`ann_date`，当前文档列出至少 2000 积分。
- [fund_daily](https://tushare.pro/document/2?doc_id=127)：收盘后 ETF 日线；当前文档列出至少 5000 积分。**不是实时 IOPV。**
- [REST 协议](https://tushare.pro/document/1?doc_id=130)、[用户协议](https://tushare.pro/document/1?doc_id=409)、[服务协议](https://tushare.pro/document/1?doc_id=405)。积分说明只表明 API 访问门槛，不是公开展示/再分发许可。

本机无凭证探测 `https://api.tushare.pro` 得到 HTTP 200、业务码 40101（缺 token）。只证明 TLS 服务可到达，不代表取得真实基金数据或通过商业授权。

## 已写入的代码

- `TushareFundProvider`：固定 HTTPS 主机、禁止重定向、超时/12 秒总预算、响应白名单、屏蔽供应商原始错误与 token。
- 国内目录最多 12 项，只读取服务端确认的人民币份额代码白名单；不根据六位代码或名称相似强行认定 A/C、美元/人民币相同。不自动塞入示例基金。
- ETF 显示收盘价及交易日、正式净值所属日、公告日；只用在该交易日已公告的净值计算非实时比值。未知/零分母/未来公告不计算。场外基金没有场内价格或折溢价。
- `domesticBoard` 云 action 独立于 US Provider；保留可信 AppID/OpenID、用户访问检查与限频，公开行情缓存不包含私人账本。
- Tushare 模式：公开展示/缓存许可、凭证、有效期任何一项缺失即关闭。缓存到期不延长授权，不把旧值标为今日最新。
- 小程序两个国内分段已接响应、加载/空态/失败、目录详情及复用手动持仓表单；持有标的回到既有持仓详情。
- 国内“和 AI 聊聊”仅提供用户选定身份和相关本地原文/持仓，**不会将尚未授权用于 AI 的国内价格、净值外发**。国内候选批量比较、AI 行情凭据尚未接通，不能标为完成。
- 本机私有 `config.local.json` 原来没有 `marketFunctionName`，现已设为已有的 `portfolioMarket`；配置值不构成供应商权限。

## 可选 Tushare 模式需要补齐

1. 取得覆盖“向微信小程序用户展示、缓存、数据归档/备份、提供给模型”用途的明确许可；模型用途可单独关闭。不要仅购买积分就填写授权开关。
2. 把 token 放在 **portfolioMarket 服务端环境变量**，不要贴聊天、写源码或小程序。
3. 在云端配置以下项目；只有合同真实允许才填写 true：

| 环境变量 | 含义 |
|---|---|
| `TUSHARE_TOKEN` | 服务端密钥 |
| `CN_MARKET_ENABLED` | 功能开关 |
| `CN_PUBLIC_DISPLAY_ALLOWED` / `CN_CACHE_ALLOWED` | 公开展示、缓存获允许 |
| `CN_ENTITLEMENT_REFERENCE` | 内部授权记录编号，非密钥 |
| `CN_ENTITLEMENT_VALID_UNTIL` | 授权到期 ISO 时间 |
| `CN_CACHE_SECONDS` | 获允许的缓存秒数，60–86400 |
| `CN_CNY_FUND_CODES` | 经核实的人民币份额 TS 代码，逗号分隔；没有默认值 |

4. 部署本次 `portfolioMarket` bundle 到明确的测试环境，核对 `EXPECTED_WEAPP_APPID`、`market_access`（closed_beta 的 enrolled / enabled / consentVersion）、公开缓存/租约/预算集合权限。运行真实 ETF / QDII 样本，核对源站原始日期和数据，再做公开发布。
5. 原有 US 同样要补齐 Twelve Data key、feed、延迟、授权及 access 配置。两套服务独立；不以开国内功能绕过美股授权。
6. 既有截图清理 cron 与专项截图准确率仍需真实环境验收，未因本轮适配器完成而关闭。

给供应商的询价文本（尚未发送）：

> 我们计划在公开微信小程序展示美股/国内纳指标普 ETF 和有限场外 QDII 的价格、日终行情及正式单位净值。请确认允许的终端用户范围、延迟标识、缓存及历史保留期限、署名要求、费用与配额，以及是否允许将已授权行情作为第三方 AI 模型输入、归档分析来源和随用户备份导出。我们不提供下单或交易执行。请分别说明展示和 AI 用途的许可。

## 后续 GitHub 核验

检索 `wyouc-hope/nasdaq-etf-premium`、`k1403530812/nasdaq-etf`、`xcb97/nasdaq_etf_premium_monitor`。第一个仓库使用同日收盘价/净值计算历史溢价，最新估值另做指数滚动，README 明确缺汇率和仓位因子；与当前来源参考溢价口径不同，未混合导入其历史序列。其引用的 HaoETF 首页可读，但目标 159501 详情没有可用历史响应，仍未确认截图来源。未安装或执行这些仓库代码。
