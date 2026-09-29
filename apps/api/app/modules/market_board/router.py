from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional

from app.core.settings import DB_PATH

from .catalog import InstrumentCatalog
from .models import Segment
from .service import BoardService
from .store import BoardStore, SelectionConflict

router = APIRouter(prefix="/api/market-board", tags=["market-board"])
_store = BoardStore(DB_PATH)
_catalog = InstrumentCatalog(_store)
_service = BoardService(_store, _catalog)


class SelectionUpdate(BaseModel):
    keys: list[str] = Field(default_factory=list)
    expected_revision: int


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=80), market: str = Query(pattern="^(US|CN)$"), asset_type: Optional[str] = None, limit: int = Query(default=20, ge=1, le=20)):
    return {"items": [item.model_dump(mode="json") for item in _catalog.search(q, market, asset_type, limit)]}


@router.get("/selection/{segment}")
def selection(segment: Segment):
    return _store.get_selection(segment).model_dump(mode="json")


@router.put("/selection/{segment}")
def replace_selection(segment: Segment, payload: SelectionUpdate):
    try:
        return _store.replace_selection(segment, payload.keys, payload.expected_revision).model_dump(mode="json")
    except SelectionConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "selection_conflict", "message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "invalid_selection", "message": str(exc)}) from exc


@router.get("/board/{segment}")
def board(segment: Segment, refresh: bool = False):
    return _service.board(segment, refresh).model_dump(mode="json")


@router.get("/detail")
def detail(key: str, refresh: bool = False):
    try:
        return _service.detail(key, refresh).model_dump(mode="json")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_instrument"}) from exc


@router.get("/capabilities")
def capabilities(key: str):
    try:
        return _service.capabilities(key).model_dump(mode="json")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_instrument"}) from exc


@router.get("/series")
def series(key: str, period: str = Query(default="1d"), range_: str = Query(default="1y", alias="range"), refresh: bool = False):
    if period not in {"1d", "60m", "30m", "15m", "5m", "1m"} or range_ not in {"1mo", "3mo", "1y"}:
        raise HTTPException(status_code=422, detail={"code": "invalid_series"})
    try:
        return _service.series(key, period, range_, refresh).model_dump(mode="json")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_instrument"}) from exc


@router.post("/quotes")
def quotes(payload: dict):
    keys = payload.get("keys", [])
    if not isinstance(keys, list) or len(keys) > 30:
        raise HTTPException(status_code=422, detail={"code": "invalid_keys"})
    rows = []
    for key in keys:
        try:
            rows.append(_service.detail(str(key), bool(payload.get("refresh"))).row.model_dump(mode="json"))
        except KeyError as exc:
            raise HTTPException(status_code=422, detail={"code": "unknown_instrument"}) from exc
    return {"items": rows}
