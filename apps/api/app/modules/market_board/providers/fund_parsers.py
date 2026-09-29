from __future__ import annotations

import re
import json
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal


def parse_amount(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"([\d,.]+)\s*(?:万元|万)?", value)
    if not match:
        return None
    amount = Decimal(match.group(1).replace(",", ""))
    if "万" in value:
        amount *= 10000
    return format(amount, "f").rstrip("0").rstrip(".") or "0"


def parse_nav_rows(rows: list[dict]) -> dict | None:
    valid = [row for row in rows if row.get("nav") not in (None, "") and row.get("date")]
    if not valid:
        return None
    valid.sort(key=lambda row: str(row["date"]), reverse=True)
    return valid[0]


def extract_js_json(text: str, variable: str):
    match = re.search(rf"var\s+{re.escape(variable)}\s*=\s*(\[.*?\]|\{{.*?\}})\s*;", text, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def parse_nav_trend(text: str, now: datetime) -> dict | None:
    rows = extract_js_json(text, "Data_netWorthTrend")
    if not isinstance(rows, list):
        return None
    cutoff = now.timestamp() * 1000 + 60_000
    parsed = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("x"), (int, float)):
            continue
        if row["x"] > cutoff or not isinstance(row.get("y"), (int, float)):
            continue
        observed = datetime.fromtimestamp(row["x"] / 1000, timezone.utc).date()
        parsed.append({"date": observed.isoformat(), "nav": str(row["y"]), "change_pct": str(row["equityReturn"]) if isinstance(row.get("equityReturn"), (int, float)) else None})
    return parsed[-1] if parsed else None


def parse_asset_allocation(text: str, now: datetime) -> dict | None:
    data = extract_js_json(text, "Data_assetAllocation")
    if not isinstance(data, dict) or not isinstance(data.get("categories"), list):
        return None
    valid = [(index, value) for index, value in enumerate(data["categories"]) if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) and value <= now.date().isoformat()]
    if not valid:
        return None
    index, report_date = valid[-1]
    values = {str(series.get("name")): series.get("data", [])[index] for series in data.get("series", []) if isinstance(series, dict) and isinstance(series.get("data"), list) and len(series["data"]) > index}
    return {"report_date": report_date, "stocks_pct": str(values["股票占净比"]) if isinstance(values.get("股票占净比"), (int, float)) else None, "bonds_pct": str(values["债券占净比"]) if isinstance(values.get("债券占净比"), (int, float)) else None, "cash_pct": str(values["现金占净比"]) if isinstance(values.get("现金占净比"), (int, float)) else None}


def parse_holdings(text: str, now: datetime, instrument_key: str):
    report = None
    stocks = []
    for block in re.finditer(r"<div[^>]+class=[\"']boxitem[\"'][^>]*>(.*?)</div>\s*</div>", text, re.S | re.I):
        date_match = re.search(r"(20\d{2}-\d{2}-\d{2})", block.group(1))
        if not date_match or date_match.group(1) > now.date().isoformat():
            continue
        rows = re.findall(r"<tr[^>]*>\s*(.*?)\s*</tr>", block.group(1), re.S | re.I)
        parsed = []
        for row in rows:
            cells = [re.sub(r"<[^>]+>", "", cell).strip() for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S | re.I)]
            if len(cells) < 4 or not cells[0].isdigit():
                continue
            weight = re.search(r"(\d+(?:\.\d+)?)\s*%", " ".join(cells))
            if weight:
                parsed.append({"rank": int(cells[0]), "symbol": cells[1], "name": cells[2], "weight_pct": weight.group(1)})
        if parsed:
            report, stocks = date_match.group(1), parsed[:10]
            break
    return {"instrument_key": instrument_key, "report_date": report, "allocation": parse_asset_allocation(text, now), "stocks": stocks}


def parse_purchase_state(text: str | None) -> tuple[str, str | None]:
    value = (text or "").strip()
    if "暂停" in value:
        return "suspended", None
    amount = parse_amount(value)
    if amount is not None:
        return "limited", amount
    if "不限" in value or "开放" in value:
        return "unlimited", None
    return "unknown", None
