// @ts-check
// Restores vendor/openclaw/node_modules to a full pre-bundle state when a
// previous packaging run already pruned/bundled it down to a runtime-only set.
//
// Why this exists:
// - bundle-vendor-deps.cjs pre-bundles extensions and the main gateway bundle
//   from vendor/openclaw sources/dist, which requires the full dependency tree.
// - After a successful run, cleanupNodeModules() shrinks node_modules to a
//   runtime keepset for installer size/file-count reasons.
// - If a later run needs to fresh re-bundle (for example after deleting
//   dist/.bundled), the pruned node_modules is no longer sufficient.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const vendorDir = path.resolve(__dirname, "..", "..", "..", "vendor", "openclaw");
const nmDir = path.join(vendorDir, "node_modules");
const typescriptDir = path.join(nmDir, "typescript");
const keepSetPath = path.join(nmDir, ".bundle-keepset.json");

if (!fs.existsSync(nmDir)) {
  console.log("[restore-vendor-deps] vendor/openclaw/node_modules not found, skipping.");
  process.exit(0);
}

const looksPruned = !fs.existsSync(typescriptDir) || fs.existsSync(keepSetPath);
if (!looksPruned) {
  console.log("[restore-vendor-deps] vendor deps already look complete, skipping.");
  process.exit(0);
}

console.log("[restore-vendor-deps] Restoring full vendor dependencies with pnpm install ...");
try {
  execSync("pnpm install --no-frozen-lockfile", {
    cwd: vendorDir,
    stdio: "inherit",
    timeout: 10 * 60_000,
    env: { ...process.env, CI: "true" },
  });
} catch (err) {
  console.error("[restore-vendor-deps] pnpm install failed:", err.message);
  process.exit(1);
}

try {
  execSync("git checkout -- .", { cwd: vendorDir, stdio: "ignore" });
} catch {}

try {
  fs.rmSync(keepSetPath, { force: true });
} catch {}

const restoredTypescript = fs.existsSync(typescriptDir);
console.log(
  restoredTypescript
    ? "[restore-vendor-deps] Vendor dependencies restored."
    : "[restore-vendor-deps] Warning: install completed but typescript is still missing.",
);
