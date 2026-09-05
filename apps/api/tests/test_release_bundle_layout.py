from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VERIFIER = ROOT / "scripts" / "verify_release_bundle_layout.py"
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "build-release-packages.yml"
WINDOWS_LAUNCHER = ROOT / "scripts" / "windows" / "Start-StockPlatform.ps1"
MACOS_LAUNCHER = ROOT / "scripts" / "macos" / "Start-StockPlatform.command"


class ReleaseBundleLayoutTest(unittest.TestCase):
    def test_packaged_launchers_use_loopback_reuse_and_nested_entry_points(self) -> None:
        windows = WINDOWS_LAUNCHER.read_text(encoding="utf-8")
        macos = MACOS_LAUNCHER.read_text(encoding="utf-8")

        self.assertIn('$env:HOSTNAME = "127.0.0.1"', windows)
        self.assertIn('"--hostname", "127.0.0.1"', windows)
        self.assertIn("Test-RunningPlatform", windows)
        self.assertIn('"web\\apps\\web\\server.js"', windows)
        self.assertIn('export HOSTNAME="127.0.0.1"', macos)
        self.assertIn("running_platform()", macos)
        self.assertIn('"./web/apps/web/server.js"', macos)

    def test_release_workflow_verifies_each_assembled_package(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

        self.assertEqual(workflow.count("scripts/verify_release_bundle_layout.py"), 2)

    def test_verifier_accepts_nested_windows_standalone_layout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / "stock-platform"
            web_root = package / "web" / "apps" / "web"
            (package / "api").mkdir(parents=True)
            (package / "runtime" / "node").mkdir(parents=True)
            (package / "updater").mkdir(parents=True)
            (web_root / ".next" / "static").mkdir(parents=True)
            (web_root / "public").mkdir()
            (package / "api" / "stock-platform-api.exe").write_text("api")
            (package / "runtime" / "node" / "node.exe").write_text("node")
            (package / "updater" / "Install-Update.ps1").write_text("updater")
            (package / "Start-StockPlatform.ps1").write_text("launcher")
            (package / "启动股票交易平台.exe").write_text("launcher exe")
            (package / "release.json").write_text("{}")
            (web_root / "server.js").write_text("server")

            result = subprocess.run(
                [
                    sys.executable,
                    str(VERIFIER),
                    "--package",
                    str(package),
                    "--platform",
                    "windows-x64",
                ],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("web/apps/web/server.js", result.stdout)


if __name__ == "__main__":
    unittest.main()
