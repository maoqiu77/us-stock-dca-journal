from __future__ import annotations

import json
import time
from typing import Any

from app.modules.ai_settings import (
    OpenAICompatibleRequestError,
    call_openai_compatible_completion,
    load_ai_settings,
)
from app.modules.quant_analysis.engine import build_stage_plan, parse_structured_response
from app.modules.quant_analysis.sources import collect_analysis_sources, evidence_for_ai
from app.modules.quant_analysis.store import (
    export_analysis_run,
    get_analysis_run,
    update_analysis_run,
    upsert_analysis_step,
    utc_timestamp,
)


TERMINAL_STEP_STATUSES = {"completed", "disabled", "sample", "unavailable"}
FINAL_RATINGS = {"买入", "增持", "持有", "减持", "卖出"}
ROLE_LABELS = {
    "analyst_technical": "技术分析师",
    "analyst_fundamentals": "基本面与 ETF 结构分析师",
    "analyst_news": "新闻分析师",
    "analyst_social": "社交情绪分析师",
    "analyst_macro": "宏观事件分析师",
    "bull": "多头研究员",
    "bear": "空头研究员",
    "research_manager": "研究经理",
    "trader": "交易方案研究员",
    "risk_aggressive": "进取风险研究员",
    "risk_neutral": "中性风险研究员",
    "risk_conservative": "保守风险研究员",
    "portfolio_manager": "组合研究经理",
}
COMPLEX_ROLES = frozenset({"research_manager", "portfolio_manager"})
QUANT_AI_MAX_OUTPUT_TOKENS = 8192


def execute_analysis_run(run_id: str) -> dict[str, Any]:
    run = get_analysis_run(run_id)
    if run["status"] == "cancel_requested":
        return _finish_canceled(run_id)

    settings = load_ai_settings()
    base_url = str(settings.get("baseUrl") or "").strip()
    simple_model = str(run.get("simpleModel") or run.get("model") or "").strip()
    complex_model = str(run.get("complexModel") or run.get("model") or "").strip()
    api_key = str(settings.get("apiKey") or "").strip()
    if not (base_url and simple_model and complex_model and api_key):
        return update_analysis_run(
            run_id,
            status="interrupted",
            error_code="ai_not_configured",
            error_message="请先在数据管理中配置完整的 AI 接口。",
        )

    started_at = run.get("startedAt") or utc_timestamp()
    update_analysis_run(
        run_id,
        status="running",
        started_at=started_at,
        error_code="",
        error_message="",
    )
    run = get_analysis_run(run_id)
    plan = build_stage_plan(str(run["mode"]), list(run["analysts"]))
    source_results = collect_analysis_sources(
        ticker=str(run["ticker"]),
        asset_type=str(run["assetType"]),
        effective_date=str(run["effectiveDate"]),
        requested_date=str(run["requestedDate"]),
        analysts=list(run["analysts"]),
    )
    evidence = {
        analyst: real_data
        for analyst, source_result in source_results.items()
        if (real_data := evidence_for_ai(source_result)) is not None
    }
    existing_steps = {step["stepKey"]: step for step in run["steps"]}
    previous_outputs: dict[str, dict[str, Any]] = {
        key: step["output"]
        for key, step in existing_steps.items()
        if step["status"] == "completed" and isinstance(step.get("output"), dict)
    }
    has_existing_analyst_report = any(
        key.startswith("analyst:") for key in previous_outputs
    )

    for step in plan:
        current = get_analysis_run(run_id)
        if current["status"] == "cancel_requested":
            return _finish_canceled(run_id)

        step_key = str(step["stepKey"])
        step_model = model_for_role(
            role=str(step["role"]),
            simple_model=simple_model,
            complex_model=complex_model,
        )
        existing = existing_steps.get(step_key)
        if existing and existing["status"] in TERMINAL_STEP_STATUSES:
            _update_progress(run_id, plan)
            continue

        if step_key.startswith("analyst:"):
            analyst = step_key.split(":", 1)[1]
            source_result = source_results.get(
                analyst,
                {
                    "analyst": analyst,
                    "status": "unavailable",
                    "reason": "数据源未返回结果。",
                    "sources": [],
                },
            )
            if analyst not in evidence:
                source_status = str(source_result.get("status") or "unavailable")
                upsert_analysis_step(
                    run_id,
                    step_key=step_key,
                    sequence=int(step["sequence"]),
                    role=str(step["role"]),
                    status=source_status
                    if source_status in {"disabled", "sample", "unavailable"}
                    else "unavailable",
                    output={
                        "availability": source_status,
                        "reason": source_result.get("reason")
                        or source_result.get("error", ""),
                        "samplePreview": source_result.get("samplePreview"),
                    },
                    data_sources=list(source_result.get("sources") or []),
                    completed_at=utc_timestamp(),
                )
                _update_progress(run_id, plan)
                continue
            context = {
                "instrument": _instrument_context(run),
                "publicEvidence": evidence[analyst],
            }
            data_sources = list(source_result.get("sources") or [])
        else:
            if not evidence and not has_existing_analyst_report:
                return update_analysis_run(
                    run_id,
                    status="failed",
                    current_stage="data-quality",
                    error_code="insufficient_data",
                    error_message="所选分析师均未取得真实公开数据，已停止 AI 决策链。",
                )
            context = {
                "instrument": _instrument_context(run),
                "publicEvidence": evidence,
                "completedResearch": previous_outputs,
            }
            data_sources = []

        step_started = utc_timestamp()
        started_clock = time.monotonic()
        update_analysis_run(
            run_id,
            current_stage=step_key,
        )
        upsert_analysis_step(
            run_id,
            step_key=step_key,
            sequence=int(step["sequence"]),
            role=str(step["role"]),
            status="running",
            model=step_model,
            input_summary=_input_summary(run, step, context),
            data_sources=data_sources,
            started_at=step_started,
        )
        try:
            output = call_structured_ai(
                provider=settings.get("provider", "custom"),
                protocol=settings.get("protocol", "auto"),                role=str(step["role"]),
                context=context,
                base_url=base_url,
                model=step_model,
                api_key=api_key,
            )
        except (OpenAICompatibleRequestError, ValueError, json.JSONDecodeError) as exc:
            duration_ms = round((time.monotonic() - started_clock) * 1000)
            upsert_analysis_step(
                run_id,
                step_key=step_key,
                sequence=int(step["sequence"]),
                role=str(step["role"]),
                status="failed",
                model=step_model,
                input_summary=_input_summary(run, step, context),
                data_sources=data_sources,
                error_message=str(exc),
                started_at=step_started,
                completed_at=utc_timestamp(),
                duration_ms=duration_ms,
            )
            return update_analysis_run(
                run_id,
                status="interrupted",
                current_stage=step_key,
                error_code="external_call_failed",
                error_message=f"{ROLE_LABELS.get(str(step['role']), step['role'])}调用失败：{exc}",
            )

        output = _normalize_stage_output(str(step["role"]), output)
        previous_outputs[step_key] = output
        upsert_analysis_step(
            run_id,
            step_key=step_key,
            sequence=int(step["sequence"]),
            role=str(step["role"]),
            status="completed",
            model=step_model,
            input_summary=_input_summary(run, step, context),
            output=output,
            data_sources=data_sources,
            started_at=step_started,
            completed_at=utc_timestamp(),
            duration_ms=round((time.monotonic() - started_clock) * 1000),
        )
        _update_progress(run_id, plan)

    final = previous_outputs.get("portfolio-manager")
    if not final:
        return update_analysis_run(
            run_id,
            status="interrupted",
            error_code="missing_final_result",
            error_message="最终研究结论未生成。",
        )
    if not _has_real_price(evidence):
        final["targetPrice"] = None
    final_result = {
        **final,
        "ticker": run["ticker"],
        "assetType": run["assetType"],
        "effectiveDate": run["effectiveDate"],
        "dataQuality": _data_quality(source_results),
    }
    result = update_analysis_run(
        run_id,
        status="completed",
        current_stage="completed",
        progress=100,
        completed_at=utc_timestamp(),
        final_result=final_result,
        error_code="",
        error_message="",
    )
    export_analysis_run(run_id)
    return result


def model_for_role(*, role: str, simple_model: str, complex_model: str) -> str:
    return complex_model if role in COMPLEX_ROLES else simple_model


def call_structured_ai(
    *, role: str, context: dict[str, Any], base_url: str, model: str, api_key: str,
    provider: str = "custom", protocol: str = "auto",
) -> dict[str, Any]:
    messages = _stage_messages(role, context)
    completion = call_openai_compatible_completion(
        provider=provider,
        protocol=protocol,
        base_url=base_url,
        model=model,
        api_key=api_key,
        messages=messages,
        timeout=120,
        max_output_tokens=QUANT_AI_MAX_OUTPUT_TOKENS,
    )
    try:
        parsed = parse_structured_response(completion["content"])
        _validate_stage_output(role, parsed)
        return parsed
    except (json.JSONDecodeError, ValueError) as first_error:
        repaired = call_openai_compatible_completion(
            provider=provider,
            protocol=protocol,
            base_url=base_url,
            model=model,
            api_key=api_key,
            messages=[
                *messages,
                {"role": "assistant", "content": completion["content"]},
                {
                    "role": "user",
                    "content": (
                        "上一个回答不是有效 JSON 对象。只修复格式并返回 JSON，不要新增证据。"
                    ),
                },
            ],
            timeout=120,
            max_output_tokens=QUANT_AI_MAX_OUTPUT_TOKENS,
        )
        try:
            parsed = parse_structured_response(repaired["content"])
            _validate_stage_output(role, parsed)
            return parsed
        except (json.JSONDecodeError, ValueError) as repair_error:
            raise ValueError(f"结构化 JSON 修复失败：{repair_error}") from first_error


def _stage_messages(role: str, context: dict[str, Any]) -> list[dict[str, str]]:
    role_label = ROLE_LABELS.get(role, role)
    schema = _role_schema(role)
    return [
        {
            "role": "system",
            "content": (
                f"你是{role_label}。仅使用提供的公开证据，不得补充任何个人财务或交易信息。"
                "输出必须是一个 JSON 对象，使用中文，事实与推断要分开，信息不足时明确说明。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {"task": _role_task(role), "requiredSchema": schema, **context},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        },
    ]


def _role_task(role: str) -> str:
    if role == "analyst_fundamentals":
        return (
            "区分当前估值快照、最新季度报告和预测修订，优先使用 freshnessStatus 为 fresh 的证据；"
            "对 aging 数据明确降权，不得把已排除或过期财务数据当作当前事实。"
        )
    if role == "analyst_news":
        return (
            "提取最近 7 天的公司事件和风险，按 importanceScore 优先引用直接相关且更新的新闻；"
            "不得把泛市场关联标题与标的直接新闻等权，也不得补充未提供的正文事实。"
        )
    if role.startswith("analyst_"):
        return "提取主要事实、信号、限制和数据质量，形成可供后续辩论引用的研究报告。"
    if role == "bull":
        return "基于已有研究提出多头论据；仅在已有空头论点时回应，否则只做开场陈述，不得虚构对手观点。"
    if role == "bear":
        return "基于已有研究提出空头论据；仅在已有多头论点时回应，否则只做开场陈述，不得虚构对手观点。"
    if role == "research_manager":
        return "综合多空论据，给出五档研究评级和理由；证据矛盾或不足时选择持有，不得强行给出方向。"
    if role == "trader":
        return "给出研究用途的方向、观察条件、风险条件和时间周期；缺少真实价格时不得给出精确价位。"
    if role.startswith("risk_"):
        return "从指定风险偏好复核交易方案，指出可接受条件、否决条件和调整建议。"
    return "综合全部公开证据与风险复核，输出最终五档评级、置信度、核心证据、主要风险和时间周期；证据矛盾或不足时选择持有，不得强行给出方向。"


def _role_schema(role: str) -> dict[str, str]:
    if role == "portfolio_manager":
        return {
            "rating": "买入|增持|持有|减持|卖出",
            "confidence": "0-100",
            "summary": "string",
            "evidence": "string[]",
            "risks": "string[]",
            "targetPrice": "number|null",
            "timeHorizon": "string",
        }
    if role in {"research_manager", "trader"}:
        return {
            "rating": "买入|增持|持有|减持|卖出",
            "summary": "string",
            "evidence": "string[]",
            "risks": "string[]",
            "timeHorizon": "string",
        }
    return {
        "summary": "string",
        "evidence": "string[]",
        "risks": "string[]",
        "dataLimitations": "string[]",
    }


def _normalize_stage_output(role: str, output: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(output)
    if role in {"research_manager", "trader", "portfolio_manager"}:
        if normalized.get("rating") not in FINAL_RATINGS:
            normalized["rating"] = "持有"
    if role == "portfolio_manager":
        try:
            normalized["confidence"] = max(
                0, min(100, round(float(normalized.get("confidence", 0))))
            )
        except (TypeError, ValueError):
            normalized["confidence"] = 0
        for key in ("evidence", "risks"):
            if not isinstance(normalized.get(key), list):
                normalized[key] = []
        normalized.setdefault("targetPrice", None)
        normalized.setdefault("timeHorizon", "未确定")
        normalized.setdefault("summary", "信息不足，维持中性观察。")
    return normalized


def _validate_stage_output(role: str, output: dict[str, Any]) -> None:
    if not isinstance(output.get("summary"), str) or not output["summary"].strip():
        raise ValueError("结构化结果缺少 summary。")
    if role in {"research_manager", "trader", "portfolio_manager"} and output.get(
        "rating"
    ) not in FINAL_RATINGS:
        raise ValueError("结构化结果缺少有效的五档评级。")


def _instrument_context(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticker": run["ticker"],
        "assetType": run["assetType"],
        "effectiveDate": run["effectiveDate"],
        "mode": run["mode"],
    }


def _input_summary(
    run: dict[str, Any], step: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    public_evidence = context.get("publicEvidence")
    evidence_keys = (
        sorted(public_evidence.keys()) if isinstance(public_evidence, dict) else []
    )
    return {
        "ticker": run["ticker"],
        "effectiveDate": run["effectiveDate"],
        "role": step["role"],
        "round": step.get("round"),
        "evidenceKeys": evidence_keys,
    }


def _data_quality(source_results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    statuses = {
        analyst: str(result.get("status") or "unavailable")
        for analyst, result in source_results.items()
    }
    return {
        "analystStatuses": statuses,
        "availableCount": sum(status == "available" for status in statuses.values()),
        "partial": any(status != "available" for status in statuses.values()),
    }


def _has_real_price(evidence: dict[str, Any]) -> bool:
    technical = evidence.get("technical")
    if not isinstance(technical, dict):
        return False
    recent_bars = technical.get("recentBars")
    if not isinstance(recent_bars, list) or not recent_bars:
        return False
    try:
        return float(recent_bars[-1].get("close")) > 0
    except (AttributeError, TypeError, ValueError):
        return False


def _update_progress(run_id: str, plan: list[dict[str, Any]]) -> None:
    current = get_analysis_run(run_id)
    completed = sum(
        step["status"] in TERMINAL_STEP_STATUSES for step in current["steps"]
    )
    update_analysis_run(
        run_id,
        progress=min(99, round(completed / max(1, len(plan)) * 100)),
    )


def _finish_canceled(run_id: str) -> dict[str, Any]:
    return update_analysis_run(
        run_id,
        status="canceled",
        current_stage="canceled",
        completed_at=utc_timestamp(),
        error_code="canceled_by_user",
        error_message="任务已按用户请求停止。",
    )
