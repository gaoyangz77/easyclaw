// @ts-check
// Bundles vendor/openclaw dist chunks + JS node_modules into a single file
// using esbuild, then cleans up bundled packages from node_modules.
//
// Must run AFTER prune-vendor-deps.cjs (which removes devDeps) and
// BEFORE electron-builder (which copies the results into the installer).
//
// This reduces file count for the installer:
//   - dist/: 758 chunk files → 3 files (bundle, babel.cjs, warning-filter)
//   - node_modules/: kept intact (vendor .ts extensions loaded via jiti at
//     runtime need the full dependency tree)
//
// The dist/ reduction alone cuts ~755 files from the installer.  node_modules
// is NOT pruned because bundled vendor extensions (device-pair, memory-core,
// qwen-portal-auth, etc.) are TypeScript files loaded by jiti at runtime.
// jiti transpiles them on the fly, and those .ts files transitively import
// the entire vendor source tree + npm dependencies (@mariozechner/pi-ai,
// @aws-sdk/*, etc.).  Removing any package breaks extension loading.

const fs = require("fs");
const path = require("path");

const vendorDir = path.resolve(__dirname, "..", "..", "..", "vendor", "openclaw");
const distDir = path.join(vendorDir, "dist");
const nmDir = path.join(vendorDir, "node_modules");

const ENTRY_FILE = path.join(distDir, "entry.js");
const BUNDLE_TEMP = path.join(distDir, "gateway-bundle.tmp.mjs");

// ─── External packages: cannot be bundled by esbuild ───
// Native modules (.node binaries), complex dynamic loaders, and undici
// (needed by proxy-setup.cjs via createRequire at runtime).
const EXTERNAL_PACKAGES = [
  // Native modules (contain .node or .dylib binaries)
  "sharp",
  "@img/*",
  "koffi",
  "@napi-rs/canvas",
  "@napi-rs/canvas-*",
  "@lydell/node-pty",
  "@lydell/node-pty-*",
  "@matrix-org/matrix-sdk-crypto-nodejs",
  "@discordjs/opus",
  "sqlite-vec",
  "sqlite-vec-*",
  "better-sqlite3",
  "@snazzah/*",

  // Complex dynamic loading patterns (runtime fs access, .proto files, etc.)
  "protobufjs",
  "protobufjs/*",
  "playwright-core",
  "playwright",
  "chromium-bidi",
  "chromium-bidi/*",

  // Optional/missing (may not be installed, referenced in try/catch)
  "ffmpeg-static",
  "authenticate-pam",
  "esbuild",
  "node-llama-cpp",

  // Proxy dependency (needed by proxy-setup.cjs via createRequire)
  "undici",

  // Schema library used by both bundled code AND plugins loaded at runtime.
  // Must stay in node_modules so plugins can resolve it.
  "@sinclair/typebox",
  "@sinclair/typebox/*",
];

// Path to the static vendor model catalog JSON that replaces the dynamic
// import of @mariozechner/pi-ai/dist/models.generated.js at runtime.
const VENDOR_MODELS_JSON = path.join(distDir, "vendor-models.json");

// Files to preserve in dist/ (everything else is a chunk file to delete).
// After Phase 2 the bundle IS entry.js (renamed from temp), so only entry.js
// and auxiliary files need to survive Phase 3.
const KEEP_DIST_FILES = new Set([
  "entry.js",
  "babel.cjs",       // jiti runtime loader (see Phase 2 comment)
  ".bundled",
  "vendor-models.json",
  "warning-filter.js",
  "warning-filter.mjs",
]);

// ─── Helpers ───

/** Count files + symlinks in a directory recursively. */
function countFiles(dir) {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        count++;
      } else if (entry.isDirectory()) {
        count += countFiles(full);
      } else {
        count++;
      }
    }
  } catch {}
  return count;
}


// ─── Phase 0: Extract vendor model catalog to static JSON ───
// model-catalog.ts dynamically imports models.generated.js from
// @mariozechner/pi-ai at runtime. We extract { id, name } per provider
// at build time into a static JSON file that the bundle inlines.

async function extractVendorModelCatalog() {
  console.log("[bundle-vendor-deps] Phase 0: Extracting vendor model catalog...");

  const piAiModelsPath = path.join(
    nmDir,
    "@mariozechner",
    "pi-ai",
    "dist",
    "models.generated.js",
  );

  if (!fs.existsSync(piAiModelsPath)) {
    console.log("[bundle-vendor-deps] models.generated.js not found, writing empty catalog.");
    fs.writeFileSync(VENDOR_MODELS_JSON, "{}\n", "utf-8");
    return;
  }

  const { pathToFileURL } = require("url");
  const mod = await import(pathToFileURL(piAiModelsPath).href);
  const allModels = mod.MODELS;

  if (!allModels || typeof allModels !== "object") {
    console.log("[bundle-vendor-deps] MODELS export not found, writing empty catalog.");
    fs.writeFileSync(VENDOR_MODELS_JSON, "{}\n", "utf-8");
    return;
  }

  // Extract only { id, name } per provider — same structure readVendorModelCatalog() returns
  const catalog = {};
  let totalModels = 0;

  for (const [provider, modelMap] of Object.entries(allModels)) {
    if (!modelMap || typeof modelMap !== "object") continue;

    const entries = [];
    for (const model of Object.values(modelMap)) {
      const id = String(model?.id ?? "").trim();
      if (!id) continue;
      entries.push({
        id,
        name: String(model?.name ?? id).trim() || id,
      });
    }

    if (entries.length > 0) {
      catalog[provider] = entries;
      totalModels += entries.length;
    }
  }

  fs.writeFileSync(VENDOR_MODELS_JSON, JSON.stringify(catalog) + "\n", "utf-8");
  const size = fs.statSync(VENDOR_MODELS_JSON).size;
  console.log(
    `[bundle-vendor-deps] Wrote vendor-models.json: ${Object.keys(catalog).length} providers, ` +
      `${totalModels} models (${(size / 1024).toFixed(1)}KB)`,
  );
}

// ─── Phase 1: esbuild bundle ───

function bundleWithEsbuild() {
  console.log("[bundle-vendor-deps] Phase 1: Bundling dist/entry.js with esbuild...");

  let esbuild;
  try {
    // Resolve from apps/desktop (where esbuild is a devDep)
    const desktopDir = path.resolve(__dirname, "..");
    esbuild = require(require.resolve("esbuild", { paths: [desktopDir] }));
  } catch {
    console.error(
      "[bundle-vendor-deps] esbuild not found. Ensure it is listed in " +
        "apps/desktop/package.json devDependencies and `pnpm install` has been run.",
    );
    process.exit(1);
  }

  const t0 = Date.now();
  const result = esbuild.buildSync({
    entryPoints: [ENTRY_FILE],
    bundle: true,
    outfile: BUNDLE_TEMP,
    format: "esm",
    platform: "node",
    target: "node22",
    external: EXTERNAL_PACKAGES,
    logLevel: "warning",
    metafile: true,
    sourcemap: false,
    // Some bundled packages (e.g. @smithy/*) use CJS require() for Node.js
    // builtins like "buffer". esbuild's ESM output wraps these in a
    // __require() shim that throws "Dynamic require of X is not supported".
    // Providing a real require via createRequire fixes this.
    banner: {
      js: 'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);',
    },
  });

  const elapsed = Date.now() - t0;
  const bundleSize = fs.statSync(BUNDLE_TEMP).size;
  console.log(
    `[bundle-vendor-deps] Bundle created: ${(bundleSize / 1024 / 1024).toFixed(1)}MB in ${elapsed}ms`,
  );

  // Log which packages esbuild treated as external imports (for debugging)
  if (result.metafile) {
    const usedExternals = new Set();
    for (const output of Object.values(result.metafile.outputs)) {
      for (const imp of output.imports || []) {
        if (imp.external) {
          const parts = imp.path.split("/");
          const pkgName = imp.path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
          usedExternals.add(pkgName);
        }
      }
    }
    console.log(
      `[bundle-vendor-deps] External packages referenced: ${[...usedExternals].sort().join(", ")}`,
    );
  }
}

// ─── Phase 2: Replace entry.js with the bundle ───
// The bundle must be named entry.js (not gateway-bundle.mjs) because the
// vendor's isMainModule() check compares import.meta.url against the
// wrapperEntryPairs table which only recognises "entry.js".  Using a
// re-export stub breaks this: import.meta.url inside the bundle would
// point at "gateway-bundle.mjs", causing isMainModule() to return false
// and the gateway to exit immediately with code 0.

function replaceEntryWithBundle() {
  console.log("[bundle-vendor-deps] Phase 2: Replacing entry.js with bundle...");
  fs.unlinkSync(ENTRY_FILE);
  fs.renameSync(BUNDLE_TEMP, ENTRY_FILE);

  // jiti's lazyTransform() does:
  //   createRequire(import.meta.url)("../dist/babel.cjs")
  // which resolves relative to entry.js → dist/babel.cjs.
  // esbuild inlined babel.cjs statically, but this dynamic createRequire
  // bypasses the static bundle and needs the file on disk.
  const babelSrc = path.join(nmDir, "@mariozechner", "jiti", "dist", "babel.cjs");
  const babelDst = path.join(distDir, "babel.cjs");
  if (fs.existsSync(babelSrc)) {
    fs.copyFileSync(babelSrc, babelDst);
    console.log("[bundle-vendor-deps] Copied babel.cjs to dist/ for jiti runtime loader");
  }
}

// ─── Phase 3: Delete chunk files from dist/ ───

function deleteChunkFiles() {
  console.log("[bundle-vendor-deps] Phase 3: Deleting chunk files from dist/...");

  let deletedCount = 0;
  let deletedBytes = 0;

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    // Keep subdirectories (bundled/, canvas-host/, cli/, etc.)
    if (entry.isDirectory()) continue;
    // Keep preserved files
    if (KEEP_DIST_FILES.has(entry.name)) continue;
    // Delete all other files (chunk .js files)
    const fullPath = path.join(distDir, entry.name);
    try {
      deletedBytes += fs.statSync(fullPath).size;
      fs.unlinkSync(fullPath);
      deletedCount++;
    } catch {}
  }

  console.log(
    `[bundle-vendor-deps] Deleted ${deletedCount} chunk files (${(deletedBytes / 1024 / 1024).toFixed(1)}MB)`,
  );
}

// ─── Phase 4: Light node_modules cleanup ───
// We keep ALL packages in node_modules because vendor .ts extensions loaded
// via jiti at runtime transitively import the entire dependency tree.
// Only remove .bin/ (not needed at runtime).

function cleanupNodeModules() {
  console.log("[bundle-vendor-deps] Phase 4: Light node_modules cleanup...");

  if (!fs.existsSync(nmDir)) {
    console.log("[bundle-vendor-deps] node_modules not found, skipping.");
    return;
  }

  // Remove .bin/ directory (not needed at runtime)
  const binDir = path.join(nmDir, ".bin");
  if (fs.existsSync(binDir)) {
    const binFiles = countFiles(binDir);
    fs.rmSync(binDir, { recursive: true, force: true });
    console.log(`[bundle-vendor-deps] Removed .bin/ (${binFiles} files)`);
  }

  const totalFiles = countFiles(nmDir);
  console.log(`[bundle-vendor-deps] node_modules: ${totalFiles} files (kept intact for jiti runtime)`);
}

// ─── Phase 5: Smoke test the bundled gateway ───
//
// Spawns `node openclaw.mjs gateway` with a temporary state dir and verifies
// the process stays alive for a few seconds and produces stderr output.
// This catches three classes of bugs that only manifest after bundling:
//
//   1. isMainModule() mismatch — The vendor's entry.ts uses import.meta.url
//      to decide if it's the main module.  If the bundle file is not named
//      "entry.js", the check fails and the process exits silently with code 0.
//      Fix: Phase 2 must rename the bundle to entry.js (not use a re-export stub).
//
//   2. CJS require() in ESM bundle — Some bundled packages (e.g. @smithy/*)
//      use CJS require() for Node.js builtins like "buffer".  esbuild's ESM
//      output wraps these in __require() which throws "Dynamic require of X
//      is not supported".  Fix: add a createRequire banner in the esbuild config.
//
//   3. Missing runtime dependencies — Plugins loaded at runtime (outside the
//      bundle) may import packages that Phase 4 cleanup deleted.  Symptom:
//      "Cannot find module 'X'" in stderr.  Fix: add the package to
//      EXTERNAL_PACKAGES so it survives both bundling and cleanup.
//
// See docs/BUNDLE_VENDOR.md for full design docs and runbook.

function smokeTestGateway() {
  console.log("[bundle-vendor-deps] Phase 5: Smoke testing bundled gateway...");

  const { execFileSync } = require("child_process");
  const os = require("os");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "easyclaw-bundle-smoke-"));
  const openclawMjs = path.join(vendorDir, "openclaw.mjs");

  // Write a minimal config so the gateway can start.
  // Use a high ephemeral port to avoid conflicts with running services.
  // We intentionally let the gateway discover vendor-internal extensions
  // (device-pair, memory-core, etc.) to verify that jiti can load .ts files
  // (i.e. babel.cjs is present in dist/).  EasyClaw's own extensions
  // (easyclaw-tools, file-permissions) are not present in the smoke test
  // environment; that's fine — the test just checks the gateway starts.
  const minimalConfig = {
    gateway: { port: 59999, mode: "local" },
    models: {},
    agents: { defaults: { skipBootstrap: true } },
  };
  fs.writeFileSync(
    path.join(tmpDir, "openclaw.json"),
    JSON.stringify(minimalConfig),
    "utf-8",
  );

  let allOutput = "";
  let exitCode = null;

  try {
    // Run for up to 8 seconds.  A healthy gateway stays alive (listening on
    // its port); we kill it after the timeout.  An unhealthy gateway exits
    // immediately (code 0 or 1) within the first second.
    // The gateway may also exit after ~5s if it tries (and fails) to build
    // the Control UI assets — this is expected in the smoke test environment.
    const stdout = execFileSync(process.execPath, [openclawMjs, "gateway"], {
      cwd: tmpDir,
      timeout: 8000,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: path.join(tmpDir, "openclaw.json"),
        OPENCLAW_STATE_DIR: tmpDir,
        // Prevent Electron compile cache conflicts
        NODE_COMPILE_CACHE: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGTERM",
    });
    // If execFileSync returns normally, the process exited on its own
    exitCode = 0;
    allOutput = (stdout || "").toString();
  } catch (err) {
    exitCode = /** @type {any} */ (err).status ?? null;
    const stderrStr = (/** @type {any} */ (err).stderr || "").toString();
    const stdoutStr = (/** @type {any} */ (err).stdout || "").toString();
    allOutput = stdoutStr + "\n" + stderrStr;
  }

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  // ── Diagnose results ──
  // The key question: did the gateway code path execute?
  // If allOutput contains "[gateway]" log lines, the bundle loaded correctly
  // and isMainModule() passed — the gateway process initialised.
  // It may still exit (e.g. Control UI build failure) but the bundle is valid.

  const gatewayStarted = allOutput.includes("[gateway]");

  if (gatewayStarted) {
    // Gateway code path was reached — fail fast on missing modules.
    // Even if the gateway itself started, a missing module means a plugin
    // or extension will be broken in production.  Don't ship broken builds.
    if (allOutput.includes("Cannot find module")) {
      const matches = allOutput.match(/Cannot find module '([^']+)'/g) || [];
      const modules = matches.map((m) => m.match(/Cannot find module '([^']+)'/)?.[1] || "?");
      const unique = [...new Set(modules)];
      console.error(
        `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Gateway started but ${unique.length} module(s) missing at runtime.\n` +
          `\n` +
          `  Missing: ${unique.join(", ")}\n` +
          `\n` +
          `  Root cause: These modules were removed from node_modules by Phase 4\n` +
          `  cleanup but are needed at runtime by plugins/extensions loaded via jiti.\n` +
          `\n` +
          `  Fix: Add each missing module to EXTERNAL_PACKAGES in this script.\n` +
          `  This keeps them as external imports AND preserves them in node_modules.\n` +
          `  See docs/BUNDLE_VENDOR.md § "Adding external packages" for details.\n`,
      );
      process.exit(1);
    }
    console.log("[bundle-vendor-deps] Smoke test passed: gateway started successfully.");
    return;
  }

  // Gateway code path was NOT reached — diagnose why.
  if (exitCode === 0 && !allOutput.trim()) {
    console.error(
      `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Gateway exited immediately with code 0 and no output.\n` +
        `\n` +
        `  Root cause: The vendor's isMainModule() check failed. This means the\n` +
        `  bundled entry file's import.meta.url did not match the expected filename.\n` +
        `\n` +
        `  The vendor's src/entry.ts has:\n` +
        `    isMainModule({ currentFile: fileURLToPath(import.meta.url),\n` +
        `      wrapperEntryPairs: [{ wrapperBasename: "openclaw.mjs", entryBasename: "entry.js" }] })\n` +
        `\n` +
        `  If the bundle is NOT named "entry.js", import.meta.url won't match\n` +
        `  and the gateway silently exits.\n` +
        `\n` +
        `  Fix: Ensure Phase 2 renames the bundle to entry.js (not a re-export stub).\n` +
        `  See docs/BUNDLE_VENDOR.md § "isMainModule check" for full explanation.\n`,
    );
    process.exit(1);
  }

  if (allOutput.includes("Dynamic require of")) {
    const match = allOutput.match(/Dynamic require of "([^"]+)" is not supported/);
    const mod = match ? match[1] : "(unknown)";
    console.error(
      `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: CJS require() incompatible with ESM bundle.\n` +
        `\n` +
        `  Error: Dynamic require of "${mod}" is not supported\n` +
        `\n` +
        `  Root cause: A bundled CJS package uses require("${mod}") which esbuild\n` +
        `  wraps in __require(). In ESM output this shim throws for Node.js builtins.\n` +
        `\n` +
        `  Fix: Add a createRequire banner to the esbuild config:\n` +
        `    banner: { js: 'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);' }\n` +
        `  See docs/BUNDLE_VENDOR.md § "CJS/ESM interop" for details.\n`,
    );
    process.exit(1);
  }

  if (allOutput.includes("Cannot find module")) {
    const match = allOutput.match(/Cannot find module '([^']+)'/);
    const mod = match ? match[1] : "(unknown)";
    console.error(
      `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Missing runtime dependency.\n` +
        `\n` +
        `  Error: Cannot find module '${mod}'\n` +
        `\n` +
        `  Root cause: The module '${mod}' was removed from node_modules by Phase 4\n` +
        `  cleanup but is needed at runtime (by a plugin or dynamic import).\n` +
        `\n` +
        `  Fix: Add '${mod}' to EXTERNAL_PACKAGES in bundle-vendor-deps.cjs.\n` +
        `  This tells esbuild to keep it as an external import AND tells Phase 4\n` +
        `  to preserve it in node_modules.\n` +
        `  See docs/BUNDLE_VENDOR.md § "Adding external packages" for details.\n`,
    );
    process.exit(1);
  }

  // Generic failure
  console.error(
    `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Gateway exited with code ${exitCode}.\n` +
      `\n` +
      `  Output (first 1000 chars):\n` +
      `  ${(allOutput || "(empty)").substring(0, 1000)}\n` +
      `\n` +
      `  See docs/BUNDLE_VENDOR.md § "Debugging bundle failures" for guidance.\n`,
  );
  process.exit(1);
}

// ─── Main ───

// Guard: skip if already bundled (marker written after successful run)
const BUNDLED_MARKER = path.join(distDir, ".bundled");
if (fs.existsSync(BUNDLED_MARKER)) {
  console.log("[bundle-vendor-deps] Already bundled (.bundled marker exists), skipping.");
  process.exit(0);
}

// Guard: entry.js must exist
if (!fs.existsSync(ENTRY_FILE)) {
  console.log("[bundle-vendor-deps] dist/entry.js not found, skipping.");
  process.exit(0);
}

// Guard: node_modules must exist
if (!fs.existsSync(nmDir)) {
  console.log("[bundle-vendor-deps] vendor/openclaw/node_modules not found, skipping.");
  process.exit(0);
}

(async () => {
  const t0 = Date.now();
  await extractVendorModelCatalog();
  bundleWithEsbuild();
  replaceEntryWithBundle();
  deleteChunkFiles();
  cleanupNodeModules();
  smokeTestGateway();

  // Write marker so re-runs are skipped (idempotency guard).
  // Placed AFTER smoke test so a failed run can be re-tried.
  fs.writeFileSync(BUNDLED_MARKER, new Date().toISOString(), "utf-8");

  console.log(`[bundle-vendor-deps] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
