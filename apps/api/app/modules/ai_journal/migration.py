from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import uuid4


def backup_before_upgrade(connection):
    from app.core.database import CURRENT_DB_SCHEMA_VERSION
    if connection.execute('pragma user_version').fetchone()[0] >= CURRENT_DB_SCHEMA_VERSION:
        return
    filename = connection.execute('pragma database_list').fetchone()[2]
    if not filename or not connection.execute("select name from sqlite_master where type='table'").fetchone():
        return
    path = Path(filename)
    backup = path.parent / 'backups' / (path.name + '.before-journal-' + uuid4().hex + '.db')
    backup.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(backup) as target:
        connection.backup(target)


def migrate_journal_db(connection):
    # No executescript: all DDL and the version bump must roll back together.
    connection.execute('savepoint journal_upgrade')
    try:
        statements = [
            'create table if not exists ai_journal_snapshots (id text primary key, payload text not null, digest text not null, model_fingerprint text not null, created_at text not null)',
            'create table if not exists ai_journal_sessions (id text primary key, title text not null, task_type text not null, instrument_key text, created_at text not null)',
            'create table if not exists ai_journal_turns (id text primary key, session_id text not null, snapshot_id text not null unique, idempotency_key text not null unique, status text not null, answer text not null default \'\', error_code text not null default \'\', created_at text not null, updated_at text not null)',
            'create table if not exists ai_journal_notes (id text primary key, body text not null, created_at text not null, updated_at text not null, deleted_at text)',
            'create table if not exists ai_journal_quant_links (run_id text primary key, session_id text not null, question text not null, created_at text not null)',
            'create index if not exists idx_journal_session_date on ai_journal_sessions(created_at)',
            'create index if not exists idx_journal_turn_session on ai_journal_turns(session_id, created_at)',
            "create trigger if not exists journal_snapshot_immutable before update on ai_journal_snapshots begin select raise(abort, 'immutable snapshot'); end",
            "create trigger if not exists journal_snapshot_no_delete before delete on ai_journal_snapshots begin select raise(abort, 'immutable snapshot'); end",
        ]
        for statement in statements:
            connection.execute(statement)
        if connection.execute('pragma user_version').fetchone()[0] < 6:
            connection.execute('pragma user_version = 6')
        from .agent.migration import migrate_agent_db
        migrate_agent_db(connection)
        connection.execute('release journal_upgrade')
    except Exception:
        connection.execute('rollback to journal_upgrade')
        connection.execute('release journal_upgrade')
        raise
