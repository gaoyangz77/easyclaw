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
git config user.email "ci@rivonclaw.com"
git config user.name "RivonClaw CI"
echo 'node-linker=hoisted' > .npmrc
pnpm install --no-frozen-lockfile
pnpm run build

# Replay EasyClaw vendor patches (if any exist)
PATCH_DIR="$REPO_ROOT/vendor-patches/openclaw"
if ls "$PATCH_DIR"/*.patch &>/dev/null; then
  echo "Replaying vendor patches from $PATCH_DIR..."
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

# Provision commit: track dist/ and build artifacts, ignore node_modules
# (recursive deps create paths that exceed Windows MAX_PATH on CI).
# This is the +1 commit above the patch count that the pre-commit hook allows.
printf 'node_modules\n' > .gitignore
git add -A
git commit -m "chore: provision build artifacts" --no-verify

echo "OpenClaw vendor ready ($HASH)"
