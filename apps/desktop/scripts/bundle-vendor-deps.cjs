// @ts-check
// Bundles vendor/openclaw dist chunks + JS node_modules into a single file
// using esbuild, then cleans up bundled packages from node_modules.
//
// Must run AFTER prune-vendor-deps.cjs (which removes devDeps) and
// BEFORE electron-builder (which copies the results into the installer).
//
// This dramatically reduces file count for the installer:
//   - dist/: 758 chunk files → 3 files (bundle, stub, warning-filter)
//   - node_modules/: ~56K files → ~1.5K files (native/external only)
//
// The combined reduction from ~29K shipped files to ~1.5K files cuts
// Windows NSIS install time from 5-8 minutes to ~30-60 seconds and
// gateway cold start from 30-45 seconds to ~5-10 seconds.

const fs = require("fs");
const path = require("path");

const vendorDir = path.resolve(__dirname, "..", "..", "..", "vendor", "openclaw");
const distDir = path.join(vendorDir, "dist");
const nmDir = path.join(vendorDir, "node_modules");

const ENTRY_FILE = path.join(distDir, "entry.js");
const BUNDLE_FILE = path.join(distDir, "gateway-bundle.mjs");

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
];

// Path to the static vendor model catalog JSON that replaces the dynamic
// import of @mariozechner/pi-ai/dist/models.generated.js at runtime.
const VENDOR_MODELS_JSON = path.join(distDir, "vendor-models.json");

// Files to preserve in dist/ (everything else is a chunk file to delete)
const KEEP_DIST_FILES = new Set([
  "entry.js",
  "gateway-bundle.mjs",
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

/**
 * Parse a .pnpm directory name to extract the package name.
 * Examples:
 *   "sharp@0.34.5"                    → "sharp"
 *   "@img+sharp-darwin-arm64@0.34.5"  → "@img/sharp-darwin-arm64"
 *   "undici@7.22.0"                   → "undici"
 *   "pkg@1.0.0_peer+info"            → "pkg"
 */
function parsePnpmDirName(dirName) {
  if (dirName.startsWith("@")) {
    // Scoped: @scope+name@version[_peer_info]
    const plusIdx = dirName.indexOf("+");
    if (plusIdx === -1) return null;
    const afterPlus = dirName.substring(plusIdx + 1);
    const atIdx = afterPlus.indexOf("@");
    if (atIdx === -1) return null;
    const scope = dirName.substring(0, plusIdx);
    const name = afterPlus.substring(0, atIdx);
    return `${scope}/${name}`;
  }
  // Unscoped: name@version[_peer_info]
  const atIdx = dirName.indexOf("@");
  if (atIdx <= 0) return dirName;
  return dirName.substring(0, atIdx);
}

// Node.js built-in modules — these appear as externals in the metafile
// but are NOT npm packages. Filter them out of the keep set.
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
  "zlib",
]);

/** Returns true if the name is a Node.js built-in (including node: prefix). */
function isNodeBuiltin(name) {
  if (name.startsWith("node:")) return true;
  return NODE_BUILTINS.has(name);
}

/**
 * Check if a package name matches any pattern in EXTERNAL_PACKAGES.
 * Patterns support trailing `*` wildcards (e.g. "@img/*" matches "@img/sharp-darwin-arm64").
 */
function matchesExternalPattern(pkgName) {
  for (const pattern of EXTERNAL_PACKAGES) {
    if (pattern === pkgName) return true;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // "@img/" from "@img/*"
      if (pkgName.startsWith(prefix)) return true;
    }
    if (pattern.endsWith("-*")) {
      const prefix = pattern.slice(0, -1); // "@lydell/node-pty-" from "@lydell/node-pty-*"
      if (pkgName.startsWith(prefix)) return true;
    }
  }
  return false;
}

/**
 * Build a Set of package names that must be kept in node_modules.
 *
 * Only keeps packages that are INTENTIONALLY external (listed in EXTERNAL_PACKAGES)
 * plus their transitive dependencies. Incidental externals (packages esbuild couldn't
 * resolve, like optional `canvas` or `jimp`) are NOT kept — their imports are in
 * try/catch blocks and fail gracefully at runtime.
 */
function buildKeepSet(usedExternals) {
  const keepSet = new Set();
  const queue = [];

  // Seed BFS with ONLY intentionally external packages that were actually referenced
  for (const pkg of usedExternals) {
    if (!isNodeBuiltin(pkg) && matchesExternalPattern(pkg)) {
      queue.push(pkg);
    }
  }

  // Explicitly ensure undici is kept (proxy-setup.cjs needs it)
  queue.push("undici");

  while (queue.length > 0) {
    const pkgName = queue.shift();
    if (keepSet.has(pkgName)) continue;
    if (isNodeBuiltin(pkgName) || pkgName.startsWith("@types/")) continue;
    keepSet.add(pkgName);

    // Read package.json to find dependencies
    const pkgJsonPath = path.join(nmDir, pkgName, "package.json");
    try {
      if (!fs.existsSync(pkgJsonPath)) continue;
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      for (const depMap of [pkgJson.dependencies, pkgJson.optionalDependencies]) {
        if (!depMap) continue;
        for (const dep of Object.keys(depMap)) {
          if (!keepSet.has(dep) && !isNodeBuiltin(dep) && !dep.startsWith("@types/")) {
            queue.push(dep);
          }
        }
      }
    } catch {}
  }

  return keepSet;
}

// ─── Phase 0: Extract vendor model catalog to static JSON ───
// model-catalog.ts used to dynamically import models.generated.js from
// @mariozechner/pi-ai at runtime. Instead, we extract { id, name } per
// provider at build time so the JS file (and the entire pi-ai package)
// can be safely removed from node_modules.

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
    outfile: BUNDLE_FILE,
    format: "esm",
    platform: "node",
    target: "node22",
    external: EXTERNAL_PACKAGES,
    logLevel: "warning",
    metafile: true,
    sourcemap: false,
  });

  const elapsed = Date.now() - t0;
  const bundleSize = fs.statSync(BUNDLE_FILE).size;
  console.log(
    `[bundle-vendor-deps] Bundle created: ${(bundleSize / 1024 / 1024).toFixed(1)}MB in ${elapsed}ms`,
  );

  // Extract which packages esbuild treated as external imports
  const usedExternals = new Set();
  if (result.metafile) {
    for (const output of Object.values(result.metafile.outputs)) {
      for (const imp of output.imports || []) {
        if (imp.external) {
          // Extract package name: "@img/sharp-darwin-arm64" → "@img/sharp-darwin-arm64"
          // "protobufjs/minimal" → "protobufjs"
          const parts = imp.path.split("/");
          const pkgName = imp.path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
          usedExternals.add(pkgName);
        }
      }
    }
  }

  console.log(
    `[bundle-vendor-deps] External packages referenced: ${[...usedExternals].sort().join(", ")}`,
  );
  return usedExternals;
}

// ─── Phase 2: Replace entry.js with re-export stub ───

function replaceEntryWithStub() {
  console.log("[bundle-vendor-deps] Phase 2: Replacing entry.js with re-export stub...");
  const stub = `export * from './gateway-bundle.mjs';\n`;
  fs.writeFileSync(ENTRY_FILE, stub, "utf-8");
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

// ─── Phase 4: Clean up node_modules ───

function cleanupNodeModules(usedExternals) {
  console.log("[bundle-vendor-deps] Phase 4: Cleaning up node_modules...");

  if (!fs.existsSync(nmDir)) {
    console.log("[bundle-vendor-deps] node_modules not found, skipping cleanup.");
    return;
  }

  const filesBefore = countFiles(nmDir);

  // 4a. Build the keep-set via BFS from externals
  const keepSet = buildKeepSet(usedExternals);
  console.log(`[bundle-vendor-deps] Packages to keep: ${keepSet.size} (${[...keepSet].sort().join(", ")})`);

  // 4b. Clean top-level entries
  let removedTopLevel = 0;
  for (const entry of fs.readdirSync(nmDir, { withFileTypes: true })) {
    // Skip metadata/special directories
    if (
      entry.name === ".pnpm" ||
      entry.name === ".bin" ||
      entry.name === ".modules.yaml" ||
      entry.name.startsWith(".ignored_") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    if (entry.name.startsWith("@")) {
      // Scoped packages: check each sub-entry
      const scopeDir = path.join(nmDir, entry.name);
      let scopeEntries;
      try {
        scopeEntries = fs.readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const scopeEntry of scopeEntries) {
        const fullPkgName = `${entry.name}/${scopeEntry.name}`;
        if (!keepSet.has(fullPkgName)) {
          fs.rmSync(path.join(scopeDir, scopeEntry.name), { recursive: true, force: true });
          removedTopLevel++;
        }
      }

      // Remove empty scope directories
      try {
        if (fs.readdirSync(scopeDir).length === 0) fs.rmdirSync(scopeDir);
      } catch {}
    } else {
      // Unscoped packages
      if (!keepSet.has(entry.name)) {
        fs.rmSync(path.join(nmDir, entry.name), { recursive: true, force: true });
        removedTopLevel++;
      }
    }
  }

  console.log(`[bundle-vendor-deps] Removed ${removedTopLevel} top-level packages`);

  // 4c. Clean .pnpm/ entries
  const pnpmDir = path.join(nmDir, ".pnpm");
  let removedPnpm = 0;
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules") continue;

      const pkgName = parsePnpmDirName(entry.name);
      if (pkgName && !keepSet.has(pkgName)) {
        fs.rmSync(path.join(pnpmDir, entry.name), { recursive: true, force: true });
        removedPnpm++;
      }
    }
  }

  console.log(`[bundle-vendor-deps] Removed ${removedPnpm} .pnpm/ entries`);

  // 4d. Clean up broken symlinks
  let brokenSymlinks = 0;
  const cleanBrokenSymlinks = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        try {
          const lstat = fs.lstatSync(fullPath);
          if (lstat.isSymbolicLink()) {
            try {
              fs.statSync(fullPath); // follows symlink — throws if broken
            } catch {
              fs.unlinkSync(fullPath);
              brokenSymlinks++;
            }
          } else if (lstat.isDirectory() && entry.name.startsWith("@")) {
            // Recurse into scoped dirs
            cleanBrokenSymlinks(fullPath);
            // Remove empty scope dirs
            try {
              if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
            } catch {}
          }
        } catch {}
      }
    } catch {}
  };
  cleanBrokenSymlinks(nmDir);

  if (brokenSymlinks > 0) {
    console.log(`[bundle-vendor-deps] Removed ${brokenSymlinks} broken symlinks`);
  }

  // 4e. Remove .bin/ directory (not needed at runtime)
  const binDir = path.join(nmDir, ".bin");
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  // 4f. Also clean .pnpm/node_modules/ broken symlinks
  const pnpmNmDir = path.join(pnpmDir, "node_modules");
  if (fs.existsSync(pnpmNmDir)) {
    cleanBrokenSymlinks(pnpmNmDir);
  }

  // 4g. Report
  const filesAfter = countFiles(nmDir);
  console.log(
    `[bundle-vendor-deps] node_modules: ${filesBefore} → ${filesAfter} files ` +
      `(removed ${filesBefore - filesAfter})`,
  );
}

// ─── Main ───

// Guard: skip if already bundled
if (fs.existsSync(BUNDLE_FILE)) {
  console.log("[bundle-vendor-deps] Already bundled (gateway-bundle.mjs exists), skipping.");
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
  const usedExternals = bundleWithEsbuild();
  replaceEntryWithStub();
  deleteChunkFiles();
  cleanupNodeModules(usedExternals);

  console.log(`[bundle-vendor-deps] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
