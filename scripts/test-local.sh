#!/usr/bin/env bash
# =============================================================================
# test-local.sh — Build and run full test suite locally (unit + e2e)
#
# Usage:
#   ./scripts/test-local.sh [version] [--skip-tests]
#
# Examples:
#   ./scripts/test-local.sh 1.2.8          # full pipeline
#   ./scripts/test-local.sh --skip-tests   # build + pack only (no tests)
#
# Pipeline:
#   1. pnpm install              — ensure dependencies match lockfile
#   2. vendor check              — ensure vendor/openclaw matches .openclaw-version
#   3. rebuild-native.sh         — prebuild better-sqlite3 for Node.js + Electron
#   4. pnpm run build            — build all workspace packages
#   5. pnpm run test             — unit tests (vitest via turbo)
#   6. test:e2e:dev              — Playwright e2e against dev build
#   7. pnpm run pack             — electron-builder --dir (unpacked app)
#   8. rebuild-native.sh         — restore dual prebuilds after electron-builder
#   9. test:e2e:prod             — Playwright e2e against packed app
#
# Native module strategy:
#   rebuild-native.sh builds better-sqlite3 twice (for Node.js and Electron)
#   and places both in lib/binding/node-v{ABI}-{platform}-{arch}/. The
#   `bindings` package auto-selects the correct one at runtime. No switching
#   needed — unit tests and E2E dev tests coexist.
# =============================================================================
set -euo pipefail

# Electron must NOT run as Node — unset this in case the parent shell sets it
# (e.g. VS Code integrated terminal, Claude Code).
unset ELECTRON_RUN_AS_NODE

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/apps/desktop"
RELEASE_DIR="$DESKTOP_DIR/release"

# ---- Helpers ----
info()  { echo "$(date +%H:%M:%S) [INFO]  $*"; }
warn()  { echo "$(date +%H:%M:%S) [WARN]  $*" >&2; }
error() { echo "$(date +%H:%M:%S) [ERROR] $*" >&2; exit 1; }
step()  { echo ""; echo "========================================"; echo "  STEP: $*"; echo "========================================"; }

# ---- Parse arguments ----
SKIP_TESTS=false
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --skip-tests)  SKIP_TESTS=true ;;
    *)             VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then
  VERSION=$(cd "$REPO_ROOT" && node -p "require('./apps/desktop/package.json').version")
fi
[ "$VERSION" = "0.0.0" ] && error "Version is 0.0.0. Pass a version: ./scripts/test-local.sh 1.2.8"

info "Test pipeline for EasyClaw v$VERSION"
info "Platform: $(uname -s) ($(uname -m))"

# ---- Determine platform ----
case "$(uname -s)" in
  Darwin)       PLATFORM="mac" ;;
  MINGW*|MSYS*) PLATFORM="win" ;;
  *)            PLATFORM="linux" ;;
esac

# ---- Step 1: Install dependencies ----
step "Install dependencies"
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile)
info "Dependencies up to date."

# ---- Step 2: Verify vendor/openclaw matches .openclaw-version ----
step "Verify vendor/openclaw version"
EXPECTED_HASH="$(tr -d '[:space:]' < "$REPO_ROOT/.openclaw-version")"
VENDOR_DIR="$REPO_ROOT/vendor/openclaw"

if [ -d "$VENDOR_DIR/.git" ]; then
  ACTUAL_HASH="$(cd "$VENDOR_DIR" && git rev-parse HEAD)"
  # Compare short-hash prefix so .openclaw-version can use abbreviated hashes
  if [[ "$ACTUAL_HASH" == "$EXPECTED_HASH"* ]]; then
    info "Vendor already at $EXPECTED_HASH — skipping setup."
  else
    warn "Vendor mismatch: expected $EXPECTED_HASH, got ${ACTUAL_HASH:0:9}"
    info "Re-provisioning vendor/openclaw..."
    rm -rf "$VENDOR_DIR"
    bash "$REPO_ROOT/scripts/setup-vendor.sh"
  fi
else
  info "vendor/openclaw not found — running setup-vendor.sh..."
  bash "$REPO_ROOT/scripts/setup-vendor.sh"
fi

# ---- Step 3: Prebuild native modules ----
# postinstall hook normally handles this, but run explicitly in case
# pnpm install was a no-op (deps already satisfied).
step "Prebuild native modules (Node.js + Electron)"
bash "$REPO_ROOT/scripts/rebuild-native.sh"
info "Native prebuilds ready."

# ---- Step 4: Build all packages ----
step "Build all workspace packages"
(cd "$REPO_ROOT" && pnpm run build)
info "Build complete."

# ---- Step 5: Unit tests ----
if [ "$SKIP_TESTS" = false ]; then
  step "Run unit tests"
  (cd "$REPO_ROOT" && pnpm run test)
  info "Unit tests passed."
fi

# ---- Step 6: E2E tests (dev mode) ----
if [ "$SKIP_TESTS" = false ]; then
  step "Run E2E tests (dev mode)"
  (cd "$DESKTOP_DIR" && pnpm run test:e2e:dev)
  info "E2E dev tests passed."
fi

# ---- Step 7: Pack (unpacked app for prod e2e) ----
step "Pack application (electron-builder --dir)"
# Clean stale release dirs to avoid picking up wrong binary in prod E2E
rm -rf "$RELEASE_DIR"
(cd "$DESKTOP_DIR" && pnpm run pack)
info "Pack complete."

# ---- Step 8: Restore dual prebuilds ----
# electron-builder's @electron/rebuild overwrites build/Release/ with Electron ABI.
# Restore dual prebuilds so the Node.js-based E2E seed helper can load better-sqlite3.
bash "$REPO_ROOT/scripts/rebuild-native.sh"

# ---- Step 9: E2E tests (prod mode) ----
if [ "$SKIP_TESTS" = false ]; then
  step "Run E2E tests (prod mode)"

  # Kill stale gateway processes left over from dev e2e to avoid port conflicts.
  # On Windows the gateway can't rebind port 28789 while the old process holds it.
  # We kill by PORT (28789) rather than process name because during dev e2e
  # the gateway runs as electron.exe/node, not openclaw.exe.
  if [ "$PLATFORM" = "win" ]; then
    info "Killing stale gateway processes on port 28789 (if any)..."
    for pid in $(netstat -ano 2>/dev/null | grep ":28789 .*LISTENING" | awk '{print $5}' | sort -u); do
      taskkill //T //F //PID "$pid" 2>/dev/null || true
    done
    # Wait for the port to be released
    sleep 2
  else
    info "Killing stale gateway processes on port 28789 (if any)..."
    lsof -ti :28789 | xargs kill -9 2>/dev/null || true
    pkill -f "openclaw.*gateway" 2>/dev/null || true
    sleep 1
  fi

  # Clean up the shared V8 compile cache left by dev e2e gateway processes.
  # OpenClaw calls module.enableCompileCache() which defaults to $TMPDIR/node-compile-cache/.
  # When a dev e2e gateway is force-killed (taskkill), the cache can be left in a
  # corrupt state that causes the prod e2e gateway to hang during import().
  COMPILE_CACHE="${TMPDIR:-${TEMP:-/tmp}}/node-compile-cache"
  if [ -d "$COMPILE_CACHE" ]; then
    info "Cleaning V8 compile cache at $COMPILE_CACHE..."
    rm -rf "$COMPILE_CACHE"
  fi

  EXEC_PATH=""
  if [ "$PLATFORM" = "mac" ]; then
    APP_DIR=$(find "$RELEASE_DIR" -maxdepth 2 -name "EasyClaw.app" -print -quit 2>/dev/null || true)
    [ -z "$APP_DIR" ] && error "No EasyClaw.app found in $RELEASE_DIR after pack"
    EXEC_PATH="$APP_DIR/Contents/MacOS/EasyClaw"
  elif [ "$PLATFORM" = "win" ]; then
    EXEC_PATH=$(find "$RELEASE_DIR" -maxdepth 2 -name "EasyClaw.exe" -not -path "*Setup*" -print -quit 2>/dev/null || true)
    [ -z "$EXEC_PATH" ] && error "No EasyClaw.exe found in $RELEASE_DIR after pack"
  else
    warn "Prod E2E not supported on $PLATFORM, skipping."
  fi

  if [ -n "$EXEC_PATH" ]; then
    info "Launching prod E2E with: $EXEC_PATH"
    (cd "$DESKTOP_DIR" && E2E_EXECUTABLE_PATH="$EXEC_PATH" pnpm run test:e2e:prod)
    info "E2E prod tests passed."
  fi
fi

# ---- Done ----
echo ""
info "==============================================="
info "  Test pipeline v$VERSION complete!"
info ""
info "  All local checks passed. Ready to publish."
info "==============================================="
