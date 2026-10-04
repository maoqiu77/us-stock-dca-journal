from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from fastapi import HTTPException
from app.core import database
from app.modules.ledger_store import read_ledger, write_ledger, read_receipt
from app.modules.local_backup import create_backup, prepare_restore, restore_backup, runtime_lock
from app.modules.trading_data import APP_STATE_KEY, load_trading_state


class LedgerSafetyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / "local"
        self.home.mkdir()
        self.db = self.home / "app.db"
        mock = patch.object(database, "DB_PATH", self.db)
        mock.start()
        self.addCleanup(mock.stop)
        self.base = read_ledger()

    def write(self, amount, operation="op", revision=None):
        state = deepcopy(self.base["state"])
        state["account"]["totalAssets"] = amount
        return write_ledger(state, revision or self.base["revision"], operation)

    def test_atomic_two_tabs_exactly_one_wins(self):
        def run(n):
            try:
                return self.write(n, str(n))["state"]["account"]["totalAssets"]
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(run, [100, 200]))
        self.assertEqual(results.count(409), 1)
        self.assertIn(read_ledger()["state"]["account"]["totalAssets"], (100, 200))

    def test_receipt_survives_lost_response_and_replay(self):
        first = self.write(123)
        self.assertEqual(read_receipt("op")["revision"], first["revision"])
        self.assertEqual(self.write(123), first)
        with self.assertRaises(HTTPException) as exc:
            self.write(456)
        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(read_receipt("not-yet-committed")["status"], "unknown")

    def test_legacy_writes_change_revision(self):
        database.set_state_payload(APP_STATE_KEY, json.dumps(self.base["state"]))
        with self.assertRaises(HTTPException) as exc:
            self.write(100)
        self.assertEqual(exc.exception.status_code, 409)

    def test_http_requires_revision_and_exposes_durable_receipt(self):
        from fastapi.testclient import TestClient
        from app.main import app
        # No lifespan/worker startup: all requests use the patched synthetic DB.
        client = TestClient(app)
        self.assertEqual(client.put("/api/trading-state", json=self.base["state"]).status_code, 428)
        self.assertEqual(client.post("/api/trading-state/reset").status_code, 428)
        body = {"state": self.base["state"], "expectedRevision": self.base["revision"], "operationId": "http-operation"}
        response = client.put("/api/trading-state", json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get("/api/trading-state").json()["revision"], response.json()["revision"])
        self.assertEqual(client.get("/api/trading-state/receipts/http-operation").json()["status"], "committed")
        body["operationId"] = "stale-client"
        self.assertEqual(client.put("/api/trading-state", json=body).status_code, 409)
        self.assertEqual(client.get("/api/trading-state/migration-preview").json()["revision"], response.json()["revision"])
        with patch("app.main.settings.DATA_HOME", self.home), patch("app.main.settings.DB_PATH", self.db):
            backup = client.post("/api/local-backup", json={"browserPreferences": {"theme": "dark", "apiKey": "synthetic-secret"}})
        self.assertEqual(backup.status_code, 200)
        import io
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            self.assertEqual(json.loads(archive.read("browser-local-storage.json")), {"theme": "dark"})

    def test_corrupt_json_and_bad_shape_are_never_overwritten(self):
        for raw in ("{broken", "", "null", '{"schemaVersion":1}'):
            database.set_state_payload(APP_STATE_KEY, raw)
            for action in (read_ledger, load_trading_state, lambda: self.write(100)):
                with self.assertRaises(HTTPException):
                    action()
            self.assertEqual(database.get_state_payload(APP_STATE_KEY), raw)

    def test_corrupt_database_is_preserved(self):
        damaged = self.home / "damaged.db"
        damaged.write_bytes(b"not a sqlite database")
        with patch.object(database, "DB_PATH", damaged), self.assertRaises(HTTPException):
            read_ledger()
        self.assertEqual(damaged.read_bytes(), b"not a sqlite database")

    def seed_journal(self):
        with database.connect() as db:
            db.execute("insert into ai_journal_snapshots values ('snapshot','{}','digest','model','2026-10-03')")
            db.execute("insert into ai_journal_sessions values ('session','synthetic','portfolio',null,'2026-10-03')")
            db.execute("insert into ai_journal_turns values ('turn','session','snapshot','idem','running','','','2026-10-03','2026-10-03')")
            db.execute("insert into ai_journal_notes values ('note','synthetic note','2026-10-03','2026-10-03',null)")
            db.execute("insert into ai_journal_agent_runs(id,turn_id,snapshot_id,engine_version,model_fingerprint,status,created_at,updated_at) values ('run','turn','snapshot','v1','model','queued','2026-10-03','2026-10-03')")
            db.execute("insert into ai_journal_agent_sources values ('run','source','{}')")

    def test_backup_restore_roundtrip_excludes_keys_and_disarms_pending(self):
        self.write(321)
        self.seed_journal()
        fixture_value = "fixture-private-value"
        database.set_state_payload("ai_settings_v1", json.dumps({"simpleModel": "test", "apiKey": fixture_value, "profiles": {"custom": {"apiKey": fixture_value}}}))
        database.set_state_payload("research_settings_v1", json.dumps({"fredApiKey": fixture_value}))
        (self.home / ".env").write_text(fixture_value)
        reports = self.home / "quant-analysis"
        reports.mkdir()
        (reports / "synthetic.json").write_text('{"report":"test"}')
        archive = create_backup(self.home, self.db, self.home / "backups" / "test.zip")
        with zipfile.ZipFile(archive) as z:
            self.assertNotIn(".env", z.namelist())
            self.assertNotIn(fixture_value.encode(), z.read("app.db"))
            self.assertIn("quant-analysis/synthetic.json", z.namelist())
        restored = Path(self.tmp.name) / "restored"
        prepare_restore(archive, restored)
        with sqlite3.connect(restored / "app.db") as db:
            self.assertEqual(db.execute("select status from ai_journal_agent_runs").fetchone()[0], "outcome_unknown")
            self.assertEqual(db.execute("select status from ai_journal_turns").fetchone()[0], "outcome_unknown")
            self.assertEqual(db.execute("select count(*) from ai_journal_agent_sources").fetchone()[0], 1)
            self.assertEqual(db.execute("select count(*) from ledger_receipts").fetchone()[0], 0)
            self.assertNotEqual(db.execute("select revision from ledger_revision").fetchone()[0], read_ledger()["revision"])
        with self.assertRaises(ValueError):
            prepare_restore(archive, restored)
        point = restore_backup(archive, self.home)
        self.assertTrue((point / ".env").exists())
        self.assertEqual(read_ledger()["state"]["account"]["totalAssets"], 321)

    def test_missing_references_and_bad_manifest_refused(self):
        self.seed_journal()
        with database.connect() as db:
            db.execute("delete from ai_journal_sessions")
        with self.assertRaises(ValueError):
            create_backup(self.home, self.db, self.home / "bad.zip")
        self.assertEqual(read_ledger()["revision"], self.base["revision"])
        bad = self.home / "legacy.zip"
        with zipfile.ZipFile(bad, "w") as z:
            z.writestr("app.db", "invalid")
        with self.assertRaises(ValueError):
            restore_backup(bad, self.home)
        self.assertTrue(self.db.exists())

    def test_restore_is_blocked_by_running_workspace(self):
        archive = create_backup(self.home, self.db, self.home / "good.zip")
        with runtime_lock(self.home), self.assertRaises(ValueError):
            restore_backup(archive, self.home)
        self.assertEqual(read_ledger()["revision"], self.base["revision"])

    def test_failed_switch_restores_original_and_crash_marker_blocks_startup(self):
        import os
        archive = create_backup(self.home, self.db, self.home / "good.zip")
        original_replace = os.replace
        def fail_activation(source, target):
            if ".restore-" in str(source):
                raise OSError("synthetic activation failure")
            return original_replace(source, target)
        with patch("app.modules.local_backup.os.replace", side_effect=fail_activation), self.assertRaises(OSError):
            restore_backup(archive, self.home)
        self.assertEqual(read_ledger()["revision"], self.base["revision"])
        marker = self.home.parent / ".local.restore-pending.json"
        marker.write_text('{"synthetic":"interrupted switch"}')
        with self.assertRaises(ValueError):
            with runtime_lock(self.home):
                self.fail("must not start after interrupted restore")

    def test_wal_snapshot_includes_committed_data(self):
        with database.connect() as db:
            db.execute("pragma journal_mode=wal")
            self.write(654)
            archive = create_backup(self.home, self.db, self.home / "wal.zip")
            restored = Path(self.tmp.name) / "wal-restored"
            prepare_restore(archive, restored)
            with sqlite3.connect(restored / "app.db") as snapshot:
                state = json.loads(snapshot.execute("select payload from app_state where key=?", (APP_STATE_KEY,)).fetchone()[0])
                self.assertEqual(state["account"]["totalAssets"], 654)


if __name__ == "__main__":
    unittest.main()
