from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core import database
from app.core.settings import DATA_HOME


REPORT_HOME = DATA_HOME / "quant-analysis"
_RUN_PATCH_COLUMNS = {
    "asset_type": "asset_type",
    "status": "status",
    "current_stage": "current_stage",
    "progress": "progress",
    "error_code": "error_code",
    "error_message": "error_message",
    "started_at": "started_at",
    "completed_at": "completed_at",
    "reflection_status": "reflection_status",
}


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_analysis_run(
    *,
    ticker: str,
    requested_date: str,
    effective_date: str,
    mode: str,
    analysts: list[str],
    reflection_enabled: bool,
    model: str,
    input_signature: str,
) -> dict[str, Any]:
    database.init_db()
    run_id = uuid.uuid4().hex
    now = utc_timestamp()
    with database.connect() as connection:
        row = connection.execute(
            """
            select coalesce(max(version), 0) + 1
            from quant_analysis_runs
            where ticker = ? and effective_date = ?
            """,
            (ticker, effective_date),
        ).fetchone()
        version = int(row[0])
        connection.execute(
            """
            insert into quant_analysis_runs (
              id, ticker, requested_date, effective_date, mode, analysts_json,
              reflection_enabled, input_signature, model, version, status,
              reflection_status, created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
            """,
            (
                run_id,
                ticker,
                requested_date,
                effective_date,
                mode,
                json.dumps(analysts, ensure_ascii=False),
                1 if reflection_enabled else 0,
                input_signature,
                model,
                version,
                "pending" if reflection_enabled else "disabled",
                now,
                now,
            ),
        )
    return get_analysis_run(run_id)


def get_analysis_run(run_id: str) -> dict[str, Any]:
    database.init_db()
    with database.connect() as connection:
        row = connection.execute(
            "select * from quant_analysis_runs where id = ?", (run_id,)
        ).fetchone()
        if row is None:
            raise KeyError(run_id)
        steps = connection.execute(
            """
            select * from quant_analysis_steps
            where run_id = ?
            order by sequence asc, step_key asc
            """,
            (run_id,),
        ).fetchall()
    return _run_to_public(dict(row), [dict(step) for step in steps])


def list_analysis_runs(
    *,
    ticker: str | None = None,
    effective_date: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    database.init_db()
    clauses: list[str] = []
    values: list[Any] = []
    for column, value in (
        ("ticker", ticker),
        ("effective_date", effective_date),
        ("status", status),
    ):
        if value:
            clauses.append(f"{column} = ?")
            values.append(value)
    where = f"where {' and '.join(clauses)}" if clauses else ""
    values.append(max(1, min(int(limit), 500)))
    with database.connect() as connection:
        rows = connection.execute(
            f"select id from quant_analysis_runs {where} order by created_at desc limit ?",
            values,
        ).fetchall()
    return [get_analysis_run(str(row["id"])) for row in rows]


def find_reusable_analysis_run(input_signature: str) -> dict[str, Any] | None:
    database.init_db()
    with database.connect() as connection:
        row = connection.execute(
            """
            select id from quant_analysis_runs
            where input_signature = ? and status = 'completed'
            order by created_at desc limit 1
            """,
            (input_signature,),
        ).fetchone()
    return get_analysis_run(str(row["id"])) if row else None


def update_analysis_run(run_id: str, **patch: Any) -> dict[str, Any]:
    assignments: list[str] = []
    values: list[Any] = []
    for key, column in _RUN_PATCH_COLUMNS.items():
        if key in patch:
            assignments.append(f"{column} = ?")
            values.append(patch[key])
    if "final_result" in patch:
        assignments.append("final_result_json = ?")
        values.append(json.dumps(patch["final_result"], ensure_ascii=False))
    if "reflection" in patch:
        assignments.append("reflection_json = ?")
        values.append(json.dumps(patch["reflection"], ensure_ascii=False))
    if not assignments:
        return get_analysis_run(run_id)
    assignments.append("updated_at = ?")
    values.append(utc_timestamp())
    values.append(run_id)
    database.init_db()
    with database.connect() as connection:
        cursor = connection.execute(
            f"update quant_analysis_runs set {', '.join(assignments)} where id = ?", values
        )
        if cursor.rowcount == 0:
            raise KeyError(run_id)
    return get_analysis_run(run_id)


def upsert_analysis_step(
    run_id: str,
    *,
    step_key: str,
    sequence: int,
    role: str,
    status: str,
    input_summary: dict[str, Any] | None = None,
    output: dict[str, Any] | None = None,
    data_sources: list[dict[str, Any]] | None = None,
    error_message: str = "",
    tokens_in: int = 0,
    tokens_out: int = 0,
    duration_ms: int = 0,
    started_at: str = "",
    completed_at: str = "",
) -> dict[str, Any]:
    database.init_db()
    with database.connect() as connection:
        connection.execute(
            """
            insert into quant_analysis_steps (
              run_id, step_key, sequence, role, status, input_summary_json,
              output_json, data_sources_json, error_message, tokens_in, tokens_out,
              started_at, completed_at, duration_ms
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(run_id, step_key) do update set
              sequence = excluded.sequence,
              role = excluded.role,
              status = excluded.status,
              input_summary_json = excluded.input_summary_json,
              output_json = excluded.output_json,
              data_sources_json = excluded.data_sources_json,
              error_message = excluded.error_message,
              tokens_in = excluded.tokens_in,
              tokens_out = excluded.tokens_out,
              started_at = excluded.started_at,
              completed_at = excluded.completed_at,
              duration_ms = excluded.duration_ms
            """,
            (
                run_id,
                step_key,
                int(sequence),
                role,
                status,
                json.dumps(input_summary or {}, ensure_ascii=False),
                json.dumps(output, ensure_ascii=False) if output is not None else "",
                json.dumps(data_sources or [], ensure_ascii=False),
                error_message,
                int(tokens_in),
                int(tokens_out),
                started_at,
                completed_at,
                max(0, int(duration_ms)),
            ),
        )
    return get_analysis_run(run_id)


def mark_active_runs_interrupted() -> int:
    database.init_db()
    with database.connect() as connection:
        cursor = connection.execute(
            """
            update quant_analysis_runs
            set status = 'interrupted', updated_at = ?
            where status in ('queued', 'running', 'cancel_requested')
            """,
            (utc_timestamp(),),
        )
        return int(cursor.rowcount)


def export_analysis_run(run_id: str) -> Path:
    run = get_analysis_run(run_id)
    safe_ticker = re.sub(r"[^A-Z0-9.-]", "_", str(run["ticker"]).upper())
    directory = REPORT_HOME / safe_ticker / str(run["effectiveDate"])
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{run_id}.json"
    path.write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _run_to_public(row: dict[str, Any], steps: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "ticker": row["ticker"],
        "assetType": row["asset_type"],
        "requestedDate": row["requested_date"],
        "effectiveDate": row["effective_date"],
        "mode": row["mode"],
        "analysts": _json_value(row["analysts_json"], []),
        "reflectionEnabled": bool(row["reflection_enabled"]),
        "inputSignature": row["input_signature"],
        "model": row["model"],
        "version": int(row["version"]),
        "status": row["status"],
        "currentStage": row["current_stage"],
        "progress": int(row["progress"]),
        "errorCode": row["error_code"],
        "errorMessage": row["error_message"],
        "finalResult": _json_value(row["final_result_json"], None),
        "reflectionStatus": row["reflection_status"],
        "reflectionEligible": bool(row["reflection_enabled"])
        and row["status"] == "completed"
        and _reflection_eligible(str(row["effective_date"])),
        "reflection": _json_value(row["reflection_json"], None),
        "createdAt": row["created_at"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
        "updatedAt": row["updated_at"],
        "steps": [_step_to_public(step) for step in steps],
    }


def _step_to_public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "stepKey": row["step_key"],
        "sequence": int(row["sequence"]),
        "role": row["role"],
        "status": row["status"],
        "attempt": int(row["attempt"]),
        "inputSummary": _json_value(row["input_summary_json"], {}),
        "output": _json_value(row["output_json"], None),
        "dataSources": _json_value(row["data_sources_json"], []),
        "errorMessage": row["error_message"],
        "tokensIn": int(row["tokens_in"]),
        "tokensOut": int(row["tokens_out"]),
        "durationMs": int(row.get("duration_ms") or 0),
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
    }


def _json_value(raw: str, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return fallback


def _reflection_eligible(effective_date: str) -> bool:
    from app.modules.quant_analysis.calendar import reflection_eligible

    try:
        return reflection_eligible(effective_date)
    except ValueError:
        return False
