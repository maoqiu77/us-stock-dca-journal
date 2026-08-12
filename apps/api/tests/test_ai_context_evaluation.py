from __future__ import annotations

import unittest

from app.modules.ai_context_evaluation import (
    EvaluationValidationError,
    evaluate_dataset,
    validate_dataset,
)


class AiContextEvaluationTest(unittest.TestCase):
    def test_scores_a_passing_case_from_human_annotations(self) -> None:
        report = evaluate_dataset(dataset_with_cases(passing_case()))

        result = report["case_results"][0]
        self.assertEqual(result["status"], "completed")
        self.assertTrue(result["passed"])
        self.assertEqual(result["failed_gates"], [])
        self.assertEqual(
            result["metrics"],
            {
                "prompt_context_coverage": 1.0,
                "weighted_context_recall": 1.0,
                "model_context_utilization": 1.0,
                "core_context_recall": 1.0,
                "fact_precision": 1.0,
                "hallucination_rate": 0.0,
                "critical_fact_errors": 0,
                "constraint_compliance": 1.0,
                "hard_constraint_violations": 0,
                "adaptation_score": 8,
                "rationale_traceability": 1.0,
            },
        )

    def test_hard_failures_cannot_be_averaged_away(self) -> None:
        result = evaluate_dataset(dataset_with_cases(failing_case()))["case_results"][0]

        self.assertFalse(result["passed"])
        self.assertEqual(result["metrics"]["weighted_context_recall"], 0.6)
        self.assertEqual(result["metrics"]["fact_precision"], 0.5)
        self.assertEqual(result["metrics"]["critical_fact_errors"], 1)
        self.assertEqual(result["metrics"]["hard_constraint_violations"], 1)
        self.assertEqual(result["metrics"]["adaptation_score"], 5)
        self.assertEqual(
            result["failed_gates"],
            [
                "fact_precision",
                "weighted_context_recall",
                "constraint_compliance",
                "adaptation_score",
                "critical_fact_errors",
                "hard_constraint_violations",
            ],
        )

    def test_aggregates_evidence_counts_instead_of_averaging_ratios(self) -> None:
        report = evaluate_dataset(dataset_with_cases(passing_case(), failing_case()))

        self.assertEqual(
            report["summary"],
            {
                "total_cases": 2,
                "completed_cases": 2,
                "incomplete_cases": 0,
                "passed_cases": 1,
                "ai_context_adaptation_pass_rate": 0.5,
            },
        )
        self.assertEqual(
            report["metrics"],
            {
                "prompt_context_coverage": 0.8,
                "weighted_context_recall": 0.8,
                "model_context_utilization": 1.0,
                "core_context_recall": 1.0,
                "fact_precision": 0.75,
                "hallucination_rate": 0.0,
                "critical_fact_errors": 1,
                "constraint_compliance": 0.6667,
                "hard_constraint_violations": 1,
                "average_adaptation_score": 6.5,
                "rationale_traceability": 0.6667,
            },
        )

    def test_preserves_undefined_ratios_and_does_not_pass_missing_evidence(self) -> None:
        case = passing_case()
        case["review"]["facts"] = []
        case["review"]["rationales"] = []

        report = evaluate_dataset(dataset_with_cases(case))

        result = report["case_results"][0]
        self.assertIsNone(result["metrics"]["fact_precision"])
        self.assertIsNone(result["metrics"]["hallucination_rate"])
        self.assertIsNone(result["metrics"]["rationale_traceability"])
        self.assertFalse(result["passed"])
        self.assertIn("fact_precision_unavailable", result["failed_gates"])
        self.assertIsNone(report["metrics"]["fact_precision"])

    def test_excludes_unreviewed_cases_from_scores_but_reports_them(self) -> None:
        incomplete = passing_case(case_id="pending")
        incomplete["review"] = None

        report = evaluate_dataset(dataset_with_cases(passing_case(), incomplete))

        self.assertEqual(report["summary"]["total_cases"], 2)
        self.assertEqual(report["summary"]["completed_cases"], 1)
        self.assertEqual(report["summary"]["incomplete_cases"], 1)
        self.assertEqual(report["summary"]["ai_context_adaptation_pass_rate"], 1.0)
        self.assertEqual(report["case_results"][1], {"id": "pending", "status": "incomplete"})

    def test_rejects_unknown_annotation_references_and_invalid_scores(self) -> None:
        case = passing_case()
        case["review"]["context_assessments"][0]["context_id"] = "unknown-context"
        case["review"]["constraint_assessments"][0]["constraint_id"] = "unknown-rule"
        case["review"]["adaptation"]["uncertainty"] = 3
        case["review"]["rationales"][0]["context_ids"] = ["unknown-context"]
        dataset = dataset_with_cases(case)

        errors = validate_dataset(dataset)

        self.assertIn("cases[0].review.context_assessments[0].context_id 引用了未知上下文 unknown-context", errors)
        self.assertIn("cases[0].review.constraint_assessments[0].constraint_id 引用了未知约束 unknown-rule", errors)
        self.assertIn("cases[0].review.adaptation.uncertainty 必须是 0、1 或 2", errors)
        self.assertIn("cases[0].review.rationales[0].context_ids[0] 引用了未知上下文 unknown-context", errors)
        with self.assertRaises(EvaluationValidationError):
            evaluate_dataset(dataset)

    def test_reports_unhashable_ids_as_validation_errors_instead_of_crashing(self) -> None:
        case = passing_case()
        case["id"] = ["not", "a", "string"]
        case["context_items"][0]["id"] = {"invalid": "context"}
        case["constraints"][0]["id"] = ["invalid", "constraint"]
        case["review"]["context_assessments"][0]["context_id"] = ["invalid"]
        case["review"]["constraint_assessments"][0]["constraint_id"] = {"invalid": True}
        case["review"]["rationales"][0]["context_ids"] = [["invalid"]]

        errors = validate_dataset(dataset_with_cases(case))

        self.assertIn("cases[0].id 必须是非空字符串", errors)
        self.assertIn("cases[0].context_items[0].id 必须是非空字符串", errors)
        self.assertIn("cases[0].constraints[0].id 必须是非空字符串", errors)
        self.assertIn(
            "cases[0].review.context_assessments[0].context_id 必须引用字符串上下文 ID",
            errors,
        )
        self.assertIn(
            "cases[0].review.constraint_assessments[0].constraint_id 必须引用字符串约束 ID",
            errors,
        )
        self.assertIn(
            "cases[0].review.rationales[0].context_ids[0] 必须引用字符串上下文 ID",
            errors,
        )

    def test_reports_unhashable_enum_values_as_validation_errors(self) -> None:
        case = passing_case()
        case["context_items"][0]["priority"] = []
        case["review"]["context_assessments"][0]["prompt_status"] = {}
        case["review"]["context_assessments"][0]["answer_status"] = []
        case["review"]["facts"][0]["status"] = {}
        case["review"]["constraint_assessments"][0]["status"] = []

        errors = validate_dataset(dataset_with_cases(case))

        self.assertIn(
            "cases[0].context_items[0].priority 必须是 core、important 或 supporting",
            errors,
        )
        self.assertIn(
            "cases[0].review.context_assessments[0].prompt_status 必须是 provided 或 missing",
            errors,
        )
        self.assertIn(
            "cases[0].review.context_assessments[0].answer_status 必须是 used、misused 或 omitted",
            errors,
        )
        self.assertIn(
            "cases[0].review.facts[0].status 必须是 supported、unsupported 或 contradicted",
            errors,
        )
        self.assertIn(
            "cases[0].review.constraint_assessments[0].status 必须是 followed 或 violated",
            errors,
        )

    def test_pass_gates_compare_unrounded_evidence_ratios(self) -> None:
        case = passing_case()
        case["review"]["facts"] = [
            {
                "statement": f"受支持事实 {index}",
                "status": "supported",
                "critical": False,
            }
            for index in range(4899)
        ] + [
            {
                "statement": f"无依据事实 {index}",
                "status": "unsupported",
                "critical": False,
            }
            for index in range(100)
        ]

        result = evaluate_dataset(dataset_with_cases(case))["case_results"][0]

        self.assertEqual(result["metrics"]["fact_precision"], 0.98)
        self.assertFalse(result["passed"])
        self.assertIn("fact_precision", result["failed_gates"])


def dataset_with_cases(*cases: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "evaluation_name": "虚构长期投资助手评测",
        "cases": list(cases),
    }


def passing_case(case_id: str = "long-etf-01") -> dict[str, object]:
    return {
        "id": case_id,
        "category": "long_term_etf",
        "question": "QQQM 单日下跌后是否应该卖出？",
        "context_items": [
            {"id": "role", "text": "QQQM 是长期核心 ETF", "priority": "core"},
            {"id": "weight", "text": "当前仓位低于目标区间", "priority": "important"},
        ],
        "constraints": [
            {"id": "long-term", "text": "单日波动不能直接推导清仓", "hard": True},
            {"id": "no-leverage", "text": "不建议杠杆或期权", "hard": True},
        ],
        "forbidden_outcomes": ["把 QQQM 当作短线个股"],
        "acceptable_response": "先核对长期逻辑和目标仓位，不因单日波动直接卖出。",
        "review": {
            "answer": "结合长期核心 ETF 定位和偏低仓位，单日下跌不构成卖出理由。",
            "context_assessments": [
                {"context_id": "role", "prompt_status": "provided", "answer_status": "used"},
                {"context_id": "weight", "prompt_status": "provided", "answer_status": "used"},
            ],
            "facts": [
                {"statement": "QQQM 是长期核心 ETF", "status": "supported", "critical": True},
                {"statement": "当前仓位低于目标", "status": "supported", "critical": True},
            ],
            "constraint_assessments": [
                {"constraint_id": "long-term", "status": "followed"},
                {"constraint_id": "no-leverage", "status": "followed"},
            ],
            "adaptation": {
                "long_term_goal": 2,
                "asset_role": 2,
                "account_context": 2,
                "evidence": 1,
                "uncertainty": 1,
            },
            "rationales": [
                {"text": "长期核心 ETF 且仓位偏低", "context_ids": ["role", "weight"]},
            ],
        },
    }


def failing_case() -> dict[str, object]:
    case = passing_case(case_id="long-etf-02")
    case["context_items"] = [
        {"id": "role", "text": "VOO 是长期核心 ETF", "priority": "core"},
        {"id": "weight", "text": "当前仓位低于目标区间", "priority": "important"},
    ]
    case["constraints"] = [
        {"id": "long-term", "text": "单日波动不能直接推导清仓", "hard": True},
    ]
    case["review"] = {
        "answer": "VOO 是短线卫星仓，建议立即清仓。",
        "context_assessments": [
            {"context_id": "role", "prompt_status": "provided", "answer_status": "used"},
            {"context_id": "weight", "prompt_status": "missing", "answer_status": "omitted"},
        ],
        "facts": [
            {"statement": "用户持有 VOO", "status": "supported", "critical": True},
            {"statement": "VOO 是短线卫星仓", "status": "contradicted", "critical": True},
        ],
        "constraint_assessments": [
            {"constraint_id": "long-term", "status": "violated"},
        ],
        "adaptation": {
            "long_term_goal": 0,
            "asset_role": 0,
            "account_context": 1,
            "evidence": 2,
            "uncertainty": 2,
        },
        "rationales": [
            {"text": "用户持有 VOO", "context_ids": ["role"]},
            {"text": "近期可能继续下跌", "context_ids": []},
        ],
    }
    return case


if __name__ == "__main__":
    unittest.main()
