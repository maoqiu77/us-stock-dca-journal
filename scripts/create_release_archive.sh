#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/package.json")"
VERSION="${1:-v$PACKAGE_VERSION}"
DIST_DIR="$ROOT/dist"
ARCHIVE="$DIST_DIR/stock-trading-platform-next-${VERSION}.zip"

mkdir -p "$DIST_DIR"
rm -f "$ARCHIVE"

cd "$ROOT"

python3 scripts/check_public_safety.py
python3 scripts/check_release_readiness.py

zip -r "$ARCHIVE" . \
  -x ".git" \
  -x ".git/*" \
  -x "*/.git/*" \
  -x "*/.git/**" \
  -x "dist/*" \
  -x "node_modules/*" \
  -x "apps/web/node_modules/*" \
  -x "*/node_modules/*" \
  -x "packages/*/dist/*" \
  -x "packages/*/coverage/*" \
  -x "packages/*/*.tsbuildinfo" \
  -x "packages/*/storage/local/*" \
  -x "apps/miniprogram/dist/*" \
  -x "apps/miniprogram/project.private.config.json" \
  -x "apps/miniprogram/*/project.private.config.json" \
  -x "apps/mobile/.expo/*" \
  -x "apps/mobile/native-artifacts/*" \
  -x "apps/mobile/ios/*" \
  -x "apps/mobile/android/*" \
  -x "*.keystore" \
  -x "*.jks" \
  -x "*.p12" \
  -x "*.mobileprovision" \
  -x "apps/web/.next/*" \
  -x ".venv/*" \
  -x "storage/local/*" \
  -x "*.db" \
  -x "*.sqlite" \
  -x "*.sqlite3" \
  -x ".env" \
  -x ".env.*" \
  -x "apps/**/.env" \
  -x "apps/**/.env.*" \
  -x ".DS_Store" \
  -x "__pycache__/*" \
  -x "*/__pycache__/*"

echo "$ARCHIVE"
