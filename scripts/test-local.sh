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
# A summary table is printed at the end showing each step's status and duration.
#
# Native module strategy:
#   rebuild-native.sh builds better-sqlite3 twice (for Node.js and Electron)
#   and places both in lib/binding/node-v{ABI}-{platform}-{arch}/. The
#   `bindings` package auto-selects the correct one at runtime. No switching
#   needed — unit tests and E2E dev tests coexist.
# =============================================================================
set -uo pipefail
# Not using set -e — we track each step's exit code for the summary table.

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

# ---- Summary tracking ----
STEP_NAMES=()
STEP_STATUSES=()
STEP_DURATIONS=()
STEP_E2E_COUNTS=()
STEP_FAILED_TESTS=()
PIPELINE_FAILED=false
PIPELINE_START=$SECONDS
SUMMARY_TMPDIR=$(mktemp -d)

format_duration() {
  local secs=$1
  if (( secs >= 60 )); then
    printf "%dm%02ds" $((secs / 60)) $((secs % 60))
  else
    printf "%ds" "$secs"
  fi
}

record_step() {
  local name="$1" rc="$2" duration="$3" e2e_counts="${4:-}" failed_tests="${5:-}"
  STEP_NAMES+=("$name")
  if [ "$rc" -eq 0 ]; then
    STEP_STATUSES+=("pass")
  else
    STEP_STATUSES+=("fail")
    PIPELINE_FAILED=true
  fi
  STEP_DURATIONS+=("$duration")
  STEP_E2E_COUNTS+=("$e2e_counts")
  STEP_FAILED_TESTS+=("$failed_tests")
}

parse_e2e_output() {
  local log_file="$1"
  # Strip ANSI escape codes for reliable parsing
  local clean_file="${log_file}.clean"
  sed $'s/\033\[[0-9;]*m//g' "$log_file" > "$clean_file" 2>/dev/null || cp "$log_file" "$clean_file"

  local passed failed flaky total
  passed=$(grep -oE '[0-9]+ passed' "$clean_file" | tail -1 | grep -oE '[0-9]+' || true)
  failed=$(grep -oE '[0-9]+ failed' "$clean_file" | tail -1 | grep -oE '[0-9]+' || true)
  flaky=$(grep -oE '[0-9]+ flaky' "$clean_file" | tail -1 | grep -oE '[0-9]+' || true)
  passed=${passed:-0}
  failed=${failed:-0}
  flaky=${flaky:-0}
  total=$((passed + failed + flaky))

  if [ "$total" -gt 0 ]; then
    if [ "$flaky" -gt 0 ]; then
      E2E_COUNTS="$passed+${flaky}flaky/$total"
    else
      E2E_COUNTS="$passed/$total"
    fi
  else
    E2E_COUNTS=""
  fi

  E2E_FAILURES=""
  if [ "$failed" -gt 0 ]; then
    E2E_FAILURES=$(grep -E '^[[:space:]]+[0-9]+\) ' "$clean_file" \
      | sed 's/^[[:space:]]*[0-9]*)[[:space:]]*//' \
      | sed 's/^\[.*\] › //' \
      | sed 's/[[:space:]]*─*$//' \
      || true)
  fi
  rm -f "$clean_file"
}

print_summary() {
  # Skip summary if no steps were recorded (e.g. early argument error)
  if [ ${#STEP_NAMES[@]} -eq 0 ]; then
    return
  fi

  local total_duration=$((SECONDS - PIPELINE_START))
  local result
  if [ "$PIPELINE_FAILED" = true ]; then
    result="FAIL"
  else
    result="PASS"
  fi

  echo ""
  echo "========== SUMMARY =========="

  for i in "${!STEP_NAMES[@]}"; do
    local name="${STEP_NAMES[$i]}"
    local status="${STEP_STATUSES[$i]}"
    local duration
    duration=$(format_duration "${STEP_DURATIONS[$i]}")
    local e2e_counts="${STEP_E2E_COUNTS[$i]}"
    local failures="${STEP_FAILED_TESTS[$i]}"

    local icon
    if [ "$status" = "pass" ]; then
      icon="✅"
    else
      icon="❌"
    fi

    local label="$name"
    if [ -n "$e2e_counts" ]; then
      label="$name ($e2e_counts)"
    fi

    printf "%s %-22s %6s\n" "$icon" "$label" "$duration"

    if [ -n "$failures" ]; then
      while IFS= read -r test_name; do
        [ -n "$test_name" ] && echo "   FAILED: $test_name"
      done <<< "$failures"
    fi
  done

  echo "============================="
  printf "Total: %s | Result: %s\n" "$(format_duration "$total_duration")" "$result"
}

cleanup() {
  print_summary
  rm -rf "${SUMMARY_TMPDIR:-}"
}
trap cleanup EXIT

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
if [ "$PIPELINE_FAILED" = false ]; then
  step "Install dependencies"
  step_start=$SECONDS
  if (cd "$REPO_ROOT" && pnpm install --frozen-lockfile); then
    record_step "pnpm install" 0 $((SECONDS - step_start))
    info "Dependencies up to date."
  else
    record_step "pnpm install" 1 $((SECONDS - step_start))
  fi
fi

# ---- Step 2: Verify vendor/openclaw matches .openclaw-version ----
if [ "$PIPELINE_FAILED" = false ]; then
  step "Verify vendor/openclaw version"
  step_start=$SECONDS
  vendor_rc=0
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
      bash "$REPO_ROOT/scripts/setup-vendor.sh" || vendor_rc=$?
    fi
  else
    info "vendor/openclaw not found — running setup-vendor.sh..."
    bash "$REPO_ROOT/scripts/setup-vendor.sh" || vendor_rc=$?
  fi

  record_step "vendor check" "$vendor_rc" $((SECONDS - step_start))
fi

# ---- Step 3: Prebuild native modules ----
# postinstall hook normally handles this, but run explicitly in case
# pnpm install was a no-op (deps already satisfied).
if [ "$PIPELINE_FAILED" = false ]; then
  step "Prebuild native modules (Node.js + Electron)"
  step_start=$SECONDS
  if bash "$REPO_ROOT/scripts/rebuild-native.sh"; then
    record_step "rebuild-native" 0 $((SECONDS - step_start))
    info "Native prebuilds ready."
  else
    record_step "rebuild-native" 1 $((SECONDS - step_start))
  fi
fi

# ---- Step 4: Build all packages ----
if [ "$PIPELINE_FAILED" = false ]; then
  step "Build all workspace packages"
  step_start=$SECONDS
  if (cd "$REPO_ROOT" && pnpm run build); then
    record_step "build" 0 $((SECONDS - step_start))
    info "Build complete."
  else
    record_step "build" 1 $((SECONDS - step_start))
  fi
fi

# ---- Step 5: Unit tests ----
if [ "$PIPELINE_FAILED" = false ] && [ "$SKIP_TESTS" = false ]; then
  step "Run unit tests"
  step_start=$SECONDS
  if (cd "$REPO_ROOT" && pnpm run test); then
    record_step "unit tests" 0 $((SECONDS - step_start))
    info "Unit tests passed."
  else
    record_step "unit tests" 1 $((SECONDS - step_start))
  fi
fi

# ---- Step 6: E2E tests (dev mode) ----
if [ "$PIPELINE_FAILED" = false ] && [ "$SKIP_TESTS" = false ]; then
  step "Run E2E tests (dev mode)"
  step_start=$SECONDS
  E2E_DEV_LOG="$SUMMARY_TMPDIR/e2e_dev.log"

  (cd "$DESKTOP_DIR" && pnpm run test:e2e:dev) 2>&1 | tee "$E2E_DEV_LOG"
  e2e_rc=$?
  step_duration=$((SECONDS - step_start))

  parse_e2e_output "$E2E_DEV_LOG"
  record_step "e2e dev" "$e2e_rc" "$step_duration" "$E2E_COUNTS" "$E2E_FAILURES"
  [ "$e2e_rc" -eq 0 ] && info "E2E dev tests passed."
fi

# ---- Step 7: Pack (unpacked app for prod e2e) ----
if [ "$PIPELINE_FAILED" = false ]; then
  step "Pack application (electron-builder --dir)"
  step_start=$SECONDS
  # Clean stale release dirs to avoid picking up wrong binary in prod E2E
  rm -rf "$RELEASE_DIR"
  if (cd "$DESKTOP_DIR" && pnpm run pack); then
    record_step "pack" 0 $((SECONDS - step_start))
    info "Pack complete."
  else
    record_step "pack" 1 $((SECONDS - step_start))
  fi
fi

# ---- Step 8: Restore dual prebuilds ----
# electron-builder's @electron/rebuild overwrites build/Release/ with Electron ABI.
# Restore dual prebuilds so the Node.js-based E2E seed helper can load better-sqlite3.
if [ "$PIPELINE_FAILED" = false ]; then
  step "Restore dual prebuilds after electron-builder"
  step_start=$SECONDS
  if bash "$REPO_ROOT/scripts/rebuild-native.sh"; then
    record_step "rebuild-native" 0 $((SECONDS - step_start))
  else
    record_step "rebuild-native" 1 $((SECONDS - step_start))
  fi
fi

# ---- Step 9: E2E tests (prod mode) ----
if [ "$PIPELINE_FAILED" = false ] && [ "$SKIP_TESTS" = false ]; then
  step "Run E2E tests (prod mode)"
  step_start=$SECONDS

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
  prod_e2e_skip=false
  if [ "$PLATFORM" = "mac" ]; then
    APP_DIR=$(find "$RELEASE_DIR" -maxdepth 2 -name "EasyClaw.app" -print -quit 2>/dev/null || true)
    if [ -z "$APP_DIR" ]; then
      warn "No EasyClaw.app found in $RELEASE_DIR after pack"
      record_step "e2e prod" 1 $((SECONDS - step_start))
      prod_e2e_skip=true
    else
      EXEC_PATH="$APP_DIR/Contents/MacOS/EasyClaw"
    fi
  elif [ "$PLATFORM" = "win" ]; then
    EXEC_PATH=$(find "$RELEASE_DIR" -maxdepth 2 -name "EasyClaw.exe" -not -path "*Setup*" -print -quit 2>/dev/null || true)
    if [ -z "$EXEC_PATH" ]; then
      warn "No EasyClaw.exe found in $RELEASE_DIR after pack"
      record_step "e2e prod" 1 $((SECONDS - step_start))
      prod_e2e_skip=true
    fi
  else
    warn "Prod E2E not supported on $PLATFORM, skipping."
    prod_e2e_skip=true
  fi

  if [ "$prod_e2e_skip" = false ] && [ -n "$EXEC_PATH" ]; then
    info "Launching prod E2E with: $EXEC_PATH"
    E2E_PROD_LOG="$SUMMARY_TMPDIR/e2e_prod.log"

    (cd "$DESKTOP_DIR" && E2E_EXECUTABLE_PATH="$EXEC_PATH" pnpm run test:e2e:prod) 2>&1 | tee "$E2E_PROD_LOG"
    e2e_rc=$?
    step_duration=$((SECONDS - step_start))

    parse_e2e_output "$E2E_PROD_LOG"
    record_step "e2e prod" "$e2e_rc" "$step_duration" "$E2E_COUNTS" "$E2E_FAILURES"
    [ "$e2e_rc" -eq 0 ] && info "E2E prod tests passed."
  fi
fi

# ---- Exit ----
# The cleanup trap prints the summary table and removes temp files.
if [ "$PIPELINE_FAILED" = true ]; then
  exit 1
fi
exit 0
