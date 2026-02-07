#!/usr/bin/env bash
# =============================================================================
# release.sh — Build installers, compute hashes, update website & manifest
#
# Usage:
#   ./scripts/release.sh [version]
#
# Examples:
#   ./scripts/release.sh 0.1.0    # build + publish version 0.1.0
#   ./scripts/release.sh          # uses version from apps/desktop/package.json
#
# What it does:
#   1. Sets the version in apps/desktop/package.json
#   2. Builds all workspace packages (pnpm run build)
#   3. Builds macOS installer (DMG, universal)
#   4. Builds Windows installer (NSIS exe, cross-compiled)
#   5. Computes SHA-256 hashes
#   6. Copies installers to website/site/releases/
#   7. Updates website/site/update-manifest.json
#   8. Updates SHA-256 hashes in website/site/index.html
#
# Prerequisites:
#   - pnpm installed
#   - Node.js >= 22
#   - For Windows cross-compile: mono or wine (optional, NSIS works without)
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/apps/desktop"
WEBSITE_DIR="$REPO_ROOT/website/site"
RELEASE_DIR="$DESKTOP_DIR/release"
WEBSITE_RELEASES="$WEBSITE_DIR/releases"

# ---- Helpers ----
info()  { echo "[INFO]  $*"; }
warn()  { echo "[WARN]  $*" >&2; }
error() { echo "[ERROR] $*" >&2; exit 1; }

# ---- Determine version ----
if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  VERSION=$(node -e "console.log(require('$DESKTOP_DIR/package.json').version)")
fi

if [ "$VERSION" = "0.0.0" ] && [ -z "${1:-}" ]; then
  error "Version is 0.0.0. Pass a version argument: ./scripts/release.sh 0.1.0"
fi

info "Building EasyClaw v$VERSION"

# ---- Step 1: Set version in package.json ----
info "Setting version to $VERSION in apps/desktop/package.json ..."
node -e "
  const fs = require('fs');
  const path = '$DESKTOP_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf-8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"
info "Version set."

# ---- Step 2: Build all packages ----
info "Building all workspace packages ..."
(cd "$REPO_ROOT" && pnpm run build)
info "Build complete."

# ---- Step 3: Build macOS installer ----
info "Building macOS installer (DMG + ZIP, universal) ..."
(cd "$DESKTOP_DIR" && pnpm run dist:mac)
info "macOS installer built."

# ---- Step 4: Build Windows installer ----
info "Building Windows installer (NSIS + portable) ..."
(cd "$DESKTOP_DIR" && pnpm run dist:win) || {
  warn "Windows build failed (may need wine/mono for cross-compile). Skipping."
}

# ---- Step 5: Find built artifacts and compute hashes ----
info "Computing SHA-256 hashes ..."

DMG_FILE=$(find "$RELEASE_DIR" -maxdepth 1 -name "*.dmg" -print -quit 2>/dev/null || true)
EXE_FILE=$(find "$RELEASE_DIR" -maxdepth 1 -name "*Setup*.exe" -print -quit 2>/dev/null || true)

if [ -z "$DMG_FILE" ]; then
  warn "No .dmg file found in $RELEASE_DIR"
fi
if [ -z "$EXE_FILE" ]; then
  warn "No Setup .exe file found in $RELEASE_DIR"
fi

DMG_HASH=""
DMG_SIZE=0
DMG_NAME=""
if [ -n "$DMG_FILE" ]; then
  DMG_HASH=$(shasum -a 256 "$DMG_FILE" | awk '{print $1}')
  DMG_SIZE=$(stat -f%z "$DMG_FILE" 2>/dev/null || stat -c%s "$DMG_FILE" 2>/dev/null || echo 0)
  DMG_NAME=$(basename "$DMG_FILE")
  info "  macOS: $DMG_NAME"
  info "    SHA-256: $DMG_HASH"
  info "    Size: $DMG_SIZE bytes"
fi

EXE_HASH=""
EXE_SIZE=0
EXE_NAME=""
if [ -n "$EXE_FILE" ]; then
  EXE_HASH=$(shasum -a 256 "$EXE_FILE" | awk '{print $1}')
  EXE_SIZE=$(stat -f%z "$EXE_FILE" 2>/dev/null || stat -c%s "$EXE_FILE" 2>/dev/null || echo 0)
  EXE_NAME=$(basename "$EXE_FILE")
  info "  Windows: $EXE_NAME"
  info "    SHA-256: $EXE_HASH"
  info "    Size: $EXE_SIZE bytes"
fi

# ---- Step 6: Copy to website/site/releases/ ----
info "Copying installers to $WEBSITE_RELEASES ..."
mkdir -p "$WEBSITE_RELEASES"

if [ -n "$DMG_FILE" ]; then
  cp "$DMG_FILE" "$WEBSITE_RELEASES/"
  info "  Copied $DMG_NAME"
fi
if [ -n "$EXE_FILE" ]; then
  cp "$EXE_FILE" "$WEBSITE_RELEASES/"
  info "  Copied $EXE_NAME"
fi

# ---- Step 7: Update manifest + HTML via Node (handles filenames with spaces) ----
info "Updating update-manifest.json and index.html ..."
MANIFEST="$WEBSITE_DIR/update-manifest.json"
HTML="$WEBSITE_DIR/index.html"
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

R_VERSION="$VERSION" \
R_DATE="$RELEASE_DATE" \
R_DMG_NAME="$DMG_NAME" \
R_DMG_HASH="$DMG_HASH" \
R_DMG_SIZE="$DMG_SIZE" \
R_EXE_NAME="$EXE_NAME" \
R_EXE_HASH="$EXE_HASH" \
R_EXE_SIZE="$EXE_SIZE" \
R_MANIFEST="$MANIFEST" \
R_HTML="$HTML" \
node -e '
  const fs = require("fs");
  const e = process.env;
  const enc = (n) => n.split("/").map(encodeURIComponent).join("/");

  // --- Update manifest ---
  const manifest = JSON.parse(fs.readFileSync(e.R_MANIFEST, "utf-8"));
  manifest.latestVersion = e.R_VERSION;
  manifest.releaseDate = e.R_DATE;
  if (e.R_DMG_HASH) {
    manifest.downloads.mac.url = "https://www.easy-claw.com/releases/" + enc(e.R_DMG_NAME);
    manifest.downloads.mac.sha256 = e.R_DMG_HASH;
    manifest.downloads.mac.size = Number(e.R_DMG_SIZE);
  }
  if (e.R_EXE_HASH) {
    manifest.downloads.win.url = "https://www.easy-claw.com/releases/" + enc(e.R_EXE_NAME);
    manifest.downloads.win.sha256 = e.R_EXE_HASH;
    manifest.downloads.win.size = Number(e.R_EXE_SIZE);
  }
  fs.writeFileSync(e.R_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  // --- Update index.html ---
  let html = fs.readFileSync(e.R_HTML, "utf-8");

  if (e.R_DMG_HASH) {
    html = html.replace(
      /href="\/releases\/[^"]*\.dmg"/,
      "href=\"/releases/" + enc(e.R_DMG_NAME) + "\""
    );
    html = html.replace(
      /(<!-- macOS -->[\s\S]*?<code class="hash-value">)[^<]*/,
      "$1" + e.R_DMG_HASH
    );
  }
  if (e.R_EXE_HASH) {
    html = html.replace(
      /href="\/releases\/[^"]*\.exe"/,
      "href=\"/releases/" + enc(e.R_EXE_NAME) + "\""
    );
    html = html.replace(
      /(<!-- Windows -->[\s\S]*?<code class="hash-value">)[^<]*/,
      "$1" + e.R_EXE_HASH
    );
  }
  const v = e.R_VERSION;
  html = html.replace(/<span class="version">[^<]*/g, "<span class=\"version\">" + v);
  html = html.replace(/<p class="download-version">v[^<]*/g, "<p class=\"download-version\">v" + v);
  fs.writeFileSync(e.R_HTML, html);
'

info "Manifest and index.html updated."

# ---- Done ----
echo ""
info "==============================================="
info "  Release v$VERSION built successfully!"
info ""
if [ -n "$DMG_FILE" ]; then
  info "  macOS:   $DMG_NAME ($DMG_HASH)"
fi
if [ -n "$EXE_FILE" ]; then
  info "  Windows: $EXE_NAME ($EXE_HASH)"
fi
info ""
info "  Files are in: $WEBSITE_RELEASES/"
info "  Manifest:     $MANIFEST"
info ""
info "  Next steps:"
info "    1. git add && git commit && git push"
info "    2. On server: git pull && docker compose restart nginx"
info "==============================================="
