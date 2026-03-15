"use strict";

/**
 * Standalone compile-cache warmup script.
 *
 * Spawns the real gateway process, waits for the "gateway listening" milestone
 * on stderr (or a 60s timeout), then exits. All exit paths return 0 because
 * the compile cache is best-effort — V8 flushes on milestone or process exit.
 *
 * Usage:
 *   node compile-cache-warmup.cjs <electronPath> <openclawMjs> [--startup-timer <path>]
 *
 * Required env: OPENCLAW_CONFIG_PATH, OPENCLAW_STATE_DIR,
 *               OPENCLAW_BUNDLED_PLUGINS_DIR, NODE_COMPILE_CACHE
 */

const { spawn } = require("child_process");

const electronPath = process.argv[2];
const openclawMjs = process.argv[3];

if (!electronPath || !openclawMjs) {
  console.error("[compile-cache-warmup] Usage: node compile-cache-warmup.cjs <electronPath> <openclawMjs> [--startup-timer <path>]");
  process.exit(0);
}

// Build child env
const childEnv = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" });

const startupTimerIdx = process.argv.indexOf("--startup-timer");
if (startupTimerIdx !== -1 && process.argv[startupTimerIdx + 1]) {
  childEnv.NODE_OPTIONS = `--require ${process.argv[startupTimerIdx + 1]}`;
}

const child = spawn(electronPath, [openclawMjs, "gateway"], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

let done = false;

const finish = () => {
  if (done) return;
  done = true;
  try { child.kill("SIGTERM"); } catch {}
  // Safety: if SIGTERM doesn't terminate the child within 5s, force-kill and exit.
  setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
    process.exit(0);
  }, 5000).unref();
};

const hardTimeout = setTimeout(() => {
  console.log("[compile-cache-warmup] Timed out after 60s (cache may be incomplete).");
  finish();
}, 60_000);

child.stderr.on("data", (/** @type {Buffer} */ chunk) => {
  const text = chunk.toString();
  if (text.includes("[startup-timer]") && text.includes("gateway listening")) {
    console.log("[compile-cache-warmup] Gateway startup milestone reached.");
    finish();
  }
});

child.on("exit", () => {
  done = true;
  clearTimeout(hardTimeout);
  process.exit(0);
});
