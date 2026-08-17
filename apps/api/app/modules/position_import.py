from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException

from app.modules.ai_settings import (
    OpenAICompatibleRequestError,
    call_openai_compatible_completion,
    load_ai_settings,
)
from app.modules.trading_data import normalize_ticker


AI_TIMEOUT_SECONDS = 120
MAX_IMAGE_DATA_URL_LENGTH = 10 * 1024 * 1024
SUPPORTED_IMAGE_PREFIXES = (
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)

SYSTEM_PROMPT = """你负责从券商截图中提取持仓或当日交易。只读取图片中明确可见的信息，不猜测被遮挡或缺失的值。
只返回一个 JSON 对象，不要 Markdown，格式如下：
{"mode":"portfolio","positions":[{"ticker":"QQQM","name":"Invesco NASDAQ 100 ETF","assetType":"ETF","shares":8,"averageCost":220.5,"marketValue":1900,"currency":"USD","confidence":0.98,"warnings":[]}],"trades":[],"warnings":[]}
要求：
1. ticker 使用大写证券代码；无法可靠确定代码时不要添加该行，并在 warnings 说明。
2. shares 是当前持有数量，averageCost 是券商展示的持仓平均成本/成本价，不是现价。
3. 图片未显示 averageCost 时返回 null，不要用市值或现价冒充。
4. assetType 只能是 ETF 或 STOCK；currency 使用 USD、HKD、CNY 等大写代码，无法判断时为空字符串。
5. confidence 是 0 到 1。忽略现金、购买力、总资产、当日盈亏等非证券持仓行。
6. 不要输出账户号、姓名或其他个人信息。
7. 完整持仓截图使用 mode=portfolio；今日交易截图使用 mode=trades，并在 trades 中返回 action(买入/卖出)、ticker、assetType、quantityType、quantity、amount、executionPrice、lastPrice、bidPrice、askPrice、sourceText、confidence。
8. quantityType 必须是 shares 或 amount：例如 Buy 50 是 shares=50；Buy $35 是 amount=35。订单右侧的 Filled 金额不是成交价，也不是股数；不要把 Filled 数值写入 executionPrice。若订单文字明确有 @ Limit 价格，使用该价格；若是 @ Market，使用该行的 Last（其次 Bid/Ask）作为 executionPrice。若 quantityType=amount，必须用订单金额 / executionPrice 计算实际 shares；若 quantityType=shares，quantity 就是实际股数（允许碎股）。
9. 对每一行同时保留 quantityType、quantity、amount、executionPrice、sourceText；sourceText 原样摘录订单文字（例如 `Buy $35.00 @ Market`、`Sell 2 @ Market`），方便用户确认。若截图文字和金额/价格无法自洽，加入该行 warnings，不要猜测。
"""


def recognize_position_screenshot(image_data_url: str, mode: str = "auto") -> dict[str, object]:
    validate_image_data_url(image_data_url)
    settings = load_ai_settings()
    if not settings.get("baseUrl") or not settings.get("model") or not settings.get("apiKey"):
        raise HTTPException(status_code=400, detail="请先在数据管理中配置并测试 AI 接口。")

    try:
        completion = call_openai_compatible_completion(
            base_url=str(settings["baseUrl"]),
            model=str(settings["model"]),
            api_key=str(settings["apiKey"]),
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"识别这张券商截图，模式为 {mode}。如果是 auto 请自行判断是 portfolio 还是 trades。"},
                        {"type": "image_url", "image_url": {"url": image_data_url}},
                    ],
                },
            ],
            timeout=AI_TIMEOUT_SECONDS,
        )
    except OpenAICompatibleRequestError as exc:
        raise HTTPException(status_code=502, detail=f"AI 图片识别失败：{exc}") from exc

    try:
        parsed = parse_json_object(completion["content"])
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="AI 未返回有效的持仓 JSON，请重试或更换支持图片的模型。") from exc
    positions, row_warnings = sanitize_positions(parsed.get("positions"))
    trades, trade_warnings = sanitize_trades(parsed.get("trades"))
    requested_mode = str(mode).lower()
    returned_mode = str(parsed.get("mode") or "").lower()
    if requested_mode in {"portfolio", "trades"}:
        detected_mode = requested_mode
    elif trades and not positions:
        detected_mode = "trades"
    elif positions and not trades:
        detected_mode = "portfolio"
    elif returned_mode in {"trade", "trades", "交易", "交易记录"}:
        detected_mode = "trades"
    else:
        detected_mode = "portfolio"
    warnings = sanitize_warnings(parsed.get("warnings")) + row_warnings + trade_warnings
    if detected_mode == "portfolio" and not positions:
        raise HTTPException(status_code=422, detail="截图中没有识别到可导入的证券持仓。")
    if detected_mode == "trades" and not trades:
        raise HTTPException(status_code=422, detail="截图中没有识别到可导入的交易记录。")
    return {"mode": detected_mode, "positions": positions, "trades": trades, "warnings": warnings, "endpoint": completion["endpoint"]}


def sanitize_trades(value: Any) -> tuple[list[dict[str, Any]], list[str]]:
    if not isinstance(value, list):
        return [], []
    result, warnings = [], []
    for item in value:
        if not isinstance(item, dict):
            continue
        ticker = normalize_ticker(item.get("ticker", ""))
        quantity_type = str(item.get("quantityType") or "shares").strip().lower()
        quantity = positive_number(item.get("quantity"))
        shares = positive_number(item.get("shares"))
        raw_action = str(item.get("action") or "").strip().lower()
        action = {"buy": "买入", "bought": "买入", "sell": "卖出", "sold": "卖出"}.get(raw_action, str(item.get("action") or "").strip())
        bid_price = positive_number(item.get("bidPrice")) or positive_number(item.get("bid"))
        ask_price = positive_number(item.get("askPrice")) or positive_number(item.get("ask"))
        quoted_price = ((bid_price + ask_price) / 2) if bid_price and ask_price else bid_price or ask_price
        price = positive_number(item.get("executionPrice")) or positive_number(item.get("filledPrice")) or positive_number(item.get("unitPrice")) or positive_number(item.get("lastPrice")) or quoted_price
        amount = positive_number(item.get("amount"))
        if not price and amount and shares:
            price = amount / shares
        if quantity_type == "amount":
            shares = amount / price if amount and price else None
        elif quantity is not None:
            shares = quantity
        if action not in {"买入", "卖出"} or not ticker or shares is None or not price:
            warnings.append(f"已忽略缺少代码、买卖方向、数量或成交价的交易行{f'（{ticker}）' if ticker else ''}。")
            continue
        amount = amount or shares * price
        result.append({"ticker": ticker, "action": action, "shares": round(shares, 6), "unitPrice": round(price, 6), "amount": round(amount, 6), "assetType": "ETF" if str(item.get("assetType", "")).upper() == "ETF" else "STOCK", "confidence": confidence_number(item.get("confidence")), "sourceText": str(item.get("sourceText") or "").strip()[:240], "warnings": sanitize_warnings(item.get("warnings"))})
    return result, warnings


def validate_image_data_url(value: str) -> None:
    if len(value) > MAX_IMAGE_DATA_URL_LENGTH:
        raise HTTPException(status_code=413, detail="图片过大，请选择 7 MB 以内的截图。")
    if not value.startswith(SUPPORTED_IMAGE_PREFIXES):
        raise HTTPException(status_code=400, detail="仅支持 PNG、JPEG 或 WebP 图片。")


def parse_json_object(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1)
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("Expected object")
    return parsed


def sanitize_positions(value: Any) -> tuple[list[dict[str, Any]], list[str]]:
    if not isinstance(value, list):
        return [], []
    positions: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        ticker = normalize_ticker(item.get("ticker", ""))
        shares = positive_number(item.get("shares"))
        if not ticker or shares is None:
            warnings.append("已忽略缺少证券代码或持仓数量的识别行。")
            continue
        if ticker in seen:
            warnings.append(f"已忽略重复持仓 {ticker}。")
            continue
        seen.add(ticker)
        positions.append(
            {
                "ticker": ticker,
                "name": str(item.get("name") or "").strip()[:120],
                "assetType": "ETF" if str(item.get("assetType", "")).upper() == "ETF" else "STOCK",
                "shares": shares,
                "averageCost": positive_number(item.get("averageCost")),
                "marketValue": positive_number(item.get("marketValue")),
                "currency": str(item.get("currency") or "").strip().upper()[:8],
                "confidence": confidence_number(item.get("confidence")),
                "warnings": sanitize_warnings(item.get("warnings")),
            }
        )
    return positions, warnings


def positive_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 6) if 0 < number < 1e15 else None


def confidence_number(value: Any) -> float:
    try:
        return round(max(0.0, min(float(value), 1.0)), 2)
    except (TypeError, ValueError):
        return 0.0


def sanitize_warnings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:240] for item in value if str(item).strip()][:20]
