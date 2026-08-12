from __future__ import annotations

import unittest
from pathlib import Path

import yaml

from app.modules.ai_context_evaluation import evaluate_dataset, validate_dataset


ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "storage" / "templates" / "ai-context-evaluation.example.yaml"
REQUIRED_CATEGORIES = {
    "account_facts",
    "long_term_etf",
    "allocation_rebalancing",
    "trade_history",
    "data_quality",
}


class AiContextEvaluationTemplateTest(unittest.TestCase):
    def test_public_template_is_a_valid_unreviewed_twenty_case_suite(self) -> None:
        dataset = yaml.safe_load(TEMPLATE.read_text(encoding="utf-8"))

        self.assertEqual(validate_dataset(dataset), [])
        self.assertEqual(len(dataset["cases"]), 20)
        self.assertEqual(len({case["id"] for case in dataset["cases"]}), 20)
        self.assertEqual({case["category"] for case in dataset["cases"]}, REQUIRED_CATEGORIES)
        self.assertEqual(
            {category: sum(case["category"] == category for case in dataset["cases"])
             for category in REQUIRED_CATEGORIES},
            {category: 4 for category in REQUIRED_CATEGORIES},
        )
        self.assertTrue(all(case["review"] is None for case in dataset["cases"]))

        report = evaluate_dataset(dataset)
        self.assertEqual(report["summary"]["completed_cases"], 0)
        self.assertEqual(report["summary"]["incomplete_cases"], 20)
        self.assertIsNone(report["summary"]["ai_context_adaptation_pass_rate"])
        self.assertIsNone(report["metrics"]["fact_precision"])


if __name__ == "__main__":
    unittest.main()
