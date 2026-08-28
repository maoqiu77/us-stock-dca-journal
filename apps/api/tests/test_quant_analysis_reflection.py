from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.core import database
from app.modules.quant_analysis import reflection, store


class QuantAnalysisReflectionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.original_db_path = database.DB_PATH
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DB_PATH = Path(self.temp_dir.name) / "app.db"
        database.init_db()
        self.run = store.create_analysis_run(
            ticker="AAPL",
            requested_date="2026-08-21",
            effective_date="2026-08-21",
            mode="quick",
            analysts=["technical"],
            reflection_enabled=True,
            model="gpt-test",
            input_signature="reflection-signature",
        )
        store.update_analysis_run(
            self.run["id"],
            status="completed",
            progress=100,
            final_result={"rating": "增持", "summary": "原始结论"},
        )

    def tearDown(self) -> None:
        database.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_reflection_rejects_requests_before_five_trading_days(self) -> None:
        with self.assertRaises(HTTPException) as context:
            reflection.generate_reflection(self.run["id"], today="2026-08-27")

        self.assertEqual(context.exception.status_code, 409)

    @patch("app.modules.quant_analysis.reflection.load_ai_settings")
    @patch("app.modules.quant_analysis.reflection.calculate_five_day_performance")
    @patch("app.modules.quant_analysis.reflection.call_openai_compatible_completion")
    def test_reflection_is_generated_once_with_relative_spy_return(
        self, completion, calculate, load_settings
    ) -> None:
        load_settings.return_value = {
            "baseUrl": "https://example.test/v1",
            "model": "gpt-test",
            "apiKey": "secret",
        }
        calculate.return_value = {
            "tickerReturnPct": 5.0,
            "spyReturnPct": 2.0,
            "excessReturnPct": 3.0,
            "startDate": "2026-08-21",
            "endDate": "2026-08-28",
        }
        completion.return_value = {
            "content": json.dumps(
                {
                    "verdictCorrect": True,
                    "validEvidence": ["趋势延续"],
                    "invalidEvidence": [],
                    "improvements": ["继续跟踪成交量"],
                },
                ensure_ascii=False,
            ),
            "endpoint": "responses",
        }

        first = reflection.generate_reflection(self.run["id"], today="2026-08-28")
        second = reflection.generate_reflection(self.run["id"], today="2026-08-29")

        self.assertEqual(first["reflection"]["performance"]["excessReturnPct"], 3.0)
        self.assertEqual(second["reflection"], first["reflection"])
        completion.assert_called_once()


if __name__ == "__main__":
    unittest.main()
