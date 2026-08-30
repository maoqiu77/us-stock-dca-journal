from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from app.core.settings import DB_PATH, TEMPLATE_HOME


CURRENT_DB_SCHEMA_VERSION = 4


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with connect() as connection:
        migrate_db(connection)
        existing = connection.execute("select count(*) from watchlist").fetchone()[0]
        if existing == 0:
            seed_watchlist(connection, TEMPLATE_HOME / "watchlist.example.json")


def migrate_db(connection: sqlite3.Connection) -> None:
    version = connection.execute("pragma user_version").fetchone()[0]
    if version < 1:
        connection.execute(
            """
            create table if not exists watchlist (
              ticker text primary key,
              name text not null,
              market text not null,
              sort_order integer not null default 0
            )
            """
        )
        connection.execute(
            """
            create table if not exists app_state (
              key text primary key,
              payload text not null,
              updated_at text not null default current_timestamp
            )
            """
        )
        connection.execute("pragma user_version = 1")
        version = 1
    if version < 2:
        connection.execute(
            """
            create table if not exists quant_analysis_runs (
              id text primary key,
              ticker text not null,
              asset_type text not null default '',
              requested_date text not null,
              effective_date text not null,
              mode text not null,
              analysts_json text not null,
              reflection_enabled integer not null default 0,
              input_signature text not null,
              model text not null default '',
              version integer not null,
              status text not null,
              current_stage text not null default '',
              progress integer not null default 0,
              error_code text not null default '',
              error_message text not null default '',
              final_result_json text not null default '',
              reflection_status text not null default 'disabled',
              reflection_json text not null default '',
              created_at text not null default current_timestamp,
              started_at text not null default '',
              completed_at text not null default '',
              updated_at text not null default current_timestamp
            )
            """
        )
        connection.execute(
            """
            create table if not exists quant_analysis_steps (
              run_id text not null,
              step_key text not null,
              sequence integer not null,
              role text not null,
              status text not null,
              attempt integer not null default 1,
              input_summary_json text not null default '{}',
              output_json text not null default '',
              data_sources_json text not null default '[]',
              error_message text not null default '',
              tokens_in integer not null default 0,
              tokens_out integer not null default 0,
              started_at text not null default '',
              completed_at text not null default '',
              primary key (run_id, step_key)
            )
            """
        )
        connection.execute(
            """
            create index if not exists idx_quant_runs_ticker_date
            on quant_analysis_runs (ticker, effective_date, created_at desc)
            """
        )
        connection.execute(
            """
            create index if not exists idx_quant_runs_signature
            on quant_analysis_runs (input_signature, status, created_at desc)
            """
        )
        connection.execute("pragma user_version = 2")
        version = 2
    if version < 3:
        step_columns = {
            str(row["name"])
            for row in connection.execute(
                "pragma table_info(quant_analysis_steps)"
            ).fetchall()
        }
        if "duration_ms" not in step_columns:
            connection.execute(
                "alter table quant_analysis_steps add column duration_ms integer not null default 0"
            )
        connection.execute("pragma user_version = 3")
        version = 3
    if version < 4:
        run_columns = {
            str(row["name"])
            for row in connection.execute(
                "pragma table_info(quant_analysis_runs)"
            ).fetchall()
        }
        if "simple_model" not in run_columns:
            connection.execute(
                "alter table quant_analysis_runs add column simple_model text not null default ''"
            )
        if "complex_model" not in run_columns:
            connection.execute(
                "alter table quant_analysis_runs add column complex_model text not null default ''"
            )
        connection.execute(
            "update quant_analysis_runs set simple_model = model where simple_model = ''"
        )
        connection.execute(
            "update quant_analysis_runs set complex_model = model where complex_model = ''"
        )
        step_columns = {
            str(row["name"])
            for row in connection.execute(
                "pragma table_info(quant_analysis_steps)"
            ).fetchall()
        }
        if "model" not in step_columns:
            connection.execute(
                "alter table quant_analysis_steps add column model text not null default ''"
            )
        connection.execute(f"pragma user_version = {CURRENT_DB_SCHEMA_VERSION}")


def seed_watchlist(connection: sqlite3.Connection, template_path: Path) -> None:
    if not template_path.exists():
        return

    rows: list[dict[str, Any]] = json.loads(template_path.read_text(encoding="utf-8"))
    for index, item in enumerate(rows):
        connection.execute(
            """
            insert or ignore into watchlist (ticker, name, market, sort_order)
            values (?, ?, ?, ?)
            """,
            (
                item["ticker"].upper(),
                item["name"],
                item.get("market", "UNKNOWN"),
                index,
            ),
        )


def get_watchlist() -> list[dict[str, Any]]:
    init_db()
    with connect() as connection:
        rows = connection.execute(
            """
            select ticker, name, market
            from watchlist
            order by sort_order asc, ticker asc
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_state_payload(key: str) -> str | None:
    init_db()
    with connect() as connection:
        row = connection.execute(
            "select payload from app_state where key = ?",
            (key,),
        ).fetchone()
    return str(row["payload"]) if row else None


def set_state_payload(key: str, payload: str) -> None:
    init_db()
    with connect() as connection:
        connection.execute(
            """
            insert into app_state (key, payload, updated_at)
            values (?, ?, current_timestamp)
            on conflict(key) do update set
              payload = excluded.payload,
              updated_at = current_timestamp
            """,
            (key, payload),
        )


def delete_state_payload(key: str) -> None:
    init_db()
    with connect() as connection:
        connection.execute("delete from app_state where key = ?", (key,))
