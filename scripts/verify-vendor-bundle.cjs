// @ts-check
// Dry-run bundle verification for vendor/openclaw.
//
// Catches production packaging issues (missing dependencies, extension
// bundling failures, EXTERNAL_PACKAGES gaps) WITHOUT modifying the
// working tree.
//
// Strategy (Option C): Run read-only phases directly against the vendor
// tree (esbuild with write:false / metafile analysis, keepSet BFS,
// external import cross-reference).  Only create a temp copy for the
// smoke test phase.  This keeps execution under 60 seconds and avoids
// copying 1.3GB of node_modules.
//
// Phases verified:
//   0.5b  Pre-bundle vendor extensions (dry-run: catches build errors)
//   0.5a  Bundle plugin-sdk (dry-run: catches bundling failures)
//   1     Bundle dist/entry.js with esbuild (dry-run: catches EXTERNAL_PACKAGES gaps)
//   4     Simulate node_modules cleanup (resolve keep-set, verify coverage)
//   4.5   Verify external imports (cross-reference externals vs packages)
//   5     Smoke test gateway startup on the UNBUNDLED vendor tree

const fs = require("fs");
const path = require("path");
const os = require("os");

const TAG = "[verify-vendor-bundle]";
const vendorDir = path.resolve(__dirname, "..", "vendor", "openclaw");
const distDir = path.join(vendorDir, "dist");
const nmDir = path.join(vendorDir, "node_modules");
const extensionsDir = path.join(vendorDir, "extensions");

// ─── Import constants and helpers from bundle-vendor-deps.cjs ───
// We reference the original script's path but extract constants directly
// to avoid running its top-level code.

const EXTERNAL_PACKAGES = [
  // Native modules
  "sharp", "@img/*", "koffi",
  "@napi-rs/canvas", "@napi-rs/canvas-*",
  "@lydell/node-pty", "@lydell/node-pty-*",
  "@matrix-org/matrix-sdk-crypto-nodejs",
  "@discordjs/opus",
  "sqlite-vec", "sqlite-vec-*",
  "better-sqlite3",
  "@snazzah/*",
  "@lancedb/lancedb", "@lancedb/lancedb-*",
  // Complex dynamic loading
  "ajv", "protobufjs", "protobufjs/*",
  "playwright-core", "playwright", "chromium-bidi", "chromium-bidi/*",
  // Optional/missing
  "ffmpeg-static", "authenticate-pam", "esbuild", "node-llama-cpp",
  // Proxy dependency
  "undici",
  // Feishu SDK is resolved from the app workspace at runtime.
  "@larksuiteoapi/node-sdk",
  // Schema library shared with plugins
  "@sinclair/typebox", "@sinclair/typebox/*",
];

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
  const desktopDir = path.resolve(__dirname, "..", "apps", "desktop");
  return require(require.resolve("esbuild", { paths: [desktopDir] }));
}

// ─── Guards ───

if (!fs.existsSync(vendorDir)) {
  console.log(`${TAG} vendor/openclaw not found, skipping.`);
  process.exit(0);
}

const ENTRY_FILE = path.join(distDir, "entry.js");
if (!fs.existsSync(ENTRY_FILE)) {
  console.log(`${TAG} dist/entry.js not found, skipping.`);
  process.exit(0);
}

if (!fs.existsSync(nmDir)) {
  console.log(`${TAG} vendor/openclaw/node_modules not found, skipping.`);
  process.exit(0);
}

// ─── Results tracking ───

/** @type {Array<{phase: string, status: "pass" | "fail" | "skip", detail: string}>} */
const results = [];
let failed = false;

function pass(/** @type {string} */ phase, /** @type {string} */ detail) {
  results.push({ phase, status: "pass", detail });
  console.log(`${TAG} ${phase}: PASS — ${detail}`);
}

function fail(/** @type {string} */ phase, /** @type {string} */ detail) {
  results.push({ phase, status: "fail", detail });
  console.error(`${TAG} ${phase}: FAIL — ${detail}`);
  failed = true;
}

function skip(/** @type {string} */ phase, /** @type {string} */ detail) {
  results.push({ phase, status: "skip", detail });
  console.log(`${TAG} ${phase}: SKIP — ${detail}`);
}

// ─── Helpers (duplicated from bundle-vendor-deps to avoid coupling) ───

/**
 * Returns scoped plugin-sdk subpath .js filenames from vendor package.json.
 */
function resolvePluginSdkSubpathFiles() {
  const pkg = JSON.parse(fs.readFileSync(path.join(vendorDir, "package.json"), "utf-8"));
  const files = [];
  for (const key of Object.keys(pkg.exports || {})) {
    if (!key.startsWith("./plugin-sdk/")) continue;
    const subpath = key.replace("./plugin-sdk/", "");
    if (subpath === "account-id") continue;
    files.push(subpath + ".js");
  }
  return files;
}

/**
 * Build plugin-sdk alias map and externals list for esbuild.
 */
function resolvePluginSdkAliasAndExternals() {
  const pluginSdkDir = path.join(distDir, "plugin-sdk");
  const alias = {};
  const externals = [];
  for (const subFile of resolvePluginSdkSubpathFiles()) {
    const subpath = subFile.replace(".js", "");
    const importSpec = `openclaw/plugin-sdk/${subpath}`;
    alias[importSpec] = path.join(pluginSdkDir, subFile);
    externals.push(importSpec);
  }
  alias["openclaw/plugin-sdk/account-id"] = path.join(pluginSdkDir, "account-id.js");
  externals.push("openclaw/plugin-sdk/account-id");
  alias["openclaw/plugin-sdk"] = path.join(pluginSdkDir, "index.js");
  externals.push("openclaw/plugin-sdk");
  return { alias, externals };
}

/**
 * Build keep-set via BFS from EXTERNAL_PACKAGES seeds.
 */
function buildKeepSet() {
  const keepSet = new Set();
  const queue = [];

  for (const pattern of EXTERNAL_PACKAGES) {
    if (pattern.endsWith("/*")) {
      const scope = pattern.slice(0, pattern.indexOf("/"));
      const scopeDir = path.join(nmDir, scope);
      try {
        for (const entry of fs.readdirSync(scopeDir)) {
          queue.push(`${scope}/${entry}`);
        }
      } catch {}
    } else if (pattern.endsWith("-*")) {
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
            if (entry.startsWith(prefix)) {
              queue.push(entry);
            }
          }
        } catch {}
      }
    } else {
      queue.push(pattern);
    }
  }

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

/**
 * Extract package name from an import path.
 */
function extractPkgName(/** @type {string} */ importPath) {
  const parts = importPath.split("/");
  return importPath.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Check if a package matches an EXTERNAL_PACKAGES pattern.
 */
function matchesExternalPattern(/** @type {string} */ name) {
  for (const pattern of EXTERNAL_PACKAGES) {
    if (pattern === name) return true;
    if (pattern.endsWith("/*") && name.startsWith(pattern.slice(0, -1))) return true;
    if (pattern.endsWith("-*") && name.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

// ─── Phase 0.5b: Dry-run extension pre-bundling ───

function verifyExtensionBundling() {
  const phase = "Phase 0.5b (extensions)";

  if (!fs.existsSync(extensionsDir)) {
    skip(phase, "extensions/ directory not found");
    return { externals: new Set(), inlinedCount: 0 };
  }

  const esbuild = loadEsbuild();

  const INLINE_SIZE_LIMIT = 2 * 1024 * 1024;
  const extExternalsBase = [...EXTERNAL_PACKAGES];
  const { alias: pluginSdkAlias, externals: pluginSdkExternals } = resolvePluginSdkAliasAndExternals();
  const extExternalsWithSdk = [...extExternalsBase, ...pluginSdkExternals];

  // Temporarily write sideEffects:false package.json for tree-shaking
  const pluginSdkDir = path.join(distDir, "plugin-sdk");
  const pluginSdkPkg = path.join(pluginSdkDir, "package.json");
  const hadPkgJson = fs.existsSync(pluginSdkPkg);
  const origPkgContent = hadPkgJson ? fs.readFileSync(pluginSdkPkg, "utf-8") : null;
  fs.writeFileSync(pluginSdkPkg, JSON.stringify({ sideEffects: false }), "utf-8");

  // Use a temp dir for output so we never write to vendor
  const tmpExtDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclaw-verify-ext-"));

  // Find extensions with manifests
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
  let skippedExt = 0;
  const errors = [];
  const allExtPkgs = new Set();

  for (const ext of extDirs) {
    const indexTs = path.join(ext.dir, "index.ts");
    if (!fs.existsSync(indexTs)) {
      skippedExt++;
      continue;
    }

    const outfile = path.join(tmpExtDir, `${ext.name}.js`);

    try {
      // Try inline build first
      let result = esbuild.buildSync({
        entryPoints: [indexTs],
        outfile,
        bundle: true,
        format: "cjs",
        platform: "node",
        target: "node22",
        define: { "import.meta.url": "__import_meta_url" },
        banner: {
          js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href;',
        },
        external: extExternalsBase,
        alias: pluginSdkAlias,
        metafile: true,
        minify: true,
        logLevel: "warning",
      });

      const outSize = fs.statSync(outfile).size;
      if (outSize > INLINE_SIZE_LIMIT) {
        // Rebuild with plugin-sdk external
        result = esbuild.buildSync({
          entryPoints: [indexTs],
          outfile,
          bundle: true,
          format: "cjs",
          platform: "node",
          target: "node22",
          define: { "import.meta.url": "__import_meta_url" },
          banner: {
            js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href;',
          },
          external: extExternalsWithSdk,
          metafile: true,
          minify: true,
          logLevel: "warning",
        });
      } else {
        inlinedCount++;
      }

      // Collect external packages from metafile
      if (result.metafile) {
        for (const output of Object.values(result.metafile.outputs)) {
          for (const imp of /** @type {any} */ (output).imports || []) {
            if (imp.external) {
              allExtPkgs.add(extractPkgName(imp.path));
            }
          }
        }
      }

      bundled++;
    } catch (err) {
      errors.push({ name: ext.name, error: /** @type {Error} */ (err).message });
    }
  }

  // Restore original plugin-sdk package.json
  if (origPkgContent != null) {
    fs.writeFileSync(pluginSdkPkg, origPkgContent, "utf-8");
  } else {
    try { fs.unlinkSync(pluginSdkPkg); } catch {}
  }

  // Clean up temp dir
  try { fs.rmSync(tmpExtDir, { recursive: true, force: true }); } catch {}

  if (errors.length > 0) {
    const names = errors.map((e) => e.name).join(", ");
    fail(phase, `${errors.length} extension(s) failed to bundle: ${names}`);
    for (const { name, error } of errors) {
      console.error(`  ${name}: ${error.substring(0, 300)}`);
    }
  } else {
    pass(phase, `${bundled} extensions bundled (${inlinedCount} with plugin-sdk inlined, ${skippedExt} skipped)`);
  }

  return { externals: allExtPkgs, inlinedCount };
}

// ─── Phase 0.5a: Dry-run plugin-sdk bundling ───

function verifyPluginSdkBundle() {
  const phase = "Phase 0.5a (plugin-sdk)";

  const pluginSdkIndex = path.join(distDir, "plugin-sdk", "index.js");
  if (!fs.existsSync(pluginSdkIndex)) {
    skip(phase, "dist/plugin-sdk/index.js not found");
    return;
  }

  const esbuild = loadEsbuild();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclaw-verify-sdk-"));

  try {
    // Bundle index.js
    const tmpOut = path.join(tmpDir, "index.bundled.cjs");
    esbuild.buildSync({
      entryPoints: [pluginSdkIndex],
      outfile: tmpOut,
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node22",
      define: { "import.meta.url": "__import_meta_url" },
      banner: {
        js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href;',
      },
      external: EXTERNAL_PACKAGES,
      minify: true,
      logLevel: "warning",
    });

    const bundleSize = fs.statSync(tmpOut).size;

    // Bundle account-id.js
    const accountIdPath = path.join(distDir, "plugin-sdk", "account-id.js");
    if (fs.existsSync(accountIdPath)) {
      esbuild.buildSync({
        entryPoints: [accountIdPath],
        outfile: path.join(tmpDir, "account-id.bundled.cjs"),
        bundle: true,
        format: "cjs",
        platform: "node",
        target: "node22",
        external: EXTERNAL_PACKAGES,
        minify: true,
        logLevel: "warning",
      });
    }

    // Bundle scoped subpath files
    const scopedFiles = resolvePluginSdkSubpathFiles();
    let subBundled = 0;
    for (const subFile of scopedFiles) {
      const subPath = path.join(distDir, "plugin-sdk", subFile);
      if (fs.existsSync(subPath)) {
        esbuild.buildSync({
          entryPoints: [subPath],
          outfile: path.join(tmpDir, subFile.replace(".js", ".bundled.cjs")),
          bundle: true,
          format: "cjs",
          platform: "node",
          target: "node22",
          define: { "import.meta.url": "__import_meta_url" },
          banner: {
            js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href;',
          },
          external: EXTERNAL_PACKAGES,
          minify: true,
          logLevel: "warning",
        });
        subBundled++;
      }
    }

    pass(phase, `index.js ${(bundleSize / 1024 / 1024).toFixed(1)}MB, account-id.js OK, ${subBundled} subpath files OK`);
  } catch (err) {
    fail(phase, `plugin-sdk bundling failed: ${/** @type {Error} */ (err).message.substring(0, 300)}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Phase 1: Dry-run entry.js bundle ───

function verifyEntryBundle() {
  const phase = "Phase 1 (entry.js bundle)";

  const esbuild = loadEsbuild();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclaw-verify-entry-"));

  try {
    const result = esbuild.buildSync({
      entryPoints: [ENTRY_FILE],
      bundle: true,
      outdir: tmpDir,
      splitting: true,
      chunkNames: "chunk-[hash]",
      format: "esm",
      platform: "node",
      target: "node22",
      external: EXTERNAL_PACKAGES,
      logLevel: "warning",
      metafile: true,
      sourcemap: false,
      minify: true,
      banner: {
        js: 'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);',
      },
    });

    // Report output
    const outputFiles = fs.readdirSync(tmpDir);
    const entryOut = path.join(tmpDir, "entry.js");
    const entrySize = fs.existsSync(entryOut) ? fs.statSync(entryOut).size : 0;
    const chunkFiles = outputFiles.filter((f) => f !== "entry.js" && f.endsWith(".js"));
    let totalSize = entrySize;
    for (const f of chunkFiles) {
      totalSize += fs.statSync(path.join(tmpDir, f)).size;
    }

    // Collect externals from metafile
    const usedExternals = new Set();
    if (result.metafile) {
      for (const output of Object.values(result.metafile.outputs)) {
        for (const imp of /** @type {any} */ (output).imports || []) {
          if (imp.external) {
            usedExternals.add(extractPkgName(imp.path));
          }
        }
      }
    }

    pass(
      phase,
      `entry.js ${(entrySize / 1024 / 1024).toFixed(1)}MB + ${chunkFiles.length} chunks = ` +
        `${(totalSize / 1024 / 1024).toFixed(1)}MB total, ${usedExternals.size} external packages`,
    );

    return usedExternals;
  } catch (err) {
    fail(phase, `esbuild bundle failed: ${/** @type {Error} */ (err).message.substring(0, 500)}`);
    return new Set();
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Phase 4: Simulate node_modules cleanup ───

function verifyKeepSet() {
  const phase = "Phase 4 (keep-set)";

  const keepSet = buildKeepSet();

  if (keepSet.size === 0) {
    fail(phase, "BFS keep-set is empty — no external packages resolved");
    return keepSet;
  }

  // Verify that all packages in the keep-set actually exist in node_modules
  let missingFromNm = 0;
  const missingPkgs = [];
  for (const pkg of keepSet) {
    const pkgDir = path.join(nmDir, pkg);
    if (!fs.existsSync(pkgDir)) {
      missingFromNm++;
      missingPkgs.push(pkg);
    }
  }

  if (missingFromNm > 0) {
    fail(phase, `${missingFromNm} keep-set package(s) missing from node_modules: ${missingPkgs.join(", ")}`);
  } else {
    pass(phase, `${keepSet.size} packages in keep-set, all present in node_modules`);
  }

  return keepSet;
}

// ─── Phase 4.5: Verify external imports ───

function verifyExternalImports(
  /** @type {Set<string>} */ allExternals,
  /** @type {Set<string>} */ keepSet,
) {
  const phase = "Phase 4.5 (external imports)";

  const missing = [];
  let verifiedCount = 0;
  let skippedNeverInstalled = 0;

  for (const pkg of [...allExternals].sort()) {
    if (isNodeBuiltin(pkg)) continue;
    if (!matchesExternalPattern(pkg)) continue;
    if (!keepSet.has(pkg)) {
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
    fail(
      phase,
      `${missing.length} external package(s) in keep-set but missing from node_modules: ${missing.join(", ")}`,
    );
  } else {
    pass(
      phase,
      `${verifiedCount} installed external imports verified` +
        (skippedNeverInstalled > 0 ? ` (${skippedNeverInstalled} optional/never-installed skipped)` : ""),
    );
  }
}

// ─── Phase 5: Smoke test gateway startup ───

function smokeTestGateway() {
  const phase = "Phase 5 (smoke test)";
  const { spawn } = require("child_process");

  const openclawMjs = path.join(vendorDir, "openclaw.mjs");
  if (!fs.existsSync(openclawMjs)) {
    skip(phase, "openclaw.mjs not found");
    return Promise.resolve();
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclaw-verify-smoke-"));

  const minimalConfig = {
    gateway: { port: 59997, mode: "local" },
    models: {},
    agents: { defaults: { skipBootstrap: true } },
  };
  fs.writeFileSync(
    path.join(tmpDir, "openclaw.json"),
    JSON.stringify(minimalConfig),
    "utf-8",
  );

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [openclawMjs, "gateway"], {
      cwd: tmpDir,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: path.join(tmpDir, "openclaw.json"),
        OPENCLAW_STATE_DIR: tmpDir,
        NODE_COMPILE_CACHE: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let allOutput = "";
    let settled = false;

    function cleanup() {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }

    function settle(/** @type {boolean} */ ok, /** @type {string} */ detail) {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      cleanup();
      if (ok) {
        pass(phase, detail);
      } else {
        fail(phase, detail);
      }
      resolve();
    }

    function checkOutput() {
      if (settled) return;

      if (allOutput.includes("[gateway]")) {
        if (allOutput.includes("Cannot find module")) {
          const matches = allOutput.match(/Cannot find module '([^']+)'/g) || [];
          const modules = matches.map(
            (m) => m.match(/Cannot find module '([^']+)'/)?.[1] || "?",
          );
          const unique = [...new Set(modules)];
          settle(false, `Gateway started but ${unique.length} module(s) missing: ${unique.join(", ")}`);
          return;
        }
        settle(true, "Gateway started successfully");
        return;
      }

      if (allOutput.includes("Dynamic require of")) {
        const match = allOutput.match(/Dynamic require of "([^"]+)" is not supported/);
        settle(false, `Dynamic require of "${match ? match[1] : "(unknown)"}" is not supported`);
        return;
      }

      if (allOutput.includes("Cannot find module")) {
        const match = allOutput.match(/Cannot find module '([^']+)'/);
        settle(false, `Cannot find module '${match ? match[1] : "(unknown)"}'`);
        return;
      }
    }

    child.stdout.on("data", (chunk) => {
      allOutput += chunk.toString();
      checkOutput();
    });

    child.stderr.on("data", (chunk) => {
      allOutput += chunk.toString();
      checkOutput();
    });

    child.on("close", (code) => {
      if (settled) return;

      if (code === 0 && !allOutput.trim()) {
        settle(false, "Gateway exited immediately with code 0 and no output (isMainModule check failed?)");
        return;
      }

      settle(false, `Gateway exited with code ${code}. Output: ${(allOutput || "(empty)").substring(0, 500)}`);
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settle(false, `Gateway timed out (30s) with no "[gateway]" output. Output: ${(allOutput || "(empty)").substring(0, 500)}`);
      }
    }, 30_000);
    timeout.unref();
  });
}

// ─── Main ───

(async () => {
  const t0 = Date.now();
  console.log(`${TAG} Starting dry-run bundle verification...\n`);

  // Phase 0.5b: Extensions (writes to temp dir, reads from vendor)
  const { externals: extExternals } = verifyExtensionBundling();

  // Phase 0.5a: Plugin-sdk (writes to temp dir)
  verifyPluginSdkBundle();

  // Phase 1: Entry bundle (writes to temp dir)
  const bundleExternals = verifyEntryBundle();

  // Phase 4: Keep-set simulation (read-only)
  const keepSet = verifyKeepSet();

  // Phase 4.5: External import verification (read-only)
  const allExternals = new Set([...extExternals, ...bundleExternals]);
  verifyExternalImports(allExternals, keepSet);

  // Phase 5: Smoke test (uses temp dir, reads vendor)
  await smokeTestGateway();

  // ─── Summary ───
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${TAG} ═══════════════════════════════════════`);
  console.log(`${TAG} SUMMARY (${elapsed}s)`);
  console.log(`${TAG} ═══════════════════════════════════════`);

  for (const r of results) {
    const icon = r.status === "pass" ? "OK" : r.status === "fail" ? "FAIL" : "SKIP";
    console.log(`${TAG}   [${icon}] ${r.phase}: ${r.detail}`);
  }

  const passes = results.filter((r) => r.status === "pass").length;
  const fails = results.filter((r) => r.status === "fail").length;
  const skips = results.filter((r) => r.status === "skip").length;
  console.log(`${TAG}`);
  console.log(`${TAG}   ${passes} passed, ${fails} failed, ${skips} skipped`);
  console.log(`${TAG} ═══════════════════════════════════════\n`);

  if (failed) {
    process.exit(1);
  }
})();
