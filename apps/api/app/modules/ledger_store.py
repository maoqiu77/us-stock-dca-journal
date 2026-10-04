"""Local ledger compare-and-swap; receipts and state commit in one transaction."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import math
from typing import Any

from fastapi import HTTPException
from app.core import database
from app.modules.trading_data import APP_STATE_KEY, DEFAULT_TRADING_DATA, sanitize_trading_state


def check_state(value: Any) -> dict:
    if (not isinstance(value, dict) or value.get("schemaVersion") not in (1, 2)
            or not isinstance(value.get("account"), dict)
            or any(not isinstance(value.get(key), list) for key in ("stockPool", "positions", "trades"))):
        raise HTTPException(422, "账本格式无法识别；保留原始数据，禁止用默认数据覆盖。")
    # A newer ledger must never be silently stripped by a legacy adapter.
    if "ledgerEvents" in value:
        raise HTTPException(422, "此账本含尚不支持的校准格式，请使用兼容版本。")
    if any(not isinstance(ticker, str) or not ticker.strip() for ticker in value["stockPool"]):
        raise HTTPException(422, "自选标的格式损坏。")
    for key in ("positions", "trades"):
        for row in value[key]:
            if not isinstance(row, dict) or not isinstance(row.get("ticker"), str) or not row["ticker"].strip():
                raise HTTPException(422, "账本条目格式损坏。")
            if key == "trades" and (not row.get("id") or row.get("action") not in ("买入", "卖出") or not row.get("date")):
                raise HTTPException(422, "成交条目格式损坏。")
            for field in ("shares", "unitPrice", "amount", "targetWeight", "takeProfitPct", "stopLossPct"):
                if field in row and (isinstance(row[field], bool) or not isinstance(row[field], (int, float)) or not math.isfinite(row[field])):
                    raise HTTPException(422, "账本金额或数量格式损坏，不能自动归零。")
    amount = value["account"].get("totalAssets")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount):
        raise HTTPException(422, "账户金额格式损坏，不能自动归零。")
    def finite(item):
        if isinstance(item, float) and not math.isfinite(item):
            raise HTTPException(422, "账本包含无效数值。")
        for child in item.values() if isinstance(item, dict) else item if isinstance(item, list) else []:
            finite(child)
    finite(value)
    from .position_checkpoints import validate_checkpoints
    try:
        validate_checkpoints(value)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return value


def decode_state(payload: str) -> dict:
    try:
        value = json.loads(payload, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        return check_state(value)
    except (ValueError, TypeError, HTTPException) as exc:
        raise HTTPException(503, "账本数据损坏或版本不兼容，已停止写入。请保留原库并使用备份恢复工具诊断。") from exc


def _read(connection) -> dict:
    row = connection.execute("select payload from app_state where key=?", (APP_STATE_KEY,)).fetchone()
    state = decode_state(row[0]) if row else sanitize_trading_state(DEFAULT_TRADING_DATA)
    revision = connection.execute("select revision from ledger_revision where id=1").fetchone()[0]
    return {"state": state, "revision": revision}


def read_ledger() -> dict:
    try:
        database.init_db()
        with database.connect() as connection:
            connection.execute("begin")
            return _read(connection)
    except sqlite3.DatabaseError as exc:
        raise HTTPException(503, "本地数据库无法读取，已停止保存；原文件未被替换，请从备份诊断恢复。") from exc


def write_ledger(state: dict, expected_revision: str, operation_id: str, *, migration=False) -> dict:
    if not isinstance(expected_revision, str) or not isinstance(operation_id, str) or not expected_revision or not operation_id or len(operation_id) > 128:
        raise HTTPException(428, "保存需要账本 revision 和稳定 operationId，请升级客户端。")
    check_state(state)
    try:
        encoded = json.dumps(state, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "账本包含无效数值。") from exc
    digest = hashlib.sha256((expected_revision + "\n" + encoded).encode()).hexdigest()
    database.init_db()
    with database.connect() as connection:
        connection.execute("begin immediate")
        receipt = connection.execute("select request_digest, response from ledger_receipts where operation_id=?", (operation_id,)).fetchone()
        if receipt:
            if receipt[0] != digest:
                raise HTTPException(409, "同一操作 ID 对应不同内容，禁止重放。")
            return json.loads(receipt[1])
        current = _read(connection)  # Validates existing data BEFORE any write.
        if current["revision"] != expected_revision:
            raise HTTPException(409, "账本已被另一窗口修改，请比较两个候选版本后再保存。")
        sanitized = sanitize_trading_state(state)
        from .position_checkpoints import validate_transition
        try:
            validate_transition(current["state"], sanitized, expected_revision, migration=migration)
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(422, str(exc)) from exc
        connection.execute("insert into app_state(key,payload) values (?,?) on conflict(key) do update set payload=excluded.payload,updated_at=current_timestamp", (APP_STATE_KEY, json.dumps(sanitized, ensure_ascii=False, allow_nan=False)))
        response = {**_read(connection), "operationId": operation_id}
        connection.execute("insert into ledger_receipts(operation_id,request_digest,response) values (?,?,?)", (operation_id, digest, json.dumps(response, ensure_ascii=False)))
        return response


def read_receipt(operation_id: str) -> dict:
    database.init_db()
    with database.connect() as connection:
        row = connection.execute("select response from ledger_receipts where operation_id=?", (operation_id,)).fetchone()
    # Not found does not prove a timed-out request will never commit.
    return {"status": "committed", **json.loads(row[0])} if row else {"status": "unknown", "operationId": operation_id}
