from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from app.modules import app_update


class AppUpdateTest(unittest.TestCase):
    def test_project_package_versions_stay_in_sync(self) -> None:
        root = Path(__file__).resolve().parents[3]
        root_package = json.loads((root / "package.json").read_text(encoding="utf-8"))
        web_package = json.loads(
            (root / "apps" / "web" / "package.json").read_text(encoding="utf-8")
        )

        self.assertEqual(root_package["version"], web_package["version"])

    def test_version_compare_uses_semver_parts(self) -> None:
        self.assertTrue(app_update.is_newer_version("v0.1.1", "v0.1.0"))
        self.assertTrue(app_update.is_newer_version("v0.10.0", "v0.9.9"))
        self.assertFalse(app_update.is_newer_version("v0.1.0", "v0.1.0"))
        self.assertFalse(app_update.is_newer_version("dev", "v0.1.0"))

    def test_release_check_matches_platform_asset_and_digest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "updater").mkdir()
            (root / "updater" / "install-update.sh").write_text("#!/usr/bin/env bash\n")
            runtime = app_update.RuntimeInfo(
                install_root=root,
                data_home=root / "storage" / "local",
                version="v0.1.0",
                platform_id="macos-arm64",
                repo="owner/repo",
                is_packaged=True,
            )

            result = app_update.build_update_check_response(
                runtime,
                {
                    "tag_name": "v0.1.1",
                    "html_url": "https://example.test/release",
                    "assets": [
                        {
                            "name": "stock-trading-platform-next-v0.1.1-macos-arm64.zip",
                            "size": 12,
                            "digest": f"sha256:{'a' * 64}",
                            "browser_download_url": "https://example.test/app.zip",
                        }
                    ],
                },
            )

        self.assertTrue(result["updateAvailable"])
        self.assertTrue(result["canInstall"])
        self.assertEqual(result["asset"]["name"], "stock-trading-platform-next-v0.1.1-macos-arm64.zip")

    def test_release_check_requires_digest_for_auto_install(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "updater").mkdir()
            (root / "updater" / "Install-Update.ps1").write_text("param()\n")
            runtime = app_update.RuntimeInfo(
                install_root=root,
                data_home=root / "storage" / "local",
                version="v0.1.0",
                platform_id="windows-x64",
                repo="owner/repo",
                is_packaged=True,
            )

            result = app_update.build_update_check_response(
                runtime,
                {
                    "tag_name": "v0.1.1",
                    "assets": [
                        {
                            "name": "stock-trading-platform-next-v0.1.1-windows-x64.zip",
                            "size": 12,
                            "digest": "",
                            "browser_download_url": "https://example.test/app.zip",
                        }
                    ],
                },
            )

        self.assertTrue(result["updateAvailable"])
        self.assertFalse(result["canInstall"])
        self.assertIn("sha256", result["message"])

    def test_local_backup_excludes_recursive_update_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_home = Path(tmp) / "storage" / "local"
            (data_home / "updates").mkdir(parents=True)
            (data_home / "backups").mkdir()
            (data_home / "pids").mkdir()
            from app.core import database
            with patch.object(database, "DB_PATH", data_home / "app.db"):
                database.init_db()
            (data_home / "api.log").write_text("api log")
            (data_home / "updates" / "download.zip").write_text("download")
            (data_home / "backups" / "old.zip").write_text("backup")
            (data_home / "pids" / "api.pid").write_text("123")

            backup_path = app_update.create_local_backup(
                data_home=data_home,
                version="v0.1.0",
                next_version="v0.1.1",
                local_storage_snapshot={"stock-platform-next.trading-data.v1": "{}"},
            )

            with zipfile.ZipFile(backup_path) as archive:
                names = set(archive.namelist())

        self.assertIn("app.db", names)
        self.assertNotIn("api.log", names)
        self.assertIn("manifest.json", names)
        self.assertIn("browser-local-storage.json", names)
        self.assertNotIn("updates/download.zip", names)
        self.assertNotIn("backups/old.zip", names)
        self.assertNotIn("pids/api.pid", names)

    def test_updater_command_supports_dry_run(self) -> None:
        command = app_update.build_updater_command(
            platform_id="macos-arm64",
            runner_path=Path("/tmp/install-update.sh"),
            install_root=Path("/Applications/StockLab"),
            package_path=Path("/tmp/app.zip"),
            backup_path=Path("/tmp/backup.zip"),
            launcher_path=Path("/Applications/StockLab/启动股票交易平台.command"),
            api_pid="123",
            web_pid="456",
            dry_run=True,
        )

        self.assertIn("--dry-run", command)
        self.assertIn("--install-root", command)
        self.assertIn("/Applications/StockLab", command)


if __name__ == "__main__":
    unittest.main()
