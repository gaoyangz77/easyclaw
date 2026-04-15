#!/usr/bin/env bash
# Dev launcher for Windows — works around CMD's lack of KEY=value syntax
set -euo pipefail

export PATH="$PATH:/c/Users/Administrator/AppData/Roaming/npm"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_EXE="$REPO_ROOT/node_modules/.pnpm/electron@$(ls "$REPO_ROOT/node_modules/.pnpm/" | grep '^electron@' | head -1 | sed 's/electron@//')/node_modules/electron/dist/electron.exe"

# Kill any leftover processes
for port in 5180 3210; do
  pid=$(netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING | awk '{print $5}' | head -1)
  if [ -n "$pid" ]; then
    taskkill //F //PID "$pid" 2>/dev/null || true
  fi
done
taskkill //F //IM electron.exe 2>/dev/null || true

# Start panel dev server in background (Vite HMR — panel changes auto-refresh)
echo "Starting panel dev server on :5180..."
pnpm --filter @rivonclaw/panel dev &
PANEL_PID=$!

# Wait for Vite to be ready
sleep 4

# Build desktop main process
echo "Building desktop main process..."
cd "$REPO_ROOT/apps/desktop"
npx tsdown

# Launch Electron pointing at Vite dev server
# - Panel changes (CSS, TSX) → Vite HMR, no restart needed
# - Desktop changes (main.ts, store, api-routes) → re-run dev.sh
echo "Launching Electron..."
echo ""
echo "  Panel changes:   auto hot-reload (no restart needed)"
echo "  Desktop changes: re-run 'bash dev.sh'"
echo ""
PANEL_DEV_URL=http://localhost:5180 "$ELECTRON_EXE" .

# Cleanup panel on exit
kill $PANEL_PID 2>/dev/null || true
