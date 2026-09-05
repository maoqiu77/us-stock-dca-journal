from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core import database
from app.modules.trading_data import (
    derive_positions,
    get_effective_watchlist,
    load_trading_state,
    save_trading_state,
)


class TradingStateDefaultsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(database, "DB_PATH", Path(self.directory.name) / "app.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        database.init_db()

    def test_first_launch_has_only_qqq_and_spy_under_observation(self) -> None:
        state = load_trading_state()
        self.assertEqual(state["stockPool"], ["QQQ", "SPY"])
        self.assertEqual(state["trades"], [])
        self.assertEqual([row["ticker"] for row in database.get_watchlist()], ["QQQ", "SPY"])
        for position in derive_positions(state):
            self.assertEqual(position["shares"], 0)
            self.assertEqual(position["assetType"], "ETF")

    def test_deleting_each_ticker_stays_empty_after_save_reload_and_restart(self) -> None:
        state = load_trading_state()
        for ticker in list(state["stockPool"]):
            state["stockPool"].remove(ticker)
            state["positions"] = [row for row in state["positions"] if row["ticker"] != ticker]
            state["trades"] = [row for row in state["trades"] if row["ticker"] != ticker]
            expected_pool = list(state["stockPool"])
            state = save_trading_state(state)
            self.assertEqual(state["stockPool"], expected_pool)
        database.init_db()
        self.assertEqual(load_trading_state()["stockPool"], [])
        self.assertEqual(get_effective_watchlist(), [])
        self.assertEqual(derive_positions(load_trading_state()), [])
