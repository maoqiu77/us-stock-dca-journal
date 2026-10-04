#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/package.json")"
VERSION="${1:-v$PACKAGE_VERSION}"
DIST_DIR="$ROOT/dist"
ARCHIVE="$DIST_DIR/stock-trading-platform-next-${VERSION}.zip"

if [[ ! "$VERSION" =~ ^v[0-9]+(\.[0-9]+){2}(-[A-Za-z0-9._-]+)?$ ]]; then
  echo "Expected a version such as v1.4.0-rc.1" >&2
  exit 2
fi

cd "$ROOT"

python3 scripts/check_public_safety.py
python3 scripts/check_release_readiness.py

python3 scripts/create_source_archive.py "$ARCHIVE"
