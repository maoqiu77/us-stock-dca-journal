<a id="中文"></a>

# 美股定投交易日记 · 量化分析

[中文](#中文) | [English](#english)

这是一个面向美股个股和 ETF 的本地投资研究与交易辅助工具，新增的“量化分析”区域会先计算可复算的市场指标和相对表现，再通过多智能体协作生成结构化研判；它不会自动下单，也不构成投资建议。与此同时，项目把每天的交易记录和与 AI 的对话整理成一份可浏览的投资日历：点击任意日期即可切换到当天，查看交易操作、AI 建议和后续对话，持续回顾判断并进行复盘。

量化分析的多智能体研究流程借鉴了 [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) 的角色分工和研究辩论思路。TradingAgents 是一个开源的多智能体大语言模型金融交易研究框架，截至 2026-08-29 GitHub 显示约 101,567 stars（约 102k），采用 Apache License 2.0。本项目没有打包或运行 TradingAgents，而是在现有 Next.js + FastAPI、本地优先和隐私边界内做了独立实现；详细说明见 [THIRD_PARTY_NOTICES.md](https://github.com/maoqiu77/us-stock-dca-journal/blob/main/THIRD_PARTY_NOTICES.md)。

![整体界面截图](docs/screenshots/overview.png)

## 演示视频

<video src="https://github.com/user-attachments/assets/d07989b2-8ad5-490d-a9b6-327f87805320" width="800" title="美股定投交易日记演示" controls>美股定投交易日记演示</video>

> [MP4 录屏文件](docs/screenshots/demo.mp4)。

这是一个本地运行的美股研究和交易辅助工具。它会在你的电脑上打开网页界面，用来查看自选股、K 线图、账户概览、策略信号、回测结果和 AI 建议。

数据默认保存在自己的电脑里，不会自动上传到云端。公开版本只带示例数据，不包含真实账户、持仓、交易记录或 API 密钥。

## 适合谁使用

- 想用网页界面管理自选股、交易记录和 AI 对话的人。
- 想查看日 K、周 K、月 K、1 日分时、5 日分时的人。
- 想把私密交易数据保存在本地的人。
- 不熟悉命令行也可以使用：下载对应系统的压缩包，解压后双击启动。

## 下载

请到 [Release 页面](https://github.com/maoqiu77/us-stock-dca-journal/releases) 下载：

- Windows：`stock-trading-platform-next-v1.2.0-windows-x64.zip`
- Apple 芯片 Mac（M1/M2/M3/M4）：`stock-trading-platform-next-v1.2.0-macos-arm64.zip`
- Intel 芯片 Mac：`stock-trading-platform-next-v1.2.0-macos-x64.zip`

不要下载 GitHub 自动生成的 `Source code (zip)`，它是源码包，不是一键运行包。

### Release V1.2.0

本版本围绕日常使用效率、AI 建议和量化分析可靠性进行了集中升级：

- 将主工作区精简为五个核心区域，非当前页面按需加载；概览会纳入观察标的，并按显示收益排序。
- 截图导入支持一次识别多个文件，强化持仓字段解析；交易记录默认按最新日期展示，新增标的时会同步加入跟踪池。
- AI 建议在发送私密投资上下文前明确确认，支持当日连续追问、清空追问记录和中断后恢复；AI 与研究数据设置集中管理。
- 量化分析增强 Yahoo、Nasdaq、FRED、StockTwits、Reddit 和 Polymarket 等公开数据源的采集、缓存与确定性降级，并严格隔离历史日期不能使用的当前数据。
- 完善快速/深度运行阶段、AI 调用量提示、8192 token 输出上限、交易日历判断，以及第 5 个后续交易日收盘后的结果反思。
- 继续保持本地优先：公开发布包只包含示例数据，不包含真实账户、持仓、交易记录、API 密钥或本地数据库。

## Windows 使用方法

1. 下载 Windows 压缩包并选择“全部解压”。
2. 打开解压后的文件夹，双击 `启动股票交易平台.exe`。
3. 等待浏览器打开 `http://127.0.0.1:3000/`。

使用期间请保持黑色控制台窗口打开，关闭后本地服务会停止。

## macOS 使用方法

1. 下载适合自己芯片的 macOS 压缩包并解压。
2. 双击 `启动股票交易平台.command`。
3. 等待浏览器打开 `http://127.0.0.1:3000/`。

如果 macOS 阻止启动，请右键点击文件，选择“打开”，再在确认弹窗中选择“打开”。使用期间请保持终端窗口打开。

## 手机或平板访问

电脑和移动设备连接同一个 Wi-Fi 后，在手机浏览器访问电脑的局域网地址，例如：

```text
http://192.168.1.20:3000
```

这是响应式网页端，不是原生 iOS/Android App。

## 数据保存在哪里

私有运行数据保存在 `storage/local/`，可能包含账户金额、持仓、交易记录和 AI 设置。备份或分享项目时不要提交这个目录。公开示例数据位于 `storage/templates/`。

## 量化分析与多智能体研判

左侧“量化分析”面向 Yahoo 可识别的美国个股和 ETF。页面把结果分成两层：

- 量化事实：均线、RSI、MACD、布林带、ATR、VWMA、回撤和相对 SPY 收益等可复算数据。
- AI 研判：技术、基本面或 ETF 结构、新闻、社交情绪、宏观事件，以及多空和风险讨论形成的非确定性研究结论。

可选公开来源包括 Yahoo Finance、Nasdaq、StockTwits、Reddit、FRED 和 Polymarket。历史日期不会使用当前基本面快照、社交情绪或当前 Polymarket 数据；配置 FRED Key 时宏观序列会固定到分析日期的数据 vintage，无 Key 时历史分析不会用当前修订值 CSV 冒充历史数据。外部行情降级为 sample 时只保留界面预览，不会发送给 AI；没有任何真实数据时会停止后续决策链。

快速模式通常调用“分析师数量 + 8”次 AI，深度模式通常调用“分析师数量 + 18”次 AI；结构化 JSON 修复可能额外调用一次。每次调用最多生成 8192 个总输出 token。结果反思只在第 5 个后续交易日收盘并取得该日精确收盘价后生成。报告、阶段状态和反思保存在 `storage/local/quant-analysis/` 与本地 SQLite 中。FRED Key 和 AI Key 只保存在本机，API 仅返回掩码。

量化分析只发送标的代码、公开市场数据和公开新闻摘要，不发送账户金额、持仓、现金或交易流水。它不会自动下单，也不构成投资建议。多智能体角色架构的来源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 评测 AI 是否理解投资上下文

项目提供包含 20 个虚构案例的离线评测工具，用于检验 AI 是否准确使用账户上下文、遵守长期投资约束并符合用户的投资方式。

```bash
mkdir -p storage/local/evaluations
cp storage/templates/ai-context-evaluation.example.yaml \
  storage/local/evaluations/ai-context-evaluation.yaml
./scripts/evaluate_ai_context.py \
  storage/local/evaluations/ai-context-evaluation.yaml
```

详见 [AI 投资上下文评测指南](docs/ai-context-evaluation.md)。

## 给开发者

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
npm --prefix apps/web install
npm run dev:api
npm run dev:web
```

发布前运行 `npm run check:public-safety`、`npm run check:release-readiness`、`npm --prefix apps/web run lint` 和 `npm --prefix apps/web run build`。

## 参与贡献与安全

提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，不要包含真实账户、投资组合、交易记录、API 密钥、日志或本地数据库。漏洞和敏感数据请按照 [SECURITY.md](SECURITY.md) 中的说明私密报告。

## 维护者与许可证

本仓库由 [@maoqiu77](https://github.com/maoqiu77) 创建并主要维护。本项目采用 [Apache License 2.0](LICENSE) 许可证。

---

<a id="english"></a>

# US Stock DCA Journal + Quant Analysis

[中文](#中文) | [English](#english)

## Highlights

This is a local research and trading-assistance tool for US equities and ETFs. Its new **Quant Analysis** workspace computes reproducible market indicators and relative performance first, then uses a multi-agent workflow to produce a structured research view; it never places trades and is not investment advice. Daily trades and AI conversations are also organized into a browsable investment calendar so you can review decisions, compare later outcomes, and improve your investment process.

![Application overview](docs/screenshots/overview.png)

## Demo Video

<video src="https://github.com/user-attachments/assets/d07989b2-8ad5-490d-a9b6-327f87805320" width="800" title="US Stock DCA Journal demo" controls>US Stock DCA Journal demo</video>

> If your Markdown viewer cannot embed video, open the [MP4 recording](docs/screenshots/demo.mp4) directly.

This is a local stock research and trading-assistance tool for watchlists, candlestick charts, account summaries, strategy signals, backtests, and AI-generated advice.

The Quant Analysis workspace supports Yahoo-recognized US equities and ETFs. It separates reproducible market facts from non-deterministic multi-agent interpretation, archives successful reports locally, excludes current fundamentals, social, and prediction-market data from historical runs, and pins FRED vintages when a key is configured. It never sends account balances, positions, cash, or trading logs into its research prompts. Quick runs normally use `analyst count + 8` AI calls; deep runs use `analyst count + 18`, with a possible extra call for JSON repair. It does not place trades and is not investment advice.

Data is stored on your computer by default and is not automatically uploaded to the cloud. Public releases contain sample data only and do not include real accounts, positions, trade records, or API keys.

## Download

Download a ready-to-run package from the [Releases page](https://github.com/maoqiu77/us-stock-dca-journal/releases):

- Windows: `stock-trading-platform-next-v1.2.0-windows-x64.zip`
- Apple Silicon Mac: `stock-trading-platform-next-v1.2.0-macos-arm64.zip`
- Intel Mac: `stock-trading-platform-next-v1.2.0-macos-x64.zip`

Do not download GitHub's automatically generated `Source code (zip)` archive; it is for developers, not end users.

### Release V1.2.0

This release focuses on daily workflow efficiency and more reliable AI and quantitative research:

- Streamlines the main workspace to five focused areas with lazy-loaded secondary views; the overview now includes watched symbols and sorts by displayed return.
- Supports multi-file screenshot imports, hardens position-field recognition, sorts trades newest first, and automatically tracks newly entered symbols.
- Adds an explicit privacy confirmation before AI advice sends investment context, plus same-day follow-ups, conversation clearing, interrupted-run recovery, and consolidated AI/research settings.
- Improves collection, caching, and deterministic fallback behavior for public sources including Yahoo, Nasdaq, FRED, StockTwits, Reddit, and Polymarket, with stricter historical-date safeguards.
- Clarifies quick/deep run stages and AI call estimates, caps model output at 8192 tokens, strengthens trading-calendar handling, and generates outcome reflection after the fifth following trading-day close.
- Keeps the release local-first: bundles contain sample data only, never real accounts, positions, trade records, API keys, or local databases.

## Run the application

On Windows, extract the package, double-click `启动股票交易平台.exe`, and keep the console window open. On macOS, extract the package, double-click `启动股票交易平台.command`, and use **Right-click → Open** if Gatekeeper asks for confirmation. The browser opens at `http://127.0.0.1:3000/`.

The responsive web interface can also be opened from a phone or tablet on the same Wi-Fi network using the computer's local IP address.

## Data and development

Private runtime data belongs in `storage/local/`; public examples belong in `storage/templates/`. Never publish real portfolio data, trading logs, account identifiers, API keys, cookies, or local databases.

For source development, create a Python virtual environment, install `apps/api/requirements.txt`, install web dependencies with `npm --prefix apps/web install`, then run `npm run dev:api` and `npm run dev:web`. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [AI context evaluation guide](docs/ai-context-evaluation.md) for more information.

Licensed under the [Apache License 2.0](LICENSE).
