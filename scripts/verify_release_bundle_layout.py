from __future__ import annotations

import argparse
import sys
from pathlib import Path


def resolve_web_root(package_dir: Path) -> Path | None:
    for candidate in [package_dir / "web", package_dir / "web" / "apps" / "web"]:
        if (candidate / "server.js").is_file():
            return candidate
    return None


def required_paths(package_dir: Path, platform: str, web_root: Path) -> list[Path]:
    if platform.startswith("windows"):
        platform_paths = [
            package_dir / "api" / "stock-platform-api.exe",
            package_dir / "runtime" / "node" / "node.exe",
            package_dir / "启动股票交易平台.exe",
            package_dir / "Start-StockPlatform.ps1",
            package_dir / "updater" / "Install-Update.ps1",
        ]
    else:
        platform_paths = [
            package_dir / "api" / "stock-platform-api",
            package_dir / "runtime" / "node" / "node",
            package_dir / "启动股票交易平台.command",
            package_dir / "updater" / "install-update.sh",
        ]
    return [
        package_dir / "release.json",
        *platform_paths,
        web_root / "server.js",
        web_root / ".next" / "static",
        web_root / "public",
    ]


def verify_release_bundle(package_dir: Path, platform: str) -> tuple[bool, str]:
    web_root = resolve_web_root(package_dir)
    if web_root is None:
        return False, "missing web/server.js or web/apps/web/server.js"

    missing = [
        path.relative_to(package_dir).as_posix()
        for path in required_paths(package_dir, platform, web_root)
        if not path.exists()
    ]
    if missing:
        return False, f"missing required paths: {', '.join(missing)}"

    entry_point = (web_root / "server.js").relative_to(package_dir).as_posix()
    return True, f"release bundle layout verified: {entry_point}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify the files required to start a packaged release."
    )
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--platform", required=True)
    args = parser.parse_args()

    package_dir = args.package.resolve()
    valid, message = verify_release_bundle(package_dir, args.platform)
    output = sys.stdout if valid else sys.stderr
    print(message, file=output)
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
