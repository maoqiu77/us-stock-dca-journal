import copy
import unittest
from app.modules.position_checkpoints import validate_transition


class PositionCheckpointMigrationTest(unittest.TestCase):
    def test_only_verified_reference_can_migrate(self):
        old = {"schemaVersion": 1, "stockPool": ["SYNTH"], "positions": [], "trades": []}
        cp = {"id": "m1", "kind": "position_checkpoint", "observedAt": "2026-10-03T00:00:00+00:00", "recordedAt": "2026-10-03T00:01:00+00:00", "throughDate": "2026-10-02", "baseRevision": "r1", "scope": "partial", "historyComplete": False, "source": {"kind": "migration", "reference": "verified:broker-export-1"}, "rows": [{"ticker": "SYNTH", "market": "US", "currency": "USD", "assetType": "STOCK", "shareClass": "ordinary", "instrumentId": "US:SYNTH:STOCK:USD:ordinary", "quantity": "2", "totalCost": "20"}], "retainedTickers": [], "baseline": []}
        new = {**old, "schemaVersion": 2, "checkpoints": [cp]}
        validate_transition(old, new, "r1")
        bad = copy.deepcopy(new); bad["checkpoints"][0]["source"]["reference"] = "备注"
        with self.assertRaisesRegex(ValueError, "迁移入口"):
            validate_transition(old, bad, "r1")
