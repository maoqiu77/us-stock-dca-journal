from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware

from app.api_models import (
    AiAdviceBriefRequest,
    AiAdviceChatRequest,
    AiSettingsTestRequest,
    AiSettingsUpdateRequest,
    PositionScreenshotRequest,
    QuantAnalysisRunRequest,
    ResearchSettingsTestRequest,
    ResearchSettingsUpdateRequest,
    TradingStateRequest,
    UpdateStartRequest,
)
from app.core.database import init_db
from app.modules.ai_advice import (
    create_ai_chat_reply,
    create_external_ai_advice,
    create_local_ai_advice_draft,
    clear_today_ai_advice_chat,
    get_ai_advice_calendar,
)
from app.modules.ai_settings import (
    get_ai_settings_public,
    test_ai_settings_connection,
    update_ai_settings,
)
from app.modules.market import get_chart, get_quotes
from app.modules.position_import import recognize_position_screenshot
from app.modules.quant_analysis.manager import quant_analysis_manager
from app.modules.research_settings import (
    get_research_settings_public,
    test_fred_connection,
    update_research_settings,
)
from app.modules.research import get_backtest_result, get_signal_rows
from app.modules.app_update import (
    check_for_update,
    get_runtime_info,
    get_update_status,
    start_update,
)
from app.modules.trading_data import (
    account_summary,
    derive_positions,
    get_effective_watchlist,
    infer_market,
    load_trading_state,
    validate_trading_state,
    preview_legacy_migration,
)
from app.modules.market_board.router import router as market_board_router
from app.modules.ai_journal.router import router as ai_journal_router
from app.modules.ai_journal.decisions import router as user_records_router
from app.modules.ai_journal.agent.manager import journal_agent_manager
from app.modules.ledger_store import read_ledger, write_ledger, read_receipt
from app.modules.local_backup import runtime_lock, create_backup
from app.core import settings
from fastapi.responses import FileResponse
import uuid


app = FastAPI(title="Stock Trading Platform API", version=get_runtime_info().version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(market_board_router)
app.include_router(ai_journal_router)
app.include_router(user_records_router)
_runtime_lock = None


@app.on_event("startup")
def on_startup() -> None:
    global _runtime_lock
    _runtime_lock = runtime_lock(settings.DATA_HOME.resolve())
    _runtime_lock.__enter__()
    init_db()
    quant_analysis_manager.start()
    journal_agent_manager.start()


@app.on_event("shutdown")
def on_shutdown() -> None:
    quant_analysis_manager.stop()
    journal_agent_manager.stop()
    # Hold until process exit: in-flight worker threads may outlive stop()'s
    # bounded join. Offline restoration requires the API process fully stopped.


@app.post("/api/local-backup")
def download_local_backup(payload: Optional[dict] = Body(default=None)):
    path = settings.DATA_HOME / "backups" / ("local-" + uuid.uuid4().hex + ".zip")
    try:
        preferences = (payload or {}).get("browserPreferences", {})
        allowed = {key: value for key, value in preferences.items() if key in {"theme", "stock-platform-active-view-v1", "stock-platform-onboarding-v1"} and isinstance(value, str)} if isinstance(preferences, dict) else {}
        create_backup(settings.DATA_HOME, settings.DB_PATH, path, allowed)
    except Exception as exc:
        raise HTTPException(503, "备份校验失败，原库未修改。请使用恢复工具诊断数据或关联来源。") from exc
    return FileResponse(path, media_type="application/zip", filename=path.name)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/update/check")
def update_check() -> dict[str, object]:
    return check_for_update()


@app.get("/api/update/status")
def update_status() -> dict[str, object]:
    return get_update_status()


@app.post("/api/update/start")
def update_start(payload: UpdateStartRequest) -> dict[str, object]:
    return start_update(payload.localStorageSnapshot)


@app.get("/api/watchlist")
def watchlist() -> dict[str, object]:
    return {"items": get_effective_watchlist()}


@app.get("/api/quotes")
def quotes(
    ticker: list[str] = Query(default=[]),
    refresh: bool = Query(default=False),
) -> dict[str, object]:
    if ticker:
        saved_rows = {item["ticker"].upper(): item for item in get_effective_watchlist()}
        seen: set[str] = set()
        symbols = []
        for raw_ticker in ticker:
            requested_ticker = raw_ticker.strip().upper()
            if not requested_ticker or requested_ticker in seen:
                continue
            saved = saved_rows.get(requested_ticker, {})
            symbols.append(
                {
                    "ticker": requested_ticker,
                    "name": saved.get("name") or requested_ticker,
                    "market": saved.get("market") or infer_market(requested_ticker),
                }
            )
            seen.add(requested_ticker)
    else:
        symbols = get_effective_watchlist()
    return {"items": get_quotes(symbols, force_refresh=refresh)}


@app.get("/api/charts/{ticker}")
def chart(
    ticker: str,
    range_: str = Query(default="1y", alias="range"),
    interval: str = Query(default="1d"),
    refresh: bool = Query(default=False),
) -> dict[str, object]:
    return get_chart(ticker, range_, interval, force_refresh=refresh)


@app.get("/api/trading-state")
def trading_state() -> dict[str, object]:
    result = read_ledger()
    state = result["state"]
    return {
        **result,
        "state": state,
        "derivedPositions": derive_positions(state),
        "accountSummary": account_summary(state),
        "validationIssues": validate_trading_state(state),
    }


@app.put("/api/trading-state")
def update_trading_state(payload: TradingStateRequest) -> dict[str, object]:
    data = payload.model_dump(mode="python")
    if not isinstance(data.get("state"), dict):
        raise HTTPException(428, "保存需要 state、expectedRevision、operationId，请升级客户端。")
    result = write_ledger(data["state"], data.get("expectedRevision", ""), data.get("operationId", ""))
    state = result["state"]
    return {
        **result,
        "state": state,
        "derivedPositions": derive_positions(state),
        "accountSummary": account_summary(state),
        "validationIssues": validate_trading_state(state),
    }


@app.post("/api/trading-state/reset")
def reset_state() -> dict[str, object]:
    raise HTTPException(428, "无版本重置已停用；请先备份，再通过带版本的保存操作明确替换账本。")


@app.get("/api/trading-state/receipts/{operation_id}")
def trading_receipt(operation_id: str) -> dict:
    return read_receipt(operation_id)


@app.get("/api/trading-state/migration-preview")
def legacy_migration_preview() -> dict:
    current = read_ledger()
    return preview_legacy_migration(current["state"], current["revision"])


@app.get("/api/signals")
def signals() -> dict[str, object]:
    return {"items": get_signal_rows()}


@app.get("/api/backtests/{ticker}")
def backtest(
    ticker: str,
    initial_cash: Optional[float] = Query(default=None, alias="initialCash"),
    range_: str = Query(default="10y", alias="range"),
) -> dict[str, object]:
    return get_backtest_result(ticker, initial_cash=initial_cash, range_=range_)


@app.get("/api/ai-advice")
def ai_advice(date: Optional[str] = Query(default=None)) -> dict[str, object]:
    return get_ai_advice_calendar(date)


@app.post("/api/ai-advice/draft")
def create_ai_advice_draft(payload: AiAdviceBriefRequest) -> dict[str, object]:
    return create_local_ai_advice_draft(payload.brief)


@app.post("/api/ai-advice/generate")
def generate_ai_advice(payload: AiAdviceBriefRequest) -> dict[str, object]:
    return create_external_ai_advice(payload.brief)


@app.post("/api/ai-advice/chat")
def ai_advice_chat(payload: AiAdviceChatRequest) -> dict[str, object]:
    return create_ai_chat_reply(payload.prompt)


@app.post("/api/ai-advice/chat/clear")
def clear_ai_advice_chat() -> dict[str, object]:
    return clear_today_ai_advice_chat()


@app.post("/api/position-import/recognize")
def position_import_recognize(payload: PositionScreenshotRequest) -> dict[str, object]:
    return recognize_position_screenshot(payload.imageDataUrl, payload.mode)


@app.get("/api/ai-settings")
def ai_settings() -> dict[str, object]:
    return get_ai_settings_public()


@app.put("/api/ai-settings")
def put_ai_settings(payload: AiSettingsUpdateRequest) -> dict[str, object]:
    return update_ai_settings(payload.model_dump(exclude_none=True))


@app.post("/api/ai-settings/test")
def test_ai_settings(payload: AiSettingsTestRequest) -> dict[str, object]:
    return test_ai_settings_connection(payload.model_dump(exclude_none=True))


@app.post("/api/quant-analysis/runs")
def create_quant_analysis_run(payload: QuantAnalysisRunRequest) -> dict[str, object]:
    return quant_analysis_manager.submit(payload)


@app.get("/api/quant-analysis/runs")
def quant_analysis_runs(
    ticker: Optional[str] = Query(default=None),
    date: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> dict[str, object]:
    return {
        "items": quant_analysis_manager.list(
            ticker=ticker,
            effective_date=date,
            status=status,
        )
    }


@app.get("/api/quant-analysis/runs/{run_id}")
def quant_analysis_run(run_id: str) -> dict[str, object]:
    return quant_analysis_manager.get(run_id)


@app.delete("/api/quant-analysis/runs/{run_id}")
def delete_quant_analysis_run(run_id: str) -> dict[str, object]:
    return quant_analysis_manager.delete(run_id)


@app.post("/api/quant-analysis/runs/{run_id}/cancel")
def cancel_quant_analysis_run(run_id: str) -> dict[str, object]:
    return quant_analysis_manager.cancel(run_id)


@app.post("/api/quant-analysis/runs/{run_id}/resume")
def resume_quant_analysis_run(run_id: str) -> dict[str, object]:
    return quant_analysis_manager.resume(run_id)


@app.post("/api/quant-analysis/runs/{run_id}/reflection")
def reflect_quant_analysis_run(run_id: str) -> dict[str, object]:
    return quant_analysis_manager.reflect(run_id)


@app.get("/api/research-settings")
def research_settings() -> dict[str, object]:
    return get_research_settings_public()


@app.put("/api/research-settings")
def put_research_settings(payload: ResearchSettingsUpdateRequest) -> dict[str, object]:
    return update_research_settings(payload.model_dump(exclude_none=True))


@app.post("/api/research-settings/fred/test")
def test_research_fred(payload: ResearchSettingsTestRequest) -> dict[str, object]:
    return test_fred_connection(payload.model_dump(exclude_none=True))
