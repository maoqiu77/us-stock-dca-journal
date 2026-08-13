#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
REMOTE="${2:-origin}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ -z "$VERSION" || ! "$VERSION" =~ ^v[0-9]+(\.[0-9]+){2}(-[A-Za-z0-9._-]+)?$ ]]; then
  echo "Usage: npm run release:publish -- v0.1.8 [remote]" >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before publishing." >&2
  git status --short >&2
  exit 1
fi

if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Tag $VERSION already exists locally." >&2
  exit 1
fi

git fetch --tags "$REMOTE"

if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$VERSION" >/dev/null 2>&1; then
  echo "Tag $VERSION already exists on $REMOTE." >&2
  exit 1
fi

npm run check:public-safety
npm run check:release-readiness
npm run lint
npm run build

git push "$REMOTE" "$BRANCH"
git tag -a "$VERSION" -m "Release $VERSION"
git push "$REMOTE" "$VERSION"

cat <<EOF
Release tag $VERSION pushed.

GitHub Actions will build and attach:
- stock-trading-platform-next-$VERSION-windows-x64.zip
- stock-trading-platform-next-$VERSION-macos-arm64.zip
- stock-trading-platform-next-$VERSION-macos-x64.zip

Open the Actions tab or the repository Releases page to watch the upload finish.
EOF

if command -v gh >/dev/null 2>&1; then
  echo
  echo "Recent release workflow runs:"
  gh run list --workflow build-release-packages.yml --limit 3 || true
fi
