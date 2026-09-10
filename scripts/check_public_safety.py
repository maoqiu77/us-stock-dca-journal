from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKIP_FILES = {
    "scripts/check_public_safety.py",
    "scripts/import_legacy_private_data.py",
}
BLOCKED_PATH_PARTS = {
    "storage/local",
    "apps/mobile/native-artifacts/",
    "apps/mobile/.expo/",
    "apps/mobile/ios/",
    "apps/mobile/android/",
    ".keystore",
    ".jks",
    ".p12",
    ".mobileprovision",
    ".env",
}
SECRET_PATTERNS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*=\s*['\"][^'\"]{8,}['\"]"),
    re.compile(r"(?i)(broker|account|portfolio|持仓|成交|资金).*\.csv"),
]
SKIP_DIRS = {
    ".git",
    ".next",
    "node_modules",
    "__pycache__",
    ".venv",
}
SKIP_PATH_PREFIXES = {
    "storage/local/",
}


def candidate_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        return [ROOT / line for line in result.stdout.splitlines() if line]
    return iter_files()


def iter_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if path.is_dir():
            continue
        rel = path.relative_to(ROOT)
        rel_posix = rel.as_posix()
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if any(rel_posix.startswith(prefix) for prefix in SKIP_PATH_PREFIXES):
            continue
        files.append(path)
    return files


def main() -> int:
    failures: list[str] = []
    for path in candidate_files():
        if not path.exists():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if rel in SKIP_FILES:
            continue

        if any(part in rel for part in BLOCKED_PATH_PARTS) and not rel.endswith(".env.example"):
            failures.append(f"blocked path: {rel}")
            continue

        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                failures.append(f"possible secret/private data: {rel}")
                break

    if failures:
        print("Public safety check failed:")
        for item in failures:
            print(f"- {item}")
        return 1

    print("Public safety check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
