from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from app.core import database
from app.modules.ledger_store import read_ledger, write_ledger
from app.modules.trading_data import DEFAULT_TRADING_DATA

from app.modules.trading_data import preview_legacy_migration, derive_positions
from app.modules.ai_advice import build_trade_context


class LegacyCalibrationSafetyTest(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((Path(__file__).resolve().parents[3] / "contracts/fixtures/legacy-migration-preview-v1.json").read_text())

    def test_same_preview_as_web_and_no_notes_based_migration(self):
        state = {"trades": self.fixture["trades"], "stockPool": ["SYNTH"], "positions": []}
        before = deepcopy(state)
        holdings = derive_positions(state)
        for _ in range(2):
            self.assertEqual(preview_legacy_migration(state, self.fixture["revision"]), self.fixture["expected"])
        self.assertEqual(state, before)
        self.assertEqual(derive_positions(state), holdings)

    def test_ai_cannot_present_legacy_entry_counts_as_verified_execution_history(self):
        result = build_trade_context(self.fixture["trades"])
        self.assertEqual(result["total_count"], 2)
        self.assertEqual(result["count_basis"], "legacy_ledger_entries_not_verified_executions")
        self.assertIsNone(result["confirmed_execution_count"])
        self.assertIsNone(result["confirmed_turnover"])
        self.assertIsNone(result["realized_pnl"])
        self.assertIn("不能仅根据备注", result["warnings"][0])

    def test_synthetic_migration_preview_and_rejected_write_leave_ledger_unchanged(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(database, "DB_PATH", Path(temp) / "synthetic.db"):
            before = read_ledger()
            state = deepcopy(DEFAULT_TRADING_DATA)
            state.update({"schemaVersion": 1, "stockPool": ["SYNTH"], "positions": [], "trades": []})
            seeded = write_ledger(state, before["revision"], "synthetic-seed")
            preview = preview_legacy_migration(seeded["state"], seeded["revision"])
            self.assertEqual(preview["action"], "read_only")
            self.assertEqual(preview["autoConvertible"], 0)
            checkpoint = {
                "id": "synthetic-migration",
                "kind": "position_checkpoint",
                "observedAt": "2026-10-03T00:00:00+00:00",
                "recordedAt": "2026-10-03T00:01:00+00:00",
                "throughDate": "2026-10-02",
                "baseRevision": seeded["revision"],
                "scope": "partial",
                "historyComplete": False,
                "source": {"kind": "migration", "reference": "synthetic-unverified"},
                "rows": [{"ticker": "SYNTH", "market": "US", "currency": "USD", "assetType": "STOCK", "shareClass": "ordinary", "instrumentId": "US:SYNTH:STOCK:USD:ordinary", "quantity": "2", "totalCost": "20"}],
                "retainedTickers": [],
                "baseline": [],
            }
            candidate = {**seeded["state"], "schemaVersion": 2, "checkpoints": [checkpoint]}
            with self.assertRaises(HTTPException) as caught:
                write_ledger(candidate, seeded["revision"], "synthetic-unverified-migration")
            self.assertEqual(caught.exception.status_code, 422)
            after = read_ledger()
            self.assertEqual(after["state"], seeded["state"])
            self.assertEqual(after["revision"], seeded["revision"])
