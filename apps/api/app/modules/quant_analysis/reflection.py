from __future__ import annotations

import json
from datetime import date
from typing import Any

from fastapi import HTTPException

from app.modules.ai_settings import (
    OpenAICompatibleRequestError,
    call_openai_compatible_completion,
    load_ai_settings,
)
from app.modules.market import get_chart
from app.modules.privacy_policy import ensure_ai_inference_allowed
from app.modules.quant_analysis.calendar import add_us_trading_days, reflection_eligible
from app.modules.quant_analysis.engine import parse_structured_response
from app.modules.quant_analysis.store import get_analysis_run, update_analysis_run


QUANT_AI_MAX_OUTPUT_TOKENS = 8192


def generate_reflection(run_id: str, *, today: str | None = None) -> dict[str, Any]:
    ensure_ai_inference_allowed()
    try:
        run = get_analysis_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="量化分析任务不存在。") from exc
    if not run["reflectionEnabled"]:
        raise HTTPException(status_code=409, detail="该任务未启用结果反思。")
    if run["status"] != "completed":
        raise HTTPException(status_code=409, detail="任务完成后才能生成结果反思。")
    if run.get("reflection"):
        return run
    if not reflection_eligible(run["effectiveDate"], today):
        unlock = add_us_trading_days(run["effectiveDate"], 5)
        raise HTTPException(
            status_code=409,
            detail=f"需等到第 5 个后续美股交易日（{unlock}）后再生成反思。",
        )

    settings = load_ai_settings()
    base_url = str(settings.get("baseUrl") or "").strip()
    model = str(
        run.get("complexModel")
        or run.get("model")
        or settings.get("complexModel")
        or settings.get("model")
        or ""
    ).strip()
    api_key = str(settings.get("apiKey") or "").strip()
    if not (base_url and model and api_key):
        raise HTTPException(status_code=400, detail="请先配置完整的 AI 接口。")
    performance = calculate_five_day_performance(
        run["ticker"], run["effectiveDate"]
    )
    update_analysis_run(run_id, reflection_status="generating")
    messages = [
        {
            "role": "system",
            "content": (
                "你负责复盘一份历史公开研究结论。只使用给定结论和后续价格表现，"
                "输出 JSON 对象，不补充个人财务或交易信息。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "originalConclusion": run["finalResult"],
                    "performance": performance,
                    "requiredSchema": {
                        "verdictCorrect": "boolean|null",
                        "validEvidence": "string[]",
                        "invalidEvidence": "string[]",
                        "improvements": "string[]",
                    },
                },
                ensure_ascii=False,
            ),
        },
    ]
    try:
        completion = call_openai_compatible_completion(
            provider=settings.get("provider", "custom"),
            protocol=settings.get("protocol", "auto"),
            base_url=base_url,
            model=model,
            api_key=api_key,
            messages=messages,
            timeout=120,
            max_output_tokens=QUANT_AI_MAX_OUTPUT_TOKENS,
        )
        try:
            review = parse_structured_response(completion["content"])
        except (ValueError, json.JSONDecodeError):
            repaired = call_openai_compatible_completion(
                provider=settings.get("provider", "custom"),
                protocol=settings.get("protocol", "auto"),
                base_url=base_url,
                model=model,
                api_key=api_key,
                messages=[
                    *messages,
                    {"role": "assistant", "content": completion["content"]},
                    {
                        "role": "user",
                        "content": "只修复为有效 JSON 对象，不要新增证据。",
                    },
                ],
                timeout=120,
                max_output_tokens=QUANT_AI_MAX_OUTPUT_TOKENS,
            )
            review = parse_structured_response(repaired["content"])
    except (OpenAICompatibleRequestError, ValueError, json.JSONDecodeError) as exc:
        update_analysis_run(run_id, reflection_status="pending")
        raise HTTPException(status_code=502, detail=f"反思生成失败：{exc}") from exc

    return update_analysis_run(
        run_id,
        reflection_status="completed",
        reflection={
            "performance": performance,
            "review": review,
            "generatedOn": today or date.today().isoformat(),
        },
    )


def calculate_five_day_performance(
    ticker: str, effective_date: str
) -> dict[str, Any]:
    end_date = add_us_trading_days(effective_date, 5)
    ticker_return = _instrument_return(ticker, effective_date, end_date)
    spy_return = _instrument_return("SPY", effective_date, end_date)
    return {
        "startDate": effective_date,
        "endDate": end_date,
        "tickerReturnPct": ticker_return,
        "spyReturnPct": spy_return,
        "excessReturnPct": round(ticker_return - spy_return, 4),
    }


def _instrument_return(ticker: str, start_date: str, end_date: str) -> float:
    chart = get_chart(ticker, "10y", "1d")
    if chart.get("source") == "sample":
        raise HTTPException(status_code=409, detail=f"{ticker} 缺少真实历史行情。")
    bars = chart.get("bars")
    if not isinstance(bars, list):
        raise HTTPException(status_code=409, detail=f"{ticker} 历史行情不可用。")
    start_close = _close_on_date(bars, start_date)
    end_close = _close_on_date(bars, end_date)
    if start_close is None or end_close is None or start_close <= 0:
        raise HTTPException(status_code=409, detail=f"{ticker} 缺少反思区间价格。")
    return round((end_close / start_close - 1) * 100, 4)


def _close_on_date(bars: list[dict[str, Any]], target_date: str) -> float | None:
    for bar in bars:
        bar_date = str(bar.get("time") or "")[:10]
        if bar_date != target_date:
            continue
        try:
            close = float(bar.get("close"))
        except (TypeError, ValueError):
            continue
        if close > 0:
            return close
    return None
