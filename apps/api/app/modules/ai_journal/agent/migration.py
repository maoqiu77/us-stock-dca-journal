from __future__ import annotations


STATEMENTS = (
    """create table if not exists ai_journal_agent_runs (
        id text primary key, turn_id text not null unique references ai_journal_turns(id),
        snapshot_id text not null unique references ai_journal_snapshots(id),
        engine_version text not null, model_fingerprint text not null,
        status text not null check(status in ('queued','running','succeeded','failed','outcome_unknown','cancel_requested','cancelled')),
        lease_token text, lease_expires_at text, cancel_requested integer not null default 0,
        result_json text, usage_json text, error_code text not null default '',
        created_at text not null, updated_at text not null)""",
    """create table if not exists ai_journal_agent_sources (
        run_id text not null references ai_journal_agent_runs(id), source_id text not null,
        payload_json text not null, primary key(run_id,source_id))""",
    """create table if not exists ai_journal_agent_events (
        run_id text not null references ai_journal_agent_runs(id), seq integer not null,
        event_json text not null, created_at text not null, primary key(run_id,seq))""",
    'create index if not exists idx_agent_run_queue on ai_journal_agent_runs(status,created_at)',
    """create table if not exists ai_journal_agent_capabilities (
        model_fingerprint text primary key, payload_json text not null, updated_at text not null)""",
)


def migrate_agent_db(connection):
    if connection.execute('pragma user_version').fetchone()[0] >= 7:
        return
    connection.execute('savepoint journal_agent_upgrade')
    try:
        for statement in STATEMENTS:
            connection.execute(statement)
        connection.execute('pragma user_version = 7')
        connection.execute('release journal_agent_upgrade')
    except Exception:
        connection.execute('rollback to journal_agent_upgrade')
        connection.execute('release journal_agent_upgrade')
        raise
