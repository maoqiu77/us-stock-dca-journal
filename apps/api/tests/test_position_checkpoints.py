import copy
import unittest

from app.modules.position_checkpoints import project_checkpoint, validate_checkpoints, validate_transition


class PositionCheckpointTest(unittest.TestCase):
    def setUp(self):
        self.state = {"schemaVersion": 1, "stockPool": ["SYNTH"], "positions": [], "trades": [{"id": "t1", "date": "2026-10-01", "ticker": "SYNTH", "action": "买入", "shares": 10, "unitPrice": 10, "amount": 100, "note": "synthetic"}]}
        self.cp = {"id": "cp-1", "kind": "position_checkpoint", "observedAt": "2026-10-03T01:00:00+00:00", "recordedAt": "2026-10-03T01:01:00+00:00", "throughDate": "2026-10-02", "baseRevision": "r1", "scope": "partial", "historyComplete": False, "source": {"kind": "screenshot", "reference": "synthetic.png"}, "rows": [{"ticker": "SYNTH", "market": "US", "currency": "USD", "assetType": "STOCK", "shareClass": "ordinary", "instrumentId": "US:SYNTH:STOCK:USD:ordinary", "quantity": "10", "totalCost": "100"}], "retainedTickers": [], "baseline": copy.deepcopy(self.state["trades"])}

    def test_projection_and_idempotent_validation(self):
        state = {**self.state, "schemaVersion": 2, "checkpoints": [self.cp]}
        validate_checkpoints(state)
        self.assertEqual(project_checkpoint(state, "SYNTH")["shares"], 10.0)
        validate_transition(self.state, state, "r1")

    def test_changed_history_is_rejected(self):
        state = {**self.state, "schemaVersion": 2, "checkpoints": [self.cp]}
        state["trades"] = [{**state["trades"][0], "amount": 101}]
        with self.assertRaisesRegex(ValueError, "流水已变化"):
            validate_checkpoints(state)


if __name__ == "__main__":
    unittest.main()
