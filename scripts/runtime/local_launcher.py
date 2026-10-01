"""Supervise only services created by the repository's local development launcher."""
from __future__ import annotations

import fcntl
import importlib
import importlib.metadata as metadata
import os
from pathlib import Path
import select
import shlex
import shutil
import signal
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / "storage/local/agent-dev-venv/bin/python"
URLS = {"api": "http://127.0.0.1:8000/health", "web": "http://127.0.0.1:3000/"}
PORTS = {"api": 8000, "web": 3000}
STOP_SIGNAL = None


class LauncherError(Exception):
    pass


def validate_environment():
    if sys.version_info[:2] != (3, 12) or Path(sys.prefix) != PYTHON.parent.parent:
        raise LauncherError("启动器需要 storage/local/agent-dev-venv 的 Python 3.12。")
    try:
        from packaging.requirements import Requirement

        for line in (ROOT / "apps/api/requirements-agent.lock").read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            requirement = Requirement(line)
            if requirement.marker and not requirement.marker.evaluate():
                continue
            if metadata.version(requirement.name) not in requirement.specifier:
                raise LauncherError(f"Agent 锁定依赖版本不匹配：{requirement.name}")
        # Check installed dependency constraints as well as the tested lock.
        for distribution in metadata.distributions():
            for value in distribution.requires or []:
                requirement = Requirement(value)
                if requirement.marker and not requirement.marker.evaluate({"extra": ""}):
                    continue
                if metadata.version(requirement.name) not in requirement.specifier:
                    raise LauncherError(f"Agent 依赖不兼容：{distribution.metadata['Name']} / {requirement.name}")
        for module in ("langgraph.graph", "langchain_openai", "fastapi", "uvicorn", "yaml", "pandas", "yfinance", "openai"):
            importlib.import_module(module)
    except LauncherError:
        raise
    except Exception as exc:
        raise LauncherError(f"Agent 环境缺少依赖或无法导入（{type(exc).__name__}）。") from None
    for tool in ("node", "npm", "lsof", "ps"):
        if not shutil.which(tool):
            raise LauncherError(f"没有找到 {tool}。")
    if not (ROOT / "node_modules/next").is_dir():
        raise LauncherError("网页依赖缺失，请先在项目根目录运行 npm ci。")


def output(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=5).stdout.strip()


def listener_pids(port):
    return {int(value) for value in output(["lsof", "-nP", f"-tiTCP:{port}", "-sTCP:LISTEN"]).split()}


def process_cwd(pid):
    for line in output(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"]).splitlines():
        if line.startswith("n"):
            return Path(line[1:])
    return None


def project_listener(pid, service):
    expected_cwd = ROOT if service == "api" else ROOT / "apps/web"
    if process_cwd(pid) != expected_cwd:
        return False
    # Uvicorn reload and Next have listener children; verify an actual ancestor command.
    for _ in range(8):
        row = output(["ps", "-p", str(pid), "-o", "ppid=,command="]).split(maxsplit=1)
        if len(row) != 2:
            return False
        try:
            args = shlex.split(row[1])
        except ValueError:
            return False
        if service == "api":
            if args[:4] == [str(PYTHON), "-m", "uvicorn", "app.main:app"]:
                return process_cwd(pid) == ROOT and "--port" in args and args[args.index("--port") + 1] == "8000"
        else:
            next_paths = {str(ROOT / "node_modules/.bin/next"), str(ROOT / "apps/web/node_modules/.bin/next")}
            if any(arg in next_paths for arg in args) and "dev" in args and "--port" in args:
                return process_cwd(pid) == expected_cwd and args[args.index("--port") + 1] == "3000"
        pid = int(row[0])
        if pid <= 1:
            break
    return False


def healthy(service):
    try:
        with build_opener(ProxyHandler({})).open(URLS[service], timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def live_group(pgid):
    # macOS may report EPERM for a group containing only unreaped orphan zombies.
    for line in output(["ps", "-ax", "-o", "pgid=,stat="]).splitlines():
        row = line.split()
        if len(row) == 2 and row[0] == str(pgid) and not row[1].startswith("Z"):
            return True
    return False


def reusable(service):
    pids = listener_pids(PORTS[service])
    if not pids:
        return False
    if not all(project_listener(pid, service) for pid in pids):
        raise LauncherError(f"端口 {PORTS[service]} 的进程归属或环境不匹配（PID：{sorted(pids)}）；请核对后手动处理。")
    if not healthy(service):
        raise LauncherError(f"本项目端口 {PORTS[service]} 未就绪；请检查日志和在途任务后手动处理。")
    print(f"复用本项目 {service} 服务（{PORTS[service]}）。", flush=True)
    return True


class Supervisor:
    def __init__(self):
        self.owned = {}
        self.identities = {}
        self.pid_dir = ROOT / "storage/local/pids"

    def start(self, service):
        check_interruption()
        if reusable(service):
            return
        env = {**os.environ, "STOCK_APP_INSTALL_ROOT": str(ROOT),
               "STOCK_APP_DATA_HOME": str(ROOT / "storage/local"),
               "STOCK_APP_DB_PATH": str(ROOT / "storage/local/app.db"),
               "STOCK_APP_TEMPLATE_HOME": str(ROOT / "storage/templates"),
               "BACKEND_API_URL": "http://127.0.0.1:8000"}
        if service == "api":
            args = [str(PYTHON), "-m", "uvicorn", "app.main:app", "--reload", "--reload-dir",
                    "apps/api", "--app-dir", "apps/api", "--host", "127.0.0.1", "--port", "8000"]
        else:
            args = ["npm", "--prefix", "apps/web", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"]
        self.pid_dir.mkdir(parents=True, exist_ok=True)
        with (ROOT / f"storage/local/{service}.log").open("ab") as log:
            child = subprocess.Popen(args, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                     stdout=log, stderr=log, start_new_session=True)
        self.owned[service] = child
        self.identities[service] = output(["ps", "-p", str(child.pid), "-o", "lstart="])
        check_interruption()
        (self.pid_dir / f"{service}.pid").write_text(str(child.pid))
        print(f"启动 {service}（PID：{child.pid}）。", flush=True)

    def check_children(self):
        check_interruption()
        for service, child in self.owned.items():
            if child.poll() is not None:
                raise LauncherError(f"{service} 服务异常退出，请查看 storage/local/{service}.log。")

    def cleanup(self):
        # Dedicated groups include reload/npm children. Reused services never enter owned.
        groups = []
        for service, child in self.owned.items():
            birth = self.identities.get(service)
            current = output(["ps", "-p", str(child.pid), "-o", "lstart="])
            if birth and current and current != birth:
                print(f"{service} PID 已被其他进程复用，跳过停止。", flush=True)
                continue
            if live_group(child.pid):
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    groups.append(child.pid)
                except ProcessLookupError:
                    pass
            pid_file = self.pid_dir / f"{service}.pid"
            if pid_file.exists() and pid_file.read_text() == str(child.pid):
                pid_file.unlink()
        deadline = time.monotonic() + 8
        while groups and time.monotonic() < deadline:
            for child in self.owned.values():
                child.poll()
            groups = [pgid for pgid in groups if live_group(pgid)]
            if groups:
                time.sleep(0.1)
        for pgid in groups:
            if live_group(pgid):
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for child in self.owned.values():
            child.wait()


def interrupted(signum, _frame):
    # Defer exit until a newly spawned child is registered for cleanup.
    global STOP_SIGNAL
    STOP_SIGNAL = signum


def check_interruption():
    if STOP_SIGNAL:
        raise SystemExit(128 + STOP_SIGNAL)


def main():
    supervisor = Supervisor()
    lock = None
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupted)
    try:
        print(f"正在启动股票交易平台：{ROOT}", flush=True)
        validate_environment()
        check_interruption()
        print(f"Agent Python：{sys.version.split()[0]}；依赖校验通过。", flush=True)
        supervisor.pid_dir.mkdir(parents=True, exist_ok=True)
        lock = (supervisor.pid_dir / "launcher.lock").open("a")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise LauncherError("另一个启动器正在启动服务，请稍后重试。") from None
        reuse = {service: reusable(service) for service in URLS}
        for service in URLS:
            if not reuse[service]:
                supervisor.start(service)
        deadline = time.monotonic() + 90
        while True:
            supervisor.check_children()
            if all(healthy(service) for service in URLS):
                if not all(listener_pids(PORTS[service]) and
                           all(project_listener(pid, service) for pid in listener_pids(PORTS[service]))
                           for service in URLS):
                    raise LauncherError("启动期间端口归属发生变化，请核对进程。")
                break
            if time.monotonic() >= deadline:
                raise LauncherError("启动超时，请查看 storage/local/api.log 和 web.log。")
            time.sleep(0.25)
        lock.close()
        lock = None
        print(f"启动完成：{URLS['web']}", flush=True)
        subprocess.run(["open", URLS["web"]], check=False)
        if not supervisor.owned:
            return 0
        print("使用期间请不要关闭这个窗口。按 Enter 关闭本窗口启动的服务并退出。", flush=True)
        while True:
            supervisor.check_children()
            if select.select([sys.stdin], [], [], 0.25)[0]:
                sys.stdin.readline()
                return 0
    except (LauncherError, OSError, subprocess.SubprocessError) as exc:
        print(str(exc), flush=True)
        print("不会修改旧 .venv 或自动安装依赖。环境修复步骤见 docs/implementation/ai-journal-agent/RUNTIME_PY312.md。", flush=True)
        return 1
    finally:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, signal.SIG_IGN)
        supervisor.cleanup()
        if lock:
            lock.close()


if __name__ == "__main__":
    result = main()
    if result and sys.stdin.isatty():
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, signal.SIG_DFL)
        input("按 Enter 退出。")
    raise SystemExit(result)
