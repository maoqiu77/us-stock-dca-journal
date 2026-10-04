"""Verify a packaged desktop candidate and reject private runtime data."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from pathlib import PurePosixPath
import tempfile
import zipfile

from verify_release_bundle_layout import verify_release_bundle


PRIVATE_PARTS = ("storage/local/", ".env", ".db", ".sqlite", "cookies")
SIGNATURE_STATUSES = {"signed", "unsigned_external_required"}


def verify(package: Path, platform: str, *, require_signed: bool = False) -> dict:
    with tempfile.TemporaryDirectory(prefix="release-artifact-") as temp:
        root = Path(temp) / "bundle"
        archive_names: list[str] = []
        if package.is_file() and package.suffix.lower() == ".zip":
            with zipfile.ZipFile(package) as archive:
                archive_names = archive.namelist()
                for name in archive_names:
                    if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts:
                        raise ValueError(f"path traversal in archive: {name}")
                    if any(part in name.lower() for part in PRIVATE_PARTS):
                        raise ValueError(f"private runtime path in archive: {name}")
                archive.extractall(root)
            children = list(root.iterdir())
            package_dir = children[0] if len(children) == 1 and children[0].is_dir() else root
        else:
            package_dir = package.resolve()
        valid, message = verify_release_bundle(package_dir, platform)
        if not valid:
            raise ValueError(message)
        metadata = json.loads((package_dir / "release.json").read_text(encoding="utf-8"))
        if metadata.get("platform") != platform:
            raise ValueError(f"release.json platform mismatch: {metadata.get('platform')} != {platform}")
        if metadata.get("runtimeMode") != "base" or metadata.get("agentIncluded") is not False:
            raise ValueError("desktop candidates must declare the base runtime without Agent dependencies")
        if metadata.get("signatureStatus") not in SIGNATURE_STATUSES:
            raise ValueError("release.json must declare signed or unsigned_external_required")
        if require_signed and metadata["signatureStatus"] != "signed":
            raise ValueError("release candidate is unsigned; configure external signing before a tagged release")
        return {
            "platform": platform,
            "version": metadata.get("version"),
            "signatureStatus": metadata.get("signatureStatus", "unsigned_external_required"),
            "layout": message,
            "archiveEntries": len(archive_names),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--require-signed", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.package, args.platform, require_signed=args.require_signed), ensure_ascii=False, sort_keys=True))
    except (OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        parser.exit(1, f"release artifact verification failed: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
