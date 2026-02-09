// @ts-check
// Prunes vendor/openclaw/node_modules to production-only dependencies
// before electron-builder packages the app.
//
// Three-phase pruning:
// 1. `pnpm install --prod` removes devDependencies and their transitive deps
// 2. Manual removal of packages that survive the prune due to pnpm workspace
//    hoisting (e.g. vite is a prod dep of ui/ but not needed by the gateway)
// 3. Strip non-runtime files (docs, tests, source maps, etc.) to reduce file
//    count — critical for HFS+ DMGs where each file takes ≥4KB due to block
//    allocation, and excessive file count can overflow the DMG volume.
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

// --- Phase 2 config: packages not needed by the gateway runtime ---
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

// --- Phase 3 config: non-runtime files to strip ---
const STRIP_FILES = new Set([
  "README.md",
  "README",
  "readme.md",
  "CHANGELOG.md",
  "CHANGELOG",
  "changelog.md",
  "HISTORY.md",
  "CHANGES.md",
  "LICENSE",
  "LICENSE.md",
  "license",
  "LICENSE.txt",
  "LICENSE-MIT",
  "LICENSE-MIT.txt",
  "AUTHORS",
  "CONTRIBUTORS",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  ".npmignore",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
  ".prettierrc.json",
  ".editorconfig",
  "tsconfig.json",
  ".travis.yml",
  "Makefile",
  "Gruntfile.js",
  "Gulpfile.js",
  ".gitattributes",
  "appveyor.yml",
  ".babelrc",
  "jest.config.js",
  "karma.conf.js",
  ".jshintrc",
  ".nycrc",
  "tslint.json",
]);

const STRIP_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "__test__",
  "testing",
  "docs",
  "doc",
  "documentation",
  "example",
  "examples",
  "demo",
  "demos",
  ".github",
  ".idea",
  ".vscode",
  "benchmark",
  "benchmarks",
  ".nyc_output",
  "coverage",
]);

const STRIP_EXTS = [".map"];

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

/** Count files in a directory (excluding symlinks). */
function fileCount(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      count += fileCount(full);
    } else {
      count++;
    }
  }
  return count;
}

const sizeBefore = dirSize(nmDir);
const filesBefore = fileCount(nmDir);
console.log(
  `[prune-vendor-deps] Before: ${(sizeBefore / 1024 / 1024).toFixed(0)}MB, ${filesBefore} files`,
);

// ─── Phase 1: pnpm install --prod ───
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

const sizeP1 = dirSize(nmDir);
console.log(
  `[prune-vendor-deps] After Phase 1: ${(sizeP1 / 1024 / 1024).toFixed(0)}MB ` +
    `(saved ${((sizeBefore - sizeP1) / 1024 / 1024).toFixed(0)}MB)`,
);

// ─── Phase 2: remove non-gateway packages ───
console.log("[prune-vendor-deps] Phase 2: removing non-gateway packages ...");
for (const pkg of EXTRA_REMOVE) {
  const pkgDir = path.join(nmDir, pkg);
  if (!fs.existsSync(pkgDir)) continue;
  const size = dirSize(pkgDir);
  fs.rmSync(pkgDir, { recursive: true, force: true });
  console.log(`  removed ${pkg} (${(size / 1024 / 1024).toFixed(1)}MB)`);
}

const sizeP2 = dirSize(nmDir);
console.log(
  `[prune-vendor-deps] After Phase 2: ${(sizeP2 / 1024 / 1024).toFixed(0)}MB ` +
    `(saved ${((sizeBefore - sizeP2) / 1024 / 1024).toFixed(0)}MB)`,
);

// ─── Phase 3: strip non-runtime files ───
// This is critical for HFS+ DMGs: 55K+ files cause block allocation overhead
// that can overflow the DMG volume. Stripping docs/tests/maps reduces file
// count by ~15K and frees ~110MB.
console.log("[prune-vendor-deps] Phase 3: stripping non-runtime files ...");
let strippedFiles = 0;
let strippedBytes = 0;

function stripDir(dir, depth) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      // Remove entire directories matching STRIP_DIRS (only within packages, depth ≤ 3)
      if (depth <= 3 && STRIP_DIRS.has(entry.name)) {
        const size = dirSize(full);
        const count = fileCount(full);
        fs.rmSync(full, { recursive: true, force: true });
        strippedBytes += size;
        strippedFiles += count;
        continue;
      }
      stripDir(full, depth + 1);
    } else {
      // Remove files matching STRIP_FILES or STRIP_EXTS
      if (STRIP_FILES.has(entry.name)) {
        strippedBytes += fs.statSync(full).size;
        fs.unlinkSync(full);
        strippedFiles++;
        continue;
      }
      for (const ext of STRIP_EXTS) {
        if (entry.name.endsWith(ext)) {
          strippedBytes += fs.statSync(full).size;
          fs.unlinkSync(full);
          strippedFiles++;
          break;
        }
      }
    }
  }
}

stripDir(nmDir, 0);
console.log(
  `  stripped ${strippedFiles} files (${(strippedBytes / 1024 / 1024).toFixed(0)}MB)`,
);

// ─── Summary ───
const sizeAfter = dirSize(nmDir);
const filesAfter = fileCount(nmDir);
const totalSaved = sizeBefore - sizeAfter;
console.log(
  `[prune-vendor-deps] Final: ${(sizeAfter / 1024 / 1024).toFixed(0)}MB, ${filesAfter} files ` +
    `(saved ${(totalSaved / 1024 / 1024).toFixed(0)}MB / ${((totalSaved / sizeBefore) * 100).toFixed(0)}%, ` +
    `removed ${filesBefore - filesAfter} files)`,
);
