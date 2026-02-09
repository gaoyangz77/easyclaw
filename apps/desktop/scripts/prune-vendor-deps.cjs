// @ts-check
// Prunes vendor/openclaw/node_modules to production-only dependencies
// before electron-builder packages the app.
//
// Two-phase pruning:
// 1. `pnpm install --prod` removes devDependencies and their transitive deps
// 2. Manual removal of packages that survive the prune due to pnpm workspace
//    hoisting (e.g. vite is a prod dep of ui/ but not needed by the gateway,
//    typescript is only a peer dep, node-llama-cpp is an optional peer dep)
//
// Idempotent: skips if already pruned (detected by absence of typescript).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const vendorDir = path.resolve(__dirname, "..", "..", "..", "vendor", "openclaw");
const nmDir = path.join(vendorDir, "node_modules");

if (!fs.existsSync(nmDir)) {
  console.log("[prune-vendor-deps] vendor/openclaw/node_modules not found, skipping.");
  process.exit(0);
}

// Idempotency: if typescript is already gone, we've already pruned.
if (!fs.existsSync(path.join(nmDir, "typescript"))) {
  console.log("[prune-vendor-deps] Already pruned (typescript absent), skipping.");
  process.exit(0);
}

// Packages that survive `pnpm install --prod` but are NOT needed at gateway
// runtime. These are kept because:
// - ui/ workspace lists vite/lit as production deps (build tools for the web UI)
// - typescript is a peer dep of nostr-tools / node-llama-cpp
// - node-llama-cpp is an optional peer dep for local LLMs
// - tsx somehow survives as a hoisted artifact
const EXTRA_REMOVE = [
  // vite + its dependency tree (build tool for ui/)
  "vite",
  "esbuild",
  "@esbuild",
  "rollup",
  "@rollup",
  "@rolldown",
  "lightningcss",
  "lightningcss-darwin-arm64",
  "lightningcss-darwin-x64",
  "lightningcss-linux-x64-gnu",
  "lightningcss-win32-x64-msvc",
  // typescript (peer dep only, not used at runtime)
  "typescript",
  // node-llama-cpp (optional peer dep for local LLMs)
  "node-llama-cpp",
  "@node-llama-cpp",
  // tsx (devDep that survives hoisting)
  "tsx",
  // lit (ui/ dependency, not needed by gateway)
  "lit",
  "lit-html",
  "lit-element",
  "@lit",
  "@lit-labs",
];

/** Return total size of a directory in bytes. */
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

const sizeBefore = dirSize(nmDir);
console.log(`[prune-vendor-deps] Before: ${(sizeBefore / 1024 / 1024).toFixed(0)}MB`);

// Phase 1: pnpm install --prod
console.log("[prune-vendor-deps] Phase 1: pnpm install --prod ...");
try {
  execSync("pnpm install --prod --no-frozen-lockfile", {
    cwd: vendorDir,
    stdio: "inherit",
    timeout: 120_000,
    env: { ...process.env, CI: "true" },
  });
} catch (err) {
  console.error("[prune-vendor-deps] pnpm install --prod failed:", err.message);
  process.exit(1);
}

const sizeAfterPnpm = dirSize(nmDir);
console.log(
  `[prune-vendor-deps] After pnpm prune: ${(sizeAfterPnpm / 1024 / 1024).toFixed(0)}MB ` +
    `(saved ${((sizeBefore - sizeAfterPnpm) / 1024 / 1024).toFixed(0)}MB)`,
);

// Phase 2: remove packages not needed by the gateway runtime
console.log("[prune-vendor-deps] Phase 2: removing non-gateway packages ...");
let extraSaved = 0;
for (const pkg of EXTRA_REMOVE) {
  const pkgDir = path.join(nmDir, pkg);
  if (!fs.existsSync(pkgDir)) continue;
  const size = dirSize(pkgDir);
  fs.rmSync(pkgDir, { recursive: true, force: true });
  extraSaved += size;
  console.log(`  removed ${pkg} (${(size / 1024 / 1024).toFixed(1)}MB)`);
}

const sizeAfter = dirSize(nmDir);
const totalSaved = sizeBefore - sizeAfter;
console.log(
  `[prune-vendor-deps] Final: ${(sizeAfter / 1024 / 1024).toFixed(0)}MB ` +
    `(total saved ${(totalSaved / 1024 / 1024).toFixed(0)}MB / ${((totalSaved / sizeBefore) * 100).toFixed(0)}%)`,
);
