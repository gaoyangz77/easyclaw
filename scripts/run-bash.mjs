#!/usr/bin/env node
// Tiny cross-platform wrapper that finds bash and runs a script.
// Used by postinstall so `pnpm install` works from PowerShell on Windows
// without requiring users to add Git for Windows to PATH manually.
//
// Why not call bash directly from package.json:
//   - PowerShell launchers for npm/pnpm don't search Git for Windows paths.
//   - WSL bash is incompatible with our Windows scripts (different paths).
//   - cygwin/msys2 bash is not always present.
// This wrapper finds the right bash via PATH first, then falls back to the
// canonical Git for Windows install location.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-bash.mjs <script.sh> [args...]");
  process.exit(1);
}

function findBash() {
  if (process.platform !== "win32") return "bash";

  // Try PATH first — Git Bash sometimes is on PATH.
  const which = spawnSync("where.exe", ["bash"], { encoding: "utf8" });
  if (which.status === 0) {
    const first = which.stdout.split(/\r?\n/).find((l) => l.trim() && !/system32/i.test(l));
    if (first) return first.trim();
  }

  // Fall back to canonical Git for Windows install paths.
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const bash = findBash();
if (!bash) {
  console.error(
    "[run-bash] bash not found. Install Git for Windows (https://git-scm.com/download/win)\n" +
      "         or add an existing bash to your PATH and re-run.",
  );
  process.exit(1);
}

const scriptPath = resolve(args[0]);
const result = spawnSync(bash, [scriptPath, ...args.slice(1)], {
  stdio: "inherit",
  shell: false,
});
process.exit(result.status ?? 1);
