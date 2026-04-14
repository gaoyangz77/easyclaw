#!/usr/bin/env bash
# =============================================================================
# publish-release.sh — Publish a draft GitHub Release (idempotent)
#
# Promotes the newest draft release created by the CI build workflow to a public
# release. If an older public release already exists for the same tag, delete it
# first, then publish the newest draft.
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
command -v jq &>/dev/null || error "jq not found. Install jq first."

# ---- Load all releases for this tag ----
RELEASES_JSON=$(gh api repos/gaoyangz77/rivonclaw/releases --paginate | jq --arg tag "$TAG" '[.[] | select(.tag_name == $tag)]')
RELEASE_COUNT=$(echo "$RELEASES_JSON" | jq 'length')
[ "$RELEASE_COUNT" -gt 0 ] || error "Release $TAG not found on GitHub. Has the CI build workflow completed?"

info "Found $RELEASE_COUNT release object(s) for $TAG:"
echo "$RELEASES_JSON" | jq -r '.[] | "  - id=\(.id) draft=\(.draft) published_at=\(.published_at // "null") assets=\(.assets|length)"'

DRAFT_COUNT=$(echo "$RELEASES_JSON" | jq '[.[] | select(.draft == true)] | length')
[ "$DRAFT_COUNT" -gt 0 ] || error "No draft release found for $TAG. Refusing to delete/replace public release without a draft."

NEWEST_DRAFT_JSON=$(echo "$RELEASES_JSON" | jq '[.[] | select(.draft == true)] | sort_by(.created_at, .id) | last')
NEWEST_DRAFT_ID=$(echo "$NEWEST_DRAFT_JSON" | jq -r '.id')
ASSET_COUNT=$(echo "$NEWEST_DRAFT_JSON" | jq '.assets | length')
ASSET_NAMES=$(echo "$NEWEST_DRAFT_JSON" | jq -r '.assets[].name')

info "Selected newest draft release id=$NEWEST_DRAFT_ID with $ASSET_COUNT artifact(s):"
echo "$ASSET_NAMES" | while read -r name; do
  [ -n "$name" ] && echo "  - $name"
done

# Current split-mac flow:
#   macOS:   arm64.dmg + x64.dmg + arm64.zip + x64.zip + latest-mac-arm64.yml + latest-mac-x64.yml (6)
#   Windows: NSIS EXE + portable EXE + EXE.blockmap + latest.yml (4)
#   Linux:   AppImage + deb + latest-linux.yml (3)
EXPECTED_ARTIFACTS=13
if [ "$ASSET_COUNT" -lt "$EXPECTED_ARTIFACTS" ]; then
  error "Expected at least $EXPECTED_ARTIFACTS artifacts on draft $NEWEST_DRAFT_ID, but found $ASSET_COUNT. CI build may be incomplete."
fi

# ---- Ensure tag exists remotely (release object may exist before tag push) ----
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

# ---- Delete any existing public release(s) for this tag ----
PUBLIC_IDS=$(echo "$RELEASES_JSON" | jq -r '.[] | select(.draft == false) | .id')
if [ -n "$PUBLIC_IDS" ]; then
  while read -r id; do
    [ -z "$id" ] && continue
    info "Deleting existing public release id=$id for $TAG..."
    gh api -X DELETE "repos/gaoyangz77/rivonclaw/releases/$id"
  done <<< "$PUBLIC_IDS"
else
  info "No existing public release found for $TAG."
fi

# ---- Publish the newest draft release ----
info "Publishing draft release id=$NEWEST_DRAFT_ID for $TAG..."
gh api -X PATCH "repos/gaoyangz77/rivonclaw/releases/$NEWEST_DRAFT_ID" -f draft=false -f make_latest=true >/dev/null

# ---- Final verification ----
FINAL_JSON=$(gh api repos/gaoyangz77/rivonclaw/releases --paginate | jq --arg tag "$TAG" '[.[] | select(.tag_name == $tag)]')
FINAL_PUBLIC_COUNT=$(echo "$FINAL_JSON" | jq '[.[] | select(.draft == false)] | length')
[ "$FINAL_PUBLIC_COUNT" -eq 1 ] || error "Expected exactly 1 public release for $TAG after publish, found $FINAL_PUBLIC_COUNT"

FINAL_PUBLIC_ID=$(echo "$FINAL_JSON" | jq -r '[.[] | select(.draft == false)] | first | .id')
FINAL_PUBLIC_URL=$(echo "$FINAL_JSON" | jq -r '[.[] | select(.draft == false)] | first | .html_url')
FINAL_PUBLIC_ASSET_COUNT=$(echo "$FINAL_JSON" | jq '[.[] | select(.draft == false)] | first | .assets | length')

[ "$FINAL_PUBLIC_ID" = "$NEWEST_DRAFT_ID" ] || error "Published release id ($FINAL_PUBLIC_ID) does not match selected draft id ($NEWEST_DRAFT_ID)"
[ "$FINAL_PUBLIC_ASSET_COUNT" -ge "$EXPECTED_ARTIFACTS" ] || error "Published release has only $FINAL_PUBLIC_ASSET_COUNT artifacts; expected at least $EXPECTED_ARTIFACTS"

info "==============================================="
info "  Release $TAG published!"
info "  $FINAL_PUBLIC_URL"
info "==============================================="
