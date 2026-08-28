from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests
from fastapi import HTTPException

from app.core.database import get_state_payload, set_state_payload


APP_STATE_KEY = "research_settings_v1"
FRED_TEST_URL = "https://api.stlouisfed.org/fred/series"
DEFAULT_RESEARCH_SETTINGS: dict[str, Any] = {
    "schemaVersion": 1,
    "fredApiKey": "",
    "updatedAt": "",
}


def load_research_settings() -> dict[str, Any]:
    payload = get_state_payload(APP_STATE_KEY)
    if not payload:
        return DEFAULT_RESEARCH_SETTINGS.copy()
    try:
        loaded = json.loads(payload)
    except (json.JSONDecodeError, TypeError):
        return DEFAULT_RESEARCH_SETTINGS.copy()
    return {
        **DEFAULT_RESEARCH_SETTINGS,
        "fredApiKey": str(loaded.get("fredApiKey", "")).strip(),
        "updatedAt": str(loaded.get("updatedAt", "")),
    }


def get_research_settings_public() -> dict[str, Any]:
    return public_research_settings(load_research_settings())


def update_research_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_research_settings()
    if payload.get("clearFredApiKey"):
        current["fredApiKey"] = ""
    else:
        candidate = str(payload.get("fredApiKey") or "").strip()
        if candidate:
            current["fredApiKey"] = candidate
    current["updatedAt"] = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    set_state_payload(APP_STATE_KEY, json.dumps(current, ensure_ascii=False))
    return public_research_settings(current)


def test_fred_connection(payload: dict[str, Any]) -> dict[str, Any]:
    saved = load_research_settings()
    api_key = str(payload.get("fredApiKey") or saved.get("fredApiKey") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先提供 FRED API Key。")
    try:
        response = requests.get(
            FRED_TEST_URL,
            params={"series_id": "FEDFUNDS", "api_key": api_key, "file_type": "json"},
            timeout=15,
        )
        response.raise_for_status()
        body = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"FRED 连接测试失败：{exc}") from exc
    if not isinstance(body, dict) or not body.get("seriess"):
        raise HTTPException(status_code=502, detail="FRED 返回内容无效。")
    return {"ok": True, "message": "FRED 连接正常。", "series": "FEDFUNDS"}


def public_research_settings(settings: dict[str, Any]) -> dict[str, Any]:
    key = str(settings.get("fredApiKey", ""))
    return {
        "schemaVersion": 1,
        "hasFredApiKey": bool(key),
        "fredApiKeyMasked": mask_key(key),
        "updatedAt": str(settings.get("updatedAt", "")),
    }


def mask_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return f"{value[:4]}…{value[-4:]}"
