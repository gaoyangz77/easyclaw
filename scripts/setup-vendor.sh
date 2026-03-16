#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HASH="$(tr -d '[:space:]' < "$REPO_ROOT/.openclaw-version")"
PROD="${1:-}"

echo "Setting up OpenClaw vendor @ $HASH"
git clone https://github.com/openclaw/openclaw.git "$REPO_ROOT/vendor/openclaw"
cd "$REPO_ROOT/vendor/openclaw"
git checkout -B main "$HASH"
echo 'node-linker=hoisted' > .npmrc
pnpm install --no-frozen-lockfile
pnpm run build

if [ "$PROD" = "--prod" ]; then
  pnpm install --prod --no-frozen-lockfile
fi

rm -f .gitignore
echo "OpenClaw vendor ready ($HASH)"
