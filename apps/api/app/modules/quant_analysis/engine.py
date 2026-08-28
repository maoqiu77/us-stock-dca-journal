from __future__ import annotations

import hashlib
import json
from typing import Any


ANALYST_ORDER = ("technical", "fundamentals", "news", "social", "macro")


def build_input_signature(
    *,
    ticker: str,
    effective_date: str,
    mode: str,
    analysts: list[str],
    model: str,
) -> str:
    payload = {
        "ticker": ticker.upper(),
        "effectiveDate": effective_date,
        "mode": mode,
        "analysts": sorted(set(analysts)),
        "model": model,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def build_stage_plan(mode: str, analysts: list[str]) -> list[dict[str, Any]]:
    selected = set(analysts)
    steps: list[dict[str, Any]] = []
    sequence = 1

    def append(step_key: str, role: str, round_number: int | None = None) -> None:
        nonlocal sequence
        step: dict[str, Any] = {
            "stepKey": step_key,
            "role": role,
            "sequence": sequence,
        }
        if round_number is not None:
            step["round"] = round_number
        steps.append(step)
        sequence += 1

    for analyst in ANALYST_ORDER:
        if analyst in selected:
            append(f"analyst:{analyst}", f"analyst_{analyst}")

    rounds = 3 if mode == "deep" else 1
    for round_number in range(1, rounds + 1):
        append(f"debate:bull:{round_number}", "bull", round_number)
        append(f"debate:bear:{round_number}", "bear", round_number)
    append("research-manager", "research_manager")
    append("trader", "trader")
    for round_number in range(1, rounds + 1):
        append(f"risk:aggressive:{round_number}", "risk_aggressive", round_number)
        append(f"risk:neutral:{round_number}", "risk_neutral", round_number)
        append(f"risk:conservative:{round_number}", "risk_conservative", round_number)
    append("portfolio-manager", "portfolio_manager")
    return steps


def parse_structured_response(content: str) -> dict[str, Any]:
    stripped = content.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    parsed = json.loads(stripped)
    if not isinstance(parsed, dict):
        raise ValueError("AI response must be a JSON object")
    return parsed
