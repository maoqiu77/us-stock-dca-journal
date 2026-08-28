from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.core import database


class QuantAnalysisStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        from app.modules.quant_analysis import store

        self.store = store
        self.original_db_path = database.DB_PATH
        self.original_report_home = store.REPORT_HOME
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        database.DB_PATH = root / "app.db"
        store.REPORT_HOME = root / "quant-analysis"
        database.init_db()

    def tearDown(self) -> None:
        database.DB_PATH = self.original_db_path
        self.store.REPORT_HOME = self.original_report_home
        self.temp_dir.cleanup()

    def test_successful_run_is_reused_by_signature_and_forced_run_gets_new_version(self) -> None:
        first = self.store.create_analysis_run(
            ticker="NVDA",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["technical"],
            reflection_enabled=False,
            model="gpt-test",
            input_signature="same-signature",
        )
        self.store.update_analysis_run(
            first["id"],
            status="completed",
            progress=100,
            final_result={"rating": "持有"},
        )

        reusable = self.store.find_reusable_analysis_run("same-signature")
        second = self.store.create_analysis_run(
            ticker="NVDA",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["technical"],
            reflection_enabled=False,
            model="gpt-test",
            input_signature="same-signature",
        )

        self.assertEqual(reusable["id"], first["id"])
        self.assertEqual(reusable["finalResult"], {"rating": "持有"})
        self.assertEqual(first["version"], 1)
        self.assertEqual(second["version"], 2)

    def test_steps_are_persisted_in_sequence_and_exported_with_the_run(self) -> None:
        run = self.store.create_analysis_run(
            ticker="SPY",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode="deep",
            analysts=["technical", "macro"],
            reflection_enabled=True,
            model="gpt-test",
            input_signature="export-signature",
        )
        self.store.upsert_analysis_step(
            run["id"],
            step_key="analyst:technical",
            sequence=1,
            role="技术分析师",
            status="completed",
            output={"summary": "趋势向上"},
            data_sources=[{"name": "Yahoo", "status": "real"}],
        )
        self.store.upsert_analysis_step(
            run["id"],
            step_key="analyst:macro",
            sequence=2,
            role="宏观事件分析师",
            status="completed",
            output={"summary": "利率稳定"},
        )
        self.store.update_analysis_run(
            run["id"], status="completed", progress=100, final_result={"rating": "增持"}
        )

        saved = self.store.get_analysis_run(run["id"])
        export_path = self.store.export_analysis_run(run["id"])
        exported = json.loads(export_path.read_text(encoding="utf-8"))

        self.assertEqual([step["stepKey"] for step in saved["steps"]], [
            "analyst:technical",
            "analyst:macro",
        ])
        self.assertEqual(export_path.parent.name, "2026-08-28")
        self.assertEqual(export_path.parent.parent.name, "SPY")
        self.assertEqual(exported["finalResult"], {"rating": "增持"})
        self.assertEqual(len(exported["steps"]), 2)

    def test_startup_marks_running_jobs_interrupted_without_touching_completed_jobs(self) -> None:
        running = self.store.create_analysis_run(
            ticker="MSFT",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["technical"],
            reflection_enabled=False,
            model="gpt-test",
            input_signature="running",
        )
        completed = self.store.create_analysis_run(
            ticker="AAPL",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["technical"],
            reflection_enabled=False,
            model="gpt-test",
            input_signature="completed",
        )
        self.store.update_analysis_run(running["id"], status="running", current_stage="bull:1")
        self.store.update_analysis_run(completed["id"], status="completed", progress=100)

        changed = self.store.mark_active_runs_interrupted()

        self.assertEqual(changed, 1)
        self.assertEqual(self.store.get_analysis_run(running["id"])["status"], "interrupted")
        self.assertEqual(self.store.get_analysis_run(completed["id"])["status"], "completed")


if __name__ == "__main__":
    unittest.main()
