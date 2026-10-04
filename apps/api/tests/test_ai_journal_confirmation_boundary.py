from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from app.core import database
from app.modules.ai_journal.models import PreviewRequest, ConfirmRequest
from app.modules.ai_journal.service import JournalService
from app.modules.ai_journal.store import JournalStore


class ConfirmationBoundaryTest(unittest.TestCase):
    def test_explicit_note_revocation_blocks_new_send_but_preserves_frozen_history(self):
        for mutation in ('delete', 'edit'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp, \
                 patch.object(database, 'DB_PATH', Path(temp) / 'synthetic.db'):
                database.init_db()
                store = JournalStore()
                note = store.save_note('Synthetic original note')
                sent = []
                def complete(**kwargs):
                    sent.append(kwargs)
                    return {'content': 'Synthetic answer'}
                service = JournalService(store, None, settings=lambda: {
                    'provider': 'custom', 'complexModel': 'synthetic',
                    'baseUrl': 'https://synthetic.invalid', 'apiKey': 'fixture'}, completion=complete)
                preview = service.preview(PreviewRequest(task_type='portfolio_review', question='Synthetic review', note_ids=[note['id']]))
                self.assertEqual(sent, [])
                if mutation == 'delete':
                    store.delete_note(note['id'])
                else:
                    store.save_note('Synthetic revised note', note['id'])
                with self.assertRaises(HTTPException) as caught:
                    service.confirm(ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='synthetic-confirm'))
                self.assertEqual(caught.exception.status_code, 403)
                self.assertEqual(sent, [])
                frozen, _, _ = store.snapshot(preview['id'])
                self.assertEqual(frozen['private_context']['notes'][0]['body'], 'Synthetic original note')
