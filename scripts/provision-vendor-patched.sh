#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/provision-vendor-patched.sh [--target PATH] [--skip-build] [--prod]

Create a disposable patched OpenClaw workspace from the pristine vendor checkout
plus the replayable patch stack in vendor-patches/openclaw/.

Options:
  --target PATH   Target directory for the patched workspace.
                  Default: tmp/vendor-patched/openclaw
  --skip-build    Apply patches only; skip pnpm install + build.
  --prod          After a successful build, reinstall prod deps only.
  -h, --help      Show this help.
EOF
}

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$REPO_ROOT/vendor/openclaw"
PATCH_DIR="$REPO_ROOT/vendor-patches/openclaw"
TARGET_DIR="$REPO_ROOT/tmp/vendor-patched/openclaw"
SKIP_BUILD=0
PROD_ONLY=0
PATCH_BRANCH="easyclaw-patched"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      TARGET_DIR="${2:?--target requires a path}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --prod)
      PROD_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

echo "==> Preparing patched vendor workspace"
echo "    repo:   $REPO_ROOT"
echo "    vendor: $VENDOR_DIR"
echo "    patch:  $PATCH_DIR"
echo "    target: $TARGET_DIR"

if [ ! -d "$VENDOR_DIR/.git" ]; then
  echo "FAIL: $VENDOR_DIR is missing. Run ./scripts/setup-vendor.sh first." >&2
  exit 1
fi

if [ ! -d "$PATCH_DIR" ]; then
  echo "FAIL: $PATCH_DIR is missing." >&2
  exit 1
fi

EXPECTED_HASH="$(tr -d '[:space:]' < "$REPO_ROOT/.openclaw-version")"
ACTUAL_HASH="$(git -C "$VENDOR_DIR" rev-parse HEAD)"

if [[ "$ACTUAL_HASH" != "$EXPECTED_HASH"* ]]; then
  echo "FAIL: vendor/openclaw is at $ACTUAL_HASH, expected prefix $EXPECTED_HASH." >&2
  echo "      Re-provision vendor/openclaw before creating a patched workspace." >&2
  exit 1
fi

BRANCH="$(git -C "$VENDOR_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$BRANCH" != "main" ]; then
  echo "FAIL: vendor/openclaw must be on main before provisioning a patched workspace." >&2
  exit 1
fi

if ! git -C "$VENDOR_DIR" diff --quiet 2>/dev/null; then
  echo "FAIL: vendor/openclaw has unstaged changes." >&2
  exit 1
fi

if ! git -C "$VENDOR_DIR" diff --cached --quiet 2>/dev/null; then
  echo "FAIL: vendor/openclaw has staged changes." >&2
  exit 1
fi

UNTRACKED="$(git -C "$VENDOR_DIR" ls-files --others --exclude-standard 2>/dev/null)"
if [ -n "$UNTRACKED" ]; then
  echo "FAIL: vendor/openclaw has untracked files." >&2
  echo "$UNTRACKED" | sed 's/^/  - /'
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"

if [ -d "$TARGET_DIR" ]; then
  echo "==> Removing existing patched workspace at $TARGET_DIR"
  git -C "$VENDOR_DIR" worktree remove --force "$TARGET_DIR" 2>/dev/null || rm -rf "$TARGET_DIR"
fi

git -C "$VENDOR_DIR" worktree prune

if git -C "$VENDOR_DIR" show-ref --verify --quiet "refs/heads/$PATCH_BRANCH"; then
  git -C "$VENDOR_DIR" branch -D "$PATCH_BRANCH" >/dev/null 2>&1 || true
fi

echo "==> Creating git worktree from pinned vendor"
git -C "$VENDOR_DIR" worktree add --force -B "$PATCH_BRANCH" "$TARGET_DIR" "$ACTUAL_HASH" >/dev/null

PATCH_COUNT=0
PATCH_FILES=()
while IFS= read -r patch_file; do
  PATCH_FILES+=("$patch_file")
  PATCH_COUNT=$((PATCH_COUNT + 1))
done < <(find "$PATCH_DIR" -maxdepth 1 -type f -name '*.patch' | sort)

if ! git -C "$TARGET_DIR" config user.name >/dev/null; then
  git -C "$TARGET_DIR" config user.name "EasyClaw Vendor Replay"
fi
if ! git -C "$TARGET_DIR" config user.email >/dev/null; then
  git -C "$TARGET_DIR" config user.email "vendor-replay@easyclaw.invalid"
fi

if [ "$PATCH_COUNT" -gt 0 ]; then
  echo "==> Replaying $PATCH_COUNT patch(es)"
  if ! git -C "$TARGET_DIR" am --3way "${PATCH_FILES[@]}"; then
    echo >&2
    echo "FAIL: Patch replay stopped in $TARGET_DIR." >&2
    echo "      Inspect the worktree, resolve or drop the patch, then rerun." >&2
    echo "      To abandon this failed replay: git -C \"$TARGET_DIR\" am --abort" >&2
    exit 1
  fi
else
  echo "==> No patch files found; patched workspace matches pristine vendor"
fi

if [ "$SKIP_BUILD" -eq 1 ]; then
  echo "==> Skipping pnpm install + build"
else
  echo "==> Installing patched vendor dependencies"
  if ! grep -q 'node-linker=hoisted' "$TARGET_DIR/.npmrc" 2>/dev/null; then
    echo 'node-linker=hoisted' >> "$TARGET_DIR/.npmrc"
  fi

  (
    cd "$TARGET_DIR"
    pnpm install --no-frozen-lockfile
    pnpm run build
    if [ "$PROD_ONLY" -eq 1 ]; then
      pnpm install --prod --no-frozen-lockfile
    fi
  )
fi

echo "==> Patched vendor workspace ready"
echo "    base:   $ACTUAL_HASH"
echo "    target: $TARGET_DIR"
if [ "$PATCH_COUNT" -gt 0 ]; then
  echo "    stack:"
  git -C "$TARGET_DIR" log --oneline --reverse "$ACTUAL_HASH"..HEAD
fi
