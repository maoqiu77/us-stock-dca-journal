from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / 'apps/api') not in sys.path:
    sys.path.insert(0, str(ROOT / 'apps/api'))


def self_check() -> dict:
    """Offline import/storage/backup smoke check, including inside a frozen binary.

    Must run before importing app settings. No real data or model configuration is read.
    """
    import socket
    from unittest.mock import patch

    with tempfile.TemporaryDirectory(prefix='stock-api-self-check-') as directory:
        home = Path(directory) / 'local'
        bundle_root = Path(getattr(sys, '_MEIPASS', ROOT))
        template_home = bundle_root / 'storage/templates'
        env = {'STOCK_APP_DATA_HOME': str(home), 'STOCK_APP_DB_PATH': str(home / 'app.db'),
               'STOCK_APP_TEMPLATE_HOME': str(template_home)}
        with patch.dict(os.environ, env), patch.object(socket.socket, 'connect', side_effect=RuntimeError('self-check is offline')):
            import uvicorn  # noqa: F401 - verify the server dependency is bundled
            from app.main import app
            from app.core import database
            from app.modules.ai_journal.agent.model import runtime_available
            from app.modules.ai_journal.store import JournalStore
            from app.modules.ledger_store import read_ledger
            from app.modules.local_backup import create_backup, prepare_restore

            if database.DB_PATH != home / 'app.db':
                raise RuntimeError('self-check must run in a fresh process before app imports')
            ledger = read_ledger()
            note = JournalStore().save_note('SYNTHETIC offline smoke note', journal_date='2026-10-03')
            archive = create_backup(home, database.DB_PATH, Path(directory) / 'backup.zip')
            restored = Path(directory) / 'restored'
            prepare_restore(archive, restored)
            with sqlite3.connect(restored / 'app.db') as db:
                body = db.execute('select body from ai_journal_notes where id=?', (note['id'],)).fetchone()
                if body != ('SYNTHETIC offline smoke note',):
                    raise RuntimeError('restored note differs')
            if read_ledger() != ledger or not app.routes:
                raise RuntimeError('storage or route registration smoke check failed')
            return {'schema': database.CURRENT_DB_SCHEMA_VERSION,
                    'storage': 'synthetic_roundtrip_ok', 'backup_restore': 'synthetic_roundtrip_ok',
                    'agent_dependencies': runtime_available(), 'external_requests': 'not_run',
                    'market': 'not_probed', 'text_model': 'not_probed',
                    'image_model': 'not_probed', 'model_tools': 'not_probed'}


def main() -> None:
    parser = argparse.ArgumentParser(description='Local FastAPI server / offline package check')
    parser.add_argument('--self-check', action='store_true', help='use only a temporary synthetic database; no network or server')
    args = parser.parse_args()
    if args.self_check:
        print(json.dumps(self_check()))
        return
    import uvicorn
    from app.main import app

    host = os.getenv("STOCK_APP_API_HOST", "127.0.0.1")
    port = int(os.getenv("STOCK_APP_API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
