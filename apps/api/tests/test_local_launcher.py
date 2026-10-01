from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("local_launcher", ROOT / "scripts/runtime/local_launcher.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_wrong_python_fails_before_services(self):
        with patch.object(launcher.sys, "version_info", (3, 9)), self.assertRaisesRegex(launcher.LauncherError, "Python 3.12"):
            launcher.validate_environment()

    def test_lock_mismatch_is_explicit(self):
        with patch.object(launcher.sys, "version_info", (3, 12)), patch.object(launcher.sys, "prefix", str(launcher.PYTHON.parent.parent)), patch.object(launcher.metadata, "version", return_value="0.0.0"):
            with self.assertRaisesRegex(launcher.LauncherError, "锁定依赖版本不匹配"):
                launcher.validate_environment()

    def test_missing_package_is_explicit(self):
        with patch.object(launcher.sys, "version_info", (3, 12)), patch.object(launcher.sys, "prefix", str(launcher.PYTHON.parent.parent)), patch.object(launcher.metadata, "version", side_effect=launcher.metadata.PackageNotFoundError("synthetic")):
            with self.assertRaisesRegex(launcher.LauncherError, "缺少依赖"):
                launcher.validate_environment()

    def test_foreign_port_never_uses_health_as_ownership(self):
        with patch.object(launcher, "listener_pids", return_value={123}), patch.object(launcher, "project_listener", return_value=False), patch.object(launcher, "healthy") as health:
            with self.assertRaisesRegex(launcher.LauncherError, "归属或环境不匹配"):
                launcher.reusable("api")
            health.assert_not_called()

    def test_unhealthy_project_is_not_stopped(self):
        with patch.object(launcher, "listener_pids", return_value={123}), patch.object(launcher, "project_listener", return_value=True), patch.object(launcher, "healthy", return_value=False), patch.object(launcher.os, "killpg") as kill:
            with self.assertRaisesRegex(launcher.LauncherError, "未就绪"):
                launcher.reusable("api")
            kill.assert_not_called()

    def test_similar_cwd_prefix_is_not_this_project(self):
        with patch.object(launcher, "process_cwd", return_value=Path(str(ROOT) + "-other")):
            self.assertFalse(launcher.project_listener(123, "api"))

    def test_reload_child_requires_verified_python_ancestor(self):
        rows = ["123 python -c spawn_main", f"1 {launcher.PYTHON} -m uvicorn app.main:app --port 8000"]
        with patch.object(launcher, "process_cwd", return_value=ROOT), patch.object(launcher, "output", side_effect=rows):
            self.assertTrue(launcher.project_listener(124, "api"))
        with patch.object(launcher, "process_cwd", return_value=ROOT), patch.object(launcher, "output", return_value=f"1 {ROOT}/.venv/bin/python -m uvicorn app.main:app --port 8000"):
            self.assertFalse(launcher.project_listener(123, "api"))

    def test_reuse_preserves_pid_files_and_signals_no_process(self):
        with tempfile.TemporaryDirectory() as directory:
            supervisor = launcher.Supervisor()
            supervisor.pid_dir = Path(directory)
            pid_file = supervisor.pid_dir / "api.pid"
            pid_file.write_text("123")
            with patch.object(launcher, "reusable", return_value=True), patch.object(launcher.os, "killpg") as kill:
                supervisor.start("api")
                supervisor.cleanup()
                kill.assert_not_called()
            self.assertEqual(pid_file.read_text(), "123")

    def test_partial_start_sets_original_database_and_dedicated_group(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, "ROOT", Path(directory)), patch.object(launcher, "reusable", return_value=False), patch.object(launcher, "output", return_value="synthetic birth"), patch.object(launcher.subprocess, "Popen") as spawn:
            supervisor = launcher.Supervisor()
            spawn.return_value.pid = 123
            supervisor.start("api")
            self.assertEqual(spawn.call_args.args[0][0], str(launcher.PYTHON))
            self.assertTrue(spawn.call_args.kwargs["start_new_session"])
            self.assertEqual(spawn.call_args.kwargs["env"]["STOCK_APP_DB_PATH"], str(Path(directory) / "storage/local/app.db"))
            self.assertEqual(set(supervisor.owned), {"api"})

    def test_abnormal_parent_exit_cleans_remaining_group_child(self):
        with tempfile.TemporaryDirectory() as directory:
            child_file = Path(directory) / "child.pid"
            code = "import subprocess,sys; from pathlib import Path; child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); Path(sys.argv[1]).write_text(str(child.pid))"
            parent = subprocess.Popen([sys.executable, "-c", code, str(child_file)], start_new_session=True)
            supervisor = launcher.Supervisor()
            supervisor.pid_dir = Path(directory)
            supervisor.owned["api"] = parent
            supervisor.pid_dir.joinpath("api.pid").write_text(str(parent.pid))
            try:
                parent.wait(timeout=5)
                descendant = int(child_file.read_text())
                with self.assertRaisesRegex(launcher.LauncherError, "异常退出"):
                    supervisor.check_children()
                supervisor.cleanup()
                row = launcher.output(["ps", "-p", str(descendant), "-o", "stat="])
                self.assertTrue(not row or row.startswith("Z"), row)
                self.assertFalse(supervisor.pid_dir.joinpath("api.pid").exists())
            finally:
                if launcher.live_group(parent.pid):
                    try:
                        os.killpg(parent.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_signal_arriving_during_spawn_is_cleaned(self):
        def spawn(*args, **kwargs):
            launcher.interrupted(signal.SIGTERM, None)
            return subprocess_mock

        from unittest.mock import Mock
        subprocess_mock = Mock(pid=123)
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, "ROOT", Path(directory)), patch.object(launcher, "reusable", return_value=False), patch.object(launcher, "output", return_value="synthetic birth"), patch.object(launcher.subprocess, "Popen", side_effect=spawn):
            supervisor = launcher.Supervisor()
            try:
                with self.assertRaises(SystemExit):
                    supervisor.start("api")
                self.assertEqual(supervisor.owned["api"].pid, 123)
            finally:
                launcher.STOP_SIGNAL = None

    def test_recycled_pid_is_never_signalled(self):
        from unittest.mock import Mock
        supervisor = launcher.Supervisor()
        supervisor.owned["api"] = Mock(pid=123)
        supervisor.identities["api"] = "original start"
        with patch.object(launcher, "output", return_value="different start"), patch.object(launcher.os, "killpg") as kill:
            supervisor.cleanup()
            kill.assert_not_called()

    def test_missing_environment_shell_exit_preserves_legacy_venv(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / ".venv"
            legacy.mkdir()
            marker = legacy / "untouched"
            marker.write_text("legacy")
            script = (ROOT / "一键打开股票交易平台.command").read_text()
            result = subprocess.run(["bash", "-c", script, str(Path(directory) / "launcher.command")],
                                    input="", text=True, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertIn("没有找到 Agent Python 3.12 环境", result.stdout)
            self.assertEqual(marker.read_text(), "legacy")
            self.assertFalse(Path(directory, "storage/local/agent-dev-venv").exists())


if __name__ == "__main__":
    unittest.main()
