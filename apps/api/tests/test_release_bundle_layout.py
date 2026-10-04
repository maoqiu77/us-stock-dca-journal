from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import json
from pathlib import Path
import zipfile


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

    def test_windows_launcher_hides_api_and_web_child_windows(self) -> None:
        windows = WINDOWS_LAUNCHER.read_text(encoding="utf-8")

        child_process_lines = [
            line
            for line in windows.splitlines()
            if "$apiProcess = Start-Process" in line
            or "$webProcess = Start-Process" in line
        ]

        self.assertEqual(len(child_process_lines), 4)
        for line in child_process_lines:
            self.assertIn("-WindowStyle Hidden", line)
            self.assertNotIn("-WindowStyle Minimized", line)

    def test_release_workflow_verifies_each_assembled_package(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

        self.assertEqual(workflow.count("scripts/verify_release_bundle_layout.py"), 2)
        self.assertIn("scripts/verify_release_artifact.py", workflow)
        self.assertIn("-VerifyOnly", workflow)
        self.assertIn("--verify-only", workflow)
        self.assertIn("signatureStatus", workflow)

    def test_update_helpers_have_non_mutating_verification_modes(self) -> None:
        windows = (ROOT / "scripts/windows/Install-Update.ps1").read_text(encoding="utf-8")
        macos = (ROOT / "scripts/macos/install-update.sh").read_text(encoding="utf-8")
        self.assertIn("[switch]$VerifyOnly", windows)
        self.assertIn("Verify-Package", windows)
        self.assertIn("--verify-only", macos)
        self.assertIn("release.json", macos)

    def test_verifier_accepts_nested_windows_standalone_layout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / "stock-platform"
            web_root = package / "web" / "apps" / "web"
            (package / "api").mkdir(parents=True)
            (package / "runtime" / "node").mkdir(parents=True)
            (package / "updater").mkdir(parents=True)
            (web_root / ".next" / "static").mkdir(parents=True)
            (web_root / "public").mkdir()
            (web_root / ".next" / "static" / "placeholder.js").write_text("static")
            (web_root / "public" / "placeholder.txt").write_text("public")
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

    def test_release_artifact_verifier_accepts_candidate_and_rejects_private_runtime(self) -> None:
        artifact = ROOT / "scripts" / "verify_release_artifact.py"
        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / "stock-platform"
            web_root = package / "web" / "apps" / "web"
            (package / "api").mkdir(parents=True)
            (package / "runtime" / "node").mkdir(parents=True)
            (package / "updater").mkdir()
            (web_root / ".next" / "static").mkdir(parents=True)
            (web_root / "public").mkdir()
            (web_root / ".next" / "static" / "placeholder.js").write_text("static")
            (web_root / "public" / "placeholder.txt").write_text("public")
            (package / "api" / "stock-platform-api.exe").write_text("api")
            (package / "runtime" / "node" / "node.exe").write_text("node")
            (package / "updater" / "Install-Update.ps1").write_text("updater")
            (package / "Start-StockPlatform.ps1").write_text("launcher")
            (package / "启动股票交易平台.exe").write_text("launcher exe")
            (package / "release.json").write_text(json.dumps({"platform": "windows-x64", "runtimeMode": "base", "agentIncluded": False, "signatureStatus": "unsigned_external_required"}))
            (web_root / "server.js").write_text("server")

            def make_zip(path: Path) -> None:
                with zipfile.ZipFile(path, "w") as zipped:
                    for item in package.rglob("*"):
                        if item.is_file():
                            zipped.write(item, item.relative_to(Path(tmp)).as_posix())

            archive = Path(tmp) / "candidate.zip"
            make_zip(archive)
            result = subprocess.run([sys.executable, str(artifact), "--package", str(archive), "--platform", "windows-x64"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([sys.executable, str(artifact), "--package", str(archive), "--platform", "windows-x64", "--require-signed"], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            (package / "storage" / "local").mkdir(parents=True)
            (package / "storage" / "local" / "private.db").write_text("private")
            make_zip(archive)
            result = subprocess.run([sys.executable, str(artifact), "--package", str(archive), "--platform", "windows-x64"], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
