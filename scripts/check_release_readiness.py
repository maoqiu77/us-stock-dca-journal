from __future__ import annotations

import sys
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLIENT_API_FILES = [
    ROOT / "apps/web/src/features/charts/api.ts",
    ROOT / "apps/web/src/features/platform/api.ts",
    ROOT / "apps/web/src/features/quant-analysis/api.ts",
]
NEXT_CONFIG = ROOT / "apps/web/next.config.ts"
RELEASE_WORKFLOW = ROOT / ".github/workflows/build-release-packages.yml"
MACOS_LAUNCHER = ROOT / "scripts/macos/Start-StockPlatform.command"
WINDOWS_LAUNCHER = ROOT / "scripts/windows/Start-StockPlatform.ps1"


def main() -> int:
    failures: list[str] = []

    for path in CLIENT_API_FILES:
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        text_without_ai_direct_base = re.sub(
            r"const AI_REQUEST_BASE_URL[\s\S]*?;",
            "",
            text,
        )
        if "http://127.0.0.1:8000" in text_without_ai_direct_base or "http://localhost:8000" in text_without_ai_direct_base:
            failures.append(f"{rel} defaults to a loopback API URL")
        normalized = " ".join(text.split())
        if '?? "";' not in normalized:
            failures.append(f"{rel} does not default to same-origin API requests")

    next_config = NEXT_CONFIG.read_text(encoding="utf-8")
    required_snippets = [
        'output: "standalone"',
        "async rewrites()",
        "process.env.BACKEND_API_URL",
        "source: \"/api/:path*\"",
        "destination: `${backendApiUrl}/api/:path*`",
    ]
    for snippet in required_snippets:
        if snippet not in next_config:
            failures.append(f"apps/web/next.config.ts missing {snippet}")

    workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")
    workflow_snippets = [
        "stock-trading-platform-next-${{ github.ref_name }}-windows-x64.zip",
        "stock-trading-platform-next-${{ github.ref_name }}-macos-${{ matrix.arch }}.zip",
        "启动股票交易平台.exe",
        "启动股票交易平台.command",
        "pyinstaller --onefile",
        "release.json",
        "scripts/windows/Install-Update.ps1",
        "scripts/macos/install-update.sh",
    ]
    for snippet in workflow_snippets:
        if snippet not in workflow:
            failures.append(f".github/workflows/build-release-packages.yml missing {snippet}")

    if "StockTradingPlatform-Launcher.exe" in workflow:
        failures.append("release workflow still uploads a standalone launcher exe")

    for launcher in [MACOS_LAUNCHER, WINDOWS_LAUNCHER]:
        if not launcher.exists():
            failures.append(f"missing launcher: {launcher.relative_to(ROOT)}")

    for updater in [
        ROOT / "scripts/windows/Install-Update.ps1",
        ROOT / "scripts/macos/install-update.sh",
    ]:
        if not updater.exists():
            failures.append(f"missing updater: {updater.relative_to(ROOT)}")

    if failures:
        print("Release readiness check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Release readiness check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
