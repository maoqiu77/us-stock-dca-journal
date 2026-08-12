from __future__ import annotations

import unittest

import pandas as pd

from app.modules.indicators import add_indicators, latest_metrics
from app.modules.research import allocate_etf_investments
from app.modules.signal_engine import evaluate_add_signal
from app.modules.trading_data import (
    derive_positions,
    etf_investment_pool,
    sanitize_strategy_settings,
)


class TradingDataTest(unittest.TestCase):
    def test_etf_investment_pool_counts_only_etf_buys_in_current_round(self) -> None:
        settings = sanitize_strategy_settings(
            {"recentEtfInvestmentAmount": 1000, "recentEtfInvestmentStartDate": "2026-08-01"}
        )
        state = {
            "positions": [
                {"ticker": "VOO", "assetType": "ETF"},
                {"ticker": "MSFT", "assetType": "STOCK"},
            ],
            "trades": [
                {"date": "2026-07-31", "ticker": "VOO", "action": "买入", "amount": 200},
                {"date": "2026-08-02", "ticker": "VOO", "action": "买入", "amount": 150},
                {"date": "2026-08-03", "ticker": "MSFT", "action": "买入", "amount": 300},
                {"date": "2026-08-04", "ticker": "VOO", "action": "卖出", "amount": 50},
            ],
        }

        self.assertEqual(settings["recentEtfInvestmentAmount"], 1000)
        self.assertEqual(settings["recentEtfInvestmentStartDate"], "2026-08-01")
        self.assertEqual(
            etf_investment_pool(state, settings),
            {"total": 1000.0, "invested": 150.0, "remaining": 850.0},
        )

    def test_indicators_include_52_week_drawdown_and_latest_high_date(self) -> None:
        index = pd.date_range("2025-01-01", periods=260, freq="D")
        closes = [100.0] * 258 + [120.0, 102.0]
        frame = pd.DataFrame({"Close": closes}, index=index)

        metrics = latest_metrics(add_indicators(frame))

        self.assertEqual(metrics["High252"], 120.0)
        self.assertAlmostEqual(metrics["Drawdown252"], 0.15)
        self.assertEqual(metrics["High252Date"], index[-2].date().isoformat())

    def test_etf_ignores_stop_and_ma_but_takes_extreme_profit(self) -> None:
        base = dict(
            ticker="VOO",
            shares=10,
            target_weight=0.8,
            asset_type="ETF",
            total_assets=2000,
            cash=1000,
            strategy_config={"etf_allocation_amount": 150},
            risk_config={"max_etf_weight": 0.9},
            cost_basis=100,
            take_profit_pct=0.2,
            stop_loss_pct=0.05,
        )
        falling = evaluate_add_signal(
            metrics={"Close": 80, "MA60": 95, "MA120": 100, "RSI14": 40, "Drawdown20": 0.2, "Drawdown252": 0.2},
            **base,
        )
        extreme = evaluate_add_signal(
            metrics={"Close": 200, "MA60": 180, "MA120": 160, "RSI14": 85, "Drawdown20": 0.0, "Drawdown252": 0.0},
            **base,
        )

        self.assertEqual(falling.action, "允许分批加仓")
        self.assertEqual(falling.suggested_amount, 150)
        self.assertEqual(extreme.action, "建议减仓")
        self.assertAlmostEqual(extreme.suggested_shares, 2.0)

    def test_shared_etf_allocation_uses_cumulative_tier_once(self) -> None:
        allocations = allocate_etf_investments(
            [
                {"ticker": "VOO", "assetType": "ETF", "drawdown252": 0.11, "targetGap": 600},
                {"ticker": "QQQM", "assetType": "ETF", "drawdown252": 0.07, "targetGap": 400},
            ],
            pool={"total": 1000, "invested": 100, "remaining": 900},
            cash=1000,
        )

        self.assertAlmostEqual(sum(allocations.values()), 250.0)
        self.assertAlmostEqual(allocations["VOO"], 150.0)
        self.assertAlmostEqual(allocations["QQQM"], 100.0)

    def test_shared_etf_allocation_catches_up_when_price_skips_tiers(self) -> None:
        allocations = allocate_etf_investments(
            [{"ticker": "VOO", "assetType": "ETF", "drawdown252": 0.21, "targetGap": 2000}],
            pool={"total": 1000, "invested": 350, "remaining": 650},
            cash=500,
        )

        self.assertEqual(allocations, {"VOO": 500.0})

    def test_shared_etf_allocation_respects_single_etf_weight_space(self) -> None:
        allocations = allocate_etf_investments(
            [
                {
                    "ticker": "VOO",
                    "assetType": "ETF",
                    "drawdown252": 0.21,
                    "targetGap": 800,
                    "etfLimitGap": 50,
                }
            ],
            pool={"total": 1000, "invested": 0, "remaining": 1000},
            cash=1000,
        )

        self.assertEqual(allocations, {"VOO": 50.0})

    def test_new_etf_high_resets_tier_progress_without_restoring_pool(self) -> None:
        allocations = allocate_etf_investments(
            [
                {
                    "ticker": "VOO",
                    "assetType": "ETF",
                    "drawdown252": 0.06,
                    "targetGap": 800,
                    "cycleInvested": 0,
                }
            ],
            pool={"total": 1000, "invested": 150, "remaining": 850},
            cash=1000,
        )

        self.assertEqual(allocations, {"VOO": 150.0})

    def test_etf_above_single_asset_limit_trims_only_the_excess(self) -> None:
        signal = evaluate_add_signal(
            ticker="VOO",
            metrics={"Close": 100, "MA60": 95, "MA120": 90, "RSI14": 50, "Drawdown20": 0.0, "Drawdown252": 0.0},
            shares=7,
            target_weight=0.8,
            asset_type="ETF",
            total_assets=1000,
            cash=300,
            strategy_config={},
            risk_config={"max_etf_weight": 0.6},
            cost_basis=90,
        )

        self.assertEqual(signal.action, "建议减仓")
        self.assertAlmostEqual(signal.suggested_shares, 1.0)

    def test_etf_with_no_pool_allocation_does_not_fall_back_to_trend_buy(self) -> None:
        signal = evaluate_add_signal(
            ticker="VOO",
            metrics={"Close": 95, "MA60": 90, "MA120": 85, "RSI14": 50, "Drawdown20": 0.05, "Drawdown252": 0.05},
            shares=1,
            target_weight=0.8,
            asset_type="ETF",
            total_assets=1000,
            cash=500,
            strategy_config={"etf_allocation_amount": 0},
            risk_config={"max_etf_weight": 0.9},
            cost_basis=100,
        )

        self.assertEqual(signal.action, "不加仓")
        self.assertEqual(signal.suggested_amount, 0)

    def test_stock_stop_loss_behavior_is_unchanged(self) -> None:
        signal = evaluate_add_signal(
            ticker="MSFT",
            metrics={"Close": 80, "MA60": 95, "MA120": 100, "RSI14": 40, "Drawdown20": 0.2},
            shares=10,
            target_weight=0.8,
            asset_type="STOCK",
            total_assets=2000,
            cash=1000,
            strategy_config={},
            risk_config={"max_etf_weight": 0.9},
            cost_basis=100,
            stop_loss_pct=0.05,
        )

        self.assertEqual(signal.action, "建议减仓")
        self.assertAlmostEqual(signal.suggested_shares, 5.0)
    def test_derive_positions_removes_sold_shares_from_oldest_lots_first(self) -> None:
        [position] = derive_positions(
            {
                "stockPool": ["VOO"],
                "positions": [
                    {
                        "ticker": "VOO",
                        "targetWeight": 0.2,
                        "assetType": "ETF",
                        "takeProfitPct": 0.0,
                        "stopLossPct": 0.0,
                        "purchaseDate": "",
                    }
                ],
                "trades": [
                    {
                        "date": "2026-06-01",
                        "ticker": "VOO",
                        "action": "买入",
                        "shares": 10,
                        "unitPrice": 10,
                        "amount": 100,
                    },
                    {
                        "date": "2026-06-02",
                        "ticker": "VOO",
                        "action": "买入",
                        "shares": 10,
                        "unitPrice": 20,
                        "amount": 200,
                    },
                    {
                        "date": "2026-06-03",
                        "ticker": "VOO",
                        "action": "卖出",
                        "shares": 10,
                        "unitPrice": 15,
                        "amount": 150,
                    },
                ],
            }
        )

        self.assertEqual(position["shares"], 10)
        self.assertEqual(position["costBasis"], 20)
        self.assertEqual(position["holdingCost"], 200)


if __name__ == "__main__":
    unittest.main()
