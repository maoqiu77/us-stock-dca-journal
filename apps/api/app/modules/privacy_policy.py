"""Legacy AI-inference policy; market networking is a separate concern."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.modules.trading_data import load_trading_state


def ensure_ai_inference_allowed(state: dict[str, Any] | None = None) -> None:
    current = load_trading_state() if state is None else state
    if current.get("privacyMode") == "local-only":
        raise HTTPException(status_code=403, detail="当前为本地模式，已阻止向外部 AI 发送资料。请先在隐私设置中允许 AI 外发。")
