from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core import database


class ResearchSettingsTest(unittest.TestCase):
    def setUp(self) -> None:
        from app.modules import research_settings

        self.module = research_settings
        self.original_db_path = database.DB_PATH
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DB_PATH = Path(self.temp_dir.name) / "app.db"
        database.init_db()

    def tearDown(self) -> None:
        database.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_public_settings_mask_saved_fred_key_and_never_return_plaintext(self) -> None:
        public = self.module.update_research_settings({"fredApiKey": "fred-secret-value"})

        self.assertTrue(public["hasFredApiKey"])
        self.assertEqual(public["fredApiKeyMasked"], "fred…alue")
        self.assertNotIn("fred-secret-value", str(public))
        self.assertEqual(self.module.load_research_settings()["fredApiKey"], "fred-secret-value")

    def test_blank_update_keeps_key_and_explicit_clear_removes_it(self) -> None:
        self.module.update_research_settings({"fredApiKey": "saved-key"})

        kept = self.module.update_research_settings({"fredApiKey": ""})
        cleared = self.module.update_research_settings({"clearFredApiKey": True})

        self.assertTrue(kept["hasFredApiKey"])
        self.assertFalse(cleared["hasFredApiKey"])
        self.assertEqual(cleared["fredApiKeyMasked"], "")


if __name__ == "__main__":
    unittest.main()
