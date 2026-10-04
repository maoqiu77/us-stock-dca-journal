"""Versioned, credential-free SQLite backups and offline, recoverable activation.

CLI: python -m app.modules.local_backup verify ARCHIVE --workspace NEW_DIRECTORY
     python -m app.modules.local_backup restore ARCHIVE --target DATA_HOME
Restore requires all API processes stopped; it never starts AI workers.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import tempfile
import uuid
import zipfile

from app.core.database import CURRENT_DB_SCHEMA_VERSION


@contextmanager
def runtime_lock(data_home: Path, *, exclusive=False):
    if (data_home.parent / ("." + data_home.name + ".restore-pending.json")).exists():
        raise ValueError("上次恢复未完成，禁止启动或写入；请先依据恢复标记找回原目录。")
    if os.name == "nt":
        if exclusive:
            raise ValueError("此离线目录切换工具目前仅支持 macOS/Linux；Windows 请在隔离目录验收后人工恢复。")
        yield
        return
    import fcntl
    data_home.parent.mkdir(parents=True, exist_ok=True)
    # Outside the directory that is switched, so the lock inode stays stable.
    with (data_home.parent / ("." + data_home.name + ".runtime.lock")).open("a") as lock:
        try:
            fcntl.flock(lock, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("运行服务占用此工作区，请先停止 API 后恢复。") from exc
        try:
            if (data_home.parent / ("." + data_home.name + ".restore-pending.json")).exists():
                raise ValueError("上次恢复未完成，禁止自动初始化新数据库。")
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def redact_settings(value):
    if isinstance(value, dict):
        return {key: ("" if any(part in key.lower().replace("_", "") for part in ("apikey", "secret", "password", "token", "cookie", "privatekey")) else redact_settings(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_settings(item) for item in value]
    return value


def validate_database(path: Path) -> dict:
    from app.modules.ledger_store import decode_state
    with sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True) as db:
        if db.execute("pragma integrity_check").fetchone()[0] != "ok":
            raise ValueError("数据库完整性检查失败")
        version = db.execute("pragma user_version").fetchone()[0]
        if version < 7 or version > CURRENT_DB_SCHEMA_VERSION:
            raise ValueError("备份数据库版本不受支持；保留原件，使用兼容版本迁移。")
        tables = {row[0] for row in db.execute("select name from sqlite_master where type='table'")}
        required = {"app_state", "ai_journal_notes", "ai_journal_turns", "ai_journal_sessions", "ai_journal_snapshots", "ai_journal_agent_runs", "ai_journal_agent_sources", "ai_journal_quant_links", "quant_analysis_runs"}
        if not required.issubset(tables):
            raise ValueError("备份缺少必要的数据表")
        if version >= 9:
            if not {'ai_journal_user_records', 'ai_journal_note_versions', 'ai_journal_note_dates'}.issubset(tables):
                raise ValueError('备份缺少判断、政策或手记版本')
            for record_id, in db.execute('select distinct id from ai_journal_user_records'):
                revisions = db.execute('select version,payload from ai_journal_user_records where id=? order by version', (record_id,)).fetchall()
                for expected, (revision, raw) in enumerate(revisions, 1):
                    value = json.loads(raw)
                    if revision != expected or value.get('version') != revision or value.get('id') != record_id or value.get('confirmed') is not True:
                        raise ValueError('判断/政策版本链无效')
                    # Missing original turns are explicitly represented on read; snapshots remain immutable.
                    source = value.get('source')
                    if source and not db.execute('select id from ai_journal_snapshots where id=?', (source['snapshot_id'],)).fetchone():
                        raise ValueError('判断缺少冻结快照')
        payload = db.execute("select payload from app_state where key='trading_data_v1'").fetchone()
        if payload:
            decode_state(payload[0])
        relations = [("ai_journal_turns", "session_id", "ai_journal_sessions"), ("ai_journal_turns", "snapshot_id", "ai_journal_snapshots"), ("ai_journal_agent_runs", "turn_id", "ai_journal_turns"), ("ai_journal_agent_runs", "snapshot_id", "ai_journal_snapshots"), ("ai_journal_agent_sources", "run_id", "ai_journal_agent_runs"), ("ai_journal_agent_events", "run_id", "ai_journal_agent_runs"), ("ai_journal_quant_links", "session_id", "ai_journal_sessions"), ("ai_journal_quant_links", "run_id", "quant_analysis_runs")]
        for child, field, parent in relations:
            if db.execute(f"select 1 from {child} c left join {parent} p on c.{field}=p.id where p.id is null limit 1").fetchone():
                raise ValueError(f"缺失关联来源：{child}.{field}")
        if db.execute("pragma foreign_key_check").fetchone():
            raise ValueError("外键关联检查失败")
        return {"schemaVersion": version, "tables": {name: db.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0] for name in sorted(tables)}}


def create_backup(data_home: Path, db_path: Path, destination: Path, browser_storage=None) -> Path:
    data_home, db_path, destination = data_home.resolve(), db_path.resolve(), destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with runtime_lock(data_home), tempfile.TemporaryDirectory(prefix="ledger-backup-") as tmp:
        snapshot = Path(tmp) / "app.db"
        # sqlite.backup takes a coherent snapshot, including committed WAL pages.
        with sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True) as source, sqlite3.connect(snapshot) as target:
            source.backup(target)
            for key in ("ai_settings_v1", "research_settings_v1"):
                row = target.execute("select payload from app_state where key=?", (key,)).fetchone()
                if row:
                    target.execute("update app_state set payload=? where key=?", (json.dumps(redact_settings(json.loads(row[0])), ensure_ascii=False), key))
            target.commit()
            target.execute("vacuum")  # Removed keys must not survive in free pages.
            target.execute("pragma wal_checkpoint(truncate)")
            target.execute("pragma journal_mode=delete")
        summary = validate_database(snapshot)
        files = {"app.db": snapshot.read_bytes()}
        if browser_storage:
            allowed = {key: value for key, value in browser_storage.items() if key.startswith("stock-platform-next.trading-data.v1") or key in {"stock-platform-active-view-v1", "stock-platform-onboarding-v1", "theme"}}
            files["browser-local-storage.json"] = json.dumps(allowed, ensure_ascii=False).encode()
        # Only known associated exports, never .env, arbitrary runtime files or keys.
        report_root = data_home / "quant-analysis"
        for path in sorted(report_root.rglob("*.json")) if report_root.exists() else []:
            if path.is_symlink() or report_root.is_symlink() or not path.resolve().is_relative_to(data_home):
                raise ValueError("关联文件不能是外部链接")
            before = path.stat()
            content = path.read_bytes()
            after = path.stat()
            if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                raise ValueError("关联文件正在写入，请稍后重新备份")
            json.loads(content)
            files[path.relative_to(data_home).as_posix()] = content
        manifest = {"format": "stock-local-backup", "version": 1, "createdAt": datetime.now(timezone.utc).isoformat(), **summary,
                    "credentials": "excluded", "associatedFiles": "quant-analysis JSON exports; database is authoritative", "files": {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}}
        with destination.open("xb") as output:
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for name, content in files.items():
                    archive.writestr(name, content)
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return destination


def prepare_restore(archive_path: Path, workspace: Path) -> dict:
    """Extract only inventoried data into a NEW workspace; never overwrite a ledger."""
    workspace = workspace.resolve()
    if workspace.exists():
        raise ValueError("隔离恢复目录必须尚不存在")
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or "manifest.json" not in names:
            raise ValueError("重复条目或缺少版本清单；旧热拷贝 ZIP 不可直接恢复")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("format") != "stock-local-backup" or manifest.get("version") != 1:
            raise ValueError("不支持此备份格式")
        expected = manifest.get("files", {})
        if "app.db" not in expected or set(names) != set(expected) | {"manifest.json"}:
            raise ValueError("备份清单不完整")
        if sum(info.file_size for info in archive.infolist()) > 1024**3:
            raise ValueError("备份超过 1 GiB，需人工恢复")
        contents = {}
        for name, digest in expected.items():
            path = Path(name)
            if path.is_absolute() or ".." in path.parts or (name not in {"app.db", "browser-local-storage.json"} and not (name.startswith("quant-analysis/") and name.endswith(".json"))):
                raise ValueError("非法备份路径")
            content = archive.read(name)
            if hashlib.sha256(content).hexdigest() != digest:
                raise ValueError("备份校验和不匹配")
            contents[name] = content
    workspace.mkdir(parents=True)
    for name, content in contents.items():
        path = workspace / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    summary = validate_database(workspace / "app.db")
    if summary != {key: manifest[key] for key in ("schemaVersion", "tables")}:
        raise ValueError("数据库与清单不一致")
    with sqlite3.connect(workspace / "app.db") as db:
        db.execute("update ai_journal_agent_runs set status='outcome_unknown',lease_token=null,lease_expires_at=null,error_code='restored_outcome_unknown' where status in ('queued','running','cancel_requested')")
        db.execute("update ai_journal_turns set status='outcome_unknown',error_code='restored_outcome_unknown' where status in ('queued','running','pending','sending','cancel_requested')")
        db.execute("update quant_analysis_runs set status='interrupted',error_code='restored_outcome_unknown' where status in ('queued','running','cancel_requested')")
        if summary["schemaVersion"] >= 8:
            # A restore is a new history: old clients and receipts cannot authorize writes.
            db.execute("update ledger_revision set revision=lower(hex(randomblob(16)))")
            db.execute("delete from ledger_receipts")
    validate_database(workspace / "app.db")
    (workspace / "restore-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    return summary


def restore_backup(archive: Path, target: Path) -> Path:
    target = target.resolve()
    if target == Path.home() or target == Path("/") or not (target / "app.db").is_file():
        raise ValueError("目标必须是已有 app.db 的专用数据目录")
    # Also refuses a pre-upgrade canonical runtime that does not yet hold our lock.
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 8000)) == 0:
            raise ValueError("请先停止 canonical 8000 服务后恢复；此工具不会停止服务。")
    with runtime_lock(target, exclusive=True):
        staged = target.parent / (target.name + ".restore-" + uuid.uuid4().hex)
        prepare_restore(archive, staged)
        restore_point = target.parent / (target.name + ".before-restore-" + uuid.uuid4().hex)
        marker = target.parent / ("." + target.name + ".restore-pending.json")
        with marker.open("x") as journal:
            json.dump({"target": str(target), "restorePoint": str(restore_point), "staged": str(staged)}, journal)
            journal.flush()
            os.fsync(journal.fileno())
        # No active writer; whole workspace moves together, retaining the raw old copy.
        try:
            os.replace(target, restore_point)
            os.replace(staged, target)
        except BaseException:
            if restore_point.exists():
                os.replace(restore_point, target)
            marker.unlink()
            raise
        marker.unlink()
    return restore_point


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("verify", "restore"))
    parser.add_argument("archive", type=Path)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--target", type=Path)
    args = parser.parse_args()
    if args.action == "verify" and args.workspace:
        print(json.dumps(prepare_restore(args.archive, args.workspace), ensure_ascii=False))
    elif args.action == "restore" and args.target:
        print("恢复完成；原工作区保留在：", restore_backup(args.archive, args.target))
    else:
        parser.error("verify 需要 --workspace；restore 需要 --target")


if __name__ == "__main__":
    main()
