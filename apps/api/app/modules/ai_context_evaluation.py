from __future__ import annotations

from dataclasses import dataclass
from typing import Any


SCHEMA_VERSION = 1
CONTEXT_WEIGHTS = {"core": 3, "important": 2, "supporting": 1}
ADAPTATION_DIMENSIONS = (
    "long_term_goal",
    "asset_role",
    "account_context",
    "evidence",
    "uncertainty",
)
PASS_THRESHOLDS = {
    "fact_precision": 0.98,
    "weighted_context_recall": 0.90,
    "constraint_compliance": 0.95,
    "adaptation_score": 8,
}


class EvaluationValidationError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("评测文件校验失败：\n- " + "\n- ".join(errors))


@dataclass
class EvidenceCounts:
    context_weight: int = 0
    prompt_weight: int = 0
    used_context_weight: int = 0
    used_provided_weight: int = 0
    core_contexts: int = 0
    used_core_contexts: int = 0
    facts: int = 0
    supported_facts: int = 0
    unsupported_facts: int = 0
    critical_fact_errors: int = 0
    constraints: int = 0
    followed_constraints: int = 0
    hard_constraint_violations: int = 0
    adaptation_score: int = 0
    rationales: int = 0
    traceable_rationales: int = 0

    def add(self, other: "EvidenceCounts") -> None:
        for field_name in self.__dataclass_fields__:
            setattr(self, field_name, getattr(self, field_name) + getattr(other, field_name))


def validate_dataset(dataset: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(dataset, dict):
        return ["根节点必须是对象"]
    if dataset.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version 必须是 {SCHEMA_VERSION}")
    if not _nonempty_string(dataset.get("evaluation_name")):
        errors.append("evaluation_name 必须是非空字符串")
    cases = dataset.get("cases")
    if not isinstance(cases, list) or not cases:
        errors.append("cases 必须是非空数组")
        return errors

    seen_case_ids: set[str] = set()
    for case_index, case in enumerate(cases):
        path = f"cases[{case_index}]"
        if not isinstance(case, dict):
            errors.append(f"{path} 必须是对象")
            continue
        case_id = case.get("id")
        if not _nonempty_string(case_id):
            errors.append(f"{path}.id 必须是非空字符串")
        elif case_id in seen_case_ids:
            errors.append(f"{path}.id 与其他案例重复：{case_id}")
        else:
            seen_case_ids.add(case_id)
        for field_name in ("category", "question", "acceptable_response"):
            if not _nonempty_string(case.get(field_name)):
                errors.append(f"{path}.{field_name} 必须是非空字符串")
        _validate_string_list(case.get("forbidden_outcomes"), f"{path}.forbidden_outcomes", errors)

        context_ids = _validate_context_items(case.get("context_items"), path, errors)
        constraint_ids = _validate_constraints(case.get("constraints"), path, errors)
        review = case.get("review")
        if review is None:
            continue
        if not isinstance(review, dict):
            errors.append(f"{path}.review 必须是对象或 null")
            continue
        _validate_review(review, path, context_ids, constraint_ids, errors)
    return errors


def evaluate_dataset(dataset: dict[str, Any]) -> dict[str, Any]:
    errors = validate_dataset(dataset)
    if errors:
        raise EvaluationValidationError(errors)

    case_results: list[dict[str, Any]] = []
    aggregate = EvidenceCounts()
    completed_cases = 0
    passed_cases = 0
    adaptation_scores: list[int] = []

    for case in dataset["cases"]:
        if case.get("review") is None:
            case_results.append({"id": case["id"], "status": "incomplete"})
            continue
        result, counts = _evaluate_case(case)
        case_results.append(result)
        aggregate.add(counts)
        completed_cases += 1
        passed_cases += int(result["passed"])
        adaptation_scores.append(counts.adaptation_score)

    total_cases = len(dataset["cases"])
    return {
        "schema_version": SCHEMA_VERSION,
        "evaluation_name": dataset["evaluation_name"],
        "thresholds": {
            **PASS_THRESHOLDS,
            "critical_fact_errors": 0,
            "hard_constraint_violations": 0,
        },
        "summary": {
            "total_cases": total_cases,
            "completed_cases": completed_cases,
            "incomplete_cases": total_cases - completed_cases,
            "passed_cases": passed_cases,
            "ai_context_adaptation_pass_rate": _ratio(passed_cases, completed_cases),
        },
        "metrics": {
            "prompt_context_coverage": _ratio(
                aggregate.prompt_weight, aggregate.context_weight
            ),
            "weighted_context_recall": _ratio(
                aggregate.used_context_weight, aggregate.context_weight
            ),
            "model_context_utilization": _ratio(
                aggregate.used_provided_weight, aggregate.prompt_weight
            ),
            "core_context_recall": _ratio(
                aggregate.used_core_contexts, aggregate.core_contexts
            ),
            "fact_precision": _ratio(aggregate.supported_facts, aggregate.facts),
            "hallucination_rate": _ratio(aggregate.unsupported_facts, aggregate.facts),
            "critical_fact_errors": aggregate.critical_fact_errors,
            "constraint_compliance": _ratio(
                aggregate.followed_constraints, aggregate.constraints
            ),
            "hard_constraint_violations": aggregate.hard_constraint_violations,
            "average_adaptation_score": _average(adaptation_scores),
            "rationale_traceability": _ratio(
                aggregate.traceable_rationales, aggregate.rationales
            ),
        },
        "case_results": case_results,
    }


def _evaluate_case(case: dict[str, Any]) -> tuple[dict[str, Any], EvidenceCounts]:
    review = case["review"]
    contexts = {item["id"]: item for item in case["context_items"]}
    constraints = {item["id"]: item for item in case["constraints"]}
    counts = EvidenceCounts()

    for assessment in review["context_assessments"]:
        context = contexts[assessment["context_id"]]
        weight = CONTEXT_WEIGHTS[context["priority"]]
        counts.context_weight += weight
        if assessment["prompt_status"] == "provided":
            counts.prompt_weight += weight
        if assessment["answer_status"] == "used":
            counts.used_context_weight += weight
            if assessment["prompt_status"] == "provided":
                counts.used_provided_weight += weight
        if context["priority"] == "core":
            counts.core_contexts += 1
            if assessment["answer_status"] == "used":
                counts.used_core_contexts += 1

    for fact in review["facts"]:
        counts.facts += 1
        if fact["status"] == "supported":
            counts.supported_facts += 1
        if fact["status"] == "unsupported":
            counts.unsupported_facts += 1
        if fact["critical"] and fact["status"] != "supported":
            counts.critical_fact_errors += 1

    for assessment in review["constraint_assessments"]:
        constraint = constraints[assessment["constraint_id"]]
        counts.constraints += 1
        if assessment["status"] == "followed":
            counts.followed_constraints += 1
        elif constraint["hard"]:
            counts.hard_constraint_violations += 1

    counts.adaptation_score = sum(review["adaptation"].values())
    for rationale in review["rationales"]:
        counts.rationales += 1
        if rationale["context_ids"]:
            counts.traceable_rationales += 1

    metrics = {
        "prompt_context_coverage": _ratio(counts.prompt_weight, counts.context_weight),
        "weighted_context_recall": _ratio(
            counts.used_context_weight, counts.context_weight
        ),
        "model_context_utilization": _ratio(
            counts.used_provided_weight, counts.prompt_weight
        ),
        "core_context_recall": _ratio(
            counts.used_core_contexts, counts.core_contexts
        ),
        "fact_precision": _ratio(counts.supported_facts, counts.facts),
        "hallucination_rate": _ratio(counts.unsupported_facts, counts.facts),
        "critical_fact_errors": counts.critical_fact_errors,
        "constraint_compliance": _ratio(
            counts.followed_constraints, counts.constraints
        ),
        "hard_constraint_violations": counts.hard_constraint_violations,
        "adaptation_score": counts.adaptation_score,
        "rationale_traceability": _ratio(
            counts.traceable_rationales, counts.rationales
        ),
    }
    failed_gates = _failed_gates(metrics, counts)
    return (
        {
            "id": case["id"],
            "category": case["category"],
            "status": "completed",
            "passed": not failed_gates,
            "failed_gates": failed_gates,
            "metrics": metrics,
        },
        counts,
    )


def _failed_gates(metrics: dict[str, Any], counts: EvidenceCounts) -> list[str]:
    failures: list[str] = []
    gate_values = {
        "fact_precision": _raw_ratio(counts.supported_facts, counts.facts),
        "weighted_context_recall": _raw_ratio(
            counts.used_context_weight, counts.context_weight
        ),
        "constraint_compliance": _raw_ratio(
            counts.followed_constraints, counts.constraints
        ),
        "adaptation_score": counts.adaptation_score,
    }
    for metric_name, value in gate_values.items():
        if value is None:
            failures.append(f"{metric_name}_unavailable")
        elif value < PASS_THRESHOLDS[metric_name]:
            failures.append(metric_name)
    if metrics["critical_fact_errors"]:
        failures.append("critical_fact_errors")
    if metrics["hard_constraint_violations"]:
        failures.append("hard_constraint_violations")
    return failures


def _validate_context_items(value: Any, case_path: str, errors: list[str]) -> set[str]:
    path = f"{case_path}.context_items"
    if not isinstance(value, list) or not value:
        errors.append(f"{path} 必须是非空数组")
        return set()
    ids: set[str] = set()
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path} 必须是对象")
            continue
        item_id = item.get("id")
        if not _nonempty_string(item_id):
            errors.append(f"{item_path}.id 必须是非空字符串")
        elif item_id in ids:
            errors.append(f"{item_path}.id 重复：{item_id}")
        else:
            ids.add(item_id)
        if not _nonempty_string(item.get("text")):
            errors.append(f"{item_path}.text 必须是非空字符串")
        if not _enum_value_is_valid(item.get("priority"), CONTEXT_WEIGHTS):
            errors.append(f"{item_path}.priority 必须是 core、important 或 supporting")
    return ids


def _validate_constraints(value: Any, case_path: str, errors: list[str]) -> set[str]:
    path = f"{case_path}.constraints"
    if not isinstance(value, list) or not value:
        errors.append(f"{path} 必须是非空数组")
        return set()
    ids: set[str] = set()
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path} 必须是对象")
            continue
        item_id = item.get("id")
        if not _nonempty_string(item_id):
            errors.append(f"{item_path}.id 必须是非空字符串")
        elif item_id in ids:
            errors.append(f"{item_path}.id 重复：{item_id}")
        else:
            ids.add(item_id)
        if not _nonempty_string(item.get("text")):
            errors.append(f"{item_path}.text 必须是非空字符串")
        if not isinstance(item.get("hard"), bool):
            errors.append(f"{item_path}.hard 必须是布尔值")
    return ids


def _validate_review(
    review: dict[str, Any],
    case_path: str,
    context_ids: set[str],
    constraint_ids: set[str],
    errors: list[str],
) -> None:
    path = f"{case_path}.review"
    if not _nonempty_string(review.get("answer")):
        errors.append(f"{path}.answer 必须是非空字符串")

    assessments = review.get("context_assessments")
    assessed_context_ids: list[str] = []
    if not isinstance(assessments, list):
        errors.append(f"{path}.context_assessments 必须是数组")
    else:
        for index, assessment in enumerate(assessments):
            item_path = f"{path}.context_assessments[{index}]"
            if not isinstance(assessment, dict):
                errors.append(f"{item_path} 必须是对象")
                continue
            context_id = assessment.get("context_id")
            if not isinstance(context_id, str):
                errors.append(f"{item_path}.context_id 必须引用字符串上下文 ID")
            elif context_id not in context_ids:
                errors.append(f"{item_path}.context_id 引用了未知上下文 {context_id}")
            else:
                assessed_context_ids.append(context_id)
            if not _enum_value_is_valid(
                assessment.get("prompt_status"), {"provided", "missing"}
            ):
                errors.append(f"{item_path}.prompt_status 必须是 provided 或 missing")
            if not _enum_value_is_valid(
                assessment.get("answer_status"), {"used", "misused", "omitted"}
            ):
                errors.append(f"{item_path}.answer_status 必须是 used、misused 或 omitted")
        _validate_exact_ids(
            assessed_context_ids,
            context_ids,
            f"{path}.context_assessments",
            "上下文",
            errors,
        )

    facts = review.get("facts")
    if not isinstance(facts, list):
        errors.append(f"{path}.facts 必须是数组")
    else:
        for index, fact in enumerate(facts):
            item_path = f"{path}.facts[{index}]"
            if not isinstance(fact, dict):
                errors.append(f"{item_path} 必须是对象")
                continue
            if not _nonempty_string(fact.get("statement")):
                errors.append(f"{item_path}.statement 必须是非空字符串")
            if not _enum_value_is_valid(
                fact.get("status"), {"supported", "unsupported", "contradicted"}
            ):
                errors.append(f"{item_path}.status 必须是 supported、unsupported 或 contradicted")
            if not isinstance(fact.get("critical"), bool):
                errors.append(f"{item_path}.critical 必须是布尔值")

    constraint_assessments = review.get("constraint_assessments")
    assessed_constraint_ids: list[str] = []
    if not isinstance(constraint_assessments, list):
        errors.append(f"{path}.constraint_assessments 必须是数组")
    else:
        for index, assessment in enumerate(constraint_assessments):
            item_path = f"{path}.constraint_assessments[{index}]"
            if not isinstance(assessment, dict):
                errors.append(f"{item_path} 必须是对象")
                continue
            constraint_id = assessment.get("constraint_id")
            if not isinstance(constraint_id, str):
                errors.append(f"{item_path}.constraint_id 必须引用字符串约束 ID")
            elif constraint_id not in constraint_ids:
                errors.append(f"{item_path}.constraint_id 引用了未知约束 {constraint_id}")
            else:
                assessed_constraint_ids.append(constraint_id)
            if not _enum_value_is_valid(
                assessment.get("status"), {"followed", "violated"}
            ):
                errors.append(f"{item_path}.status 必须是 followed 或 violated")
        _validate_exact_ids(
            assessed_constraint_ids,
            constraint_ids,
            f"{path}.constraint_assessments",
            "约束",
            errors,
        )

    adaptation = review.get("adaptation")
    if not isinstance(adaptation, dict):
        errors.append(f"{path}.adaptation 必须是对象")
    else:
        missing = [key for key in ADAPTATION_DIMENSIONS if key not in adaptation]
        extra = [key for key in adaptation if key not in ADAPTATION_DIMENSIONS]
        if missing:
            errors.append(f"{path}.adaptation 缺少字段：{', '.join(missing)}")
        if extra:
            errors.append(f"{path}.adaptation 包含未知字段：{', '.join(extra)}")
        for dimension in ADAPTATION_DIMENSIONS:
            if dimension in adaptation and not _score_is_valid(adaptation[dimension]):
                errors.append(f"{path}.adaptation.{dimension} 必须是 0、1 或 2")

    rationales = review.get("rationales")
    if not isinstance(rationales, list):
        errors.append(f"{path}.rationales 必须是数组")
    else:
        for index, rationale in enumerate(rationales):
            item_path = f"{path}.rationales[{index}]"
            if not isinstance(rationale, dict):
                errors.append(f"{item_path} 必须是对象")
                continue
            if not _nonempty_string(rationale.get("text")):
                errors.append(f"{item_path}.text 必须是非空字符串")
            referenced_ids = rationale.get("context_ids")
            if not isinstance(referenced_ids, list):
                errors.append(f"{item_path}.context_ids 必须是数组")
                continue
            for reference_index, context_id in enumerate(referenced_ids):
                if not isinstance(context_id, str):
                    errors.append(
                        f"{item_path}.context_ids[{reference_index}] 必须引用字符串上下文 ID"
                    )
                elif context_id not in context_ids:
                    errors.append(
                        f"{item_path}.context_ids[{reference_index}] 引用了未知上下文 {context_id}"
                    )


def _validate_exact_ids(
    observed: list[str],
    expected: set[str],
    path: str,
    label: str,
    errors: list[str],
) -> None:
    duplicates = sorted({item for item in observed if observed.count(item) > 1})
    missing = sorted(expected - set(observed))
    if duplicates:
        errors.append(f"{path} 重复标注{label}：{', '.join(duplicates)}")
    if missing:
        errors.append(f"{path} 缺少{label}：{', '.join(missing)}")


def _validate_string_list(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, list):
        errors.append(f"{path} 必须是数组")
        return
    for index, item in enumerate(value):
        if not _nonempty_string(item):
            errors.append(f"{path}[{index}] 必须是非空字符串")


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _score_is_valid(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value in {0, 1, 2}


def _enum_value_is_valid(value: Any, choices: Any) -> bool:
    return isinstance(value, str) and value in choices


def _raw_ratio(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def _ratio(numerator: int, denominator: int) -> float | None:
    value = _raw_ratio(numerator, denominator)
    return None if value is None else round(value, 4)


def _average(values: list[int]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 4)
