from __future__ import annotations

import sqlite3


def migrate_board_db(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        create table if not exists board_instruments (
          key text primary key, payload text not null
        );
        create table if not exists board_selections (
          segment text primary key, revision integer not null default 0,
          initialized integer not null default 0
        );
        create table if not exists board_selection_items (
          segment text not null, instrument_key text not null,
          sort_order integer not null, primary key (segment, instrument_key),
          foreign key(segment) references board_selections(segment)
        );
        create index if not exists idx_board_selection_order
          on board_selection_items(segment, sort_order);
        create table if not exists board_cache (
          cache_key text primary key, payload text not null,
          expires_at text not null, retain_until text not null
        );
        create table if not exists board_premiums (
          instrument_key text not null, basis text not null,
          trade_date text not null, premium text not null,
          is_final integer not null default 0,
          primary key(instrument_key, basis, trade_date)
        );
        """
    )

