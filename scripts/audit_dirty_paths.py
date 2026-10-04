"""Audit the current worktree without changing, staging, or hiding any file."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PRIVATE_MARKERS = (
    "storage/local/",
    ".env",
    ".db",
    ".sqlite",
    "cookies",
    "api-key",
    "apikey",
)


def entries(root: Path = ROOT) -> list[dict[str, str]]:
    output = subprocess.check_output(
        ["git", "-C", str(root), "-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=normal"],
        text=True,
    )
    result = []
    for line in output.splitlines():
        if not line:
            continue
        status, path = line[:2], line[3:]
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[-1]
        result.append({"status": status, "path": path})
    return result


def category(path: str) -> str:
    if path.startswith(".github/"):
        return "ci"
    if path.startswith("apps/api/"):
        return "api"
    if path.startswith("apps/web/"):
        return "web"
    if path.startswith("apps/"):
        return "other-app"
    if path.startswith("scripts/"):
        return "scripts"
    if path.startswith("contracts/"):
        return "contracts"
    if path.startswith("优化/") or path.startswith("docs/"):
        return "docs"
    return "root"


def audit(root: Path = ROOT) -> dict:
    rows = entries(root)
    private = [row["path"] for row in rows if any(marker in row["path"].lower() for marker in PRIVATE_MARKERS)]
    grouped: dict[str, int] = {}
    statuses: dict[str, int] = {}
    for row in rows:
        grouped[category(row["path"])] = grouped.get(category(row["path"]), 0) + 1
        statuses[row["status"]] = statuses.get(row["status"], 0) + 1
    return {
        "root": str(root),
        "total": len(rows),
        "candidate": not private,
        "private_markers": private,
        "by_category": dict(sorted(grouped.items())),
        "by_status": dict(sorted(statuses.items())),
        "paths": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect", type=int, default=None, help="fail if the dirty path count differs")
    parser.add_argument("--json", action="store_true", help="emit the complete machine-readable audit")
    args = parser.parse_args()
    report = audit()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"dirty_paths={report['total']} candidate={report['candidate']}")
        print("by_category=" + json.dumps(report["by_category"], ensure_ascii=False, sort_keys=True))
        print("by_status=" + json.dumps(report["by_status"], ensure_ascii=False, sort_keys=True))
        if report["private_markers"]:
            print("private_markers=" + json.dumps(report["private_markers"], ensure_ascii=False))
    if args.expect is not None and report["total"] != args.expect:
        return 1
    return 0 if report["candidate"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
