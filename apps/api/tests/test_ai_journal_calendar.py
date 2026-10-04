from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.core import database
from app.modules.ai_journal.calendar import calendar
from app.modules.ai_journal.migration import migrate_journal_db
from app.modules.ai_journal.store import JournalStore


class AiJournalCalendarTest(unittest.TestCase):
    def test_new_turns_and_legacy_records_share_beijing_day_without_overwriting(self):
        original = database.DB_PATH
        with tempfile.TemporaryDirectory() as temp:
            database.DB_PATH = Path(temp) / "isolated.db"
            try:
                with database.connect() as db:
                    db.execute("create table app_state(key text primary key,payload text,updated_at text)")
                    migrate_journal_db(db)
                    db.execute("create table quant_analysis_runs(id text primary key,status text,ticker text)")
                    db.execute("insert into app_state values (?,?,?)", (
                        "ai_advice_v1",
                        json.dumps({"records": {"2026-09-30": {"content": "legacy"}, "2026-09-29": {"content": "old"}}}),
                        "2026-09-30T00:00:00+00:00",
                    ))
                    snapshots = [
                        ("snap-a", {"request": {"question": "检查集中度", "task_type": "portfolio_review"}}, "2026-09-30T01:00:00+00:00"),
                        ("snap-b", {"request": {"question": "研究 AAPL 风险", "task_type": "instrument_research"}}, "2026-09-30T02:00:00+00:00"),
                    ]
                    for snapshot_id, payload, created_at in snapshots:
                        db.execute("insert into ai_journal_snapshots values (?,?,?,?,?)", (snapshot_id, json.dumps(payload), f"digest-{snapshot_id}", "model", created_at))
                    db.execute("insert into ai_journal_sessions values (?,?,?,?,?)", ("session-a", "检查集中度", "portfolio_review", None, snapshots[0][2]))
                    db.execute("insert into ai_journal_sessions values (?,?,?,?,?)", ("session-b", "研究 AAPL 风险", "instrument_research", "US:XNAS:AAPL:STOCK", snapshots[1][2]))
                    db.execute("insert into ai_journal_turns (id,session_id,snapshot_id,idempotency_key,status,created_at,updated_at) values (?,?,?,?,?,?,?)", ("turn-a", "session-a", "snap-a", "idem-a", "completed", snapshots[0][2], snapshots[0][2]))
                    db.execute("insert into ai_journal_turns (id,session_id,snapshot_id,idempotency_key,status,created_at,updated_at) values (?,?,?,?,?,?,?)", ("turn-b", "session-b", "snap-b", "idem-b", "completed", snapshots[1][2], snapshots[1][2]))
                result = calendar(JournalStore())
                self.assertEqual(result["dates"], ["2026-09-30", "2026-09-29"])
                same_day = [item for item in result["items"] if item["date"] == "2026-09-30"]
                self.assertEqual({item["id"] for item in same_day}, {"turn-a", "turn-b", "2026-09-30"})
                self.assertIn("持仓分析 · 检查集中度", {item["title"] for item in same_day})
                self.assertIn("标的快研 · 研究 AAPL 风险", {item["title"] for item in same_day})
                self.assertEqual(len([item for item in same_day if item["kind"] == "legacy"]), 1)
                selected = calendar(JournalStore(), "2026-09-30")
                self.assertTrue(all(item["date"] == "2026-09-30" for item in selected["items"]))
            finally:
                database.DB_PATH = original

    def test_note_can_be_archived_on_selected_business_date(self):
        original = database.DB_PATH
        with tempfile.TemporaryDirectory() as temp:
            database.DB_PATH = Path(temp) / "isolated.db"
            try:
                with database.connect() as db:
                    db.execute("create table app_state(key text primary key,payload text,updated_at text)")
                    migrate_journal_db(db)
                    db.execute("create table quant_analysis_runs(id text primary key,status text,ticker text)")
                JournalStore().save_note("补记旧日期", journal_date="2026-01-15")
                result = calendar(JournalStore(), "2026-01-15")
                self.assertEqual(result["items"][0]["date"], "2026-01-15")
            finally:
                database.DB_PATH = original


if __name__ == "__main__":
    unittest.main()
