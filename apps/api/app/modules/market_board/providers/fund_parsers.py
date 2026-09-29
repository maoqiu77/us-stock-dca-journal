from __future__ import annotations

import re
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

