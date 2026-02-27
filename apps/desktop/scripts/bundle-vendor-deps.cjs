// @ts-check
// Bundles vendor/openclaw dist chunks + JS node_modules into a single file
// using esbuild, then cleans up bundled packages from node_modules.
//
// Must run AFTER prune-vendor-deps.cjs (which removes devDeps) and
// BEFORE electron-builder (which copies the results into the installer).
//
// This dramatically reduces file count for the installer:
//   - dist/plugin-sdk/: 90 chunk files → 2 files (bundled index.js + account-id.js)
//   - extensions/: .ts → pre-bundled .js (inlines npm deps, plugin-sdk external)
//   - dist/: 758 chunk files → 3 files (bundle, babel.cjs, warning-filter)
//   - node_modules/: ~56K files → ~7K files (native/external only)
//
// Plugin-sdk is bundled ONCE (Phase 0.5a), then shared by all extensions.
// Extensions keep plugin-sdk as an external import resolved by jiti's alias
// at runtime, avoiding 36× duplication of the ~27MB plugin-sdk code.

const fs = require("fs");
const path = require("path");

const vendorDir = path.resolve(__dirname, "..", "..", "..", "vendor", "openclaw");
const distDir = path.join(vendorDir, "dist");
const nmDir = path.join(vendorDir, "node_modules");
const extensionsDir = path.join(vendorDir, "extensions");

const ENTRY_FILE = path.join(distDir, "entry.js");
const BUNDLE_TEMP = path.join(distDir, "gateway-bundle.tmp.mjs");

// ─── External packages: cannot be bundled by esbuild ───
// Native modules (.node binaries), complex dynamic loaders, and undici
// (needed by proxy-setup.cjs via createRequire at runtime).
// Used for BOTH the main entry.js bundle AND per-extension bundles.
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
  "@lancedb/lancedb",
  "@lancedb/lancedb-*",

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
  "babel.cjs", // jiti safety net (kept in case any .ts extension was missed)
  ".bundled",
  "vendor-models.json",
  "warning-filter.js",
  "warning-filter.mjs",
]);

// Subdirectories of dist/ to preserve.  plugin-sdk/ is kept because its
// index.js is bundled into a single file (Phase 0.5a) that extensions
// import at runtime via jiti's alias.
const KEEP_DIST_DIRS = new Set([
  "bundled",
  "canvas-host",
  "cli",
  "control-ui",
  "export-html",
  "plugin-sdk",
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
function parsePnpmDirName(/** @type {string} */ dirName) {
  if (dirName.startsWith("@")) {
    const plusIdx = dirName.indexOf("+");
    if (plusIdx === -1) return null;
    const afterPlus = dirName.substring(plusIdx + 1);
    const atIdx = afterPlus.indexOf("@");
    if (atIdx === -1) return null;
    const scope = dirName.substring(0, plusIdx);
    const name = afterPlus.substring(0, atIdx);
    return `${scope}/${name}`;
  }
  const atIdx = dirName.indexOf("@");
  if (atIdx <= 0) return dirName;
  return dirName.substring(0, atIdx);
}

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
  "zlib",
]);

function isNodeBuiltin(/** @type {string} */ name) {
  if (name.startsWith("node:")) return true;
  return NODE_BUILTINS.has(name);
}

/** Resolve esbuild from apps/desktop devDependencies. */
function loadEsbuild() {
  try {
    const desktopDir = path.resolve(__dirname, "..");
    return require(require.resolve("esbuild", { paths: [desktopDir] }));
  } catch {
    console.error(
      "[bundle-vendor-deps] esbuild not found. Ensure it is listed in " +
        "apps/desktop/package.json devDependencies and `pnpm install` has been run.",
    );
    process.exit(1);
  }
}

/**
 * Delete all .ts files (not .d.ts) recursively in a directory.
 * Used to clean up extension source files after pre-bundling.
 */
function deleteTsFiles(/** @type {string} */ dir) {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += deleteTsFiles(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        fs.unlinkSync(full);
        count++;
      }
    }
  } catch {}
  return count;
}

/**
 * Build a Set of package names that must be kept in node_modules.
 * BFS from EXTERNAL_PACKAGES seeds, following dependencies transitively.
 */
function buildKeepSet() {
  const keepSet = new Set();
  const queue = [];

  // Seed BFS with all EXTERNAL_PACKAGES (resolve wildcards against node_modules)
  for (const pattern of EXTERNAL_PACKAGES) {
    if (pattern.endsWith("/*")) {
      // Scoped wildcard: @scope/* → find all @scope/X packages
      const scope = pattern.slice(0, pattern.indexOf("/"));
      const scopeDir = path.join(nmDir, scope);
      try {
        for (const entry of fs.readdirSync(scopeDir)) {
          queue.push(`${scope}/${entry}`);
        }
      } catch {}
    } else if (pattern.endsWith("-*")) {
      // Suffix wildcard: pkg-* → find all pkg-X packages
      const prefix = pattern.slice(0, -1);
      const scope = prefix.startsWith("@") ? prefix.split("/")[0] : null;
      if (scope) {
        const scopeDir = path.join(nmDir, scope);
        try {
          for (const entry of fs.readdirSync(scopeDir)) {
            if (`${scope}/${entry}`.startsWith(prefix)) {
              queue.push(`${scope}/${entry}`);
            }
          }
        } catch {}
      } else {
        try {
          for (const entry of fs.readdirSync(nmDir)) {
            if (entry.startsWith(prefix)) queue.push(entry);
          }
        } catch {}
      }
    } else {
      queue.push(pattern);
    }
  }

  // BFS: follow dependencies and optionalDependencies transitively
  while (queue.length > 0) {
    const pkgName = /** @type {string} */ (queue.shift());
    if (keepSet.has(pkgName) || isNodeBuiltin(pkgName) || pkgName.startsWith("@types/")) continue;

    const pkgJsonPath = path.join(nmDir, pkgName, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;

    keepSet.add(pkgName);

    try {
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

// ─── Phase 0.5a: Bundle plugin-sdk into a single file ───
// dist/plugin-sdk/ contains index.js + ~90 chunk files.  Extensions import
// plugin-sdk at runtime via jiti's alias ("openclaw/plugin-sdk" → dist/plugin-sdk/index.js).
// Bundle index.js into a self-contained file so we can delete the chunks.
// account-id.js is already self-contained (1.1KB, no chunk imports).

function bundlePluginSdk() {
  console.log("[bundle-vendor-deps] Phase 0.5a: Bundling plugin-sdk...");

  const pluginSdkDir = path.join(distDir, "plugin-sdk");
  const pluginSdkIndex = path.join(pluginSdkDir, "index.js");

  if (!fs.existsSync(pluginSdkIndex)) {
    console.log("[bundle-vendor-deps] dist/plugin-sdk/index.js not found, skipping.");
    return;
  }

  const esbuild = loadEsbuild();
  const tmpOut = path.join(pluginSdkDir, "index.bundled.mjs");

  esbuild.buildSync({
    entryPoints: [pluginSdkIndex],
    outfile: tmpOut,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    external: EXTERNAL_PACKAGES,
    banner: {
      js: 'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);',
    },
    logLevel: "warning",
  });

  const bundleSize = fs.statSync(tmpOut).size;

  // Replace index.js with the bundle
  fs.unlinkSync(pluginSdkIndex);
  fs.renameSync(tmpOut, pluginSdkIndex);

  // Delete chunk files and subdirs (keep only index.js and account-id.js)
  const keepFiles = new Set(["index.js", "account-id.js"]);
  let deleted = 0;
  for (const entry of fs.readdirSync(pluginSdkDir, { withFileTypes: true })) {
    if (keepFiles.has(entry.name)) continue;
    const fullPath = path.join(pluginSdkDir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      deleted += countFiles(fullPath) || 1;
    } else {
      fs.unlinkSync(fullPath);
      deleted++;
    }
  }

  console.log(
    `[bundle-vendor-deps] plugin-sdk bundled: ${(bundleSize / 1024 / 1024).toFixed(1)}MB, deleted ${deleted} chunk files`,
  );
}

// ─── Phase 0.5b: Pre-bundle vendor extensions ───
// Vendor extensions are .ts files loaded at runtime by jiti.  Without
// pre-bundling, jiti needs babel.cjs to transpile them, and the transpiled
// code imports plugin-sdk → chunk files → all of node_modules.
//
// By pre-bundling each extension into a .js file:
//   1. jiti loads .js directly (no babel transpilation needed)
//   2. npm dependencies are inlined (node_modules can be pruned)
//   3. plugin-sdk is kept as external (shared single bundle, not duplicated)
//   4. Only EXTERNAL_PACKAGES + plugin-sdk remain as runtime imports

function prebundleExtensions() {
  console.log("[bundle-vendor-deps] Phase 0.5b: Pre-bundling vendor extensions...");

  if (!fs.existsSync(extensionsDir)) {
    console.log("[bundle-vendor-deps] extensions/ not found, skipping.");
    return new Set();
  }

  const esbuild = loadEsbuild();

  // Extensions keep plugin-sdk as external — jiti resolves "openclaw/plugin-sdk"
  // to dist/plugin-sdk/index.js (now a single bundle from Phase 0.5a) at runtime.
  const extExternals = [
    ...EXTERNAL_PACKAGES,
    "openclaw/plugin-sdk",
    "openclaw/plugin-sdk/account-id",
  ];

  // Find all extensions with openclaw.plugin.json
  const extDirs = [];
  for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(extensionsDir, entry.name, "openclaw.plugin.json");
    if (fs.existsSync(manifestPath)) {
      extDirs.push({ name: entry.name, dir: path.join(extensionsDir, entry.name) });
    }
  }

  let bundled = 0;
  let skipped = 0;
  const errors = [];
  const allExtPkgs = new Set();

  for (const ext of extDirs) {
    const indexTs = path.join(ext.dir, "index.ts");
    if (!fs.existsSync(indexTs)) {
      skipped++;
      continue;
    }

    const indexJs = path.join(ext.dir, "index.js");

    try {
      const result = esbuild.buildSync({
        entryPoints: [indexTs],
        outfile: indexJs,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        external: extExternals,
        metafile: true,
        banner: {
          js: 'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);',
        },
        logLevel: "warning",
      });

      // Collect external packages from metafile
      if (result.metafile) {
        for (const output of Object.values(result.metafile.outputs)) {
          for (const imp of output.imports || []) {
            if (imp.external) {
              const parts = imp.path.split("/");
              const pkgName = imp.path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
              allExtPkgs.add(pkgName);
            }
          }
        }
      }

      // Delete .ts source files (now inlined into index.js)
      deleteTsFiles(ext.dir);

      // Update package.json entry if it references .ts
      const pkgJsonPath = path.join(ext.dir, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const content = fs.readFileSync(pkgJsonPath, "utf-8");
        if (content.includes("./index.ts")) {
          fs.writeFileSync(pkgJsonPath, content.replace(/\.\/index\.ts/g, "./index.js"), "utf-8");
        }
      }

      bundled++;
    } catch (err) {
      errors.push({ name: ext.name, error: /** @type {Error} */ (err).message });
    }
  }

  console.log(
    `[bundle-vendor-deps] Pre-bundled ${bundled} extensions` +
      (skipped > 0 ? ` (${skipped} skipped — no index.ts)` : ""),
  );

  if (errors.length > 0) {
    console.error(`\n[bundle-vendor-deps] ✗ ${errors.length} extension(s) failed to bundle:\n`);
    for (const { name, error } of errors) {
      console.error(`  ${name}: ${error.substring(0, 200)}\n`);
    }
    process.exit(1);
  }

  return allExtPkgs;
}

// ─── Phase 1: esbuild bundle ───

function bundleWithEsbuild() {
  console.log("[bundle-vendor-deps] Phase 1: Bundling dist/entry.js with esbuild...");

  const esbuild = loadEsbuild();

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

  // Collect which packages esbuild treated as external imports
  const usedExternals = new Set();
  if (result.metafile) {
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

  return usedExternals;
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
  // After pre-bundling extensions to .js, babel is NOT needed for normal
  // operation.  We copy it as a safety net in case a .ts extension is
  // missed or a future vendor update adds one.
  const babelSrc = path.join(nmDir, "@mariozechner", "jiti", "dist", "babel.cjs");
  const babelDst = path.join(distDir, "babel.cjs");
  if (fs.existsSync(babelSrc)) {
    fs.copyFileSync(babelSrc, babelDst);
    console.log("[bundle-vendor-deps] Copied babel.cjs to dist/ (safety net for jiti)");
  }
}

// ─── Phase 3: Delete chunk files from dist/ ───
// Also deletes dist/plugin-sdk/ (1,575 chunk files) since all its code
// is now inlined into the pre-bundled extensions by Phase 0.5.

function deleteChunkFiles() {
  console.log("[bundle-vendor-deps] Phase 3: Deleting chunk files from dist/...");

  let deletedCount = 0;
  let deletedBytes = 0;

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Delete directories NOT in the keep set (e.g. plugin-sdk/)
      if (!KEEP_DIST_DIRS.has(entry.name)) {
        const dirPath = path.join(distDir, entry.name);
        const dirFiles = countFiles(dirPath);
        fs.rmSync(dirPath, { recursive: true, force: true });
        deletedCount += dirFiles;
        console.log(`[bundle-vendor-deps] Deleted dist/${entry.name}/ (${dirFiles} files)`);
      }
      continue;
    }
    if (KEEP_DIST_FILES.has(entry.name)) continue;
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
// Now that extensions are pre-bundled (all npm deps inlined), node_modules
// only needs EXTERNAL_PACKAGES + their transitive dependencies.

/** @returns {Set<string>} keepSet — packages that were found and preserved */
function cleanupNodeModules() {
  console.log("[bundle-vendor-deps] Phase 4: Cleaning up node_modules...");

  if (!fs.existsSync(nmDir)) {
    console.log("[bundle-vendor-deps] node_modules not found, skipping.");
    return new Set();
  }

  const filesBefore = countFiles(nmDir);

  // Build the keep-set via BFS from EXTERNAL_PACKAGES
  const keepSet = buildKeepSet();
  console.log(`[bundle-vendor-deps] Packages to keep: ${keepSet.size}`);

  // Clean top-level entries
  let removedTopLevel = 0;
  for (const entry of fs.readdirSync(nmDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .pnpm, .bin, .modules.yaml, etc.

    if (entry.name.startsWith("@")) {
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

      try {
        if (fs.readdirSync(scopeDir).length === 0) fs.rmdirSync(scopeDir);
      } catch {}
    } else {
      if (!keepSet.has(entry.name)) {
        fs.rmSync(path.join(nmDir, entry.name), { recursive: true, force: true });
        removedTopLevel++;
      }
    }
  }

  console.log(`[bundle-vendor-deps] Removed ${removedTopLevel} top-level packages`);

  // Clean .pnpm/ entries
  const pnpmDir = path.join(nmDir, ".pnpm");
  let removedPnpm = 0;
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const pkgName = parsePnpmDirName(entry.name);
      if (pkgName && !keepSet.has(pkgName)) {
        fs.rmSync(path.join(pnpmDir, entry.name), { recursive: true, force: true });
        removedPnpm++;
      }
    }
  }

  console.log(`[bundle-vendor-deps] Removed ${removedPnpm} .pnpm/ entries`);

  // Clean up broken symlinks
  let brokenSymlinks = 0;
  const cleanBrokenSymlinks = (/** @type {string} */ dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        try {
          const lstat = fs.lstatSync(fullPath);
          if (lstat.isSymbolicLink()) {
            try {
              fs.statSync(fullPath);
            } catch {
              fs.unlinkSync(fullPath);
              brokenSymlinks++;
            }
          } else if (lstat.isDirectory() && entry.name.startsWith("@")) {
            cleanBrokenSymlinks(fullPath);
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

  // Remove .bin/ directory (not needed at runtime)
  const binDir = path.join(nmDir, ".bin");
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  // Also clean .pnpm/node_modules/ broken symlinks
  const pnpmNmDir = path.join(pnpmDir, "node_modules");
  if (fs.existsSync(pnpmNmDir)) {
    cleanBrokenSymlinks(pnpmNmDir);
  }

  const filesAfter = countFiles(nmDir);
  console.log(
    `[bundle-vendor-deps] node_modules: ${filesBefore} → ${filesAfter} files ` +
      `(removed ${filesBefore - filesAfter})`,
  );

  return keepSet;
}

// ─── Phase 4.5: Static import verification ───
// Uses esbuild metafile data (collected during Phase 0.5 and Phase 1) to
// verify that every external package referenced by the bundles still exists
// in node_modules after Phase 4 cleanup.  This is deterministic and
// platform-independent — no gateway spawn needed.

function verifyExternalImports(/** @type {Set<string>} */ allExternals, /** @type {Set<string>} */ keepSet) {
  console.log("[bundle-vendor-deps] Phase 4.5: Verifying external imports...");

  // Only verify packages that are BOTH:
  //   1. Intentionally external (listed in EXTERNAL_PACKAGES)
  //   2. Were actually installed (present in BFS keepSet from Phase 4)
  //
  // Packages in EXTERNAL_PACKAGES that were never installed (ffmpeg-static,
  // authenticate-pam, esbuild, node-llama-cpp) are listed there so esbuild
  // doesn't try to resolve them — but they're behind try/catch in vendor
  // code and fail gracefully at runtime.
  const matchesIntentional = (/** @type {string} */ name) => {
    for (const pattern of EXTERNAL_PACKAGES) {
      if (pattern === name) return true;
      if (pattern.endsWith("/*") && name.startsWith(pattern.slice(0, -1))) return true;
      if (pattern.endsWith("-*") && name.startsWith(pattern.slice(0, -1))) return true;
    }
    return false;
  };

  const missing = [];
  let verifiedCount = 0;
  let skippedNeverInstalled = 0;

  for (const pkg of [...allExternals].sort()) {
    if (isNodeBuiltin(pkg)) continue;
    if (!matchesIntentional(pkg)) continue; // skip incidental externals
    if (!keepSet.has(pkg)) {
      // Package is in EXTERNAL_PACKAGES but was never installed — expected
      skippedNeverInstalled++;
      continue;
    }
    verifiedCount++;
    const pkgDir = path.join(nmDir, pkg);
    if (!fs.existsSync(pkgDir)) {
      missing.push(pkg);
    }
  }

  if (missing.length > 0) {
    console.error(
      `\n[bundle-vendor-deps] ✗ IMPORT VERIFICATION FAILED: ${missing.length} package(s) were in BFS keep-set but missing from node_modules.\n`,
    );
    for (const pkg of missing) {
      console.error(`  ${pkg}`);
    }
    console.error(
      `\n  These packages were installed and should have been preserved by Phase 4.\n` +
        `\n  Fix: Check buildKeepSet() BFS logic or Phase 4 cleanup.\n`,
    );
    process.exit(1);
  }

  console.log(
    `[bundle-vendor-deps] All ${verifiedCount} installed external imports verified` +
      (skippedNeverInstalled > 0 ? ` (${skippedNeverInstalled} optional/never-installed skipped)` : "") +
      ".",
  );
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
//   3. Missing runtime dependencies — Pre-bundled extensions or the main bundle
//      may reference packages deleted by Phase 4 cleanup.  Symptom:
//      "Cannot find module 'X'" in stderr.  Fix: add the package to
//      EXTERNAL_PACKAGES.
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
  // We let the gateway discover vendor extensions (now pre-bundled .js files)
  // to verify that pre-bundled extensions load correctly at runtime.
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
    const stdout = execFileSync(process.execPath, [openclawMjs, "gateway"], {
      cwd: tmpDir,
      timeout: 8000,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: path.join(tmpDir, "openclaw.json"),
        OPENCLAW_STATE_DIR: tmpDir,
        NODE_COMPILE_CACHE: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGTERM",
    });
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
  const gatewayStarted = allOutput.includes("[gateway]");

  if (gatewayStarted) {
    if (allOutput.includes("Cannot find module")) {
      const matches = allOutput.match(/Cannot find module '([^']+)'/g) || [];
      const modules = matches.map((m) => m.match(/Cannot find module '([^']+)'/)?.[1] || "?");
      const unique = [...new Set(modules)];
      console.error(
        `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Gateway started but ${unique.length} module(s) missing at runtime.\n` +
          `\n  Missing: ${unique.join(", ")}\n` +
          `\n  Fix: Add each missing module to EXTERNAL_PACKAGES.\n`,
      );
      process.exit(1);
    }
    console.log("[bundle-vendor-deps] Smoke test passed: gateway started successfully.");
    return;
  }

  if (exitCode === 0 && !allOutput.trim()) {
    console.error(
      `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Gateway exited immediately with code 0 and no output.\n` +
        `\n  Root cause: isMainModule() check failed. Bundle must be named entry.js.\n`,
    );
    process.exit(1);
  }

  if (allOutput.includes("Dynamic require of")) {
    const match = allOutput.match(/Dynamic require of "([^"]+)" is not supported/);
    const mod = match ? match[1] : "(unknown)";
    console.error(
      `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Dynamic require of "${mod}" is not supported.\n` +
        `\n  Fix: Ensure the esbuild config has the createRequire banner.\n`,
    );
    process.exit(1);
  }

  if (allOutput.includes("Cannot find module")) {
    const match = allOutput.match(/Cannot find module '([^']+)'/);
    const mod = match ? match[1] : "(unknown)";
    console.error(
      `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Cannot find module '${mod}'.\n` +
        `\n  Fix: Add '${mod}' to EXTERNAL_PACKAGES.\n`,
    );
    process.exit(1);
  }

  console.error(
    `\n[bundle-vendor-deps] ✗ SMOKE TEST FAILED: Gateway exited with code ${exitCode}.\n` +
      `\n  Output (first 1000 chars):\n  ${(allOutput || "(empty)").substring(0, 1000)}\n`,
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
  bundlePluginSdk();
  const extExternals = prebundleExtensions();
  const bundleExternals = bundleWithEsbuild();
  replaceEntryWithBundle();
  deleteChunkFiles();
  const keepSet = cleanupNodeModules();
  // Merge all external packages from extensions + main bundle for verification
  const allExternals = new Set([...extExternals, ...bundleExternals]);
  verifyExternalImports(allExternals, keepSet);
  smokeTestGateway();

  // Write marker so re-runs are skipped (idempotency guard).
  // Placed AFTER smoke test so a failed run can be re-tried.
  fs.writeFileSync(BUNDLED_MARKER, new Date().toISOString(), "utf-8");

  console.log(`[bundle-vendor-deps] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
