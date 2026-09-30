from __future__ import annotations
import sqlite3, tempfile, unittest
from pathlib import Path
from app.core import database
from app.modules.ai_journal.migration import migrate_journal_db
from app.modules.ai_journal.store import JournalStore


class AiJournalStoreTest(unittest.TestCase):
    def test_snapshot_is_immutable_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = database.DB_PATH; database.DB_PATH = Path(tmp) / 'app.db'
            try:
                with database.connect() as db:
                    db.execute('create table app_state(key text primary key,payload text,updated_at text)')
                    db.execute('pragma user_version=5'); migrate_journal_db(db)
                store = JournalStore()
                saved = store.save_snapshot({'request': {'question':'q'}, 'private_context': {'notes': []}, 'created_at':'2026-09-30T00:00:00+00:00'}, 'fp')
                with self.assertRaises(sqlite3.DatabaseError):
                    with store.connect() as db: db.execute('delete from ai_journal_snapshots where id=?',(saved['id'],))
                session, turn, claimed = store.claim(type('R',(),{'idempotency_key':'idem-1234','snapshot_id':saved['id']})(), {'request': {'question':'q','task_type':'instrument_research','instrument_key':None}}, None)
                self.assertTrue(claimed)
                again = store.claim(type('R',(),{'idempotency_key':'idem-1234','snapshot_id':saved['id']})(), {'request': {'question':'q','task_type':'instrument_research','instrument_key':None}}, session)
                self.assertFalse(again[2]); self.assertEqual(again[:2], (session, turn))
            finally: database.DB_PATH = original
