// @ts-check
// Compiles private merchant extension .mjs files to V8 bytecode (.jsc),
// then replaces the original source with a thin loader wrapper.
//
// This prevents users from easily reading the business logic in packaged builds.
//
// IMPORTANT: Must use Electron's Node.js binary for compilation because .jsc
// files are V8 version-specific. Bytecode compiled by system Node.js will be
// rejected by Electron's V8 at runtime.
//
// No external dependencies required — uses only Node.js built-in modules.
// The bytecode format follows the same conventions as bytenode (Module.wrap +
// vm.Script.createCachedData), so the runtime loader is compatible.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Resolves the Electron binary path from the packaged app output directory.
 *
 * In packaged builds:
 * - macOS: <appOutDir>/<ProductName>.app/Contents/MacOS/<ProductName>
 * - Windows: <appOutDir>/<ProductName>.exe
 * - Linux: <appOutDir>/<productName (lowercase)>
 *
 * @param {import("electron-builder").AfterPackContext} context
 * @returns {string}
 */
function resolvePackagedElectronPath(context) {
  const { appOutDir, electronPlatformName } = context;
  const productName = context.packager.appInfo.productFilename;

  if (electronPlatformName === "darwin") {
    return path.join(appOutDir, `${productName}.app`, "Contents", "MacOS", productName);
  }
  if (electronPlatformName === "win32") {
    return path.join(appOutDir, `${productName}.exe`);
  }
  // Linux: binary name is lowercase productName
  return path.join(appOutDir, productName.toLowerCase());
}

/**
 * Compiles a single .mjs source file to V8 bytecode using the packaged
 * Electron binary.
 *
 * The source is wrapped in Module.wrap() (CommonJS wrapper) before compiling,
 * producing a function(exports, require, module, __filename, __dirname) { ... }
 * wrapper — the same format that Module._extensions['.jsc'] expects at runtime.
 *
 * @param {string} electronPath - Path to packaged Electron binary
 * @param {string} sourceFile   - Absolute path to the .mjs file to compile
 * @param {string} outputFile   - Absolute path for the .jsc output
 */
function compileToBytecodeSingle(electronPath, sourceFile, outputFile) {
  // Run a small inline script under Electron's Node.js runtime
  // (ELECTRON_RUN_AS_NODE=1) to compile using the correct V8 version.
  //
  // The script reads the source, wraps it in Module.wrap(), compiles to
  // bytecode via vm.Script.createCachedData(), and writes the .jsc file.
  // ESM sources (.mjs) contain `export` statements that vm.Script (CJS context)
  // cannot parse. Convert ESM → CJS with esbuild before compiling to bytecode.
  const esbuild = require("esbuild");
  const cjsFile = sourceFile.replace(/\.mjs$/, ".cjs");
  esbuild.buildSync({
    entryPoints: [sourceFile],
    outfile: cjsFile,
    format: "cjs",
    platform: "node",
    bundle: true,
    sourcemap: false,
    // Inline all workspace deps (e.g. @rivonclaw/core) that won't exist at
    // runtime in the packaged app. Only keep true Node.js built-ins external.
    packages: "bundle",
  });

  const compileScript = `
    const fs = require('fs');
    const Module = require('module');
    const vm = require('vm');
    const v8 = require('v8');

    v8.setFlagsFromString('--no-lazy');
    if (Number.parseInt(process.versions.node, 10) >= 12) {
      v8.setFlagsFromString('--no-flush-bytecode');
    }

    const sourceCode = fs.readFileSync(${JSON.stringify(cjsFile)}, 'utf-8');
    const wrappedCode = Module.wrap(sourceCode);

    const script = new vm.Script(wrappedCode, { produceCachedData: true });
    const bytecodeBuffer = script.createCachedData
      ? script.createCachedData()
      : script.cachedData;

    if (!bytecodeBuffer || bytecodeBuffer.length === 0) {
      process.stderr.write('Failed to create cached data\\n');
      process.exit(1);
    }

    fs.writeFileSync(${JSON.stringify(outputFile)}, bytecodeBuffer);
    process.exit(0);
  `;

  const result = execFileSync(electronPath, ["-e", compileScript], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });

  // Verify the .jsc file was created and is non-empty
  if (!fs.existsSync(outputFile)) {
    throw new Error(`Bytecode compilation failed: ${outputFile} was not created`);
  }
  const stat = fs.statSync(outputFile);
  if (stat.size === 0) {
    throw new Error(`Bytecode compilation produced empty file: ${outputFile}`);
  }

  // Clean up temp CJS file
  try { fs.unlinkSync(cjsFile); } catch {}
}

/**
 * Generates a thin .mjs loader wrapper that loads the compiled .jsc bytecode
 * at runtime. The wrapper inlines the essential runtime loader so there is no
 * dependency on any external bytecode package.
 *
 * The wrapper works with jiti (OpenClaw's plugin loader) because jiti
 * evaluates .mjs files in a CommonJS-compatible context where `require`
 * and `module` are available.
 *
 * @param {string} jscBasename - Basename of the .jsc file (e.g. "rivonclaw-ecommerce.jsc")
 * @returns {string} The loader wrapper source code
 */
function generateLoaderWrapper(jscBasename) {
  // The wrapper inlines the essential V8 bytecode loader.
  // This is the minimal code needed to:
  // 1. Register Module._extensions['.jsc'] so require('.jsc') works
  // 2. Load and execute the bytecode with correct module context
  //
  // The loader uses CommonJS require() which jiti provides when loading .mjs files.
  return `'use strict';
// V8 bytecode loader — auto-generated by compile-merchant-bytecode.cjs
// This file replaces the original source with a thin wrapper that loads
// pre-compiled V8 bytecode. Do not edit.

const _path = require('path');
const _fs = require('fs');
const _vm = require('vm');
const _Module = require('module');

// Register .jsc extension handler (inlined bytecode runtime loader)
if (!_Module._extensions['.jsc']) {
  _Module._extensions['.jsc'] = function (fileModule, filename) {
    const bytecodeBuffer = _fs.readFileSync(filename);

    // Fix bytecode hash to match current V8 version.
    // V8 embeds a version hash at bytes 12-15 that must match the running
    // engine. We compile a tiny dummy script to get the correct hash and
    // patch it into the loaded bytecode buffer.
    const dummyCode = '"\\u200b"';
    const dummyScript = new _vm.Script(dummyCode, { produceCachedData: true });
    const dummyBytecode = dummyScript.createCachedData
      ? dummyScript.createCachedData()
      : dummyScript.cachedData;
    dummyBytecode.subarray(12, 16).copy(bytecodeBuffer, 12);

    // Read source length from bytecode header to generate a dummy source
    // string of matching length (required by V8 for bytecode validation).
    const length = bytecodeBuffer.subarray(8, 12).reduce(
      function (sum, n, power) { return sum + n * Math.pow(256, power); }, 0
    );
    let dummySource = '';
    if (length > 1) {
      dummySource = '"' + '\\u200b'.repeat(length - 2) + '"';
    }

    const script = new _vm.Script(dummySource, {
      cachedData: bytecodeBuffer,
      filename: filename,
    });
    if (script.cachedDataRejected) {
      throw new Error('V8 bytecode rejected — compiled with incompatible V8 version: ' + filename);
    }

    // Set up the CommonJS module context for the bytecode wrapper function
    function require(id) { return fileModule.require(id); }
    require.resolve = function (request, options) {
      return _Module._resolveFilename(request, fileModule, false, options);
    };
    if (process.main) { require.main = process.main; }
    require.extensions = _Module._extensions;
    require.cache = _Module._cache;

    const compiledWrapper = script.runInThisContext({
      filename: filename,
      displayErrors: true,
    });
    const dirname = _path.dirname(filename);
    return compiledWrapper.apply(fileModule.exports, [
      fileModule.exports, require, fileModule, filename, dirname, process, global
    ]);
  };
}

// Load the bytecode module
const _jscPath = _path.join(__dirname, ${JSON.stringify(jscBasename)});
module.exports = require(_jscPath);
`;
}

/**
 * Compiles all .mjs files under extensions-merchant/ in the packaged app
 * to V8 bytecode, replacing original source with loader wrappers.
 *
 * @param {import("electron-builder").AfterPackContext} context
 * @param {string} resourcesDir - Path to the Resources directory in the packaged app
 */
async function compileMerchantBytecode(context, resourcesDir) {
  // For universal macOS builds, afterPack runs 3 times: x64, arm64, universal.
  // .jsc bytecode is architecture-specific (different V8 internal encoding),
  // so we skip the per-arch builds and only compile once on the universal pass.
  // This avoids "Expected all non-binary files to have identical SHAs" errors.
  const appOutDir = context.appOutDir;
  if (appOutDir.includes("x64-temp") || appOutDir.includes("arm64-temp")) {
    console.log(`[compile-merchant-bytecode] Skipping per-arch build (${path.basename(appOutDir)}), will compile on universal pass.`);
    return;
  }

  const merchantDir = path.join(resourcesDir, "extensions-merchant");

  if (!fs.existsSync(merchantDir)) {
    console.log("[compile-merchant-bytecode] extensions-merchant/ not found, skipping.");
    return;
  }

  const electronPath = resolvePackagedElectronPath(context);
  if (!fs.existsSync(electronPath)) {
    throw new Error(
      `[compile-merchant-bytecode] FATAL: Packaged Electron binary not found at ${electronPath}. ` +
      `Cannot compile V8 bytecode without the target runtime's binary.`
    );
  }

  console.log(`[compile-merchant-bytecode] Electron binary: ${electronPath}`);

  // Find all .mjs files under extensions-merchant/*/dist/
  const mjsFiles = [];
  for (const extEntry of fs.readdirSync(merchantDir, { withFileTypes: true })) {
    if (!extEntry.isDirectory()) continue;
    const distDir = path.join(merchantDir, extEntry.name, "dist");
    if (!fs.existsSync(distDir)) continue;
    for (const file of fs.readdirSync(distDir)) {
      if (file.endsWith(".mjs") && !file.endsWith(".d.mts")) {
        mjsFiles.push(path.join(distDir, file));
      }
    }
  }

  if (mjsFiles.length === 0) {
    console.log("[compile-merchant-bytecode] No .mjs files found in extensions-merchant/, skipping.");
    return;
  }

  console.log(`[compile-merchant-bytecode] Compiling ${mjsFiles.length} file(s) to V8 bytecode...`);

  for (const mjsFile of mjsFiles) {
    const basename = path.basename(mjsFile, ".mjs");
    const dir = path.dirname(mjsFile);
    const jscFile = path.join(dir, `${basename}.jsc`);

    console.log(`  ${path.relative(resourcesDir, mjsFile)} -> ${basename}.jsc`);

    // Step 1: Compile the .mjs source to .jsc bytecode using Electron's V8
    compileToBytecodeSingle(electronPath, mjsFile, jscFile);

    // Step 2: Replace the .mjs source with a thin loader wrapper
    const loaderCode = generateLoaderWrapper(`${basename}.jsc`);
    fs.writeFileSync(mjsFile, loaderCode, "utf-8");

    console.log(`  ${basename}.jsc (${fs.statSync(jscFile).size} bytes)`);
  }

  console.log(`[compile-merchant-bytecode] Done — ${mjsFiles.length} file(s) compiled.`);
}

module.exports = { compileMerchantBytecode };
