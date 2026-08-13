from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from app.api_models import (
    AiAdviceBriefRequest,
    AiAdviceChatRequest,
    AiSettingsTestRequest,
    AiSettingsUpdateRequest,
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
    reset_trading_state,
    save_trading_state,
    validate_trading_state,
)


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


@app.on_event("startup")
def on_startup() -> None:
    init_db()


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
    state = load_trading_state()
    return {
        "state": state,
        "derivedPositions": derive_positions(state),
        "accountSummary": account_summary(state),
        "validationIssues": validate_trading_state(state),
    }


@app.put("/api/trading-state")
def update_trading_state(payload: TradingStateRequest) -> dict[str, object]:
    state = save_trading_state(payload.model_dump(mode="python"))
    return {
        "state": state,
        "derivedPositions": derive_positions(state),
        "accountSummary": account_summary(state),
        "validationIssues": validate_trading_state(state),
    }


@app.post("/api/trading-state/reset")
def reset_state() -> dict[str, object]:
    state = reset_trading_state()
    return {
        "state": state,
        "derivedPositions": derive_positions(state),
        "accountSummary": account_summary(state),
        "validationIssues": validate_trading_state(state),
    }


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


@app.get("/api/ai-settings")
def ai_settings() -> dict[str, object]:
    return get_ai_settings_public()


@app.put("/api/ai-settings")
def put_ai_settings(payload: AiSettingsUpdateRequest) -> dict[str, object]:
    return update_ai_settings(payload.model_dump(exclude_none=True))


@app.post("/api/ai-settings/test")
def test_ai_settings(payload: AiSettingsTestRequest) -> dict[str, object]:
    return test_ai_settings_connection(payload.model_dump(exclude_none=True))
