from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class RuntimeSelfCheckTest(unittest.TestCase):
    def test_self_check_is_offline_and_never_uses_configured_data_home(self):
        # Fail before launching the old server, which has no CLI argument handling.
        script = ROOT / 'scripts/runtime/api_server.py'
        self.assertIn('--self-check', script.read_text())
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / 'private'
            private.mkdir()
            marker = private / 'app.db'
            marker.write_bytes(b'synthetic private sentinel: not a database')
            env = {**os.environ, 'PYTHONPATH': str(ROOT / 'apps/api'),
                   'STOCK_APP_DATA_HOME': str(private), 'STOCK_APP_DB_PATH': str(marker),
                   'STOCK_APP_TEMPLATE_HOME': str(private / 'missing-templates')}
            result = subprocess.run([sys.executable, str(script), '--self-check'], env=env,
                                    cwd=ROOT, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report['storage'], 'synthetic_roundtrip_ok')
            self.assertEqual(report['backup_restore'], 'synthetic_roundtrip_ok')
            self.assertEqual(report['external_requests'], 'not_run')
            self.assertEqual(marker.read_bytes(), b'synthetic private sentinel: not a database')
            self.assertEqual(list(private.iterdir()), [marker])
