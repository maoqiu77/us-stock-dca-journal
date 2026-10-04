"""Desktop checkpoint adapter. Calibration evidence never enters execution history."""
from copy import deepcopy
from datetime import datetime, date
from decimal import Decimal, localcontext, ROUND_HALF_UP
import re


def evidence(row):
    return [row[k] for k in ("id", "ticker", "date", "action")] + [Decimal(str(row[k])) for k in ("shares", "unitPrice", "amount")]


def identity(row):
    return ":".join(row[k] for k in ("market", "ticker", "assetType", "currency", "shareClass"))


def decimal(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9]\d{0,17})(?:\.\d{0,11}[1-9])?", value):
        raise ValueError("校准数值必须为规范 Decimal 字符串")
    return Decimal(value)


def validate_checkpoints(state):
    checkpoints = state.get("checkpoints", [])
    if not isinstance(checkpoints, list) or (state.get("schemaVersion", 1) == 1 and checkpoints):
        raise ValueError("校准需要版本 2 账本")
    ids, identities = set(), {}
    for cp in checkpoints:
        if not cp["id"] or cp["id"] in ids or cp["kind"] != "position_checkpoint" or not cp["baseRevision"] or cp["historyComplete"] is not False or cp["scope"] not in ("partial", "complete"):
            raise ValueError("校准批次格式或 ID 无效")
        ids.add(cp["id"])
        observed = datetime.fromisoformat(cp["observedAt"].replace("Z", "+00:00"))
        recorded = datetime.fromisoformat(cp["recordedAt"].replace("Z", "+00:00"))
        date.fromisoformat(cp["throughDate"])
        if not observed.tzinfo or not recorded.tzinfo or recorded < observed:
            raise ValueError("校准观察时间无效")
        if not cp["source"]["reference"] or cp["source"]["kind"] not in ("screenshot", "manual", "migration") or not cp["rows"] or len({r["ticker"] for r in cp["rows"]}) != len(cp["rows"]):
            raise ValueError("来源缺失或校准标的重复")
        for row in cp["rows"]:
            ticker = row["ticker"]
            if not ticker or ticker != ticker.strip().upper() or ticker not in state["stockPool"] or row["assetType"] not in ("STOCK", "ETF") or {"US": "USD", "HKEX": "HKD", "CN": "CNY"}.get(row["market"]) != row["currency"] or not row["shareClass"] or row["instrumentId"] != identity(row):
                raise ValueError("标的身份、市场或币种未确认")
            if ticker in identities and identities[ticker] != row["instrumentId"]:
                raise ValueError("同代码不同身份不可合并")
            identities[ticker] = row["instrumentId"]
            q, cost = decimal(row["quantity"]), decimal(row["totalCost"])
            if q == 0 and cost != 0:
                raise ValueError("零持仓不能有剩余成本")
    if len({t["id"] for t in state["trades"]}) != len(state["trades"]):
        raise ValueError("流水 ID 重复")
    for ticker in identities:
        cp = next(c for c in reversed(checkpoints) if any(r["ticker"] == ticker for r in c["rows"]))
        actual = [evidence(t) for t in state["trades"] if t["ticker"] == ticker and t["date"] <= cp["throughDate"]]
        baseline = [evidence(t) for t in cp["baseline"] if t["ticker"] == ticker]
        if actual != baseline:
            raise ValueError(f"{ticker} 校准前/同日流水已变化；需重新校准，不能沿用旧基线")


def validate_transition(previous, state, revision, *, migration=False):
    old, new = previous.get("checkpoints", []), state.get("checkpoints", [])
    if previous.get("schemaVersion") == 2 and state.get("schemaVersion") != 2:
        raise ValueError("不能降级或丢弃校准账本")
    if new[:len(old)] != old:
        raise ValueError("校准历史不可修改或删除，请追加新校准")
    for cp in new[len(old):]:
        if cp["baseRevision"] != revision:
            raise ValueError("校准基线版本已变化，请重新预览")
        if cp["source"]["kind"] == "migration" and not migration and not str(cp["source"].get("reference", "")).startswith("verified:"):
            raise ValueError("来源迁移只能通过已备份的迁移入口")
        if old and cp["throughDate"] < max(c["throughDate"] for c in old):
            raise ValueError("新校准不能早于已有校准截止日")
        if cp["scope"] == "complete":
            from app.modules.trading_data import derive_positions
            held = {p["ticker"] for p in derive_positions(previous) if p["shares"] > 0}
            seen = {r["ticker"] for r in cp["rows"]}
            if set(cp["retainedTickers"]) != held - seen:
                raise ValueError("完整校准必须明确保留所有遗漏持仓；清零须有显式零数量行")
    validate_checkpoints(state)
    for ticker in state["stockPool"]:
        project_checkpoint(state, ticker)


def project_checkpoint(state, ticker):
    cp = next((c for c in reversed(state.get("checkpoints", [])) if any(r["ticker"] == ticker for r in c["rows"])), None)
    if cp is None:
        return None
    row = next(r for r in cp["rows"] if r["ticker"] == ticker)
    with localcontext() as ctx:
        ctx.prec = 80
        q, cost = decimal(row["quantity"]), decimal(row["totalCost"])
        lots = [[q, cost]] if q else []
        for trade in sorted((t for t in state["trades"] if t["ticker"] == ticker and t["date"] > cp["throughDate"]), key=lambda t: t["date"]):
            q = Decimal(str(trade["shares"]))
            if trade["action"] == "买入":
                lots.append([q, Decimal(str(trade["amount"]))])
            else:
                while q > 0 and lots:
                    lot = lots[0]
                    take = min(q, lot[0])
                    lot[1] -= lot[1] * take / lot[0]
                    lot[0] -= take
                    q -= take
                    if not lot[0]:
                        lots.pop(0)
                if q > 0:
                    raise ValueError(f"{ticker} 卖出超过校准后的持仓")
        q = sum((lot[0] for lot in lots), Decimal(0))
        cost = sum((lot[1] for lot in lots), Decimal(0))
        rounded = lambda value, places: float(value.quantize(Decimal(10) ** -places, rounding=ROUND_HALF_UP))
        return {"shares": rounded(q, 6), "holdingCost": rounded(cost, 2), "costBasis": rounded(cost / q, 4) if q else 0,
                "assetType": row["assetType"], "currency": row["currency"], "instrumentId": row["instrumentId"],
                "checkpointId": cp["id"], "observedAt": cp["observedAt"], "historyComplete": False}
