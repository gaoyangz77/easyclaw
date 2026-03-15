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
//   0.6   Feishu import guard (prevents heavy deps in light entry points)
//   0.5b  Pre-bundle vendor extensions (dry-run: catches build errors)
//   0.5a  Bundle plugin-sdk (dry-run: catches bundling failures)
//   1     Bundle dist/entry.js with esbuild (dry-run: catches EXTERNAL_PACKAGES gaps)
//   4     Simulate node_modules cleanup (resolve keep-set, verify coverage)
//   4.5   Verify external imports (cross-reference externals vs packages)
//   5     Smoke test gateway startup on the UNBUNDLED vendor tree

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  EXTERNAL_PACKAGES,
  isAllowlistedVendorRuntimeSpecifier,
  matchesExternalPackage,
} = require("./vendor-runtime-packages.cjs");

const TAG = "[verify-vendor-bundle]";
const vendorDir = path.resolve(__dirname, "..", "vendor", "openclaw");
const distDir = path.join(vendorDir, "dist");
const nmDir = path.join(vendorDir, "node_modules");
const extensionsDir = path.join(vendorDir, "extensions");

// Shared single-source allowlist of packages that must survive runtime
// resolution after vendor pruning/bundling.

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
const hasEntryFile = fs.existsSync(ENTRY_FILE);
const hasNodeModules = fs.existsSync(nmDir);

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
const VENDOR_RUNTIME_LOADER_PATTERNS = {
  requireCall: /(?:^|[^\w$.])require\(\s*["']([^"']+)["']\s*\)/g,
  requireResolve: /require\.resolve\(\s*["']([^"']+)["']\s*\)/g,
  createRequireCall: /createRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g,
  moduleCreateRequireCall: /module\.createRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g,
};

function escapeRegex(/** @type {string} */ literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCreateRequireAliases(/** @type {string} */ code) {
  const aliases = new Set();
  const aliasRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:createRequire|module\.createRequire)\(/g;
  let match;
  while ((match = aliasRe.exec(code)) !== null) {
    aliases.add(match[1]);
  }
  return [...aliases];
}

// ─── Phase 0.6: Feishu import guard (light entry points must stay light) ───

function verifyFeishuImportGuard() {
  const phase = "Phase 0.6 (feishu import guard)";

  const feishuEntryPoints = [
    path.join(vendorDir, "src", "plugin-sdk", "feishu.ts"),
    path.join(vendorDir, "extensions", "feishu", "src", "channel.ts"),
    path.join(vendorDir, "extensions", "feishu", "plugin.ts"),
  ];

  // Skip if any entry point is missing (vendor may not be provisioned)
  const missingEntries = feishuEntryPoints.filter((ep) => !fs.existsSync(ep));
  if (missingEntries.length > 0) {
    skip(phase, `${missingEntries.length} feishu entry point(s) not found (vendor not provisioned?)`);
    return;
  }

  // Forbidden internal file path patterns (matched against metafile input keys)
  const FORBIDDEN_INTERNAL_PATTERNS = [
    /src[\\/]agents[\\/]model-auth\.[jt]s/,
    /src[\\/]agents[\\/]models-config\.providers\.[jt]s/,
    /src[\\/]agents[\\/]bedrock-discovery\.[jt]s/,
  ];

  // Forbidden npm packages
  const FORBIDDEN_NPM_PACKAGES = new Set([
    "@aws-sdk/client-bedrock",
    "openai",
    "@google/genai",
  ]);

  const esbuild = loadEsbuild();
  // Build alias map pointing to source .ts files (dist/ may not be built).
  // Resolve against src/plugin-sdk/ so esbuild can trace the full dep graph.
  const pluginSdkSrcDir = path.join(vendorDir, "src", "plugin-sdk");
  const feishuAlias = {};
  const { externals: pluginSdkExternals } = resolvePluginSdkAliasAndExternals();
  for (const ext of pluginSdkExternals) {
    const subpath = ext.replace("openclaw/plugin-sdk", "");
    const tsFile = subpath
      ? path.join(pluginSdkSrcDir, subpath.slice(1) + ".ts")
      : path.join(pluginSdkSrcDir, "index.ts");
    if (fs.existsSync(tsFile)) {
      feishuAlias[ext] = tsFile;
    }
  }

  // Build a filtered externals list that does NOT externalize forbidden npm
  // packages.  When a forbidden package IS in the dependency graph, esbuild
  // will resolve it into metafile.inputs — making detection reliable.
  // The normal EXTERNAL_PACKAGES list externalizes them, which hides the edge.
  const guardExternals = EXTERNAL_PACKAGES.filter((pattern) => {
    for (const forbidden of FORBIDDEN_NPM_PACKAGES) {
      // Match exact name or wildcard pattern (e.g. "@aws-sdk/*")
      if (pattern === forbidden) return false;
      if (pattern.endsWith("/*")) {
        const scope = pattern.slice(0, -2);
        if (forbidden.startsWith(scope + "/")) return false;
      }
      if (pattern.endsWith("-*")) {
        const prefix = pattern.slice(0, -1);
        if (forbidden.startsWith(prefix)) return false;
      }
    }
    return true;
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclaw-verify-feishu-"));

  /** @type {string[]} */
  const violations = [];

  try {
    for (const entryPoint of feishuEntryPoints) {
      const entryLabel = path.relative(vendorDir, entryPoint);

      /** @type {import("esbuild").BuildResult & { metafile: import("esbuild").Metafile }} */
      let result;
      try {
        result = esbuild.buildSync({
          entryPoints: [entryPoint],
          outdir: tmpDir,
          bundle: true,
          format: "cjs",
          platform: "node",
          target: "node22",
          define: { "import.meta.url": "__import_meta_url" },
          banner: {
            js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href;',
          },
          // Use guardExternals: forbidden npm packages are NOT externalized,
          // so esbuild resolves them into metafile.inputs if reachable.
          external: guardExternals,
          alias: feishuAlias,
          metafile: true,
          write: false,
          logLevel: "warning",
        });
      } catch (err) {
        // The analysis build itself broke — this means the guard cannot verify
        // the light-entry contract.  Fail hard so a broken guard is never silent.
        fail(phase, `analysis build failed for ${entryLabel} (guard non-functional): ${/** @type {Error} */ (err).message.substring(0, 300)}`);
        return;
      }

      // Analyze metafile.inputs for forbidden dependencies.
      // Because forbidden npm packages are not externalized, they appear in
      // inputs if (and only if) the entry point transitively imports them.
      const inputPaths = Object.keys(result.metafile.inputs);

      for (const inputPath of inputPaths) {
        // Check internal file path patterns
        for (const pattern of FORBIDDEN_INTERNAL_PATTERNS) {
          if (pattern.test(inputPath)) {
            violations.push(`${entryLabel} -> ${inputPath}`);
          }
        }

        // Check npm package imports — now reliably in inputs since not externalized
        const pkgName = extractPkgName(inputPath);
        if (FORBIDDEN_NPM_PACKAGES.has(pkgName)) {
          violations.push(`${entryLabel} -> npm:${pkgName} (via ${inputPath})`);
        }
      }
    }

    if (violations.length > 0) {
      fail(phase, `${violations.length} forbidden import(s) found in feishu light entries:\n` +
        violations.map((v) => `    ${v}`).join("\n"));
    } else {
      pass(phase, `${feishuEntryPoints.length} feishu entry points verified — no forbidden heavy dependencies`);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
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

  if (!hasEntryFile) {
    skip(phase, "dist/entry.js not found");
    return new Set();
  }

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

  if (!hasNodeModules) {
    skip(phase, "vendor/openclaw/node_modules not found");
    return new Set();
  }

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
    if (!matchesExternalPackage(pkg)) continue;
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

// ─── Phase 4.25: Verify vendor runtime loader allowlist ───

function verifyVendorRuntimeLoaderAllowlist() {
  const phase = "Phase 4.25 (vendor runtime loaders)";
  const vendorExtDir = path.join(vendorDir, "extensions");
  if (!fs.existsSync(vendorExtDir)) {
    skip(phase, "vendor extensions directory not found");
    return;
  }

  /** @type {Map<string, string[]>} */
  const missing = new Map();
  let scannedSpecifiers = 0;
  let allowlistedSpecifiers = 0;

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.(?:[cm]?js|[mc]?ts)$/.test(entry.name)) continue;
      if (/\.(?:test|spec)\./.test(entry.name)) continue;
      if (/\.d\.[mc]?ts$/.test(entry.name)) continue;

      const code = fs.readFileSync(fullPath, "utf-8");
      const relPath = path.relative(vendorDir, fullPath);

      /** @type {Array<[string, RegExp]>} */
      const patterns = Object.entries(VENDOR_RUNTIME_LOADER_PATTERNS);
      for (const alias of extractCreateRequireAliases(code)) {
        patterns.push([
          "createRequireAliasCall",
          new RegExp(`(?:^|[^\\w$.])${escapeRegex(alias)}\\(\\s*["']([^"']+)["']\\s*\\)`, "g"),
        ]);
        patterns.push([
          "createRequireAliasResolve",
          new RegExp(`${escapeRegex(alias)}\\.resolve\\(\\s*["']([^"']+)["']\\s*\\)`, "g"),
        ]);
      }

      for (const [kind, pattern] of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(code)) !== null) {
          const spec = match[1];
          if (isNodeBuiltin(spec) || spec.startsWith(".") || spec.startsWith("node:")) {
            continue;
          }
          scannedSpecifiers++;
          if (isAllowlistedVendorRuntimeSpecifier(spec)) {
            allowlistedSpecifiers++;
            continue;
          }
          const key = `${kind}:${spec}`;
          const sources = missing.get(key) ?? [];
          if (!sources.includes(relPath)) sources.push(relPath);
          missing.set(key, sources);
        }
      }
    }
  }

  walk(vendorExtDir);

  if (missing.size > 0) {
    const details = [...missing.entries()]
      .map(([spec, sources]) => `${spec} from ${sources.join(", ")}`)
      .join("; ");
    fail(
      phase,
      `${missing.size} runtime-loaded package(s) are not in the shared allowlist: ${details}`,
    );
    return;
  }

  pass(
    phase,
    `${allowlistedSpecifiers}/${scannedSpecifiers} runtime-loaded vendor specifiers matched the shared allowlist`,
  );
}

// ─── Startup budget enforcement ───

const startupTimerPath = path.resolve(__dirname, "..", "packages", "gateway", "src", "startup-timer.cjs");
const BUDGETS = {
  "event loop started": 8000,
  "gateway listening": 12000,
};
// Required milestones — success is only declared after ALL of these appear.
const REQUIRED_MILESTONES = ["gateway listening"];
const STARTUP_TIMER_RE = /\[startup-timer\] \+(\d+)ms (event loop started|gateway listening)/g;

/** Parse startup-timer milestones from combined output. */
function parseStartupMilestones(/** @type {string} */ output) {
  /** @type {Record<string, number>} */
  const milestones = {};
  let match;
  const re = new RegExp(STARTUP_TIMER_RE.source, STARTUP_TIMER_RE.flags);
  while ((match = re.exec(output)) !== null) {
    milestones[match[2]] = parseInt(match[1], 10);
  }
  return milestones;
}

/** Check whether all required milestones are present. */
function hasRequiredMilestones(/** @type {Record<string, number>} */ milestones) {
  return REQUIRED_MILESTONES.every((m) => m in milestones);
}

/**
 * Validate milestones against budgets.
 * Returns { violations, missing } where missing lists milestones we expected
 * but never saw.
 */
function validateStartupBudgets(
  /** @type {Record<string, number>} */ milestones,
  /** @type {boolean} */ timerInjected,
) {
  // Print actual values for monitoring
  for (const [label, ms] of Object.entries(milestones)) {
    const budget = BUDGETS[label];
    if (budget) {
      console.log(`${TAG} Startup timing: "${label}" = ${ms}ms (budget: ${budget}ms)`);
    } else {
      console.log(`${TAG} Startup timing: "${label}" = ${ms}ms`);
    }
  }

  /** @type {Array<{label: string, actual: number, budget: number}>} */
  const violations = [];
  for (const [label, budget] of Object.entries(BUDGETS)) {
    const actual = milestones[label];
    if (actual !== undefined && actual > budget) {
      violations.push({ label, actual, budget });
    }
  }

  const missing = REQUIRED_MILESTONES.filter((m) => !(m in milestones));

  return { violations, missing };
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

  // startup-timer.cjs is a required dependency for budget enforcement.
  // It lives in our repo — if missing, something is wrong.
  const timerExists = fs.existsSync(startupTimerPath);
  if (!timerExists) {
    fail(phase, `startup-timer.cjs not found at ${startupTimerPath} — budget guard cannot function`);
    return Promise.resolve();
  }

  const existingNodeOptions = process.env.NODE_OPTIONS || "";
  const nodeOptions = `${existingNodeOptions} --require ${startupTimerPath}`.trim();

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [openclawMjs, "gateway"], {
      cwd: tmpDir,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: path.join(tmpDir, "openclaw.json"),
        OPENCLAW_STATE_DIR: tmpDir,
        NODE_COMPILE_CACHE: undefined,
        NODE_OPTIONS: nodeOptions,
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

      // ── Early failure detection (crash / missing module) ──
      if (allOutput.includes("Dynamic require of")) {
        const match = allOutput.match(/Dynamic require of "([^"]+)" is not supported/);
        settle(false, `Dynamic require of "${match ? match[1] : "(unknown)"}" is not supported`);
        return;
      }

      if (allOutput.includes("Cannot find module") && !allOutput.includes("gateway listening")) {
        // If gateway is still starting up, a missing module is fatal
        if (!allOutput.includes("[gateway]") || allOutput.includes("Cannot find module")) {
          const matches = allOutput.match(/Cannot find module '([^']+)'/g) || [];
          const modules = matches.map(
            (m) => m.match(/Cannot find module '([^']+)'/)?.[1] || "?",
          );
          const unique = [...new Set(modules)];
          // Only settle if gateway has exited or we see the error before gateway logs
          if (!allOutput.includes("[gateway]")) {
            settle(false, `Cannot find module: ${unique.join(", ")}`);
            return;
          }
        }
      }

      // ── Success requires all required milestones from startup-timer ──
      const milestones = parseStartupMilestones(allOutput);
      if (!hasRequiredMilestones(milestones)) {
        // Not ready yet — keep waiting for more output
        return;
      }

      // All required milestones present — check for runtime errors first
      if (allOutput.includes("Cannot find module")) {
        const matches = allOutput.match(/Cannot find module '([^']+)'/g) || [];
        const modules = matches.map(
          (m) => m.match(/Cannot find module '([^']+)'/)?.[1] || "?",
        );
        const unique = [...new Set(modules)];
        settle(false, `Gateway started but ${unique.length} module(s) missing: ${unique.join(", ")}`);
        return;
      }

      // Validate budgets
      const budgetResult = validateStartupBudgets(milestones, true);
      if (budgetResult.violations.length > 0) {
        for (const v of budgetResult.violations) {
          console.error(
            `${TAG} BUDGET EXCEEDED: "${v.label}" took ${v.actual}ms (budget: ${v.budget}ms)`,
          );
        }
        settle(false, `Startup budget exceeded: ${budgetResult.violations.map((v) => `"${v.label}" ${v.actual}ms>${v.budget}ms`).join(", ")}`);
        return;
      }

      settle(true, "Gateway started successfully");
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

      // Gateway exited before required milestones appeared.
      // Detect whether startup-timer produced any parseable milestone record
      // (not just a raw substring — partial/malformed lines don't count).
      const milestones = parseStartupMilestones(allOutput);
      const parsedAny = Object.keys(milestones).length > 0;

      if (!parsedAny) {
        // Distinguish "timer preload ran but gateway crashed before any milestone"
        // from "timer never executed at all".
        const timerPreloadRan = allOutput.includes("[startup-timer] +");
        if (timerPreloadRan) {
          settle(false, `Gateway crashed (code ${code}) before any startup milestone fired — timer preload ran but process exited before "event loop started"`);
        } else {
          settle(false, `Gateway exited (code ${code}) and startup-timer produced no output — timer injection failed`);
        }
        return;
      }

      const missingLabels = REQUIRED_MILESTONES.filter((m) => !(m in milestones));
      if (missingLabels.length > 0) {
        settle(false, `Gateway exited (code ${code}) before required milestone(s): ${missingLabels.join(", ")}`);
        return;
      }

      settle(false, `Gateway exited with code ${code}. Output: ${(allOutput || "(empty)").substring(0, 500)}`);
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      const milestones = parseStartupMilestones(allOutput);
      const missingLabels = REQUIRED_MILESTONES.filter((m) => !(m in milestones));
      if (missingLabels.length > 0) {
        settle(false, `Gateway timed out (30s). Required milestone(s) never appeared: ${missingLabels.join(", ")}. Output: ${(allOutput || "(empty)").substring(0, 500)}`);
      } else {
        settle(false, `Gateway timed out (30s). Output: ${(allOutput || "(empty)").substring(0, 500)}`);
      }
    }, 30_000);
    timeout.unref();
  });
}

// ─── Main ───

(async () => {
  const t0 = Date.now();
  console.log(`${TAG} Starting dry-run bundle verification...\n`);

  // Phase 0.6: Feishu import guard (dry-run, reads from vendor)
  verifyFeishuImportGuard();

  // Phase 0.5b: Extensions (writes to temp dir, reads from vendor)
  const { externals: extExternals } = verifyExtensionBundling();

  // Phase 0.5a: Plugin-sdk (writes to temp dir)
  verifyPluginSdkBundle();

  // Phase 1: Entry bundle (writes to temp dir)
  const bundleExternals = verifyEntryBundle();

  // Phase 4: Keep-set simulation (read-only)
  const keepSet = verifyKeepSet();

  // Phase 4.25: Vendor runtime loader allowlist verification (read-only)
  verifyVendorRuntimeLoaderAllowlist();

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
