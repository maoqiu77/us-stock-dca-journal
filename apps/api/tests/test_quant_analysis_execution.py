from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core import database
from app.modules.quant_analysis import execution, store


class QuantAnalysisExecutionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.original_db_path = database.DB_PATH
        self.original_report_home = store.REPORT_HOME
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        database.DB_PATH = root / "app.db"
        store.REPORT_HOME = root / "reports"
        database.init_db()

    def tearDown(self) -> None:
        database.DB_PATH = self.original_db_path
        store.REPORT_HOME = self.original_report_home
        self.temp_dir.cleanup()

    def create_run(self, *, mode: str = "quick", analysts: list[str] | None = None):
        return store.create_analysis_run(
            ticker="AAPL",
            requested_date="2026-08-28",
            effective_date="2026-08-28",
            mode=mode,
            analysts=analysts or ["technical"],
            reflection_enabled=True,
            input_signature=f"{mode}-signature",
            simple_model="gpt-5.6-luna",
            complex_model="gpt-5.6-luna",
        )

    @patch("app.modules.quant_analysis.execution.collect_analysis_sources")
    @patch("app.modules.quant_analysis.execution.load_ai_settings")
    def test_quick_pipeline_completes_every_stage_and_exports_snapshot(
        self, load_settings, collect_sources
    ) -> None:
        load_settings.return_value = {
            "baseUrl": "https://example.test/v1",
            "model": "gpt-test",
            "apiKey": "secret",
        }
        collect_sources.return_value = {
            "technical": {
                "analyst": "technical",
                "status": "available",
                "data": {"asOf": "2026-08-28", "metrics": {"RSI14": 52}},
                "sources": [{"provider": "yahoo", "isReal": True}],
            }
        }
        calls: list[dict[str, object]] = []

        def complete(**kwargs):
            calls.append(kwargs)
            return {
                "content": json.dumps(
                    {
                        "summary": "结构化结论",
                        "rating": "增持",
                        "confidence": 72,
                        "evidence": ["真实公开数据"],
                        "risks": ["波动风险"],
                        "targetPrice": 225,
                    },
                    ensure_ascii=False,
                ),
                "endpoint": "responses",
            }

        run = self.create_run()
        with patch(
            "app.modules.quant_analysis.execution.call_openai_compatible_completion",
            side_effect=complete,
        ):
            result = execution.execute_analysis_run(run["id"])

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["progress"], 100)
        self.assertEqual(result["finalResult"]["rating"], "增持")
        self.assertIsNone(result["finalResult"]["targetPrice"])
        self.assertEqual(result["finalResult"]["dataQuality"]["availableCount"], 1)
        self.assertFalse(result["finalResult"]["dataQuality"]["partial"])
        self.assertEqual(len(calls), 9)
        self.assertEqual(len(result["steps"]), 9)
        self.assertTrue((store.REPORT_HOME / "AAPL" / "2026-08-28" / f"{run['id']}.json").exists())
        self.assertEqual([call["model"] for call in calls], ["gpt-5.6-luna"] * 9)
        self.assertEqual(
            {call["max_output_tokens"] for call in calls},
            {execution.QUANT_AI_MAX_OUTPUT_TOKENS},
        )
        serialized_prompts = json.dumps(
            [call["messages"] for call in calls], ensure_ascii=False
        )
        self.assertNotIn("账户", serialized_prompts)
        self.assertNotIn("持仓", serialized_prompts)
        self.assertNotIn("交易流水", serialized_prompts)
        self.assertIn("不得虚构对手观点", serialized_prompts)
        self.assertIn("不得强行给出方向", serialized_prompts)

    @patch("app.modules.quant_analysis.execution.collect_analysis_sources")
    @patch("app.modules.quant_analysis.execution.load_ai_settings")
    def test_no_real_evidence_stops_before_any_ai_call(
        self, load_settings, collect_sources
    ) -> None:
        load_settings.return_value = {
            "baseUrl": "https://example.test/v1",
            "model": "gpt-test",
            "apiKey": "secret",
        }
        collect_sources.return_value = {
            "technical": {
                "analyst": "technical",
                "status": "sample",
                "samplePreview": {"latestClose": 200},
                "sources": [{"provider": "sample", "isReal": False}],
            }
        }
        run = self.create_run()

        with patch(
            "app.modules.quant_analysis.execution.call_openai_compatible_completion"
        ) as completion:
            result = execution.execute_analysis_run(run["id"])

        completion.assert_not_called()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["errorCode"], "insufficient_data")
        self.assertIsNone(result["finalResult"])

    @patch("app.modules.quant_analysis.execution.collect_analysis_sources")
    @patch("app.modules.quant_analysis.execution.load_ai_settings")
    def test_resume_skips_completed_steps_without_repeating_ai_cost(
        self, load_settings, collect_sources
    ) -> None:
        load_settings.return_value = {
            "baseUrl": "https://example.test/v1",
            "model": "gpt-test",
            "apiKey": "secret",
        }
        collect_sources.return_value = {
            "technical": {
                "analyst": "technical",
                "status": "available",
                "data": {"metrics": {"RSI14": 52}},
                "sources": [],
            }
        }
        run = self.create_run()
        store.upsert_analysis_step(
            run["id"],
            step_key="analyst:technical",
            sequence=1,
            role="analyst_technical",
            status="completed",
            output={"summary": "已有技术报告"},
        )
        completion = {
            "content": json.dumps({"summary": "ok", "rating": "持有"}, ensure_ascii=False),
            "endpoint": "responses",
        }

        with patch(
            "app.modules.quant_analysis.execution.call_openai_compatible_completion",
            return_value=completion,
        ) as caller:
            result = execution.execute_analysis_run(run["id"])

        self.assertEqual(result["status"], "completed")
        self.assertEqual(caller.call_count, 8)
        self.assertEqual(result["steps"][0]["output"], {"summary": "已有技术报告"})

    @patch("app.modules.quant_analysis.execution.collect_analysis_sources")
    @patch("app.modules.quant_analysis.execution.load_ai_settings")
    def test_deep_pipeline_uses_three_debate_and_risk_rounds(
        self, load_settings, collect_sources
    ) -> None:
        load_settings.return_value = {
            "baseUrl": "https://example.test/v1",
            "model": "gpt-test",
            "apiKey": "secret",
        }
        collect_sources.return_value = {
            "technical": {
                "analyst": "technical",
                "status": "available",
                "data": {"metrics": {"RSI14": 52}},
                "sources": [],
            }
        }
        run = self.create_run(mode="deep")
        completion = {
            "content": json.dumps({"summary": "ok", "rating": "持有"}, ensure_ascii=False),
            "endpoint": "responses",
        }

        with patch(
            "app.modules.quant_analysis.execution.call_openai_compatible_completion",
            return_value=completion,
        ) as caller:
            result = execution.execute_analysis_run(run["id"])

        self.assertEqual(result["status"], "completed")
        self.assertEqual(caller.call_count, 19)
        models = [call.kwargs["model"] for call in caller.call_args_list]
        self.assertEqual(models, ["gpt-5.6-luna"] * 19)
        self.assertEqual(len([step for step in result["steps"] if step["role"] == "bull"]), 3)
        self.assertEqual(
            len([step for step in result["steps"] if step["role"] == "risk_neutral"]),
            3,
        )


if __name__ == "__main__":
    unittest.main()
