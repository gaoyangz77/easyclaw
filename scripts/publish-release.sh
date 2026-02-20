#!/usr/bin/env bash
# =============================================================================
# publish-release.sh — Publish a draft GitHub Release
#
# Promotes a draft release created by the CI build workflow to a public release.
# Run this after both CI build and local tests have passed.
#
# Usage:
#   ./scripts/publish-release.sh [version]
#
# If version is omitted, reads from apps/desktop/package.json.
#
# Prerequisites:
#   - gh CLI installed and authenticated
#   - Draft release v{version} exists on GitHub (created by CI build workflow)
#   - Local tests passed (test-local.sh exited 0)
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/apps/desktop"

# ---- Helpers ----
info()  { echo "$(date +%H:%M:%S) [INFO]  $*"; }
error() { echo "$(date +%H:%M:%S) [ERROR] $*" >&2; exit 1; }

# ---- Parse arguments ----
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(cd "$REPO_ROOT" && node -p "require('./apps/desktop/package.json').version")
fi
[ "$VERSION" = "0.0.0" ] && error "Version is 0.0.0. Pass a version: ./scripts/publish-release.sh 1.2.8"

TAG="v$VERSION"
info "Publishing release $TAG..."

# ---- Validate prerequisites ----
command -v gh &>/dev/null || error "gh CLI not found. Install: https://cli.github.com/"
gh auth status || error "gh not authenticated. Run: gh auth login"

# ---- Verify the draft release exists ----
gh release view "$TAG" --json isDraft &>/dev/null \
  || error "Release $TAG not found on GitHub. Has the CI build workflow completed?"

IS_DRAFT=$(gh release view "$TAG" --json isDraft -q .isDraft)
[ "$IS_DRAFT" = "true" ] || error "Release $TAG is not a draft. It may have already been published."

# ---- Verify artifacts are complete ----
ASSET_COUNT=$(gh release view "$TAG" --json assets -q '.assets | length')
ASSET_NAMES=$(gh release view "$TAG" --json assets -q '.assets[].name')

info "Draft release $TAG found with $ASSET_COUNT artifact(s):"
echo "$ASSET_NAMES" | while read -r name; do
  [ -n "$name" ] && echo "  - $name"
done

# Expect 3 artifacts: DMG + ZIP (macOS) + EXE (Windows)
EXPECTED_ARTIFACTS=3
if [ "$ASSET_COUNT" -lt "$EXPECTED_ARTIFACTS" ]; then
  error "Expected at least $EXPECTED_ARTIFACTS artifacts (DMG + ZIP + EXE), but found $ASSET_COUNT. CI build may be incomplete."
fi

# ---- Push git tag (if not already present) ----
if git rev-parse "$TAG" &>/dev/null; then
  info "Tag $TAG already exists locally."
else
  info "Creating tag $TAG..."
  git tag "$TAG"
fi

if git ls-remote --tags origin "$TAG" | grep -q "$TAG"; then
  info "Tag $TAG already exists on remote."
else
  info "Pushing tag $TAG to origin..."
  git push origin "$TAG"
fi

# ---- Publish the draft release ----
gh release edit "$TAG" --draft=false --latest
info "==============================================="
info "  Release $TAG published!"
info "  https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$TAG"
info "==============================================="
