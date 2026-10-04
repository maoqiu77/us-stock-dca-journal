from __future__ import annotations

import unittest

from app.modules.portfolio_valuation import value_positions


class PortfolioValuationTest(unittest.TestCase):
    def test_partial_quotes_do_not_use_cost_as_market_value(self) -> None:
        positions = [
            {"ticker": "KNOWN", "shares": 10, "holdingCost": 1000},
            {"ticker": "MISSING", "shares": 5, "holdingCost": 500},
        ]
        result = value_positions(
            positions,
            [
                {"ticker": "KNOWN", "price": 110, "previous_close": 100, "source": "yahoo"},
                {"ticker": "MISSING", "price": None, "status": "unavailable"},
            ],
        )
        self.assertEqual(result["market_value"], 1100)
        self.assertEqual(result["unrealized_pnl"], 100)
        self.assertEqual(result["day_change"], 100)
        self.assertEqual(result["missing_tickers"], ["MISSING"])

    def test_sample_and_incompatible_currency_are_unknown(self) -> None:
        result = value_positions(
            [{"ticker": "CNY", "shares": 10, "holdingCost": 1000}],
            [{"ticker": "CNY", "price": 120, "source": "sample", "currency": "CNY"}],
            base_currency="USD",
        )
        self.assertIsNone(result["market_value"])
        self.assertEqual(result["incompatible_tickers"], ["CNY"])


if __name__ == "__main__":
    unittest.main()
