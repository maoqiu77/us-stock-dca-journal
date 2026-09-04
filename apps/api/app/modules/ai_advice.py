from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import HTTPException

from app.core.database import get_state_payload, set_state_payload
from app.modules.ai_settings import (
    OpenAICompatibleRequestError,
    call_openai_compatible_completion,
    load_ai_settings,
)
from app.modules.market import get_chart, get_quotes
from app.modules.research import get_signal_rows
from app.modules.trading_data import (
    account_summary,
    derive_positions,
    get_effective_watchlist,
    load_trading_state,
)


APP_STATE_KEY = "ai_advice_v1"
BEIJING_TZ = ZoneInfo("Asia/Shanghai")
NEW_YORK_TZ = ZoneInfo("America/New_York")
AI_TIMEOUT_SECONDS = 120
AI_CONTEXT_VERSION = "AIContext v3"
AI_CONTEXT_RECENT_TRADE_LIMIT = 20
CHAT_HISTORY_MAX_CHARS = 12_000
CHAT_MESSAGE_MAX_CHARS = 4_000

TRADE_ACTIONS = {"买入": "buy", "卖出": "sell", "buy": "buy", "sell": "sell"}


def load_ai_advice_state() -> dict[str, Any]:
    payload = get_state_payload(APP_STATE_KEY)
    if not payload:
        return {"schemaVersion": 1, "records": {}}
    try:
        return sanitize_ai_advice_state(json.loads(payload))
    except (json.JSONDecodeError, TypeError):
        return {"schemaVersion": 1, "records": {}}


def save_ai_advice_state(state: dict[str, Any]) -> dict[str, Any]:
    sanitized = sanitize_ai_advice_state(state)
    set_state_payload(APP_STATE_KEY, json.dumps(sanitized, ensure_ascii=False))
    return sanitized


def list_ai_advice_dates() -> list[str]:
    state = load_ai_advice_state()
    return sorted(state["records"].keys())


def get_ai_advice_record(target_date: str | None = None) -> dict[str, Any] | None:
    state = load_ai_advice_state()
    if target_date:
        return state["records"].get(target_date)
    dates = sorted(state["records"].keys())
    return state["records"].get(dates[-1]) if dates else None


def get_ai_advice_calendar(target_date: str | None = None) -> dict[str, Any]:
    now_context = beijing_now_context()
    saved_dates = list_ai_advice_dates()
    selected_date = select_ai_advice_date(saved_dates, advice_date_from_context(now_context), target_date)
    return {
        "today": advice_date_from_context(now_context),
        "selectedDate": selected_date,
        "dates": saved_dates,
        "record": get_ai_advice_record(selected_date) if selected_date else None,
    }


def create_local_ai_advice_draft(brief: str = "") -> dict[str, Any]:
    context = beijing_now_context()
    target_date = advice_date_from_context(context)
    state = load_trading_state()
    summary = account_summary(state)
    positions = derive_positions(state)
    signals = get_signal_rows()
    content = build_local_advice_content(brief, summary, positions, signals, context)
    record = {
        "date": target_date,
        "generated_at": context["beijing_time"],
        "content": content,
        "messages": [
            {
                "role": "assistant",
                "content": content,
                "created_at": context["beijing_time"],
            }
        ],
        "beijing_context": context,
        "extra_question": brief.strip(),
        "news": [],
        "source": "local-draft",
    }
    advice_state = load_ai_advice_state()
    advice_state["records"][target_date] = sanitize_ai_advice_record(record)
    save_ai_advice_state(advice_state)
    return get_ai_advice_calendar(target_date)


def create_external_ai_advice(brief: str = "") -> dict[str, Any]:
    state = load_trading_state()
    ensure_external_ai_allowed(state)
    context = beijing_now_context()
    target_date = advice_date_from_context(context)
    summary = account_summary(state)
    positions = derive_positions(state)
    signals = get_signal_rows()
    watchlist = get_effective_watchlist()
    quotes = get_quotes(watchlist)
    intraday_context = build_intraday_market_context(watchlist)
    prompt = build_external_advice_prompt(
        brief=brief,
        summary=summary,
        state=state,
        positions=positions,
        quotes=quotes,
        signals=signals,
        intraday_context=intraday_context,
        context=context,
    )
    content = call_ai_response(
        [
            {
                "role": "system",
                "content": daily_advice_system_prompt(),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ]
    )
    generated_at = context["beijing_time"]
    if not content.lstrip().startswith("生成时间："):
        content = f"生成时间：{generated_at}（北京时间）\n\n{content}"
    record = {
        "date": target_date,
        "generated_at": generated_at,
        "content": content,
        "messages": [
            {
                "role": "assistant",
                "content": content,
                "created_at": generated_at,
            }
        ],
        "beijing_context": context,
        "extra_question": brief.strip(),
        "prompt": prompt,
        "news": [],
        "source": "external-ai",
    }
    advice_state = load_ai_advice_state()
    advice_state["records"][target_date] = sanitize_ai_advice_record(record)
    save_ai_advice_state(advice_state)
    return get_ai_advice_calendar(target_date)


def create_ai_chat_reply(prompt: str) -> dict[str, Any]:
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="请输入要追问 AI 的问题。")

    state = load_trading_state()
    ensure_external_ai_allowed(state)
    context = beijing_now_context()
    target_date = advice_date_from_context(context)
    current_record = get_ai_advice_record(target_date)
    if not current_record or not current_record.get("messages"):
        raise HTTPException(status_code=409, detail="请先生成今日 AI 分析，再继续追问。")

    summary = account_summary(state)
    positions = derive_positions(state)
    signals = get_signal_rows()
    watchlist = get_effective_watchlist()
    quotes = get_quotes(watchlist)
    intraday_context = build_intraday_market_context(watchlist)
    user_message = {
        "role": "user",
        "content": clean_prompt,
        "created_at": context["beijing_time"],
    }
    chat_history = normalize_conversation_messages(
        [*current_record.get("messages", []), user_message]
    )
    provider_history = budget_conversation_messages(chat_history)
    reply = call_ai_response(
        [
            {
                "role": "system",
                "content": chat_system_prompt(),
            },
            {
                "role": "user",
                "content": build_chat_context_prompt(
                    summary=summary,
                    state=state,
                    positions=positions,
                    quotes=quotes,
                    signals=signals,
                    intraday_context=intraday_context,
                    context=context,
                ),
            },
            *provider_history,
        ]
    )
    assistant_message = {
        "role": "assistant",
        "content": reply,
        "created_at": context["beijing_time"],
    }
    updated_record = {
        **current_record,
        "messages": [*current_record.get("messages", []), user_message, assistant_message],
        "source": "external-ai",
    }
    advice_state = load_ai_advice_state()
    advice_state["records"][target_date] = sanitize_ai_advice_record(updated_record)
    save_ai_advice_state(advice_state)
    return get_ai_advice_calendar(target_date)


def clear_today_ai_advice_chat() -> dict[str, Any]:
    target_date = advice_date_from_context(beijing_now_context())
    advice_state = load_ai_advice_state()
    current_record = advice_state["records"].get(target_date)
    if current_record:
        current_record["messages"] = current_record.get("messages", [])[:1]
        advice_state["records"][target_date] = sanitize_ai_advice_record(current_record)
        save_ai_advice_state(advice_state)
    return get_ai_advice_calendar(target_date)


def build_local_advice_content(
    brief: str,
    summary: dict[str, float],
    positions: list[dict[str, Any]],
    signals: list[dict[str, Any]],
    context: dict[str, Any],
) -> str:
    held_positions = [position for position in positions if number(position.get("shares")) > 0]
    signal_by_ticker = {
        context_ticker(signal): signal
        for signal in signals
        if context_ticker(signal)
    }
    lines = [
        f"生成时间：{context['beijing_time']}（北京时间）",
        "",
        "## 本地 AI 日历草案",
        "",
        brief.strip() or "研究目标：根据本地账户、持仓和市场数据生成今日复盘草案。",
        "",
        "## 账户摘要",
        "",
        f"- 总资产：${summary['totalAssets']:,.2f}",
        f"- 持仓成本：${summary['holdingCost']:,.2f}",
        f"- 推算现金：${summary['cash']:,.2f}",
        f"- 当前持仓数量：{len(held_positions)}",
        "",
        "## 今日技术观察",
        "",
    ]
    if held_positions:
        for position in held_positions:
            ticker = context_ticker(position)
            signal = signal_by_ticker.get(ticker, {})
            status, reason = local_holding_observation(signal)
            lines.append(f"- {ticker}：{status}，{reason}")
    else:
        lines.append("- 当前没有实际持仓。")
    lines.extend(
        [
            "",
            "## 执行提醒",
            "",
            f"- 当前交易时段判断：{context['estimated_session_status']}",
            "- 本页不读取隐藏策略，也不生成具体买卖金额或股数。",
            "- 本地草案不调用外部模型；接入 OpenAI-compatible 服务后可复用同一条日历记录结构。",
        ]
    )
    return "\n".join(lines)


def local_holding_observation(signal: dict[str, Any]) -> tuple[str, str]:
    status = str(signal.get("status") or "数据不足").strip()
    reason = first_advice_reason(
        signal.get("reasons") or signal.get("risk_notes")
    )
    return status, reason or "当前数据不足以判断技术状态。"


def first_advice_reason(value: Any) -> str:
    if isinstance(value, list):
        value = next((item for item in value if str(item).strip()), "")
    reason = str(value or "").strip()
    if not reason:
        return ""
    return reason if reason.endswith(("。", "！", "？")) else f"{reason}。"


def ensure_external_ai_allowed(state: dict[str, Any]) -> None:
    ai_settings = load_ai_settings()
    complex_model = ai_settings.get("complexModel") or ai_settings.get("model")
    if not ai_settings.get("apiKey") or not ai_settings.get("baseUrl") or not complex_model:
        raise HTTPException(status_code=400, detail="请先在数据管理配置 AI Base URL、模型和 API Key。")


def call_ai_response(messages: list[dict[str, str]]) -> str:
    ai_settings = load_ai_settings()
    api_key = str(ai_settings.get("apiKey", "")).strip()
    base_url = str(ai_settings.get("baseUrl", "")).strip().rstrip("/")
    model = str(ai_settings.get("complexModel") or ai_settings.get("model") or "").strip()
    if not api_key or not base_url or not model:
        raise HTTPException(status_code=400, detail="AI 设置不完整。")
    try:
        completion = call_openai_compatible_completion(
            base_url=base_url,
            model=model,
            api_key=api_key,
            messages=messages,
            timeout=AI_TIMEOUT_SECONDS,
        )
        return completion["content"]
    except OpenAICompatibleRequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI 接口请求失败：{exc}",
        ) from exc


def build_ai_context_v3(
    *,
    summary: dict[str, float],
    state: dict[str, Any],
    positions: list[dict[str, Any]],
    quotes: list[dict[str, Any]],
    signals: list[dict[str, Any]],
    intraday_context: list[dict[str, Any]],
    context: dict[str, Any],
) -> dict[str, Any]:
    return {
        "meta": {
            "version": AI_CONTEXT_VERSION,
            "prompt_language": "en",
            "response_language": "zh-CN",
            "beijing_time": context.get("beijing_time"),
            "new_york_time": context.get("new_york_time"),
            "is_regular_session": bool(context.get("is_regular_session")),
            "session_status": "regular_session" if context.get("is_regular_session") else "outside_regular_session",
            "manual_confirmation_required": True,
        },
        "account": {
            "total_assets": number(summary.get("totalAssets")),
            "holding_historical_cost": number(summary.get("holdingCost")),
            "estimated_cash": number(summary.get("cash")),
            "cash_basis": "estimated_from_historical_cost",
            "is_broker_realtime_cash": False,
            "cash_warning": (
                "Estimated cash equals total assets minus historical holding cost; "
                "it is not broker-reported buying power."
            ),
        },
        "positions": build_context_positions(positions),
        "trade_context": build_trade_context(state.get("trades", [])),
        "market_observations": build_market_observations(quotes, signals, intraday_context),
    }


def build_context_positions(positions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in positions:
        if not isinstance(row, dict):
            continue
        ticker = context_ticker(row)
        if not ticker:
            continue
        result.append(
            {
                "ticker": ticker,
                "asset_type": "etf" if str(row.get("assetType", "")).upper() == "ETF" else "stock",
                "shares": number(row.get("shares")),
                "position_state": "held" if number(row.get("shares")) > 0 else "watching",
                "cost_basis": number(row.get("costBasis")),
                "holding_historical_cost": number(row.get("holdingCost")),
                "purchase_date": str(row.get("purchaseDate", "")),
            }
        )
    return result


def build_trade_context(value: Any) -> dict[str, Any]:
    trades = [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []
    ordered = sorted(trades, key=lambda row: str(row.get("date", "")))
    by_ticker: dict[str, dict[str, Any]] = {}
    normalized: list[dict[str, Any]] = []
    for row in ordered:
        ticker = context_ticker(row)
        action = TRADE_ACTIONS.get(str(row.get("action", "")).strip(), "unknown")
        amount = number(row.get("amount"))
        shares = number(row.get("shares"))
        item = {
            "date": str(row.get("date", "")),
            "ticker": ticker,
            "action": action,
            "amount": amount,
            "unit_price": number(row.get("unitPrice")),
            "shares": shares,
        }
        note = str(row.get("note") or row.get("notes") or "").strip()
        if note:
            item["note"] = note
        normalized.append(item)
        if ticker:
            aggregate = by_ticker.setdefault(
                ticker,
                {"ticker": ticker, "buy_amount": 0.0, "sell_amount": 0.0, "buy_shares": 0.0, "sell_shares": 0.0},
            )
            if action in {"buy", "sell"}:
                aggregate[f"{action}_amount"] += amount
                aggregate[f"{action}_shares"] += shares
    summary = [
        {key: round(value, 6) if isinstance(value, float) else value for key, value in row.items()}
        for row in sorted(by_ticker.values(), key=lambda row: row["ticker"])
    ]
    return {
        "total_count": len(trades),
        "summary_by_ticker": summary,
        "recent_limit": AI_CONTEXT_RECENT_TRADE_LIMIT,
        "recent": normalized[-AI_CONTEXT_RECENT_TRADE_LIMIT:],
    }


def build_market_observations(
    quotes: list[dict[str, Any]],
    signals: list[dict[str, Any]],
    intraday_context: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    quote_map = context_row_map(quotes)
    signal_map = context_row_map(signals)
    intraday_map = context_row_map(intraday_context)
    tickers = sorted(set(quote_map) | set(signal_map) | set(intraday_map))
    decisions = []
    for ticker in tickers:
        quote = quote_map.get(ticker, {})
        signal = signal_map.get(ticker, {})
        intraday = intraday_map.get(ticker, {})
        sources = {str(row.get("source", "")).lower() for row in (quote, signal, intraday) if row}
        is_sample = "sample" in sources
        decisions.append(
            {
                "ticker": ticker,
                "data_quality": {
                    "sources": sorted(source for source in sources if source),
                    "is_sample": is_sample,
                    "precise_trigger_prices_allowed": not is_sample and bool(sources),
                },
                "quote": compact_fields(quote, ("price", "change", "changePct", "updatedAt", "source")),
                "intraday": compact_fields(
                    intraday,
                    (
                        "latest",
                        "high",
                        "low",
                        "change_pct",
                        "range_position",
                        "recent_30m_change_pct",
                        "support_levels",
                        "resistance_levels",
                        "last_bar_time",
                        "source",
                    ),
                ),
                "technical_observation": {
                    **compact_fields(
                        signal,
                        (
                            "current_price",
                            "trend_status",
                            "action",
                            "status",
                            "ma20",
                            "ma60",
                            "ma120",
                            "ma200",
                            "rsi",
                            "drawdown",
                            "drawdown252",
                            "source",
                        ),
                    ),
                    **source_text_fields(signal),
                },
            }
        )
    return decisions


def context_row_map(rows: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(rows, list):
        return {}
    return {
        ticker: row
        for row in rows
        if isinstance(row, dict) and (ticker := context_ticker(row))
    }


def context_ticker(row: dict[str, Any]) -> str:
    return str(row.get("ticker") or row.get("symbol") or "").upper().strip()


def compact_fields(row: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: row[key] for key in keys if key in row and row[key] not in (None, "", [])}


def source_text_fields(row: dict[str, Any]) -> dict[str, Any]:
    result = {}
    for key in ("reasons", "blocked_reasons", "risk_notes"):
        if row.get(key) not in (None, "", []):
            result[f"{key}_source_text"] = row[key]
    return result


def build_external_advice_prompt(
    *,
    brief: str,
    summary: dict[str, float],
    state: dict[str, Any],
    positions: list[dict[str, Any]],
    quotes: list[dict[str, Any]],
    signals: list[dict[str, Any]],
    intraday_context: list[dict[str, Any]],
    context: dict[str, Any],
) -> str:
    ai_context = build_ai_context_v3(
        summary=summary,
        state=state,
        positions=positions,
        quotes=quotes,
        signals=signals,
        intraday_context=intraday_context,
        context=context,
    )
    extra_question = brief.strip() or "none"
    overview_tickers = [
        f"- {context_ticker(position)}: "
        f"{'held' if number(position.get('shares')) > 0 else 'watching'}"
        for position in positions
        if context_ticker(position)
    ]
    overview_ticker_text = "\n".join(overview_tickers) or "none"
    return f"""Create today's concise US-equity overview analysis from the context below.
Respond in Simplified Chinese. Preserve ticker symbols and indicator abbreviations.

Requirements:
1. Start with a Simplified Chinese generation-time line containing `YYYY-MM-DD HH:MM` and the Beijing-time label.
2. Keep the entire answer under 500 Chinese characters. Use short paragraphs or bullets only. Do not use a table.
3. After the generation-time line, cover every ticker in CURRENT_OVERVIEW_TICKERS exactly once and in the listed order. Never omit a ticker.
4. Write exactly one compact bullet sentence per ticker in this format: `- TICKER：技术状态，one short factual reason；结论：ACTION。` Use the current price, MA, RSI, drawdown, return, or intraday data as evidence.
5. Choose one clear non-binding conclusion from current market facts and position state, using independent model judgment rather than a hidden strategy. For `held`, ACTION must be one of `持有不动`, `加仓`, `减仓`, or `减仓一半`. For `watching`, ACTION must be either `保持观望` or `可以建仓`.
6. Do not show internal field names, JSON paths, source-text labels, or implementation details.
7. Do not output English enum values. Translate all user-facing labels into natural Chinese.
8. Do not repeat the full account, position list, or evidence chain. Mention estimated-cash uncertainty once only when relevant.
9. There is no active portfolio strategy, target allocation, ETF funding pool, or drawdown tranche plan in this context. Never invent or infer one from trade history.
10. Do not provide a specific buy/sell amount, percentage, or share count, except for the allowed proportional phrase `减仓一半`, unless the latest extra question explicitly supplies a budget or position size and asks for a calculation.
11. Treat earlier reports as timestamped snapshots. When current data differs, explain that the market data changed rather than declaring an earlier snapshot incorrect.
12. When precise prices are not allowed, omit prices instead of explaining the internal flag. Follow the session state exactly and never imply that you placed a trade.

Extra user question (verbatim):
{extra_question}

CURRENT_OVERVIEW_TICKERS (authoritative overview order and position state):
{overview_ticker_text}

{AI_CONTEXT_VERSION}:
{json.dumps(ai_context, ensure_ascii=False, separators=(",", ":"))}
"""


def build_chat_context_prompt(
    *,
    summary: dict[str, float],
    state: dict[str, Any],
    positions: list[dict[str, Any]],
    quotes: list[dict[str, Any]],
    signals: list[dict[str, Any]],
    intraday_context: list[dict[str, Any]],
    context: dict[str, Any],
) -> str:
    ai_context = build_ai_context_v3(
        summary=summary,
        state=state,
        positions=positions,
        quotes=quotes,
        signals=signals,
        intraday_context=intraday_context,
        context=context,
    )
    return f"""Use the current {AI_CONTEXT_VERSION} below to answer only the user's latest question.
Respond in Simplified Chinese and keep the answer under 300 Chinese characters. Answer directly and do not repeat the full daily report.
Treat estimated cash as non-broker-reported. Use holdings, trades, and current market observations as evidence.
Do not expose internal English keys, JSON paths, enum values, or source-text labels. Translate all user-facing labels into natural Chinese.
When precise prices are not allowed, omit them instead of explaining the internal flag.
There is no active portfolio strategy, target allocation, ETF funding pool, or drawdown tranche plan. Never invent or infer one.
You may give a clear non-binding conclusion based on current facts and position state, but do not use or invent a hidden strategy.
Do not provide a specific buy/sell amount, percentage, or share count, except for the proportional phrase `减仓一半`, unless the latest user question explicitly supplies a budget or position size and asks for a calculation.
Treat the daily report and earlier replies as timestamped snapshots. If current data differs, explain the time/data change rather than calling the earlier snapshot wrong.

{AI_CONTEXT_VERSION}:
{json.dumps(ai_context, ensure_ascii=False, separators=(",", ":"))}
"""


def daily_advice_system_prompt() -> str:
    return (
        "You are a cautious, manual-only US equity analysis assistant. "
        "Give clear non-binding conclusions from the supplied facts, but never claim to place or execute trades, invent portfolio strategies or budgets, promise returns, or recommend margin, loans, options, shorting, or leverage. "
        "Current holdings and reliable market facts outrank AI judgment. "
        "Sample data is not real market evidence and cannot support prices, MA, RSI, levels, or signals. "
        "Respond in Simplified Chinese with clear, concise, manually verifiable analysis under 500 Chinese characters. "
        "Never expose internal English keys, JSON paths, enum values, or source-text labels to the user."
    )


def chat_system_prompt() -> str:
    return (
        "You are a cautious, manual-only US equity analysis chat assistant. "
        "Answer the latest user question from the supplied AIContext only. You may give a clear non-binding conclusion, but never claim to place or execute trades, "
        "invent portfolio strategies or budgets, promise returns, or recommend margin, loans, options, shorting, or leverage. "
        "Sample data is not real market evidence. Respond in Simplified Chinese, be brief, and do not repeat the full daily report. "
        "Never expose internal English keys, JSON paths, enum values, or source-text labels to the user."
    )


def build_intraday_market_context(watchlist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tickers = [
        str(item.get("ticker", "")).upper().strip()
        for item in watchlist
        if str(item.get("ticker", "")).strip()
    ]
    if not tickers:
        return []

    max_workers = min(len(tickers), 6)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        rows = list(executor.map(build_intraday_row, tickers))
    return [row for row in rows if row]


def build_intraday_row(ticker: str) -> dict[str, Any] | None:
    try:
        chart = get_chart(ticker, "1d", "5m")
    except Exception:
        return None
    bars = chart.get("bars", [])
    if not isinstance(bars, list) or not bars:
        return None
    return summarize_intraday_bars(ticker, chart, bars)


def summarize_intraday_bars(
    ticker: str,
    chart: dict[str, Any],
    bars: list[dict[str, Any]],
) -> dict[str, Any]:
    first = bars[0]
    last = bars[-1]
    open_price = number(first.get("open"))
    latest_price = number(last.get("close"))
    highs = [number(bar.get("high")) for bar in bars]
    lows = [number(bar.get("low")) for bar in bars]
    closes = [number(bar.get("close")) for bar in bars]
    volumes = [number(bar.get("volume")) for bar in bars]
    high = max(highs) if highs else 0.0
    low = min(lows) if lows else 0.0
    change = latest_price - open_price
    change_pct = change / open_price if open_price else 0.0
    range_position = (latest_price - low) / (high - low) if high > low else 0.0
    recent_closes = closes[-6:]
    recent_change = recent_closes[-1] - recent_closes[0] if len(recent_closes) >= 2 else 0.0
    recent_change_pct = recent_change / recent_closes[0] if len(recent_closes) >= 2 and recent_closes[0] else 0.0
    support_levels = intraday_support_levels(lows)
    resistance_levels = intraday_resistance_levels(highs, latest_price)
    key_observation_price = support_levels[0] if support_levels else round(low, 4)
    return {
        "ticker": ticker,
        "range": chart.get("range"),
        "interval": chart.get("interval"),
        "source": chart.get("source"),
        "bar_count": len(bars),
        "open": round(open_price, 4),
        "latest": round(latest_price, 4),
        "high": round(high, 4),
        "low": round(low, 4),
        "change_pct": round(change_pct, 4),
        "range_position": round(range_position, 4),
        "recent_30m_change_pct": round(recent_change_pct, 4),
        "support_levels": support_levels,
        "resistance_levels": resistance_levels,
        "key_observation_price": key_observation_price,
        "bullish_scenario": build_bullish_intraday_scenario(
            resistance_levels,
            key_observation_price,
        ),
        "bearish_scenario": build_bearish_intraday_scenario(support_levels),
        "entry_timing": classify_intraday_entry_timing(range_position, recent_change_pct),
        "volume": int(sum(volumes)),
        "last_bar_time": str(last.get("time", "")),
    }


def intraday_support_levels(lows: list[float]) -> list[float]:
    recent_levels = unique_rounded(reversed(lows[-6:]))
    day_low = round(min(lows), 4) if lows else 0.0
    levels = recent_levels[:2]
    if day_low and day_low not in levels:
        levels.append(day_low)
    return levels[:3]


def intraday_resistance_levels(highs: list[float], latest_price: float) -> list[float]:
    day_high = round(max(highs), 4) if highs else 0.0
    levels = [day_high] if day_high else []
    latest = round(latest_price, 4)
    if latest and latest not in levels:
        levels.append(latest)
    for level in unique_rounded(reversed(highs[-6:])):
        if level not in levels:
            levels.append(level)
        if len(levels) >= 3:
            break
    return levels[:3]


def unique_rounded(values: Any) -> list[float]:
    result: list[float] = []
    for value in values:
        rounded = round(number(value), 4)
        if rounded and rounded not in result:
            result.append(rounded)
    return result


def build_bullish_intraday_scenario(
    resistance_levels: list[float],
    key_observation_price: float,
) -> str:
    if resistance_levels:
        return f"若价格站稳 {key_observation_price:g} 且放量突破 {resistance_levels[0]:g}，可考虑更积极分批。"
    return f"若价格站稳 {key_observation_price:g} 且不再创新低，可考虑小额分批。"


def build_bearish_intraday_scenario(support_levels: list[float]) -> str:
    if support_levels:
        return f"若跌破 {support_levels[0]:g} 且无法收回，应等待或减小单笔。"
    return "若继续走弱并刷新日内低点，应等待或减小单笔。"


def classify_intraday_entry_timing(range_position: float, recent_change_pct: float) -> str:
    if range_position >= 0.72:
        return "等待回踩"
    if range_position <= 0.25 and recent_change_pct < 0:
        return "暂不动"
    if range_position <= 0.45:
        return "小额分批"
    return "分批观察"


def normalize_conversation_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    normalized = []
    for message in messages:
        role = str(message.get("role", "")).strip()
        content = str(message.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            normalized.append({"role": role, "content": content})
    return normalized


def budget_conversation_messages(
    messages: list[dict[str, Any]],
    max_chars: int = CHAT_HISTORY_MAX_CHARS,
    max_message_chars: int = CHAT_MESSAGE_MAX_CHARS,
) -> list[dict[str, str]]:
    normalized = normalize_conversation_messages(messages)
    if not normalized or max_chars <= 0 or max_message_chars <= 0:
        return []

    bounded = [
        {"role": item["role"], "content": truncate_message(item["content"], max_message_chars)}
        for item in normalized
    ]
    latest = bounded[-1]
    if len(latest["content"]) > max_chars:
        return [
            {
                "role": latest["role"],
                "content": truncate_message(latest["content"], max_chars),
            }
        ]

    selected_reversed = [latest]
    used = len(latest["content"])
    first = bounded[0] if len(bounded) > 1 else None
    first_cost = len(first["content"]) if first else 0
    reserve_first = bool(first and used + first_cost <= max_chars)

    for item in reversed(bounded[1:-1]):
        cost = len(item["content"])
        reserved = first_cost if reserve_first else 0
        if used + cost + reserved <= max_chars:
            selected_reversed.append(item)
            used += cost

    selected = list(reversed(selected_reversed))
    if reserve_first and first:
        selected.insert(0, first)
    return selected


def truncate_message(content: str, limit: int) -> str:
    marker = "\n[truncated]"
    if len(content) <= limit:
        return content
    if limit <= len(marker):
        return marker[:limit]
    return f"{content[: limit - len(marker)]}{marker}"


def beijing_now_context(now: pd.Timestamp | None = None) -> dict[str, Any]:
    beijing_now = now if now is not None else pd.Timestamp.now(tz=BEIJING_TZ)
    if beijing_now.tzinfo is None:
        beijing_now = beijing_now.tz_localize(BEIJING_TZ)
    else:
        beijing_now = beijing_now.tz_convert(BEIJING_TZ)
    new_york_now = beijing_now.tz_convert(NEW_YORK_TZ)
    new_york_minutes = new_york_now.hour * 60 + new_york_now.minute
    is_regular_session = new_york_now.weekday() < 5 and 9 * 60 + 30 <= new_york_minutes < 16 * 60
    if is_regular_session:
        status = "美股常规交易时段内（按纽约当地时间 09:30-16:00 判断）"
        suggestion = "可以结合券商实时价格再次确认后再手动操作。"
    else:
        status = "美股常规交易时段外（按纽约当地时间 09:30-16:00 判断）"
        suggestion = "适合生成计划；正式交易前请在常规交易时段内刷新确认。"
    advice_date = beijing_now.date()
    # A US session spans midnight in Beijing. Keep the post-midnight portion
    # attached to the prior Beijing trading date until the session closes.
    if beijing_now.hour < 4:
        advice_date -= timedelta(days=1)
    return {
        "beijing_time": beijing_now.strftime("%Y-%m-%d %H:%M"),
        "beijing_date": beijing_now.date().isoformat(),
        "advice_date": advice_date.isoformat(),
        "new_york_time": new_york_now.strftime("%Y-%m-%d %H:%M"),
        "is_regular_session": is_regular_session,
        "usual_manual_trade_time": "纽约当地时间 09:30-16:00",
        "estimated_session_status": status,
        "timing_suggestion": suggestion,
    }


def advice_date_from_context(context: dict[str, Any]) -> str:
    return str(context.get("advice_date") or context["beijing_date"])


def select_ai_advice_date(
    saved_dates: list[str],
    default_date: str,
    selected_raw: str | None,
) -> str | None:
    saved = set(saved_dates)
    if selected_raw in saved:
        return selected_raw
    if default_date in saved:
        return default_date
    return saved_dates[-1] if saved_dates else None


def sanitize_ai_advice_state(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"schemaVersion": 1, "records": {}}
    records = value.get("records", {})
    if not isinstance(records, dict):
        records = {}
    return {
        "schemaVersion": 1,
        "records": {
            key: sanitize_ai_advice_record(record)
            for key, record in records.items()
            if is_iso_date(str(key)) and isinstance(record, dict)
        },
    }


def sanitize_ai_advice_record(record: dict[str, Any]) -> dict[str, Any]:
    record_date = str(record.get("date", "")).strip()
    if not is_iso_date(record_date):
        record_date = beijing_now_context()["beijing_date"]
    generated_at = str(record.get("generated_at", "")).strip()
    content = str(record.get("content", "")).strip()
    messages = []
    for message in record.get("messages", []) or []:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role", "")).strip()
        message_content = str(message.get("content", "")).strip()
        if role in {"user", "assistant"} and message_content:
            messages.append(
                {
                    "role": role,
                    "content": message_content,
                    "created_at": str(message.get("created_at", generated_at)),
                }
            )
    if not messages and content:
        messages.append({"role": "assistant", "content": content, "created_at": generated_at})
    if messages and messages[0]["role"] == "assistant" and messages[0]["created_at"]:
        generated_at = messages[0]["created_at"]
    news = []
    for item in record.get("news", []) or []:
        if isinstance(item, dict):
            news.append(
                {
                    "title": str(item.get("title", "")),
                    "source": str(item.get("source", "")),
                    "published": str(item.get("published", "")),
                    "link": str(item.get("link", "")),
                }
            )
    context = record.get("beijing_context", {})
    return {
        "date": record_date,
        "generated_at": generated_at,
        "content": content,
        "messages": messages,
        "beijing_context": context if isinstance(context, dict) else {},
        "extra_question": str(record.get("extra_question", "")),
        "prompt": str(record.get("prompt", "")),
        "news": news,
        "source": str(record.get("source", "local")),
    }


def is_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def number(value: Any, default: float = 0.0) -> float:
    parsed = pd.to_numeric(value, errors="coerce")
    return default if pd.isna(parsed) else float(parsed)
