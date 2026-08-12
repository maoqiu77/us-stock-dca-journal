#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = PROJECT_ROOT / "apps" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.modules.ai_context_evaluation import (  # noqa: E402
    EvaluationValidationError,
    evaluate_dataset,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="对人工标注的 AI 投资上下文评测文件复算指标。"
    )
    parser.add_argument("input", type=Path, help="YAML 或 JSON 评测文件")
    parser.add_argument("--json", action="store_true", help="在标准输出打印 JSON 报告")
    parser.add_argument("--output", type=Path, help="将 JSON 报告写入指定路径")
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="存在未评分案例时以退出码 3 结束",
    )
    return parser.parse_args()


def load_dataset(path: Path) -> Any:
    if not path.exists():
        raise ValueError(f"找不到评测文件：{path}")
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(f"无法读取评测文件：{error}") from error
    try:
        if path.suffix.lower() == ".json":
            return json.loads(text)
        return yaml.safe_load(text)
    except (json.JSONDecodeError, yaml.YAMLError) as error:
        raise ValueError(f"无法解析评测文件：{error}") from error


def format_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    metrics = report["metrics"]
    lines = [
        f"AI 投资上下文评测：{report['evaluation_name']}",
        (
            f"已评分 {summary['completed_cases']}/{summary['total_cases']}，"
            f"待评分 {summary['incomplete_cases']}，通过 {summary['passed_cases']}"
        ),
        f"AI 投资上下文适配通过率：{format_ratio(summary['ai_context_adaptation_pass_rate'])}",
        "",
        f"提示词覆盖率：{format_ratio(metrics['prompt_context_coverage'])}",
        f"回答上下文召回率：{format_ratio(metrics['weighted_context_recall'])}",
        f"模型利用率：{format_ratio(metrics['model_context_utilization'])}",
        f"核心上下文召回率：{format_ratio(metrics['core_context_recall'])}",
        f"事实精确率：{format_ratio(metrics['fact_precision'])}",
        f"上下文幻觉率：{format_ratio(metrics['hallucination_rate'])}",
        f"约束遵守率：{format_ratio(metrics['constraint_compliance'])}",
        f"平均建议适配度：{format_number(metrics['average_adaptation_score'], '/10')}",
        f"建议依据可追溯率：{format_ratio(metrics['rationale_traceability'])}",
        f"关键事实错误：{metrics['critical_fact_errors']}",
        f"硬约束违反：{metrics['hard_constraint_violations']}",
    ]
    failed_cases = [
        item
        for item in report["case_results"]
        if item.get("status") == "completed" and not item.get("passed")
    ]
    if failed_cases:
        lines.extend(["", "未通过案例："])
        lines.extend(
            f"- {item['id']}: {', '.join(item['failed_gates'])}" for item in failed_cases
        )
    return "\n".join(lines) + "\n"


def format_ratio(value: float | None) -> str:
    return "无可用证据" if value is None else f"{value:.2%}"


def format_number(value: float | None, suffix: str = "") -> str:
    return "无可用证据" if value is None else f"{value:g}{suffix}"


def main() -> int:
    args = parse_args()
    try:
        dataset = load_dataset(args.input)
        report = evaluate_dataset(dataset)
    except (ValueError, EvaluationValidationError) as error:
        print(str(error), file=sys.stderr)
        return 2

    report_json = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(report_json, encoding="utf-8")
        except OSError as error:
            print(f"无法写入报告：{error}", file=sys.stderr)
            return 2

    if args.json:
        sys.stdout.write(report_json)
    elif args.output:
        print(f"评测报告已写入：{args.output}")
    else:
        sys.stdout.write(format_report(report))

    incomplete = report["summary"]["incomplete_cases"]
    if args.require_complete and incomplete:
        print(f"仍有 {incomplete} 个案例未完成评分。", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
