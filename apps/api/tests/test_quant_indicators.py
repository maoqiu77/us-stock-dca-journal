from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from app.modules.indicators import add_indicators, latest_metrics


class QuantIndicatorTest(unittest.TestCase):
    def test_extended_indicators_expose_momentum_volatility_and_volume_metrics(self) -> None:
        count = 260
        frame = pd.DataFrame(
            {
                "Open": np.linspace(100, 150, count),
                "High": np.linspace(101, 152, count),
                "Low": np.linspace(99, 149, count),
                "Close": np.linspace(100, 151, count),
                "Volume": np.linspace(1_000_000, 2_000_000, count),
            },
            index=pd.date_range("2025-01-01", periods=count, freq="B"),
        )

        metrics = latest_metrics(add_indicators(frame))

        for key in (
            "MACD",
            "MACDSignal",
            "MACDHistogram",
            "BollingerUpper",
            "BollingerMiddle",
            "BollingerLower",
            "ATR14",
            "VWMA20",
        ):
            with self.subTest(key=key):
                self.assertIn(key, metrics)
                self.assertTrue(np.isfinite(float(metrics[key])))
        self.assertGreater(metrics["BollingerUpper"], metrics["BollingerLower"])
        self.assertGreater(metrics["ATR14"], 0)


if __name__ == "__main__":
    unittest.main()
