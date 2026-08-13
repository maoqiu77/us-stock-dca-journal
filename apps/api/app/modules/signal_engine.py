from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date

import numpy as np

from app.modules.indicators import trend_status
from app.modules.position_sizing import calculate_position_context, suggested_add_amount


@dataclass
class Signal:
    ticker: str
    current_price: float
    trend_status: str
    drawdown: float
    rsi: float
    market_value: float
    cost_basis: float
    return_from_cost: float
    take_profit_pct: float
    stop_loss_pct: float
    unrealized_pnl: float
    current_weight: float
    target_weight: float
    action: str
    status: str
    suggested_amount: float
    suggested_shares: float
    reasons: list[str]
    blocked_reasons: list[str]
    risk_notes: list[str]
    manual_instruction: str

    def to_row(self) -> dict:
        row = asdict(self)
        row["date"] = date.today().isoformat()
        row["reasons"] = "；".join(self.reasons)
        row["blocked_reasons"] = "；".join(self.blocked_reasons)
        row["risk_notes"] = "；".join(self.risk_notes)
        return row


def evaluate_add_signal(
    ticker: str,
    metrics: dict,
    shares: float,
    target_weight: float,
    asset_type: str,
    total_assets: float,
    cash: float,
    strategy_config: dict,
    risk_config: dict,
    cost_basis: float = 0.0,
    take_profit_pct: float = 0.0,
    stop_loss_pct: float = 0.0,
) -> Signal:
    """Evaluate add and reduce rules, then return a manual-only signal."""
    price = float(metrics.get("Close", np.nan))
    ma60 = float(metrics.get("MA60", np.nan))
    ma120 = float(metrics.get("MA120", np.nan))
    rsi_value = float(metrics.get("RSI14", np.nan))
    drawdown20 = float(metrics.get("Drawdown20", np.nan))
    asset_key = "etf" if str(asset_type).upper() == "ETF" else "stock"
    core_holdings = {
        str(key).upper(): str(value).lower()
        for key, value in strategy_config.get("core_holdings", {}).items()
    }
    satellite_symbols = {
        str(symbol).upper() for symbol in strategy_config.get("satellite_symbols", [])
    }
    role_key = "core"
    if asset_key == "stock":
        if core_holdings.get(ticker.upper()) == "satellite" or ticker.upper() in satellite_symbols:
            role_key = "satellite"
        elif core_holdings.get(ticker.upper()) == "core":
            role_key = "core"

    def cfg(name: str, default: float) -> float:
        if asset_key == "stock":
            role_value = strategy_config.get(f"{role_key}_{name}")
            if role_value is not None:
                return float(role_value)
        return float(strategy_config.get(f"{asset_key}_{name}", strategy_config.get(name, default)))

    pullback_min = cfg("pullback_min", 0.03)
    pullback_max = cfg("pullback_max", 0.08)
    deeper_pullback_min = cfg("deeper_pullback_min", pullback_max)
    deeper_pullback_max = cfg("deeper_pullback_max", 0.18)
    starter_position_ratio = cfg("starter_position_ratio", 0.33)
    rsi_max = cfg("rsi_max", 75)
    reduce_rsi = cfg("reduce_rsi", 80)
    take_profit_rsi = cfg("take_profit_rsi", max(reduce_rsi, 82))
    take_profit_trim_ratio = float(strategy_config.get("take_profit_trim_ratio", 0.20))
    hard_stop_ma_break_ratio = float(strategy_config.get("hard_stop_ma_break_ratio", 0.50))
    trim_to_target_buffer = cfg("trim_to_target_buffer", 0.03)
    max_asset_ratio = float(strategy_config.get("single_add_asset_ratio", 0.05))
    max_cash_ratio = float(strategy_config.get("single_add_cash_ratio", 0.20))
    starter_asset_ratio = cfg("starter_add_asset_ratio", min(max_asset_ratio, 0.03))
    starter_cash_ratio = cfg("starter_add_cash_ratio", min(max_cash_ratio, 0.12))
    strong_asset_ratio = cfg("strong_add_asset_ratio", max_asset_ratio)
    strong_cash_ratio = cfg("strong_add_cash_ratio", max_cash_ratio)
    etf_limit = float(risk_config.get("max_etf_weight", 0.40))

    context = calculate_position_context(price if np.isfinite(price) else 0, shares, total_assets, target_weight)
    cost_value = shares * cost_basis if shares > 0 and cost_basis > 0 else 0.0
    unrealized_pnl = context.market_value - cost_value if cost_value > 0 else 0.0
    return_from_cost = (
        (price - cost_basis) / cost_basis
        if shares > 0 and cost_basis > 0 and np.isfinite(price)
        else np.nan
    )
    status = trend_status(metrics, pullback_min, pullback_max, rsi_max)

    reasons: list[str] = []
    blocked: list[str] = []
    risk_notes: list[str] = ["本平台不自动下单；请在券商 App 中手动确认价格、数量和风险。"]
    asset_label = "ETF" if asset_key == "etf" else ("卫星仓科技股" if role_key == "satellite" else "核心科技股")

    if not np.isfinite(price) or price <= 0:
        blocked.append("行情数据不足，无法计算建议")

    if not blocked and shares > 0:
        sell_shares = 0.0
        sell_status = "建议减仓"
        sell_reason = ""
        if asset_key == "etf":
            effective_limit = min(max(target_weight, 0), etf_limit)
            if context.current_weight > effective_limit + trim_to_target_buffer and price > 0:
                target_shares = total_assets * effective_limit / price
                sell_shares = max(shares - target_shares, 0)
                sell_reason = "当前 ETF 仓位明显高于目标仓位或单只 ETF 上限，建议只调整超出的部分"
            elif (
                (np.isfinite(rsi_value) and rsi_value >= 85)
                or (np.isfinite(return_from_cost) and return_from_cost >= 1.0)
            ):
                sell_shares = shares * 0.20
                sell_reason = (
                    f"ETF 处于极端高位（RSI14={rsi_value:.1f} 或相对成本盈利 {return_from_cost:.2%}），"
                    "建议止盈 20%，保留大部分长期仓位"
                )
        elif stop_loss_pct > 0 and np.isfinite(return_from_cost) and return_from_cost <= -stop_loss_pct:
            sell_shares = shares * hard_stop_ma_break_ratio
            sell_status = "风险减仓"
            sell_reason = f"当前相对成本亏损 {return_from_cost:.2%}，已触发止损线 {-stop_loss_pct:.0%}，建议先减仓控制风险"
        elif np.isfinite(ma120) and price < ma120:
            sell_shares = shares * hard_stop_ma_break_ratio
            sell_status = "风险减仓"
            sell_reason = f"当前价格跌破 MA120，{asset_label}长期趋势转弱，建议先减仓控制回撤"
        elif target_weight >= 0 and context.current_weight > target_weight + trim_to_target_buffer and price > 0:
            target_value_after_trim = total_assets * max(target_weight, 0)
            target_shares = target_value_after_trim / price if price > 0 else 0
            sell_shares = max(shares - target_shares, 0)
            sell_reason = "当前仓位明显高于目标仓位，建议卖出超出目标的部分，避免单一持仓过重"
        elif take_profit_pct > 0 and np.isfinite(return_from_cost) and return_from_cost >= take_profit_pct:
            sell_shares = shares * take_profit_trim_ratio
            sell_reason = f"当前相对成本盈利 {return_from_cost:.2%}，已触发止盈线 {take_profit_pct:.0%}，建议小幅止盈，保留大部分长期仓位"
        elif np.isfinite(rsi_value) and rsi_value >= take_profit_rsi and context.current_weight >= max(target_weight * 0.8, 0.05):
            sell_shares = shares * take_profit_trim_ratio
            sell_reason = f"RSI14={rsi_value:.1f} 明显过热，建议小幅止盈，保留大部分长期仓位"
        elif np.isfinite(rsi_value) and rsi_value >= reduce_rsi and context.current_weight > max(target_weight, 0):
            excess_weight = max(context.current_weight - target_weight, 0)
            trim_ratio = min(max(excess_weight / max(context.current_weight, 1e-9), 0.10), 0.25)
            sell_shares = shares * trim_ratio
            sell_reason = f"RSI14={rsi_value:.1f} 偏热且当前仓位高于目标仓位，建议先小幅降温"
        elif np.isfinite(rsi_value) and rsi_value >= take_profit_rsi and context.current_weight > 0:
            sell_shares = shares * min(take_profit_trim_ratio, 0.15)
            sell_reason = f"RSI14={rsi_value:.1f} 明显过热，建议先减一小部分仓位，等待更好的再加仓位置"

        if sell_shares > 0:
            sell_shares = min(sell_shares, shares)
            amount = sell_shares * price
            reasons.append(sell_reason)
            risk_notes.append("减仓信号用于控制仓位和风险，不代表必须清仓；请结合税费、财报日程、持仓周期和券商实时报价。")
            manual = manual_instruction("卖出", ticker, amount, sell_shares)
            return Signal(
                ticker=ticker,
                current_price=price,
                trend_status=status,
                drawdown=drawdown20,
                rsi=rsi_value,
                market_value=context.market_value,
                cost_basis=cost_basis,
                return_from_cost=return_from_cost,
                take_profit_pct=take_profit_pct,
                stop_loss_pct=stop_loss_pct,
                unrealized_pnl=unrealized_pnl,
                current_weight=context.current_weight,
                target_weight=target_weight,
                action="建议减仓",
                status=sell_status,
                suggested_amount=amount,
                suggested_shares=sell_shares,
                reasons=reasons,
                blocked_reasons=["当前存在减仓信号，先不考虑继续加仓"],
                risk_notes=risk_notes,
                manual_instruction=manual,
            )

    starter_position_value = total_assets * max(min(target_weight, starter_position_ratio), 0)
    starter_position_shares = starter_position_value / price if price > 0 else 0
    has_existing_position = shares > 0 or context.market_value > 0
    starter_context = (not has_existing_position) or (
        asset_key == "etf" and context.market_value < starter_position_value * 0.8
    )
    strong_trend = np.isfinite(ma120) and np.isfinite(ma60) and price > ma60 and price > ma120
    normal_pullback = np.isfinite(drawdown20) and pullback_min <= drawdown20 <= pullback_max
    deeper_pullback = np.isfinite(drawdown20) and deeper_pullback_min <= drawdown20 <= deeper_pullback_max

    if asset_key == "etf":
        allocation = max(float(strategy_config.get("etf_allocation_amount", 0.0)), 0.0)
        drawdown252 = float(metrics.get("Drawdown252", np.nan))
        if allocation > 0 and np.isfinite(drawdown252) and drawdown252 >= 0.05:
            reasons.extend(
                [
                    f"当前相对 52 周高点回撤 {drawdown252:.2%}，进入 ETF 分批投入区间",
                    "ETF 的 MA60、MA120、普通 RSI 和止损线仅作背景，不阻止长期分批投入",
                ]
            )
            amount = min(allocation, context.gap_to_target, cash)
            shares_to_buy = amount / price if price > 0 else 0.0
            if amount > 0:
                return Signal(
                    ticker=ticker,
                    current_price=price,
                    trend_status=status,
                    drawdown=drawdown252,
                    rsi=rsi_value,
                    market_value=context.market_value,
                    cost_basis=cost_basis,
                    return_from_cost=return_from_cost,
                    take_profit_pct=take_profit_pct,
                    stop_loss_pct=stop_loss_pct,
                    unrealized_pnl=unrealized_pnl,
                    current_weight=context.current_weight,
                    target_weight=target_weight,
                    action="允许分批加仓",
                    status="允许分批加仓",
                    suggested_amount=amount,
                    suggested_shares=shares_to_buy,
                    reasons=reasons,
                    blocked_reasons=[],
                    risk_notes=risk_notes,
                    manual_instruction=manual_instruction("买入", ticker, amount, shares_to_buy),
                )
        etf_blocked = list(blocked)
        if not np.isfinite(drawdown252) or drawdown252 < 0.05:
            etf_blocked.append("52 周回撤尚未达到 5% 的第一档")
        else:
            etf_blocked.append("当前回撤档位的共享 ETF 资金已投入，或近期可新投入资金不足")
        return Signal(
            ticker=ticker,
            current_price=price,
            trend_status=status,
            drawdown=drawdown252,
            rsi=rsi_value,
            market_value=context.market_value,
            cost_basis=cost_basis,
            return_from_cost=return_from_cost,
            take_profit_pct=take_profit_pct,
            stop_loss_pct=stop_loss_pct,
            unrealized_pnl=unrealized_pnl,
            current_weight=context.current_weight,
            target_weight=target_weight,
            action="不加仓",
            status="观察等待",
            suggested_amount=0.0,
            suggested_shares=0.0,
            reasons=[],
            blocked_reasons=etf_blocked,
            risk_notes=risk_notes,
            manual_instruction=manual_instruction("买入", ticker, 0.0, 0.0),
        )

    if np.isfinite(ma120) and price < ma120:
        blocked.append(f"当前价格低于 MA120，{asset_label}长期趋势转弱，暂停主动加仓")
        status = "风险暂停"
    elif np.isfinite(ma60) and price <= ma60:
        blocked.append("当前价格未站上 MA60，中期趋势不满足")
    elif np.isfinite(drawdown20) and not (normal_pullback or deeper_pullback):
        blocked.append(f"20 日高点回撤不在 {pullback_min:.0%}-{pullback_max:.0%} 或 {deeper_pullback_min:.0%}-{deeper_pullback_max:.0%} 区间")

    if np.isfinite(rsi_value) and rsi_value > rsi_max:
        blocked.append(f"RSI14={rsi_value:.1f} 高于 {rsi_max:.0f}，避免在{asset_label}短线过热时追高")
        if status != "风险暂停":
            status = "禁止加仓"
    if context.current_weight >= target_weight:
        blocked.append("当前仓位已经达到或超过目标仓位")
    if asset_key == "etf" and context.current_weight >= etf_limit:
        blocked.append(f"当前{asset_type}仓位超过单标的风控上限 {etf_limit:.0%}")
    if cash <= 0:
        blocked.append("账户现金不足")

    add_label = "允许加仓"
    if starter_context and strong_trend and normal_pullback and np.isfinite(rsi_value) and rsi_value <= rsi_max:
        if asset_key == "etf":
            reasons.extend(
                [
                    "核心 ETF 仍在 MA60 和 MA120 上方，可考虑先建立长期底仓",
                    f"20 日高点回撤 {drawdown20:.2%}，属于较健康的 ETF 首次建仓区间",
                    f"RSI14={rsi_value:.1f}，ETF 尚未明显过热",
                    "核心 ETF 可以比个股更积极一些，但仍建议分批建仓",
                ]
            )
        else:
            reasons.extend(
                [
                    f"长期看好的{asset_label}仍在 MA60 和 MA120 上方，可考虑先建立第一笔仓位",
                    f"20 日高点回撤 {drawdown20:.2%}，处于相对健康的首次建仓区间",
                    f"RSI14={rsi_value:.1f}，未出现明显过热",
                    "卫星仓建议更轻、更慢，核心科技股可分三笔左右建立长期仓位，不一次性买满" if role_key == "satellite" else "核心科技股建议分三笔左右建立长期仓位，不一次性买满",
                ]
            )
        add_asset_ratio = starter_asset_ratio
        add_cash_ratio = starter_cash_ratio
        add_label = "允许加仓" if has_existing_position else "允许建仓"
    elif strong_trend and normal_pullback and np.isfinite(rsi_value) and rsi_value <= rsi_max:
        if asset_key == "etf":
            reasons.extend(
                [
                    "核心 ETF 价格高于 MA60 和 MA120，长期趋势未破坏",
                    f"20 日高点回撤 {drawdown20:.2%}，处于较适合继续定投/补仓的区间",
                    f"RSI14={rsi_value:.1f}，ETF 尚未过热",
                    "ETF 波动较小，可比个股更稳定地分批加仓",
                ]
            )
        else:
            reasons.extend(
                [
                    "价格高于 MA60 和 MA120，长期趋势未破坏",
                    f"20 日高点回撤 {drawdown20:.2%}，处于顺势加仓区间",
                    f"RSI14={rsi_value:.1f}，尚未过热",
                    "卫星仓科技股更适合轻仓、慢节奏补仓，避免一次性把仓位打满" if role_key == "satellite" else "核心科技股更适合分批补仓，而不是一次性抄底或追涨",
                ]
            )
        add_asset_ratio = max_asset_ratio
        add_cash_ratio = max_cash_ratio
    elif strong_trend and deeper_pullback and np.isfinite(rsi_value) and rsi_value <= max(rsi_max - 4, 60):
        if asset_key == "etf":
            reasons.extend(
                [
                    "核心 ETF 长期趋势仍在，当前属于较深但可接受的回撤",
                    f"20 日高点回撤 {drawdown20:.2%}，适合继续分批补仓",
                    f"RSI14={rsi_value:.1f}，热度已回落",
                    "ETF 深回撤一般可以更耐心地逢低布局，但仍不建议一次打满",
                ]
            )
        else:
            reasons.extend(
                [
                    f"{asset_label}长期趋势仍在，但回撤更深，适合小步慢加，不宜激进满仓",
                    f"20 日高点回撤 {drawdown20:.2%}，属于较深回撤区间",
                    f"RSI14={rsi_value:.1f}，已经从过热区降温",
                    "卫星仓波动更大，深回撤时更应控制单笔金额和总仓位" if role_key == "satellite" else "这类核心 AI/科技股波动较大，深回撤时也应控制单笔金额",
                ]
            )
        add_asset_ratio = strong_asset_ratio
        add_cash_ratio = strong_cash_ratio
        add_label = "允许分批加仓"
    else:
        add_asset_ratio = max_asset_ratio
        add_cash_ratio = max_cash_ratio

    amount = 0.0
    shares_to_buy = 0.0
    if not blocked and reasons:
        amount = suggested_add_amount(context.gap_to_target, total_assets, cash, add_asset_ratio, add_cash_ratio)
        if starter_context and starter_position_shares > 0:
            amount = min(amount, starter_position_value, cash)
        if amount <= 0:
            blocked.append("按目标仓位、单次上限和现金上限计算后无可加仓金额")
            reasons.clear()
        else:
            shares_to_buy = amount / price

    if blocked:
        action = "不加仓"
        if status == "风险暂停":
            final_status = "风险暂停"
        elif any("RSI14" in item or "风控上限" in item or "目标仓位" in item for item in blocked):
            final_status = "禁止加仓"
        else:
            final_status = "观察等待"
    else:
        action = add_label
        final_status = add_label

    manual = manual_instruction("买入", ticker, amount, shares_to_buy)
    return Signal(
        ticker=ticker,
        current_price=price,
        trend_status=status,
        drawdown=drawdown20,
        rsi=rsi_value,
        market_value=context.market_value,
        cost_basis=cost_basis,
        return_from_cost=return_from_cost,
        take_profit_pct=take_profit_pct,
        stop_loss_pct=stop_loss_pct,
        unrealized_pnl=unrealized_pnl,
        current_weight=context.current_weight,
        target_weight=target_weight,
        action=action,
        status=final_status,
        suggested_amount=amount,
        suggested_shares=shares_to_buy,
        reasons=reasons,
        blocked_reasons=blocked,
        risk_notes=risk_notes,
        manual_instruction=manual,
    )


def format_signal(signal: Signal) -> str:
    def money(value: float) -> str:
        return "N/A" if not np.isfinite(value) else f"${value:,.2f}"

    def percent(value: float) -> str:
        return "N/A" if not np.isfinite(value) else f"{value:.2%}"

    def number(value: float, digits: int = 1) -> str:
        return "N/A" if not np.isfinite(value) else f"{value:.{digits}f}"

    reason_text = "；".join(signal.reasons) if signal.reasons else "暂无加仓理由。"
    blocked_text = "；".join(signal.blocked_reasons)
    risk_text = "；".join(signal.risk_notes)
    if blocked_text:
        reason_text = f"{reason_text} 不加仓原因：{blocked_text}"
    return "\n".join(
        [
            f"标的：{signal.ticker}",
            f"当前价格：{money(signal.current_price)}",
            f"趋势状态：{signal.trend_status}",
            f"回撤幅度：{percent(signal.drawdown)}",
            f"RSI：{number(signal.rsi)}",
            f"持仓市值：{money(signal.market_value)}",
            f"每股成本：{money(signal.cost_basis)}",
            f"成本收益率：{percent(signal.return_from_cost)}",
            f"止盈线：{percent(signal.take_profit_pct)}",
            f"止损线：{percent(signal.stop_loss_pct)}",
            f"浮动盈亏：{money(signal.unrealized_pnl)}",
            f"当前仓位：{percent(signal.current_weight)}",
            f"目标仓位：{percent(signal.target_weight)}",
            f"建议动作：{signal.action}",
            f"建议金额：{money(signal.suggested_amount)}",
            f"建议股数：{number(signal.suggested_shares, 2)}",
            f"理由：{reason_text}",
            f"风险提示：{risk_text}",
            f"手动操作建议：{signal.manual_instruction}",
        ]
    )


def manual_instruction(action: str, ticker: str, amount: float, shares: float) -> str:
    if amount <= 0 or shares <= 0:
        return "当前没有建议交易金额；请继续观察并等待下一次信号。"
    if action == "卖出":
        return f"请在券商 App 中手动确认：卖出 {ticker}，约 {shares:.2f} 股，预计金额约 ${amount:,.2f}。"
    return f"请在券商 App 中手动确认：买入 {ticker}，金额约 ${amount:,.2f}，约 {shares:.2f} 股。"
