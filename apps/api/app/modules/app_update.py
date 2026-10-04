from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import threading
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from fastapi import HTTPException

from app.core import settings


DEFAULT_UPDATE_REPO = "maoqiu77/stock-trading-platform-next"
GITHUB_API_ACCEPT = "application/vnd.github+json"
UPDATE_TIMEOUT_SECONDS = 20
DOWNLOAD_TIMEOUT_SECONDS = 60
BEIJING_TZ = ZoneInfo("Asia/Shanghai")
VERSION_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9._-]+)?$")
BACKUP_EXCLUDED_DIRS = {"updates", "backups", "pids"}


@dataclass(frozen=True)
class RuntimeInfo:
    install_root: Path
    data_home: Path
    version: str
    platform_id: str
    repo: str
    is_packaged: bool


UPDATE_STATUS_LOCK = threading.Lock()
UPDATE_STATUS: dict[str, Any] = {
    "phase": "idle",
    "message": "未开始更新。",
    "currentVersion": "",
    "latestVersion": "",
    "assetName": "",
    "downloadedBytes": 0,
    "totalBytes": 0,
    "backupPath": "",
    "error": "",
    "updatedAt": "",
}


def get_update_status() -> dict[str, Any]:
    with UPDATE_STATUS_LOCK:
        return dict(UPDATE_STATUS)


def check_for_update() -> dict[str, Any]:
    runtime = get_runtime_info()
    release = fetch_latest_release(runtime.repo)
    return build_update_check_response(runtime, release)


def start_update(local_storage_snapshot: dict[str, str] | None = None) -> dict[str, Any]:
    runtime = get_runtime_info()
    if not runtime.is_packaged and os.getenv("STOCK_APP_UPDATE_ALLOW_DEV") != "1":
        raise HTTPException(
            status_code=400,
            detail="源码开发环境不支持一键替换安装包。请使用 Release 压缩包启动后再更新。",
        )

    check = check_for_update()
    if not check["updateAvailable"]:
        raise HTTPException(status_code=400, detail="当前已经是最新版。")
    if not check.get("canInstall"):
        raise HTTPException(status_code=400, detail=str(check.get("message", "无法安装更新。")))

    asset = check.get("asset") or {}
    download_url = str(asset.get("downloadUrl", "")).strip()
    digest = str(asset.get("digest", "")).strip()
    asset_name = str(asset.get("name", "")).strip()
    total_bytes = int(asset.get("size") or 0)
    latest_version = str(check.get("latestVersion") or "")
    if not download_url or not asset_name:
        raise HTTPException(status_code=502, detail="新版 Release 缺少可下载资产。")
    expected_digest = parse_sha256_digest(digest)
    if not expected_digest:
        raise HTTPException(status_code=502, detail="新版安装包缺少 sha256 校验值，已停止自动更新。")

    timestamp = timestamp_for_file()
    work_dir = runtime.data_home / "updates" / f"{latest_version}-{timestamp}"
    work_dir.mkdir(parents=True, exist_ok=True)
    package_path = work_dir / asset_name
    status_log = work_dir / "update-runner.log"

    set_update_status(
        phase="downloading",
        message="正在下载新版安装包。",
        currentVersion=runtime.version,
        latestVersion=latest_version,
        assetName=asset_name,
        downloadedBytes=0,
        totalBytes=total_bytes,
        backupPath="",
        error="",
    )
    download_asset(download_url, package_path, total_bytes)

    set_update_status(phase="verifying", message="正在校验安装包完整性。")
    actual_digest = sha256_file(package_path)
    if actual_digest.lower() != expected_digest.lower():
        set_update_status(
            phase="error",
            message="安装包校验失败，旧版本和个人数据均已保留。",
            error="sha256 digest mismatch",
        )
        raise HTTPException(status_code=502, detail="新版安装包校验失败，已停止自动更新。")

    set_update_status(phase="backing-up", message="正在备份本地个人数据。")
    backup_path = create_local_backup(
        data_home=runtime.data_home,
        version=runtime.version,
        next_version=latest_version,
        local_storage_snapshot=local_storage_snapshot or {},
    )

    runner_path = copy_update_runner(runtime.install_root, runtime.platform_id, work_dir)
    command = build_updater_command(
        platform_id=runtime.platform_id,
        runner_path=runner_path,
        install_root=runtime.install_root,
        package_path=package_path,
        backup_path=backup_path,
        launcher_path=find_launcher(runtime.install_root, runtime.platform_id),
        api_pid=read_pid(runtime.data_home / "pids" / "api.pid"),
        web_pid=read_pid(runtime.data_home / "pids" / "web.pid"),
    )
    launch_update_runner(command, work_dir, status_log)
    set_update_status(
        phase="restarting",
        message="更新器已启动，应用会关闭并重新打开新版。",
        backupPath=str(backup_path),
    )
    return get_update_status()


def get_runtime_info() -> RuntimeInfo:
    install_root = resolve_install_root()
    data_home = settings.DATA_HOME
    release_metadata = read_json_file(install_root / "release.json")
    package_metadata = read_json_file(install_root / "package.json")
    version = str(
        release_metadata.get("version")
        or package_metadata.get("version")
        or os.getenv("STOCK_APP_VERSION")
        or "0.0.0"
    ).strip()
    platform_id = str(release_metadata.get("platform") or detect_platform_id()).strip()
    repo = str(
        os.getenv("STOCK_APP_UPDATE_REPO")
        or release_metadata.get("repo")
        or DEFAULT_UPDATE_REPO
    ).strip()
    return RuntimeInfo(
        install_root=install_root,
        data_home=data_home,
        version=version,
        platform_id=platform_id,
        repo=repo,
        is_packaged=bool(release_metadata),
    )


def resolve_install_root() -> Path:
    override = os.getenv("STOCK_APP_INSTALL_ROOT")
    if override:
        return Path(override).expanduser().resolve()

    data_home = settings.DATA_HOME.resolve()
    if data_home.name == "local" and data_home.parent.name == "storage":
        return data_home.parent.parent
    return settings.PROJECT_ROOT


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def detect_platform_id() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "windows":
        if machine in {"amd64", "x86_64"}:
            return "windows-x64"
    if system == "darwin":
        if machine in {"arm64", "aarch64"}:
            return "macos-arm64"
        if machine in {"x86_64", "amd64"}:
            return "macos-x64"
    return f"{system}-{machine}" if system and machine else "unknown"


def fetch_latest_release(repo: str) -> dict[str, Any]:
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    try:
        response = requests.get(
            url,
            headers={
                "Accept": GITHUB_API_ACCEPT,
                "User-Agent": "StockLab-Updater/1.0",
            },
            timeout=UPDATE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.exceptions.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"无法连接 GitHub Release：{exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="GitHub Release 返回格式无效。") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="GitHub Release 返回格式无效。")
    return payload


def build_update_check_response(runtime: RuntimeInfo, release: dict[str, Any]) -> dict[str, Any]:
    latest_version = str(release.get("tag_name") or release.get("name") or "").strip()
    html_url = str(release.get("html_url") or "").strip()
    is_prerelease = bool(release.get("prerelease"))
    is_draft = bool(release.get("draft"))
    selected_asset = select_release_asset(release, latest_version, runtime.platform_id)
    update_available = (
        bool(latest_version)
        and not is_prerelease
        and not is_draft
        and is_newer_version(latest_version, runtime.version)
    )
    asset_payload = asset_response(selected_asset)
    can_install = (
        update_available
        and runtime.is_packaged
        and bool(asset_payload)
        and bool(parse_sha256_digest(str(asset_payload.get("digest") or "")))
        and update_runner_exists(runtime.install_root, runtime.platform_id)
    )
    message = update_message(
        update_available=update_available,
        is_packaged=runtime.is_packaged,
        asset_payload=asset_payload,
        has_digest=bool(parse_sha256_digest(str(asset_payload.get("digest") or ""))) if asset_payload else False,
        has_runner=update_runner_exists(runtime.install_root, runtime.platform_id),
    )
    return {
        "currentVersion": normalize_display_version(runtime.version),
        "latestVersion": normalize_display_version(latest_version),
        "updateAvailable": update_available,
        "canInstall": can_install,
        "platform": runtime.platform_id,
        "repo": runtime.repo,
        "releaseUrl": html_url,
        "asset": asset_payload,
        "message": message,
    }


def select_release_asset(
    release: dict[str, Any],
    version: str,
    platform_id: str,
) -> dict[str, Any] | None:
    assets = release.get("assets")
    if not isinstance(assets, list):
        return None
    expected_name = f"stock-trading-platform-next-{version}-{platform_id}.zip"
    fallback_suffix = f"-{platform_id}.zip"
    fallback: dict[str, Any] | None = None
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name", ""))
        if name == expected_name:
            return asset
        if name.endswith(fallback_suffix):
            fallback = asset
    return fallback


def asset_response(asset: dict[str, Any] | None) -> dict[str, Any] | None:
    if not asset:
        return None
    return {
        "name": str(asset.get("name") or ""),
        "size": int(asset.get("size") or 0),
        "digest": str(asset.get("digest") or ""),
        "downloadUrl": str(asset.get("browser_download_url") or ""),
    }


def update_message(
    *,
    update_available: bool,
    is_packaged: bool,
    asset_payload: dict[str, Any] | None,
    has_digest: bool,
    has_runner: bool,
) -> str:
    if not update_available:
        return "当前已经是最新版。"
    if not asset_payload:
        return "发现新版本，但没有匹配当前系统的安装包。"
    if not has_digest:
        return "发现新版本，但安装包缺少 sha256 校验值，不能自动安装。"
    if not is_packaged:
        return "发现新版本。源码开发环境不支持一键替换安装包。"
    if not has_runner:
        return "发现新版本，但当前安装包缺少更新器。"
    return "发现新版本，可以一键更新。"


def is_newer_version(candidate: str, current: str) -> bool:
    candidate_parts = parse_version(candidate)
    current_parts = parse_version(current)
    if not candidate_parts or not current_parts:
        return False
    return candidate_parts > current_parts


def parse_version(value: str) -> tuple[int, int, int] | None:
    match = VERSION_PATTERN.match(str(value).strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def normalize_display_version(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    return value if value.startswith("v") else f"v{value}"


def parse_sha256_digest(value: str) -> str | None:
    prefix = "sha256:"
    digest = str(value or "").strip().lower()
    if not digest.startswith(prefix):
        return None
    hex_digest = digest[len(prefix) :]
    if len(hex_digest) != 64:
        return None
    if not all(char in "0123456789abcdef" for char in hex_digest):
        return None
    return hex_digest


def download_asset(url: str, package_path: Path, total_bytes: int) -> None:
    downloaded = 0
    try:
        with requests.get(
            url,
            headers={"User-Agent": "StockLab-Updater/1.0"},
            stream=True,
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
        ) as response:
            response.raise_for_status()
            with package_path.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    output.write(chunk)
                    downloaded += len(chunk)
                    set_update_status(downloadedBytes=downloaded, totalBytes=total_bytes)
    except requests.exceptions.RequestException as exc:
        set_update_status(
            phase="error",
            message="下载新版安装包失败，旧版本和个人数据均已保留。",
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail=f"下载新版安装包失败：{exc}") from exc


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as input_file:
        for block in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def create_local_backup(
    *,
    data_home: Path,
    version: str,
    next_version: str,
    local_storage_snapshot: dict[str, str],
) -> Path:
    backup_dir = data_home / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / (
        f"stock-platform-backup-{normalize_file_version(version)}-to-"
        f"{normalize_file_version(next_version)}-{timestamp_for_file()}.zip"
    )
    from app.modules.local_backup import create_backup
    db_path = settings.DB_PATH if data_home.resolve() == settings.DATA_HOME.resolve() else data_home / "app.db"
    return create_backup(data_home, db_path, backup_path, local_storage_snapshot)


def is_excluded_backup_path(data_home: Path, file_path: Path) -> bool:
    relative = file_path.relative_to(data_home)
    return bool(relative.parts and relative.parts[0] in BACKUP_EXCLUDED_DIRS)


def copy_update_runner(install_root: Path, platform_id: str, work_dir: Path) -> Path:
    source = update_runner_path(install_root, platform_id)
    if not source.exists():
        raise HTTPException(status_code=500, detail="当前安装包缺少更新器脚本。")
    runner_path = work_dir / source.name
    shutil.copy2(source, runner_path)
    if not platform_id.startswith("windows"):
        runner_path.chmod(runner_path.stat().st_mode | stat.S_IXUSR)
    return runner_path


def update_runner_exists(install_root: Path, platform_id: str) -> bool:
    return update_runner_path(install_root, platform_id).exists()


def update_runner_path(install_root: Path, platform_id: str) -> Path:
    if platform_id.startswith("windows"):
        return install_root / "updater" / "Install-Update.ps1"
    return install_root / "updater" / "install-update.sh"


def build_updater_command(
    *,
    platform_id: str,
    runner_path: Path,
    install_root: Path,
    package_path: Path,
    backup_path: Path,
    launcher_path: Path,
    api_pid: str,
    web_pid: str,
    dry_run: bool = False,
) -> list[str]:
    if platform_id.startswith("windows"):
        command = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(runner_path),
            "-InstallRoot",
            str(install_root),
            "-PackageZip",
            str(package_path),
            "-BackupZip",
            str(backup_path),
            "-LauncherPath",
            str(launcher_path),
            "-ApiPid",
            api_pid,
            "-WebPid",
            web_pid,
        ]
        if dry_run:
            command.append("-DryRun")
        return command

    command = [
        str(runner_path),
        "--install-root",
        str(install_root),
        "--package-zip",
        str(package_path),
        "--backup-zip",
        str(backup_path),
        "--launcher-path",
        str(launcher_path),
        "--api-pid",
        api_pid,
        "--web-pid",
        web_pid,
    ]
    if dry_run:
        command.append("--dry-run")
    return command


def launch_update_runner(command: list[str], work_dir: Path, status_log: Path) -> None:
    output = status_log.open("ab")
    try:
        kwargs: dict[str, Any] = {
            "cwd": work_dir,
            "stdout": output,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
        }
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen(command, **kwargs)
        output.close()
    except OSError as exc:
        output.close()
        set_update_status(
            phase="error",
            message="启动更新器失败，旧版本和个人数据均已保留。",
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=f"启动更新器失败：{exc}") from exc


def find_launcher(install_root: Path, platform_id: str) -> Path:
    if platform_id.startswith("windows"):
        exe = install_root / "启动股票交易平台.exe"
        if exe.exists():
            return exe
        return install_root / "Start-StockPlatform.ps1"
    return install_root / "启动股票交易平台.command"


def read_pid(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return value if value.isdigit() else ""


def set_update_status(**patch: Any) -> None:
    with UPDATE_STATUS_LOCK:
        UPDATE_STATUS.update(patch)
        UPDATE_STATUS["updatedAt"] = beijing_timestamp()


def timestamp_for_file() -> str:
    return datetime.now(tz=BEIJING_TZ).strftime("%Y%m%d-%H%M%S")


def beijing_timestamp() -> str:
    return datetime.now(tz=BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")


def normalize_file_version(value: str) -> str:
    return normalize_display_version(value).replace("/", "-").replace(":", "-")
