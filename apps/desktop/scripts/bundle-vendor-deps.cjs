// @ts-check
// Bundles vendor/openclaw dist chunks + JS node_modules into a single file
// using esbuild, then cleans up bundled packages from node_modules.
//
// Must run AFTER prune-vendor-deps.cjs (which removes devDeps) and
// BEFORE electron-builder (which copies the results into the installer).
//
// This dramatically reduces file count for the installer:
//   - dist/plugin-sdk/: 90 chunk files → 2 files (bundled index.js + account-id.js)
//   - extensions/: .ts → pre-bundled .js (inlines npm deps + tree-shaken plugin-sdk)
//   - dist/: 758 chunk files → 3 files (bundle, babel.cjs, warning-filter)
//   - node_modules/: ~56K files → ~7K files (native/external only)
//
// Plugin-sdk is inlined (tree-shaken) into each pre-bundled vendor extension
// during Phase 0.5b, eliminating the ~30s runtime parse of the monolithic
// plugin-sdk bundle on Windows.  Phase 0.5a still creates the monolithic
// bundle for user-installed / third-party plugins that import plugin-sdk
// at runtime.

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
// index.js is bundled into a single file (Phase 0.5a) that third-party
// plugins import at runtime via jiti's alias.
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

/** Sum byte sizes of all files in a directory recursively. */
function dirSize(/** @type {string} */ dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // skip symlinks — they point to .pnpm which is counted separately
      } else if (entry.isDirectory()) {
        total += dirSize(full);
      } else {
        total += fs.statSync(full).size;
      }
    }
  } catch {}
  return total;
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
// dist/plugin-sdk/ contains index.js + ~90 chunk files.  Vendor extensions
// now inline plugin-sdk at build time (Phase 0.5b), but user-installed /
// third-party plugins still import plugin-sdk at runtime via jiti's alias
// ("openclaw/plugin-sdk" → dist/plugin-sdk/index.js).
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
    minify: true,
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
//   3. plugin-sdk is inlined and tree-shaken (only used exports are included)
//   4. Only EXTERNAL_PACKAGES remain as runtime imports
//
// NOTE: Must run BEFORE Phase 0.5a because esbuild needs the original
// plugin-sdk chunk files to follow imports and tree-shake effectively.

function prebundleExtensions() {
  console.log("[bundle-vendor-deps] Phase 0.5b: Pre-bundling vendor extensions...");

  if (!fs.existsSync(extensionsDir)) {
    console.log("[bundle-vendor-deps] extensions/ not found, skipping.");
    return { externals: new Set(), inlinedCount: 0 };
  }

  const esbuild = loadEsbuild();

  // Plugin-sdk inlining strategy:
  //
  // Extensions that import few plugin-sdk functions (e.g. emptyPluginConfigSchema)
  // get plugin-sdk inlined + tree-shaken → self-contained, no runtime parse.
  // Extensions that import many plugin-sdk utilities (channel plugins) keep
  // plugin-sdk as external → loaded at runtime via jiti, but these are only
  // enabled when the user specifically configures the channel.
  //
  // Adaptive threshold: if an inlined extension exceeds INLINE_SIZE_LIMIT,
  // it is rebuilt with plugin-sdk external to avoid bloating the installer.
  const INLINE_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MB

  const extExternalsBase = [...EXTERNAL_PACKAGES];
  const extExternalsWithSdk = [
    ...extExternalsBase,
    "openclaw/plugin-sdk",
    "openclaw/plugin-sdk/account-id",
  ];
  const pluginSdkDir = path.join(distDir, "plugin-sdk");
  const pluginSdkAlias = {
    "openclaw/plugin-sdk": path.join(pluginSdkDir, "index.js"),
    "openclaw/plugin-sdk/account-id": path.join(pluginSdkDir, "account-id.js"),
  };
  // Mark plugin-sdk chunks as side-effect-free for esbuild tree-shaking.
  const pluginSdkPkg = path.join(pluginSdkDir, "package.json");
  const hadPkgJson = fs.existsSync(pluginSdkPkg);
  fs.writeFileSync(pluginSdkPkg, JSON.stringify({ sideEffects: false }), "utf-8");

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
  let inlinedCount = 0;
  let skipped = 0;
  const errors = [];
  const allExtPkgs = new Set();

  /**
   * Build a single extension with esbuild.
   * @param {string} entryPoint
   * @param {string} outfile
   * @param {{inline: boolean}} opts
   * @returns {import("esbuild").BuildResult}
   */
  function buildExtension(entryPoint, outfile, opts) {
    return esbuild.buildSync({
      entryPoints: [entryPoint],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      external: opts.inline ? extExternalsBase : extExternalsWithSdk,
      ...(opts.inline ? { alias: pluginSdkAlias } : {}),
      metafile: true,
      minify: true,
      banner: {
        js: 'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);',
      },
      logLevel: "warning",
    });
  }

  for (const ext of extDirs) {
    const indexTs = path.join(ext.dir, "index.ts");
    if (!fs.existsSync(indexTs)) {
      skipped++;
      continue;
    }

    const indexJs = path.join(ext.dir, "index.js");

    try {
      // First attempt: inline plugin-sdk (tree-shaken).
      let result = buildExtension(indexTs, indexJs, { inline: true });

      // If the output exceeds the threshold, the extension uses too many
      // plugin-sdk internals — rebuild with plugin-sdk as external to
      // avoid inflating the installer.
      const outSize = fs.statSync(indexJs).size;
      if (outSize > INLINE_SIZE_LIMIT) {
        result = buildExtension(indexTs, indexJs, { inline: false });
      } else {
        inlinedCount++;
      }

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
      ` (${inlinedCount} with plugin-sdk inlined)` +
      (skipped > 0 ? ` (${skipped} skipped — no index.ts)` : ""),
  );

  // Clean up the temporary package.json so it doesn't interfere with
  // Phase 0.5a or jiti runtime resolution.
  if (!hadPkgJson) {
    fs.unlinkSync(pluginSdkPkg);
  }

  if (errors.length > 0) {
    console.error(`\n[bundle-vendor-deps] ✗ ${errors.length} extension(s) failed to bundle:\n`);
    for (const { name, error } of errors) {
      console.error(`  ${name}: ${error.substring(0, 200)}\n`);
    }
    process.exit(1);
  }

  return { externals: allExtPkgs, inlinedCount };
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
    minify: true,
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

// ─── Phase 1.5: Patch vendor constants in the bundle ───
// The vendor hardcodes HEALTH_REFRESH_INTERVAL_MS = 60s which probes all
// channel APIs every minute — too aggressive and triggers rate limits for
// users with multiple channels.  We replace it with 5 minutes (300s) in
// the bundled output.  This avoids modifying vendor source while keeping
// the fix inside EasyClaw's own build pipeline.
//
// If a future vendor update renames or removes the constant, the assertion
// below will fail the build loudly so we notice immediately.

const VENDOR_HEALTH_INTERVAL_ORIGINAL = "HEALTH_REFRESH_INTERVAL_MS = 6e4";
const VENDOR_HEALTH_INTERVAL_PATCHED  = "HEALTH_REFRESH_INTERVAL_MS = 3e5";

function patchVendorConstants() {
  console.log("[bundle-vendor-deps] Phase 0.9: Patching vendor constants...");

  // Patch the vendor dist chunk files BEFORE bundling, not after.
  // esbuild's minifier inlines constant values and removes variable names,
  // so string-patching the bundled output would fail.  By patching the source
  // chunks, esbuild bundles the already-patched values.
  let totalOccurrences = 0;
  let patchedFiles = 0;

  for (const file of fs.readdirSync(distDir)) {
    const filePath = path.join(distDir, file);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
    } catch { continue; }

    const content = fs.readFileSync(filePath, "utf-8");
    const occurrences = content.split(VENDOR_HEALTH_INTERVAL_ORIGINAL).length - 1;
    if (occurrences === 0) continue;

    const patched = content.replaceAll(
      VENDOR_HEALTH_INTERVAL_ORIGINAL,
      VENDOR_HEALTH_INTERVAL_PATCHED,
    );
    fs.writeFileSync(filePath, patched, "utf-8");
    totalOccurrences += occurrences;
    patchedFiles++;
    console.log(`  patched ${file} (${occurrences} occurrence(s))`);
  }

  if (totalOccurrences === 0) {
    console.error(
      `\n[bundle-vendor-deps] ✗ PATCH FAILED: Could not find "${VENDOR_HEALTH_INTERVAL_ORIGINAL}" in any dist/ file.\n` +
        `\n  The vendor may have renamed or removed HEALTH_REFRESH_INTERVAL_MS.\n` +
        `  Check vendor/openclaw/src/gateway/server-constants.ts and update this patch.\n`,
    );
    process.exit(1);
  }

  console.log(
    `[bundle-vendor-deps] Patched HEALTH_REFRESH_INTERVAL_MS: 60s → 300s (${totalOccurrences} occurrence(s) in ${patchedFiles} file(s))`,
  );
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

// ─── Phase 2.5: Inject startup timing instrumentation ───
// Temporary diagnostic: prepends a stdout/stderr interceptor that logs
// elapsed-time markers when the gateway emits known log lines.
// This helps pinpoint which gateway startup phase is slow on Windows.
// TODO: Remove once the Windows startup regression is diagnosed.

function patchStartupTiming() {
  console.log("[bundle-vendor-deps] Phase 2.5: Injecting startup timing instrumentation...");

  const content = fs.readFileSync(ENTRY_FILE, "utf-8");

  // Anchor strings that appear exactly once in the bundled entry.js,
  // corresponding to key gateway startup phases:
  //   1. "auto-enabled plugins"    — after plugin discovery
  //   2. "memory slot plugin"      — memory plugin init
  //   3. "host mounted at"         — HTTP/canvas server ready
  //   4. "listening on ws"         — WebSocket server ready
  //   5. "agent model"             — agent model resolved
  //   6. "[health-monitor] started" — health monitor started
  const timingCode = [
    "// ── Startup Timing (diagnostic) ──",
    "if(!globalThis.__easyclaw_timing){globalThis.__easyclaw_timing=1;",
    "var __t0=Date.now(),__tm={};",
    "var __origOut=process.stdout.write.bind(process.stdout);",
    "var __origErr=process.stderr.write.bind(process.stderr);",
    'function __tmark(s){if(!__tm[s]){__tm[s]=1;__origErr("[TIMING] "+s+": "+(Date.now()-__t0)+"ms\\n")}}',
    '__tmark("entry-loaded");',
    'var __anchors=["auto-enabled plugins","memory slot plugin","host mounted at","listening on ws","agent model","[health-monitor] started"];',
    "process.stdout.write=function(){var c=arguments[0];if(typeof c===\"string\")for(var i=0;i<__anchors.length;i++)if(c.includes(__anchors[i]))__tmark(__anchors[i]);return __origOut.apply(null,arguments)};",
    "process.stderr.write=function(){var c=arguments[0];if(typeof c===\"string\")for(var i=0;i<__anchors.length;i++)if(c.includes(__anchors[i]))__tmark(__anchors[i]);return __origErr.apply(null,arguments)};",
    "}",
  ].join("\n");

  // Insert after the first line (esbuild's banner with the createRequire import)
  const firstNewline = content.indexOf("\n");
  if (firstNewline === -1) {
    // Single-line output (unlikely) — just prepend
    fs.writeFileSync(ENTRY_FILE, timingCode + "\n" + content, "utf-8");
  } else {
    const patched =
      content.slice(0, firstNewline + 1) +
      timingCode +
      "\n" +
      content.slice(firstNewline + 1);
    fs.writeFileSync(ENTRY_FILE, patched, "utf-8");
  }

  console.log("[bundle-vendor-deps] Injected timing markers for 6 gateway startup phases");
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

  // Write the keepSet so copy-vendor-deps can limit its copy to only
  // the packages that BFS determined are needed at runtime.
  const keepSetPath = path.join(nmDir, ".bundle-keepset.json");
  fs.writeFileSync(keepSetPath, JSON.stringify([...keepSet].sort()));
  console.log(`[bundle-vendor-deps] Wrote keepset (${keepSet.size} packages) to .bundle-keepset.json`);

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

// ─── Size Report ───
// Collects sizes of key pipeline outputs and writes a JSON report to tmp/.
// Used by the update-vendor skill to detect size regressions across upgrades.

function generateSizeReport(/** @type {number} */ inlinedCount) {
  console.log("[bundle-vendor-deps] ─── Size Report ───");

  const fmt = (/** @type {number} */ bytes) =>
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(1)} KB`;

  // 1. Entry bundle
  const entryBundle = fs.existsSync(ENTRY_FILE) ? fs.statSync(ENTRY_FILE).size : 0;
  console.log(`  dist/entry.js              ${fmt(entryBundle)}`);

  // 2. Plugin-sdk monolithic bundle
  const pluginSdkIndex = path.join(distDir, "plugin-sdk", "index.js");
  const pluginSdk = fs.existsSync(pluginSdkIndex) ? fs.statSync(pluginSdkIndex).size : 0;
  console.log(`  dist/plugin-sdk/index.js   ${fmt(pluginSdk)}`);

  // 3. Extensions — itemized
  let extTotal = 0;
  let extCount = 0;
  /** @type {Array<{name: string, size: number}>} */
  const extItems = [];
  if (fs.existsSync(extensionsDir)) {
    for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const extDir = path.join(extensionsDir, entry.name);
      const size = dirSize(extDir);
      if (size > 0) {
        extItems.push({ name: entry.name, size });
        extTotal += size;
        extCount++;
      }
    }
  }
  extItems.sort((a, b) => b.size - a.size);
  console.log(`  extensions/ (${extCount} items)    ${fmt(extTotal)}`);
  const top5 = extItems.slice(0, 5).map((e) => `${e.name} (${fmt(e.size)})`);
  if (top5.length > 0) {
    console.log(`    top 5: ${top5.join(", ")}`);
  }

  // 4. node_modules
  const nmSize = fs.existsSync(nmDir) ? dirSize(nmDir) : 0;
  console.log(`  node_modules/              ${fmt(nmSize)}`);

  // Grand total
  const grandTotal = entryBundle + pluginSdk + extTotal + nmSize;
  console.log(`  TOTAL                      ${fmt(grandTotal)}`);

  // Write JSON report
  const vendorVersionFile = path.resolve(__dirname, "..", "..", "..", ".openclaw-version");
  const vendorHash = fs.existsSync(vendorVersionFile)
    ? fs.readFileSync(vendorVersionFile, "utf-8").trim().slice(0, 7)
    : "unknown";

  const report = {
    vendorHash,
    timestamp: new Date().toISOString(),
    entryBundle,
    pluginSdk,
    extensions: {
      total: extTotal,
      count: extCount,
      inlined: inlinedCount,
      items: Object.fromEntries(extItems.map((e) => [e.name, e.size])),
    },
    nodeModules: nmSize,
    grandTotal,
  };

  const tmpDir = path.resolve(__dirname, "..", "..", "..", "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const reportPath = path.join(tmpDir, `vendor-size-report-${vendorHash}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`  → Saved to tmp/vendor-size-report-${vendorHash}.json`);
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
  const { externals: extExternals, inlinedCount } = prebundleExtensions();
  bundlePluginSdk();
  patchVendorConstants();
  const bundleExternals = bundleWithEsbuild();
  replaceEntryWithBundle();
  patchStartupTiming();
  deleteChunkFiles();
  const keepSet = cleanupNodeModules();
  // Merge all external packages from extensions + main bundle for verification
  const allExternals = new Set([...extExternals, ...bundleExternals]);
  verifyExternalImports(allExternals, keepSet);
  smokeTestGateway();
  generateSizeReport(inlinedCount);

  // Write marker so re-runs are skipped (idempotency guard).
  // Placed AFTER smoke test so a failed run can be re-tried.
  fs.writeFileSync(BUNDLED_MARKER, new Date().toISOString(), "utf-8");

  console.log(`[bundle-vendor-deps] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
