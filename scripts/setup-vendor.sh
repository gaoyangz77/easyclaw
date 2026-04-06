#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HASH="$(tr -d '[:space:]' < "$REPO_ROOT/.openclaw-version")"

# Parse flags
PROD=false
SKIP_CLONE=false
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=true ;;
    --skip-clone) SKIP_CLONE=true ;;
  esac
done

echo "Setting up OpenClaw vendor @ $HASH"

# Clone unless --skip-clone (CI splits clone into a separate step for caching)
if [ "$SKIP_CLONE" = false ]; then
  git clone https://github.com/openclaw/openclaw.git "$REPO_ROOT/vendor/openclaw"
fi

cd "$REPO_ROOT/vendor/openclaw"
git checkout "$HASH"
git checkout -B main

# Use env var for hoisted layout instead of modifying .npmrc,
# so vendor git stays clean (pre-commit hook checks for dirty state).
export npm_config_node_linker=hoisted

# Install dependencies (skip if CI cache hit)
if [ "${SKIP_VENDOR_INSTALL:-}" = "true" ]; then
  echo "Skipping pnpm install (cache hit)"
else
  pnpm install --frozen-lockfile
fi

# Detect vendor patches
PATCH_DIR="$REPO_ROOT/vendor-patches/openclaw"
HAS_PATCHES=false
if ls "$PATCH_DIR"/*.patch &>/dev/null; then
  HAS_PATCHES=true
fi

# Build (skip if CI cache hit)
# When dist is cached, the cached output already includes patched builds
# (the cache key incorporates patch file hashes). We still apply patches
# to source so git state matches the built artifacts.
if [ "${SKIP_VENDOR_BUILD:-}" = "true" ] && [ -f dist/.dist-complete ]; then
  echo "Skipping pnpm run build (cache hit, dist verified)"
  # Remove the .bundled marker so bundle-vendor-deps.cjs runs its full
  # pipeline (Phase 0.5b pre-bundling, Phase 4 node_modules pruning, etc.).
  # The cached dist/ is the raw build output — the bundle pipeline must
  # still process it during electron-builder packaging.
  # EXCEPTION: when the post-bundle cache hits (SKIP_BUNDLED_MARKER_REMOVAL=true),
  # the dist/ is already fully bundled — keep the marker so the pipeline skips.
  if [ "${SKIP_BUNDLED_MARKER_REMOVAL:-}" != "true" ]; then
    rm -f "$REPO_ROOT/vendor/openclaw/dist/.bundled"
  else
    echo "Post-bundle cache hit — keeping .bundled marker"
  fi
  if [ "$HAS_PATCHES" = true ]; then
    echo "Applying patches to source (dist already cached with patches)..."
    git config user.email "ci@rivonclaw.com"
    git config user.name "RivonClaw CI"
    git am --3way "$PATCH_DIR"/*.patch
  fi
else
  pnpm run build
  pnpm ui:build
  # Replay EasyClaw vendor patches (if any exist)
  if [ "$HAS_PATCHES" = true ]; then
    echo "Replaying vendor patches from $PATCH_DIR..."
    git config user.email "ci@rivonclaw.com"
    git config user.name "RivonClaw CI"
    git am --3way "$PATCH_DIR"/*.patch
    # Full rebuild after patches so plugin-sdk dist chunks stay consistent.
    # Incremental tsdown-build.mjs only rebuilds changed files, leaving other
    # chunks with stale references that trigger ERR_INTERNAL_ASSERTION in
    # Electron's CJS/ESM module loader.
    pnpm run build
    pnpm ui:build
    echo "Vendor patches applied and rebuilt."
  fi
  # Mark dist/ as complete so CI cache can verify integrity on restore.
  # Without this marker, a cached dist/ from an incomplete/failed build
  # would silently break the app (e.g. missing dist/plugins/runtime/).
  echo "$HASH" > dist/.dist-complete
fi

if [ "$PROD" = true ]; then
  npm_config_node_linker=hoisted pnpm install --prod --frozen-lockfile
fi

# Remove .gitignore so dist/ and node_modules/ are visible to electron-builder
# during CI packaging. Replicate the ignore rules in .git/info/exclude so that
# git status stays clean locally (pre-commit hook checks for dirty state).
cp .gitignore .git/info/exclude
rm -f .gitignore
echo "OpenClaw vendor ready ($HASH)"
