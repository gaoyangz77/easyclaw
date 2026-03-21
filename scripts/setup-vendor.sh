#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HASH="$(tr -d '[:space:]' < "$REPO_ROOT/.openclaw-version")"
PROD="${1:-}"

echo "Setting up OpenClaw vendor @ $HASH"
git clone https://github.com/openclaw/openclaw.git "$REPO_ROOT/vendor/openclaw"
cd "$REPO_ROOT/vendor/openclaw"
git checkout "$HASH"
git checkout -B main
echo 'node-linker=hoisted' > .npmrc
pnpm install --no-frozen-lockfile
pnpm run build

# Replay EasyClaw vendor patches (if any exist)
PATCH_DIR="$REPO_ROOT/vendor-patches/openclaw"
if ls "$PATCH_DIR"/*.patch &>/dev/null; then
  echo "Replaying vendor patches from $PATCH_DIR..."
  git config user.email "ci@rivonclaw.com"
  git config user.name "RivonClaw CI"
  git am --3way "$PATCH_DIR"/*.patch
  # Full rebuild after patches so plugin-sdk dist chunks stay consistent.
  # Incremental tsdown-build.mjs only rebuilds changed files, leaving other
  # chunks with stale references that trigger ERR_INTERNAL_ASSERTION in
  # Electron's CJS/ESM module loader.
  pnpm run build
  echo "Vendor patches applied and rebuilt."
fi

if [ "$PROD" = "--prod" ]; then
  pnpm install --prod --no-frozen-lockfile
fi

rm -f .gitignore
echo "OpenClaw vendor ready ($HASH)"
