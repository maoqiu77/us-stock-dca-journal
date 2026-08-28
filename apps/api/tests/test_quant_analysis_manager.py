from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.api_models import QuantAnalysisRunRequest
from app.core import database
from app.modules.quant_analysis.manager import QuantAnalysisManager
from app.modules.quant_analysis.store import update_analysis_run


class QuantAnalysisManagerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.original_db_path = database.DB_PATH
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DB_PATH = Path(self.temp_dir.name) / "app.db"
        database.init_db()
        self.manager = QuantAnalysisManager()
        self.request = QuantAnalysisRunRequest.model_validate(
            {
                "ticker": "qqq",
                "analysisDate": "2026-08-29",
                "mode": "quick",
                "analysts": ["technical", "fundamentals"],
                "reflectionEnabled": False,
            }
        )

    def tearDown(self) -> None:
        database.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    @patch("app.modules.quant_analysis.manager.resolve_instrument")
    @patch("app.modules.quant_analysis.manager.load_ai_settings")
    def test_submit_normalizes_date_reuses_success_and_force_creates_version(
        self, load_settings, resolve
    ) -> None:
        load_settings.return_value = {
            "baseUrl": "https://example.test/v1",
            "model": "gpt-test",
            "apiKey": "secret",
        }
        resolve.return_value = {
            "ticker": "QQQ",
            "name": "Invesco QQQ Trust",
            "assetType": "ETF",
            "exchange": "NASDAQ",
        }

        first = self.manager.submit(self.request)
        update_analysis_run(first["id"], status="completed", progress=100)
        reused = self.manager.submit(self.request)
        forced_request = self.request.model_copy(update={"forceRegenerate": True})
        forced = self.manager.submit(forced_request)

        self.assertEqual(first["effectiveDate"], "2026-08-28")
        self.assertTrue(first["dateAdjusted"])
        self.assertEqual(first["assetType"], "ETF")
        self.assertTrue(reused["reused"])
        self.assertEqual(reused["id"], first["id"])
        self.assertFalse(forced["reused"])
        self.assertEqual(forced["version"], 2)

    def test_cancel_and_resume_preserve_completed_steps(self) -> None:
        from app.modules.quant_analysis.store import create_analysis_run, upsert_analysis_step

        run = create_analysis_run(
            ticker="AAPL",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["technical"],
            reflection_enabled=False,
            model="gpt-test",
            input_signature="resume-signature",
        )
        upsert_analysis_step(
            run["id"],
            step_key="analyst:technical",
            sequence=1,
            role="analyst_technical",
            status="completed",
            output={"summary": "已有报告"},
        )
        canceled_requested = self.manager.cancel(run["id"])
        self.assertEqual(canceled_requested["status"], "cancel_requested")
        update_analysis_run(run["id"], status="interrupted")

        resumed = self.manager.resume(run["id"])

        self.assertEqual(resumed["status"], "queued")
        self.assertEqual(resumed["steps"][0]["output"]["summary"], "已有报告")

    def test_resume_rejects_completed_run(self) -> None:
        from app.modules.quant_analysis.store import create_analysis_run

        run = create_analysis_run(
            ticker="AAPL",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode="quick",
            analysts=["technical"],
            reflection_enabled=False,
            model="gpt-test",
            input_signature="completed-signature",
        )
        update_analysis_run(run["id"], status="completed", progress=100)

        with self.assertRaises(HTTPException) as context:
            self.manager.resume(run["id"])

        self.assertEqual(context.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
