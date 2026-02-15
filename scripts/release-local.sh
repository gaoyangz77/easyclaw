#!/usr/bin/env bash
# =============================================================================
# release-local.sh — Build, test (e2e), and upload release to GitHub
#
# Usage:
#   ./scripts/release-local.sh [version] [--skip-tests] [--skip-upload] [--upload-only]
#
# Examples:
#   ./scripts/release-local.sh 1.2.8          # full pipeline
#   ./scripts/release-local.sh --skip-tests   # build + upload only
#   ./scripts/release-local.sh --skip-upload  # build + test, no upload
#   ./scripts/release-local.sh 1.2.8 --upload-only  # upload existing artifacts only
#
# Pipeline:
#   1. rebuild-native.sh         — prebuild better-sqlite3 for Node.js + Electron
#   2. pnpm run build            — build all workspace packages
#   3. pnpm run test             — unit tests (vitest via turbo)
#   4. test:e2e:dev              — Playwright e2e against dev build
#   5. pnpm run pack             — electron-builder --dir (unpacked app)
#   6. test:e2e:prod             — Playwright e2e against packed app
#   7. dist:mac / dist:win       — create distributable installers
#   8. gh release upload         — upload artifacts to GitHub Release
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
SKIP_UPLOAD=false
UPLOAD_ONLY=false
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --skip-tests)  SKIP_TESTS=true ;;
    --skip-upload) SKIP_UPLOAD=true ;;
    --upload-only) UPLOAD_ONLY=true ;;
    *)             VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then
  VERSION=$(node -e "console.log(require('$DESKTOP_DIR/package.json').version)")
fi
[ "$VERSION" = "0.0.0" ] && error "Version is 0.0.0. Pass a version: ./scripts/release-local.sh 1.2.8"

info "Release pipeline for EasyClaw v$VERSION"
info "Platform: $(uname -s) ($(uname -m))"
[ "$UPLOAD_ONLY" = true ] && info "Mode: upload-only (skipping build/test steps)"

# ---- Determine platform ----
case "$(uname -s)" in
  Darwin)       PLATFORM="mac" ;;
  MINGW*|MSYS*) PLATFORM="win" ;;
  *)            PLATFORM="linux" ;;
esac

if [ "$UPLOAD_ONLY" = true ]; then
  # Jump straight to upload
  info "Skipping steps 1-7 (--upload-only)."
else

# ---- Step 1: Prebuild native modules ----
step "Prebuild native modules (Node.js + Electron)"
bash "$REPO_ROOT/scripts/rebuild-native.sh"
info "Native prebuilds ready."

# ---- Step 2: Build all packages ----
step "Build all workspace packages"
(cd "$REPO_ROOT" && pnpm run build)
info "Build complete."

# ---- Step 3: Unit tests ----
if [ "$SKIP_TESTS" = false ]; then
  step "Run unit tests"
  (cd "$REPO_ROOT" && pnpm run test)
  info "Unit tests passed."
fi

# ---- Step 4: E2E tests (dev mode) ----
if [ "$SKIP_TESTS" = false ]; then
  step "Run E2E tests (dev mode)"
  (cd "$DESKTOP_DIR" && pnpm run test:e2e:dev)
  info "E2E dev tests passed."
fi

# ---- Step 5: Pack (unpacked app for prod e2e) ----
step "Pack application (electron-builder --dir)"
# Clean stale release dirs to avoid picking up wrong binary in prod E2E
rm -rf "$RELEASE_DIR"
(cd "$DESKTOP_DIR" && pnpm run pack)
info "Pack complete."

# ---- Step 6: E2E tests (prod mode) ----
if [ "$SKIP_TESTS" = false ]; then
  step "Run E2E tests (prod mode)"

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

# ---- Step 7: Build distributable installers ----
step "Build distributable installers"
if [ "$PLATFORM" = "mac" ]; then
  (cd "$DESKTOP_DIR" && pnpm run dist:mac)
  info "macOS DMG + ZIP built."
elif [ "$PLATFORM" = "win" ]; then
  (cd "$DESKTOP_DIR" && pnpm run dist:win)
  info "Windows NSIS installer built."
else
  warn "No dist target for platform $PLATFORM"
fi

fi  # end of UPLOAD_ONLY skip

# ---- Step 8: Upload to GitHub Release ----
if [ "$SKIP_UPLOAD" = true ]; then
  info "Skipping upload (--skip-upload flag)."
else
  step "Upload to GitHub Release v$VERSION"

  command -v gh &>/dev/null || error "gh CLI not found. Install: https://cli.github.com/"
  gh auth status || error "gh not authenticated. Run: gh auth login"

  TAG="v$VERSION"

  if ! gh release view "$TAG" &>/dev/null; then
    info "Creating draft release $TAG ..."
    gh release create "$TAG" --title "EasyClaw $TAG" --notes "Release $TAG" --draft
    info "Draft release $TAG created."
  fi

  ARTIFACTS=()
  while IFS= read -r -d '' file; do
    ARTIFACTS+=("$file")
  done < <(find "$RELEASE_DIR" -maxdepth 1 \( -name "*.dmg" -o -name "*.zip" -o -name "*Setup*.exe" \) -print0 2>/dev/null)

  if [ ${#ARTIFACTS[@]} -eq 0 ]; then
    warn "No artifacts found in $RELEASE_DIR to upload."
  else
    for artifact in "${ARTIFACTS[@]}"; do
      info "Uploading: $(basename "$artifact")"
      gh release upload "$TAG" "$artifact" --clobber
    done
    info "All artifacts uploaded to release $TAG."
  fi
fi

# ---- Restore native prebuilds ----
# electron-builder's internal electron-rebuild may overwrite build/Release/.
# Re-run rebuild-native.sh to ensure both prebuilds are intact for dev use.
if [ "$UPLOAD_ONLY" = false ]; then
  step "Restore native prebuilds"
  bash "$REPO_ROOT/scripts/rebuild-native.sh"
  info "Native prebuilds restored."
fi

# ---- Done ----
echo ""
info "==============================================="
info "  Release pipeline v$VERSION complete!"
info ""
info "  Artifacts: $RELEASE_DIR/"
if [ "$SKIP_UPLOAD" = false ]; then
  info "  Review and publish the draft release on GitHub."
fi
info "==============================================="
