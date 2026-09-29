# 多市场看板（A 包）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在总览下新增美股／场内 ETF／场外基金看板，交付独立自选、可靠的多市场行情与详情，为后续 AI 快研提供明确的数据边界。

**Architecture:** 保留现有接口和账本，新建 FastAPI `market_board` 模块及独立 SQLite 表；供应商、契约、存储、指标与 HTTP 路由分离。前端新增 feature，复用 shadcn 和现有图表，真实数据与确定性示例严格区分。B 包 AI 日历增强不在本计划内，不能把 A 包验收称为整体迁移完成。

**Tech Stack:** 使用项目已安装的 Next.js 16.2.9、React 19、TanStack Query、shadcn、lightweight-charts、FastAPI、Pydantic、SQLite、requests；Python unittest 和 Node 原生测试，不新增运行时服务或默认付费依赖。

**Spec:** `docs/superpowers/specs/2026-09-29-market-board-ai-journal-migration-design.md`。

**Status:** 待用户审阅实施计划与确认执行方式。推荐 Native：由当前任务逐项实现，不把前后端共享契约拆给多个同时修改者。

## Global Constraints

- 看板保留三个板块：美股、场内 ETF、场外基金。用户已明确第三项是场外基金。
- A 股个股报价和研究接入底层能力，不增加第四个 A 股看板。
- 自选与持仓、交易流水、策略股票池独立保存；首次可载入公开默认目录，此后清空列表必须保持为空，不能自动重新种入。
- 运行数据统一保存到 `storage/local`，公开确定性示例放 `storage/templates`。
- 不把数据库、真实记录、密钥、Cookies 或原项目用户文件提交到 Git。
- 单行的真实事实与样例不混合计算。样例不得进入真实溢价、分位、组合估值或 AI 市场事实；必要字段缺失时显示 `--`。
- 国内基金可在看板观察和快研，但不能通过详情按钮直接写入尚不支持其语义的旧持仓模型。
- 沿用现有语义 CSS 与 Tailwind token，使用 `gap-*`，浏览器 API 组件声明 `"use client"`。
- 实施前读取本项目安装版本的 Next.js 本地文档，不依赖旧版本惯例。
- 在 `http://127.0.0.1:3000` 完成用户流程验收，API 使用 `http://127.0.0.1:8000`。
- 复用一键启动的开发环境；需要重启时先说明原因并征求同意，不擅停用户进程。
- 原项目、旧 Streamlit 项目及无关本地文件保持不变。

## Review Focus

1. 同码跨身份：`CN:XSHG:501312:ETF` 等身份不能靠猜测创建；场外基金与场内挂牌必须由目录确认，测试见任务 1、3。
2. 清空后重启：空关注集合不能重新种入；两个页面并发管理不能互相覆盖，测试见任务 2、8。
3. 历史污染：供应商切换、日期缺口、日内未最终确认观察、示例价格不能凑满 60 日分位，测试见任务 6。
4. 长列表与局部故障：31 个默认美股不能因 30 个批次限制掉一项；单基金请求超时不能抹掉其余行，测试见任务 7。
5. 陈旧异步响应：切板块、清空搜索或切详情后旧请求不能覆盖新状态；测试见任务 8，浏览器验收见任务 10。

## 0. 执行约定与范围映射

- 先按 using-git-worktrees 确认隔离方式，创建或复用隔离检出；不得切换或重启用户当前 3000 运行目录。最终同步到 canonical 检出需检查两边修改并保留用户变更。
- 单元测试全部使用临时数据库、固定时钟和注入的 HTTP 响应，不读取真实数据库或访问互联网。联网覆盖检查是独立、有界的诊断，不进入确定性测试。
- Python 定向命令统一为 `PYTHONPATH=apps/api .venv/bin/python -m unittest discover -s apps/api/tests -p '<文件名>' -v`；前端定向命令为 `node --test apps/web/src/features/market-board/<文件名>.test.ts`。
- 各任务执行 RED → 最小实现 → GREEN；每项结束只 stage 本项明确文件并做本地提交，不推送。若测试因环境而非预期断言失败，先修复测试环境，不算 RED。
- A 包覆盖设计第 4、5、7 节及第 9 节行情／页面／工程要求。设计第 6 节和第 3.1 节跨 AI 流程归 B 包，A 包不添加尚不能工作的「和 AI 聊聊」按钮。
- A 包为 B 包预留分市场报价／K 线／净值契约，不启动模型、不创建 AI 快照、不更改旧量化 quick / deep。

## 1. 共享契约与固定参数

所有新 API JSON 使用 snake_case，前后端同名，不通过旧 Quote 的必填数值类型丢失空值。全部 Pydantic 入站模型禁止未知字段。下列模型定义在 `modules/market_board/models.py`，前端在任务 8 镜像并使用 Zod 校验。

| 名称 | 字段／规则 |
| --- | --- |
| `Segment` | `us`、`etf`、`fund` |
| `Instrument` | `key, symbol, name, market, exchange, asset_type, currency, timezone, provider_symbols, verified_at`；market 为 US/CN，asset_type 为 STOCK/ETF/FUND，currency 为 USD/CNY；key 固定为 `market:exchange:symbol:asset_type`，场外 exchange=FUND；身份来自核实的目录而非输入字符串猜测 |
| `ObservationMeta` | `source, as_of, fetched_at, status, timeliness, cache_state, reason`；status=available/partial/stale/missing/sample，timeliness=realtime/delayed/eod/unknown；as_of 可空，不能用 fetched_at 冒充；cache_state=miss/fresh_hit/stale_hit |
| `Quote` | `instrument_key, price, previous_close, change, change_pct, volume, volume_unit, trading_date, session, meta`；金额与数量为十进制字符串或 null，session=pre/regular/post/closed/unknown；缺失报价不能含看似有效价格 |
| `Bar` / `Series` | Bar：`time, trading_date, open, high, low, close, volume, is_final`；Series：`instrument_key, currency, period, range, timezone, adjustment, volume_unit, time_label, bars, meta`；period=1d/60m/30m/15m/5m/1m，range=1mo/3mo/1y；time 用带时区 ISO 时间，日 K 使用交易日期，bars 升序唯一 |
| `Nav` | `value, change_pct, nav_date, announcement_date, meta`；日期未知用 null，净值不能充当 Quote.price |
| `PurchaseLimit` | `state, amount, currency, channel, meta`；state=limited/unlimited/suspended/unknown；仅 limited 有正数 amount，渠道固定 eastmoney；没有证据为 unknown |
| `EtfMetrics` | `premium_pct, premium_basis, reference_value, reference_date, percentile60, sample_days, shares, shares_date, shares_change, previous_shares_date, meta`；premium_basis=vendor_reference/nav/iopv/unknown，份额统一为份 |
| `FundHoldings` | `instrument_key, report_date, allocation, stocks, meta`；allocation 包含独立 report_date 与 stocks_pct/bonds_pct/cash_pct；stocks 为 rank/symbol/name/weight_pct，最多 10 项；保留各自报告期 |
| `BoardRow` | `instrument, quote, nav, purchase_limit, metrics, quality`；不适用的数据为 null；quality 为 ObservationMeta.status 的同一枚举 |
| `Benchmark` | `symbol, name, kind, quote`；kind=index/future；固定标普500、纳斯达克100、小型纳指期货三个参考对象，独立失败状态 |
| `BoardResponse` | `segment, rows, benchmarks, revision, fetched_at, warnings`；revision 对应自选版本，rows 不因为数据失败而漏掉已关注身份 |
| `Selection` | `segment, revision, items`；items 为有序 Instrument 列表；单个 us 集合最多 100，etf/fund 各 30，行情请求每批最多 30 |
| `DetailResponse` | `row, holdings`；holdings 仅场外基金适用，图表由 Series 路由独立获取 |
| `Capabilities` | `instrument_key, quote, nav, periods, ranges`；字段说明服务支持能力，不表示当前联网成功；不支持的周期不得回落到别的周期 |

模型中百分数统一为百分比点，0 为有效值；Decimal 在 JSON 中保留字符串，只有图表渲染层转换为有限 number。模型验证拒绝 NaN/Infinity、币种与身份不一致、未来超过 60 秒的观察、重复／倒序 bar 与无效 OHLC；不允许缺失字段自动变为 0。

缓存键：`provider + identity + data_kind + period + range + adjustment + schema_version`。刷新参数如下，作为实现默认值而非行情实时性承诺：报价 30 秒、K 线 60 秒、目录 24 小时、净值与限额 15 分钟、披露持仓 6 小时、份额与交易日证据 6 小时。过期真实缓存保留并明确 stale：报价／K 线最长 7 天，净值／限额最长 7 天，披露最长 30 天；超过保留期返回 missing 或隔离的 sample。

客户端无后台轮询；手动刷新受服务端同键 10 秒冷却限制，刷新报价／K 线但不强制绕过低频披露缓存。请求总截止 12 秒，单上游请求最多 4 秒、连接最多 2 秒、主机并发最多 3；429 按有效 Retry-After（最多 300 秒）或 60 秒退避，本轮不立即重试。

## Task 1: 标的身份与可验证数据契约

**Files:** Create `apps/api/app/modules/market_board/__init__.py`, `models.py`, `identity.py`; Test `apps/api/tests/test_market_board_models.py`。

**Interfaces:** 产出上表全部模型；`normalize_symbol_input(value: str) -> tuple[str, str | None]` 只做格式归一和后缀解析，不创建身份；`validate_instrument(value: dict) -> Instrument` 校验跨字段关系。

- [ ] Step 1：写失败测试。验证 `normalize_symbol_input(' 000001.sz ') == ('000001', 'XSHE')`，`.SS` 和 `.SH` 均归一 XSHG；bare `159501` 保留前导零且 exchange 为 None；`Instrument` 拒绝 FUND/USD 与 CN/XNAS 等不一致身份。Quote 中 price 缺失保持 null，change_pct='0' 不变为 null，错误 OHLC 被拒绝。

```python
def test_symbol_normalization_preserves_domestic_identity(self):
    self.assertEqual(normalize_symbol_input(" 000001.sz "), ("000001", "XSHE"))
    self.assertEqual(normalize_symbol_input("159501"), ("159501", None))
    self.assertEqual(normalize_symbol_input("513100.ss"), ("513100", "XSHG"))
```

- [ ] Step 2：运行 `test_market_board_models.py`，确认失败是缺少上述模型／行为。
- [ ] Step 3：使用现有 Pydantic 和标准库 Decimal 实现契约；不得修改旧 `api_models.py` 的交易请求类型。
- [ ] Step 4：重跑测试，补覆盖 `CN:FUND:501312:FUND` 与场内身份不同、未来观察、基金净值混入 price、日期格式和负数量。
- [ ] Step 5：本地提交 `feat: define market board contracts and instrument identities`，仅包含本项文件。

## Task 2: 自选、目录和缓存独立持久化

**Files:** Create `apps/api/app/modules/market_board/store.py`, `migration.py`; Modify `apps/api/app/core/database.py`; Test `apps/api/tests/test_market_board_store.py`, `test_database_migration.py`。

**Interfaces:** `BoardStore(db_path: Path)` 提供 `ensure_initialized(defaults: dict[Segment, list[Instrument]]) -> None`, `get_selection(segment: Segment) -> Selection`, `replace_selection(segment: Segment, keys: list[str], expected_revision: int) -> Selection`, `save_instruments(items: list[Instrument]) -> None`, `get_instrument(key: str) -> Instrument | None`, `read_cache(key: str) -> dict | None`, `write_cache(key: str, payload: dict, expires_at: str, retain_until: str) -> None`, `upsert_premium(key: str, basis: str, trade_date: str, premium: str, is_final: bool) -> None`, `read_premiums(key: str, basis: str, since: str) -> list[dict]`。版本冲突抛 `SelectionConflict`。

- [ ] Step 1：写失败测试，临时 DB 建旧 v4 和 v0 场景：迁移后 `user_version == 5`，旧 watchlist/app_state/quant 数据逐项不变；两次迁移没有重复表／备份；清空 selection 后重新初始化仍为空；旧 revision 更新抛冲突且不更改数据。
- [ ] Step 2：运行 `test_market_board_store.py` 和 `test_database_migration.py` 得到预期 RED。
- [ ] Step 3：新增 `board_instruments(key,payload)`、`board_selections(segment,revision,initialized)`、`board_selection_items(segment,instrument_key,sort_order)`、`board_cache(cache_key,payload,expires_at,retain_until)`、`board_premiums(instrument_key,basis,trade_date,premium,is_final)`，有序集合和历史使用复合唯一键。整体替换自选在单事务内校验身份、板块、长度、重复及 revision。
- [ ] Step 4：修正旧 v4 分支仅写入版本 4 再执行 v5，不能把 CURRENT_DB_SCHEMA_VERSION=5 直接代入旧 v4 分支跳过迁移。对已有磁盘 DB 在开始迁移事务前使用 SQLite backup API 生成同目录 `backups/` 下唯一备份，检查 integrity_check；备份失败则中止。新建空库和内存测试库不备份。数据读写均尊重注入的 db_path，不在测试触碰真实库。
- [ ] Step 5：重跑本项测试，覆盖未知身份无法加入、重排必须保留正确 key、删除仅关注关系、事务失败不半保存。提交 `feat: persist isolated market board selections and caches`。

## Task 3: 有界 HTTP、目录搜索与公开默认标的

**Files:** Create `apps/api/app/modules/market_board/http.py`, `catalog.py`, `providers/__init__.py`, `providers/catalogs.py`; Create `storage/templates/market-board-instruments.example.json`, `storage/templates/market-board-selection.example.json`; Test `apps/api/tests/test_market_board_catalog.py`, `test_market_board_http.py`; Create `docs/market-board-provider-coverage.md`。

**Interfaces:** `PublicHttp.get(url: str, *, referer: str | None = None, max_bytes: int = 4_000_000, deadline: float | None = None) -> bytes`；初始化注入 request 实现与时钟。`InstrumentCatalog(store: BoardStore, http: PublicHttp)` 提供 `search(query: str, market: str, asset_type: str | None, limit: int = 20) -> list[Instrument]`, `resolve(key: str) -> Instrument | None`。

- [ ] Step 1：写失败测试：查询 `159501` 返回核实的 XSHE/ETF/CNY；同代码基金与股票结果保持独立；模糊名称返回多个选项不替用户选择；不受支持或身份不全的远端行被过滤；未知币种基金不能进入人民币集合；公开默认目录的第 31 个美股不丢失。
- [ ] Step 2：定向运行 catalog/http 测试并观察 RED。
- [ ] Step 3：从原项目 `packages/market-data/src/popular.ts` 和市场页公开默认代码清单整理模板，仅保留公开身份，不复制任何价格或用户状态。已核实静态目录可离线使用；目录标记核验时间，不冒充当前活跃状态。远端更新按交易所／品种元数据确认，名称变更不误判为另一个标的。
- [ ] Step 4：实现东方财富证券 suggest 和基金目录适配。禁止执行 JS：只解析已限定的 JSON 数据段；编码按供应商确定（腾讯 GB18030、JSON/HTML 按内容类型），响应超限提前终止。拒绝外部输入 URL、非白名单域、重定向及凭据透传，错误不输出完整请求或账户信息。
- [ ] Step 5：用公开测试标的 AAPL/SPY、513100、159501、600519、000001.SZ、016701 完成每类候选源有界只读探测；每条记录来源、字段、日期、HTTP／解析结果和权限限制到 coverage 文档，不保存 Cookies 或密钥。最多每条路径一次初查，不循环撞限流。失败不伪造覆盖成功，后续该适配必须能明确降级。
- [ ] Step 6：重跑两组测试，包含 429 冷却、超长响应、超时、重定向和正文脚本不执行；提交 `feat: add verified multi-market instrument discovery`。

## Task 4: 美股／国内报价与 K 线适配

**Files:** Create `apps/api/app/modules/market_board/providers/us.py`, `providers/cn.py`, `providers/bars.py`, `calendar.py`; Test `apps/api/tests/test_market_board_quotes.py`, `test_market_board_bars.py`, `test_market_board_calendar.py`。

**Interfaces:** `USProvider(http: PublicHttp).quotes(instruments: list[Instrument], now: datetime) -> list[Quote]`；`CNProvider` 同签名；`BarsProvider(http: PublicHttp).series(instrument: Instrument, period: str, range_: str, now: datetime) -> Series`；`classify_observation(instrument: Instrument, as_of: datetime | None, now: datetime, exchange_status: str | None) -> tuple[str, str]` 返回 session 与 ObservationMeta.status；时段证据不足时 session=unknown，质量为 partial 而非自行发明 unknown 质量枚举；`fetch_cn_trading_dates(http: PublicHttp, through: date, count: int = 60) -> list[str]` 只返回完整核实窗口或空列表。

- [ ] Step 1：写 fixture 驱动的失败测试：US/CN 路由无串线，缺前收不伪造零涨幅，回包代码或交易所不符拒绝；腾讯 CNY 字段不符拒绝。K 线测试精确保留 '1.2345'、校验 high/low，重复时间拒绝，当前未闭合 bar 标 `is_final=False`。
- [ ] Step 2：运行 quotes/bars/calendar 三组测试得到 RED。
- [ ] Step 3：参考原项目 `eastmoney-us.ts`、`cn-holding-quotes.ts`、`research-provider.ts` 实现独立适配，复用现有 requests 与基础工具；不把旧 `get_quotes` 中自动生成的 sample 包装成真实报价。美股按 Yahoo chart → Nasdaq → 腾讯可验证路径，国内按东方财富 → 腾讯；仅为缺失身份补请求，来源必须对应实际响应。
- [ ] Step 4：K 线保留供应商复权与单位，日线可用范围 1mo/3mo/1y；分钟请求最多 120 根，不能声称覆盖完整一年。美国无时区分钟字符串不猜偏移；带交易所当地时间的已知格式用 ZoneInfo 按每根 bar 日期解析。无法支持的周期返回 missing 与理由，不替换周期。主／辅周期选择界面属于 B 包。
- [ ] Step 5：交易日期证据参考原 `etf-calendar.ts`，必须校验分页完整、代码和日期唯一；不能把周一到周五等同于国内交易日。无可靠交易日或 session 证据不臆断“开市”；供应商 session、时间与已核实日历交叉校验，早收盘或临时休市证据不足为 unknown。
- [ ] Step 6：GREEN 覆盖中国午休、周末、核实的节假日 fixture、美股夏令时切换两侧、半日市未知状态、分钟聚合不跨午休、复权混合拒绝、不可用周期；提交 `feat: adapt timestamped US and CN quotes and bars`。

## Task 5: 场外净值、渠道限额和基金披露

**Files:** Create `apps/api/app/modules/market_board/providers/funds.py`, `providers/fund_parsers.py`; Test `apps/api/tests/test_market_board_funds.py`。

**Interfaces:** `FundProvider(http: PublicHttp).nav(instrument: Instrument, now: datetime) -> Nav`, `.purchase_limit(instrument: Instrument, now: datetime) -> PurchaseLimit`, `.holdings(instrument: Instrument, now: datetime) -> FundHoldings`；JSON/HTML 纯解析函数放 fund_parsers.py，使用标准库 HTMLParser，无新增 HTML 依赖。

- [ ] Step 1：写失败测试，覆盖同日多条 NAV、公告日未知、旧季度披露、缺额度、明确暂停／不限额／限额、资产配置报告期不同于股票重仓；断言缺额度 state='unknown' 且 amount=None，'1.5万元' 解析为 '15000'，缺净值时 quote 不被填充。
- [ ] Step 2：运行 `test_market_board_funds.py`，确认 RED。
- [ ] Step 3：迁移原 `eastmoney-provider.ts` 的 lsjz、基金销售页、FundArchivesDatas 和 Data_assetAllocation 解析规则；只接受已核实人民币份额，保留前导零、渠道与日期。上游 JS 中仅提取严格限定变量的 JSON，不 eval。
- [ ] Step 4：净值、限额与持仓独立错误状态；任一失败保留其他事实。披露重仓表按标题定位列，不依赖第三列永远是权重；没有股票披露但有资产配置时保留有效 allocation，不推断实时仓位。
- [ ] Step 5：重跑测试并覆盖 HTML 列重排、畸形日期、未来报告、同名不同份额、USD 份额误入、基金暂停且 amount 空；提交 `feat: add fund NAV limits and disclosed holdings`。

## Task 6: ETF 参考溢价、份额与完整交易日分位

**Files:** Create `apps/api/app/modules/market_board/providers/etf.py`, `metrics.py`; Test `apps/api/tests/test_market_board_metrics.py`。

**Interfaces:** `EtfProvider(http: PublicHttp).metrics(instruments: list[Instrument], now: datetime) -> dict[str, EtfMetrics]`, `.benchmarks(now: datetime) -> list[Benchmark]`；`premium_percentile(observations: list[dict], trading_dates: list[str], current: str, basis: str) -> tuple[str | None, int]`；`shares_delta(current: tuple[str, str], previous: tuple[str, str] | None, trading_dates: list[str]) -> str | None`。

- [ ] Step 1：测试 59 个日期返回 percentile=None/sample_days=59；完整窗口含 30 个小于等于当前值返回 '50'；重复日期不能凑 60；缺一天、混 basis、sample/is_final=False 历史被排除；万份正确转为份，跨缺口份额变化为 None。

```python
def test_shares_delta_requires_adjacent_exchange_dates(self):
    dates = ["2026-09-23", "2026-09-24", "2026-09-25"]
    self.assertIsNone(shares_delta((dates[2], "120000"), (dates[0], "100000"), dates))
    self.assertEqual(shares_delta((dates[2], "120000"), (dates[1], "100000"), dates), "20000")
```

- [ ] Step 2：运行 `test_market_board_metrics.py` 得到 RED。
- [ ] Step 3：迁移原 ETF 来源参考字段映射与沪深交易所份额报告解析。东方财富折价字段转参考溢价时按原口径反号，腾讯参考字段按其口径保留，basis 在持久层附带供应商与定义版本，不能仅用 vendor_reference 合并两者历史。
- [ ] Step 4：历史每身份／口径／交易日只一条；交易时段内观察可供当前展示但不写最终日样本，来源无法确认最终日值时不给该日最终标记。保留最近 120 个自然日的证据；需核实最近 60 个交易日完全覆盖才计算。第一次使用无法回补同口径历史时明确样本不足，不改成任意 60 条。
- [ ] Step 5：GREEN 覆盖 NAV 不晚于价日且公告已公开的条件、IOPV 无时间不算同步值、零溢价、负溢价、份额来源失败、期货基准明确 kind='future'；提交 `feat: calculate provenance-aware ETF metrics`。

## Task 7: 看板聚合、缓存降级与独立 API

**Files:** Create `apps/api/app/modules/market_board/service.py`, `cache.py`, `sample.py`, `router.py`; Create `storage/templates/market-board-observations.example.json`; Modify `apps/api/app/main.py`; Test `apps/api/tests/test_market_board_api.py`, `test_market_board_service.py`。

**Interfaces:** `BoardService(store, catalog, http, now)` 的 `board(segment: Segment, refresh: bool = False) -> BoardResponse`, `detail(key: str, refresh: bool = False) -> DetailResponse`, `quotes(keys: list[str], refresh: bool = False) -> list[Quote]`, `series(key: str, period: str, range_: str, refresh: bool = False) -> Series`, `capabilities(key: str) -> Capabilities`。从配置的 DB_PATH 建实例，支持测试依赖覆盖；内部缓存／供应商只使用前面任务契约。

路由前缀 `/api/market-board`：

| 方法／路径 | 输入 | 输出／错误 |
| --- | --- | --- |
| GET `/search` | q、market=US/CN、asset_type 可选、limit 1..20；q 长度 1..80 | `{items: Instrument[]}`；参数错误 422；支持 A 股发现，不产生第四个板块 |
| GET `/selection/{segment}` | segment | Selection |
| PUT `/selection/{segment}` | `{keys: string[], expected_revision: int}` | Selection；版本冲突 409，未知身份／板块不符 422 |
| GET `/board/{segment}` | refresh=false | BoardResponse，部分缺失仍 200 |
| GET `/detail` | key、refresh=false | DetailResponse；未知 key 404 |
| POST `/quotes` | `{keys: string[], refresh: boolean}`，最多 30 | `{items: Quote[]}`；未知 key 422，保留顺序 |
| GET `/series` | key、period、range、refresh=false | Series；非法枚举 422，不支持的合法周期返回 missing |
| GET `/capabilities` | key | Capabilities；未知 key 404 |

- [ ] Step 1：写失败测试：31 个美股分成 30+1 两批并按自选顺序返回全部 31 行；基金一行超时保留其他行；同 key 并发刷新只发生一次供应商调用；clear/reorder 不触及旧 app_state 交易内容。
- [ ] Step 2：运行 service/api 两组测试得到 RED，API 可采用现有 unittest 调用路由的方式，避免引入额外 HTTP 测试库。
- [ ] Step 3：实现聚合与缓存固定参数，慢的份额／持仓按独立缓存和截止时间降级。全板截止时间耗尽返回已有结果及其余 missing 行，不取消身份。手动刷新绕过新鲜报价缓存但保留冷却和供应商退避。
- [ ] Step 4：失败优先使用带原时间的真实缓存，过期标 stale。无真实值时公开模板内身份允许展示整行 sample，其 derived 指标为空；任意新增未知于模板的标的显示 missing。UI 始终可加载确定性演示，但不为所有 ticker 生成假“真实价”，sample 不写真实历史。
- [ ] Step 5：`main.py` 只 include 独立 router，不改旧行情／交易／AI 路由。错误正文为受控中文理由及稳定错误码，不暴露上游响应正文；生产只允许固定白名单源。API 变更由现有开发热重载加载，不主动重启。
- [ ] Step 6：GREEN 验证 TTL 边界、保留上限、429、每类数据不同缓存键、refresh 不刷净值、状态校验、409、空列表返回 0 行且不请求供应商。运行旧 `test_api_contracts.py` 和 `test_market_cache.py`；提交 `feat: expose isolated market board APIs`。

## Task 8: 前端数据契约、自选操作和异步状态

**Files:** Create `apps/web/src/features/market-board/types.ts`, `api.ts`, `queries.ts`, `state.ts`, `format.ts`; Test 同目录 `api.test.ts`, `state.test.ts`, `format.test.ts`。

**Interfaces:** Zod schema 镜像任务 1 并导出推导类型；api 提供 `fetchBoard(segment, refresh?, signal?)`, `fetchSelection(segment, signal?)`, `saveSelection(segment, keys, expectedRevision, signal?)`, `searchInstruments(query, market, assetType?, signal?)`, `fetchDetail(key, signal?)`, `fetchSeries(key, period, range, signal?)`，返回对应模型 Promise。纯函数 `moveSelection(keys: string[], key: string, to: number): string[]`, `removeSelection(keys: string[], removed: string[]): string[]`, `sortRows(rows: BoardRow[], field: string, ascending: boolean): BoardRow[]`。

- [ ] Step 1：Node 测试 mock fetch，断言请求路径与字段正确，AbortSignal 原样传递、非 2xx 抛受控错误、API 返回畸形数字不变成 0；纯函数不变异输入、删除所有得到 []、重排无重复、空值正反排序都在末尾。

```typescript
test("selection operations preserve identity and an intentionally empty list", () => {
  const keys = ["US:XNAS:AAPL:STOCK", "US:ARCX:SPY:ETF"];
  assert.deepEqual(removeSelection(keys, keys), []);
  assert.deepEqual(moveSelection(keys, keys[1], 0), [keys[1], keys[0]]);
  assert.equal(keys[0], "US:XNAS:AAPL:STOCK");
});
```

- [ ] Step 2：运行 `node --test "apps/web/src/features/market-board/*.test.ts"` 得到 RED。
- [ ] Step 3：API 基址复用 `resolveApiBaseUrl` 与既有 rewrite；查询 key 包含 segment/key/period/range；搜索防抖 300ms 并对每次 query key 使用 AbortSignal。板块变更不保留其他板块 placeholder；保存成功刷新相应 revision 和 board，409 刷新服务端自选并提示重试，不强行覆盖。
- [ ] Step 4：formatter 接受 null 与十进制字符串，股票价展示币种、ETF／净值最多保留四位但不修改底层值；参考溢价、限额状态、来源与日期独立格式化；份额转换为万份仅在显示层进行。
- [ ] Step 5：GREEN 验证同 key 不同 segment 不碰撞、历史 stale 时间不改为当前、人民币不出现美元符号、0 溢价显示 0.00%、unknown 限额不是不限额；提交 `feat: add market board client state and formatting`。

## Task 9: 看板页面、详情和图表接入

**Files:** Create `apps/web/src/features/market-board/market-board-view.tsx`, `instrument-search.tsx`, `selection-manager.tsx`, `us-table.tsx`, `etf-table.tsx`, `fund-table.tsx`, `instrument-detail.tsx`, `data-quality.tsx`; Create `apps/web/src/features/charts/board-chart.tsx`, `board-chart-data.ts`, `board-chart-data.test.ts`; Modify `apps/web/src/features/platform/types.ts`, `platform-workspace.tsx`, `platform-workspace.test.ts`; 最小兼容扩展 `apps/web/src/features/charts/types.ts`, `market-chart.tsx`, `format.ts` 的缺失 volume 路径并新增 `volume.test.ts`；Test `apps/web/src/features/market-board/navigation.test.ts`。

**Interfaces:** `MarketBoardView({marketRefreshKey: number})`；各 table 接收 BoardRow[] 和 `onOpen(key)`；详情以 `instrumentKey` 独立查询；`BoardChart({series: Series})`；`toBoardChartData(series: Series) -> ChartResponse` 只用于美股日 K，range 按 1mo/3mo/1y 原样，volume 缺失须保留未知语义而非对用户显示 0。

- [ ] Step 1：先写导航与图表转换测试：看板 id='market-board' 紧跟 overview，可恢复且动态加载；转换不得修改序列、混复权、引入交易标记；sample 图表状态保留；同一天唯一 bar、null volume 不变成事实成交量。
- [ ] Step 2：运行导航／图表测试得到 RED；阅读 `apps/web/AGENTS.md` 和已安装 Next.js 关于动态导入、客户端组件的文档，再写组件。
- [ ] Step 3：使用现有 Tabs/Table/Card/Button/Dialog/Input/Alert/Badge；三板块独立 selection，搜索结果只加入符合板块身份的条目；管理支持移除、置顶、上移／下移，键盘可达，不强制引入拖拽依赖。保留默认顺序及 ETF／基金列排序。刷新按钮接线到当前板块，不触发 AI 或交易写入。
- [ ] Step 4：详情显示分字段来源／时间／质量；场外基金渲染资产配置与前十重仓、报告期和限额渠道。只美股提供 1月／3月／1年日 K 与均线；其余能力供 B 包使用，不展示虚构的国内分钟图。
- [ ] Step 5：BoardChart 复用现有 MarketChart；若旧组件无法表达缺失 volume，最小扩展 ChartBar.volume 为 number|null 并过滤 histogram 缺失点，旧 numeric 消费者保持兼容，增加相关回归测试。不把 unknown volume 伪装成 0。必须显示币种、复权、来源和数据状态。
- [ ] Step 6：动态注册新页面，更新 RESTORABLE_VIEWS，传 marketRefreshKey；其余侧栏顺序不改。没有配置 AI 的用户仍可完整浏览看板；不显示未完成 B 包的快研或新增基金持仓入口。
- [ ] Step 7：GREEN 执行 Node 单测、`npm run test:web` 与 `npm run lint`；提交 `feat: add three-segment market board and details`。

## Task 10: 确定性回归、联网覆盖记录和 canonical 验收

**Files:** Update `docs/market-board-provider-coverage.md`; Create `docs/market-board-acceptance.md`; 按实际发现只修改所属任务文件并补对应回归用例。

**Interfaces:** 消费全部前述接口，不增加业务接口。产出 A 包验收记录和 B 包可用的数据能力清单。

- [ ] Step 1：运行 `npm run test:api`、`npm run test:web`、`npm run lint`、`npm run check:public-safety`、`npm run check:release-readiness`，逐项记录真实结果。检查中若命中用户现有 output 文件，报告路径和原因，不擅删文件或伪称本次引入。
- [ ] Step 2：在隔离工作树执行 `npm run build`，不要让构建改写正在运行的 canonical `.next`。依赖／环境变更如需重启必须先询问；缺依赖或环境阻塞与代码失败分别记录。
- [ ] Step 3：确认 canonical 3000/8000 进程归属与工作目录；在逐文件检查无冲突后，将经验证的本次提交同步到用户项目开发检出并利用热重载。若存在重叠用户修改或需要改变运行环境，停止同步并请求决定；不得 reset/覆盖用户工作。
- [ ] Step 4：使用浏览器工具验证 3000：导航、三个标签、搜索添加／移除／清空／重排、刷新页面后保留、详情与日 K 范围、基金披露、窄屏、错误／样例状态。只使用临时新测试关注项并恢复原状态，不清空用户现有自选；破坏性／断网场景在自动化测试或浏览器路由 mock 中验证，不停用户网络服务。
- [ ] Step 5：快速输入多个搜索词并切板块、切详情，确认旧响应不覆盖；检查 console 和 API 错误；验证现有总览、交易记录、AI 日历和量化入口仍可访问，量化任务不为验收自动启动。
- [ ] Step 6：以公开标的复查可用源并更新 coverage；不把外网失败忽略为通过，不无限重试。已支持的数据类型若全部只有样例，标明功能已实现但真实行情验收未通过，不宣称完整可用。
- [ ] Step 7：按 requesting-code-review 与 verification-before-completion 完成授权范围内审查和复核；修复发现后重跑对应测试。检查 `git diff --check`、变更路径和运行进程，确认无私有文件／原项目修改、无遗留临时端口。提交 `docs: record market board verification and provider coverage`。
- [ ] Step 8：交付 A 包实际完成范围、已知接口缺口及验收证据；明确 B 包尚未实现。以稳定下来的模型／接口编写 B 包实施计划，不擅自扩展多币种记账或量化市场覆盖。

## 自查结论与执行确认

- 看板功能对应任务 3、5、6、8、9；行情身份／质量对应任务 1、3、4、7；持久化兼容对应任务 2；canonical 与旧功能回归对应任务 10。
- 五项 Review Focus 均有任务中的明确断言；B 包 AI 验收未混入 A 包已完成条件。
- 接口可用性尚未现场验收，因此联网探测作为任务 3 和任务 10 的显式交付，不把候选供应商当作保证。
- 文档已明确模型、输入／输出、失败状态、固定缓存参数、容量与提交边界，不预写完整实现。
- 推荐 Native 执行：当前任务逐项 TDD 实现，保持跨市场身份／缓存／UI 契约一致；如用户偏好逐任务独立实现和审查，可选择 subagent-driven。未选择前不派发子代理。
- 用户审阅本计划并确认执行方式后开始任务 1；不重复确认已批准的设计内容。
