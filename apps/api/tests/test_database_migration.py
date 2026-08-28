from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.core import database


class DatabaseMigrationTest(unittest.TestCase):
    def test_init_db_sets_schema_version_without_losing_existing_data(self) -> None:
        original_db_path = database.DB_PATH
        original_template_home = database.TEMPLATE_HOME
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            database.DB_PATH = root / "app.db"
            database.TEMPLATE_HOME = root / "templates"
            with sqlite3.connect(database.DB_PATH) as connection:
                connection.execute(
                    """
                    create table watchlist (
                      ticker text primary key,
                      name text not null,
                      market text not null,
                      sort_order integer not null default 0
                    )
                    """
                )
                connection.execute(
                    """
                    create table app_state (
                      key text primary key,
                      payload text not null,
                      updated_at text not null default current_timestamp
                    )
                    """
                )
                connection.execute(
                    "insert into watchlist (ticker, name, market, sort_order) values (?, ?, ?, ?)",
                    ("NVDA", "NVIDIA", "US", 0),
                )
                connection.execute(
                    "insert into app_state (key, payload) values (?, ?)",
                    ("ai_settings_v1", '{"model":"gpt-test"}'),
                )
                connection.execute("pragma user_version = 0")

            try:
                database.init_db()
                with sqlite3.connect(database.DB_PATH) as connection:
                    version = connection.execute("pragma user_version").fetchone()[0]
                    watchlist_count = connection.execute("select count(*) from watchlist").fetchone()[0]
                    ai_payload = connection.execute(
                        "select payload from app_state where key = ?",
                        ("ai_settings_v1",),
                    ).fetchone()[0]
                    quant_tables = {
                        row[0]
                        for row in connection.execute(
                            "select name from sqlite_master where type = 'table'"
                        ).fetchall()
                    }
            finally:
                database.DB_PATH = original_db_path
                database.TEMPLATE_HOME = original_template_home

        self.assertEqual(version, database.CURRENT_DB_SCHEMA_VERSION)
        self.assertEqual(watchlist_count, 1)
        self.assertEqual(ai_payload, '{"model":"gpt-test"}')
        self.assertIn("quant_analysis_runs", quant_tables)
        self.assertIn("quant_analysis_steps", quant_tables)


if __name__ == "__main__":
    unittest.main()
