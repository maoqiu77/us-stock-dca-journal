from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "evaluate_ai_context.py"


class AiContextEvaluationCliTest(unittest.TestCase):
    def test_prints_a_readable_summary(self) -> None:
        result = run_cli(reviewed_dataset())

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("AI 投资上下文评测：CLI 虚构评测", result.stdout)
        self.assertIn("已评分 1/1，待评分 0，通过 1", result.stdout)
        self.assertIn("AI 投资上下文适配通过率：100.00%", result.stdout)
        self.assertIn("事实精确率：100.00%", result.stdout)

    def test_emits_machine_readable_json(self) -> None:
        result = run_cli(reviewed_dataset(), "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["evaluation_name"], "CLI 虚构评测")
        self.assertEqual(report["summary"]["completed_cases"], 1)
        self.assertEqual(report["summary"]["ai_context_adaptation_pass_rate"], 1.0)

    def test_rejects_invalid_input_with_validation_details(self) -> None:
        result = run_cli({"schema_version": 1, "evaluation_name": "损坏文件", "cases": []})

        self.assertEqual(result.returncode, 2)
        self.assertIn("cases 必须是非空数组", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_strict_mode_rejects_incomplete_evaluations(self) -> None:
        dataset = reviewed_dataset()
        dataset["cases"][0]["review"] = None

        normal = run_cli(dataset)
        strict = run_cli(dataset, "--require-complete")

        self.assertEqual(normal.returncode, 0, normal.stderr)
        self.assertEqual(strict.returncode, 3)
        self.assertIn("仍有 1 个案例未完成评分", strict.stderr)

    def test_writes_json_report_to_an_explicit_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "evaluation.yaml"
            output = Path(directory) / "reports" / "result.json"
            source.write_text(
                yaml.safe_dump(reviewed_dataset(), allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )

            result = subprocess.run(
                [str(SCRIPT), str(source), "--output", str(output)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output.exists())
            report = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["summary"]["passed_cases"], 1)
            self.assertIn(str(output), result.stdout)


def run_cli(dataset: dict[str, object], *arguments: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "evaluation.yaml"
        source.write_text(
            yaml.safe_dump(dataset, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        return subprocess.run(
            [str(SCRIPT), str(source), *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )


def reviewed_dataset() -> dict[str, object]:
    return {
        "schema_version": 1,
        "evaluation_name": "CLI 虚构评测",
        "cases": [
            {
                "id": "cli-01",
                "category": "account_facts",
                "question": "我持有什么？",
                "context_items": [
                    {"id": "holding", "text": "虚构用户持有 TEST ETF", "priority": "core"}
                ],
                "constraints": [
                    {"id": "no-invention", "text": "不虚构持仓", "hard": True}
                ],
                "forbidden_outcomes": ["虚构其他持仓"],
                "acceptable_response": "只陈述提供的虚构持仓。",
                "review": {
                    "answer": "你持有 TEST ETF。",
                    "context_assessments": [
                        {
                            "context_id": "holding",
                            "prompt_status": "provided",
                            "answer_status": "used",
                        }
                    ],
                    "facts": [
                        {
                            "statement": "持有 TEST ETF",
                            "status": "supported",
                            "critical": True,
                        }
                    ],
                    "constraint_assessments": [
                        {"constraint_id": "no-invention", "status": "followed"}
                    ],
                    "adaptation": {
                        "long_term_goal": 2,
                        "asset_role": 2,
                        "account_context": 2,
                        "evidence": 2,
                        "uncertainty": 2,
                    },
                    "rationales": [
                        {"text": "依据持仓上下文", "context_ids": ["holding"]}
                    ],
                },
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
