# M00 基线

日期：2026-09-09（Asia/Shanghai）。本记录是本轮实际运行结果，不复用旧审查的 65/24 结论。

## 代码与文档

- 源仓库：maoqiu77/us-stock-dca-journal；本机源 checkout 为相邻 `股票交易平台-next`。
- 起始 HEAD：`e661b1d1efce7b2e88d327e34eda0fe98199b859`，Release v1.3.2。
- 源 checkout 初始 status 为空；相对审查提交 diff 为空。
- 隔离工作目录：当前项目下 `implementation/`，分支 `codex/mobile-phase-0-1`。
- 原始两份用户文档保留在 worktree 上级；只执行实施计划 Phase 0（M00–M07）、Phase 1（M08–M27）。
- 已读取根/Web AGENTS、两个 package.json、Web lockfile、API requirements、CI、旧总设计与旧功能地图。
- 路径/解释器/范围差异与已知事项逐条核查见 [discrepancies.md](discrepancies.md)。

## 环境与隔离

- macOS 26.6.2 build 25G83，arm64。
- Node v24.16.0，npm 11.13.0。
- 系统 Python 3.9.6；使用已有 Python 3.12.13（与 CI 3.12 对齐）创建新 `.venv`。
- JS 安装严格使用现有 Web lockfile，没有更新依赖或 lockfile。
- 已读测试隔离：DB 测试使用 TemporaryDirectory/patch 替换 DB_PATH，Provider/market 使用合成响应和 mock，Web 包含行为与源码字符串检查。
- 全套测试额外设置 STOCK_APP_DATA_HOME、STOCK_APP_DB_PATH 为 `mktemp -d /tmp/portfolio-m00.XXXXXX` 创建的临时目录。未读取源 checkout 的真实数据；未启动长期服务。

## 实际命令与结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | 上述精确 HEAD |
| `git status --short`（初始） | 0 | 干净 |
| `git diff e661b1d1efce7b2e88d327e34eda0fe98199b859 --stat` | 0 | 无差异 |
| `python3.12 -m venv .venv` | 0 | 独立虚拟环境 |
| `.venv/bin/python -m pip install -r apps/api/requirements.txt` | 0 | 安装成功，版本快照见下 |
| `npm --prefix apps/web ci` | 0 | 625 packages；audit 报 15 项（1 low / 5 moderate / 8 high / 1 critical）；仅记录，未运行 audit fix |
| `npm run test`（临时数据路径环境） | 0 | API 161/161；Web 65/65；无跳过。Starlette 提示 httpx TestClient 弃用警告 |
| `npm run lint` | 0 | 无 lint 错误 |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | 0 | Next 16.2.9，编译/TS/静态生成成功 |
| `npm run check:public-safety` | 0 | 通过 |
| `npm run check:release-readiness` | 0 | 通过（静态发行检查） |

构建自动将 next-env.d.ts 的 dev 路由类型路径改为生产路径；检查 diff 后只恢复此构建生成的修改。M00 无业务源文件变化。
上述测试不等价于浏览器交互、完整可安装发行包、真实 Provider、iOS/Android 或真机验证；这些尚未运行。

## 当前入口、状态与核心

Web `src/app/page.tsx → PlatformWorkspace`，唯一业务 URL `/`；overview / ai / quant / data / ai-settings 由页面状态切换；图表、旧策略源码仍在但不挂载。无 Next 自有业务 API route。

SQLite user_version=4，watchlist/app_state/quant_analysis_runs/quant_analysis_steps；app_state 键 trading_data_v1、ai_advice_v1、ai_settings_v1、research_settings_v1。各 payload schema 与 DB schema 独立。

核心边界：trading_data.py（sanitize_trade / derive_positions / account_summary / validate_trading_state）；trading-data.ts（normalizeTradeInput / derivePositions / dynamicCash / importPositionSnapshots / replacePositionSnapshot）；ai_advice.py（ensure_external_ai_allowed / build_ai_context_v3 / create_ai_chat_reply）；ai_settings.py（call_openai_compatible_completion）。FIFO、舍入、现金、隐私和截图差异已核对源码，M01 再以合成输入建立固定 witness。

### API 路由（静态枚举，不启动 API）

- @app.get("/health")
- @app.get("/api/update/check")
- @app.get("/api/update/status")
- @app.post("/api/update/start")
- @app.get("/api/watchlist")
- @app.get("/api/quotes")
- @app.get("/api/charts/{ticker}")
- @app.get("/api/trading-state")
- @app.put("/api/trading-state")
- @app.post("/api/trading-state/reset")
- @app.get("/api/signals")
- @app.get("/api/backtests/{ticker}")
- @app.get("/api/ai-advice")
- @app.post("/api/ai-advice/draft")
- @app.post("/api/ai-advice/generate")
- @app.post("/api/ai-advice/chat")
- @app.post("/api/ai-advice/chat/clear")
- @app.post("/api/position-import/recognize")
- @app.get("/api/ai-settings")
- @app.put("/api/ai-settings")
- @app.post("/api/ai-settings/test")
- @app.post("/api/quant-analysis/runs")
- @app.get("/api/quant-analysis/runs")
- @app.get("/api/quant-analysis/runs/{run_id}")
- @app.delete("/api/quant-analysis/runs/{run_id}")
- @app.post("/api/quant-analysis/runs/{run_id}/cancel")
- @app.post("/api/quant-analysis/runs/{run_id}/resume")
- @app.post("/api/quant-analysis/runs/{run_id}/reflection")
- @app.get("/api/research-settings")
- @app.put("/api/research-settings")
- @app.post("/api/research-settings/fred/test")

## 文档 SHA-256

- `CODEX_MOBILE_IMPLEMENTATION_PLAN.md`: `77c95ad88b523da75853d4541bf08410f9bdd8d32a2b7ce78ad1e68d3353ce1b`
- `AI_PORTFOLIO_COPILOT_ARCHITECTURE_REVIEW.md`: `44cb448416256da74d93c9119713f08571a647073025bf4f56b111cd927fad35`

## Python 安装版本快照（环境证据，不新增运行时 lock）

```text
annotated-doc==0.0.5
annotated-types==0.8.0
anyio==4.15.1
beautifulsoup4==4.15.0
certifi==2026.7.22
cffi==2.1.1
charset-normalizer==3.5.1
click==8.5.0
curl_cffi==0.16.3
distro==1.9.0
fastapi==0.141.1
frozendict==2.4.7
h11==0.16.0
httpcore==1.0.9
httptools==0.8.0
httpx==0.28.1
idna==3.19
jiter==0.16.0
multitasking==0.0.13
numpy==2.5.3
openai==2.54.0
pandas==2.3.3
peewee==4.5.1
platformdirs==4.11.8
protobuf==7.36.1
pycparser==3.0
pydantic==2.13.5
pydantic_core==2.46.5
python-dateutil==2.9.0.post0
python-dotenv==1.2.3
pytz==2026.3.post1
PyYAML==6.0.3
requests==2.34.2
six==1.17.0
sniffio==1.3.1
soupsieve==2.9.2
starlette==1.6.0
tqdm==4.70.0
typing-inspection==0.4.4
typing_extensions==4.16.0
tzdata==2026.3
urllib3==2.7.0
uvicorn==0.52.4
uvloop==0.22.1
watchfiles==1.2.0
websockets==17.1
yfinance==0.2.66
```
