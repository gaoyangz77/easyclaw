// @ts-check
// afterPack hook for electron-builder — copies vendor/openclaw/node_modules
// into the packaged app's extraResources.
//
// electron-builder respects .gitignore files (including the root one that has
// "node_modules/"), which silently blocks node_modules from extraResources copy.
// This hook works around that by copying node_modules manually after packing.

const fs = require("fs");
const path = require("path");

/** Recursively count files in a directory. */
function countFiles(/** @type {string} */ dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

/**
 * @param {import("electron-builder").AfterPackContext} context
 */
exports.default = async function copyVendorDeps(context) {
  const { appOutDir, electronPlatformName } = context;

  // Resolve paths based on platform
  let resourcesDir;
  if (electronPlatformName === "darwin") {
    const productName = context.packager.appInfo.productFilename;
    resourcesDir = path.join(appOutDir, `${productName}.app`, "Contents", "Resources");
  } else {
    // Windows / Linux
    resourcesDir = path.join(appOutDir, "resources");
  }

  const vendorDest = path.join(resourcesDir, "vendor", "openclaw", "node_modules");
  const vendorSrc = path.resolve(__dirname, "..", "..", "..", "vendor", "openclaw", "node_modules");

  if (!fs.existsSync(vendorSrc)) {
    console.log(`[copy-vendor-deps] vendor/openclaw/node_modules not found at ${vendorSrc}, skipping.`);
    return;
  }

  if (fs.existsSync(vendorDest)) {
    console.log("[copy-vendor-deps] vendor/openclaw/node_modules already present, skipping.");
    return;
  }

  // Diagnostic: log vendorSrc state before copying
  const srcEntries = fs.readdirSync(vendorSrc).filter((e) => !e.startsWith("."));
  console.log(`[copy-vendor-deps] Copying vendor node_modules...`);
  console.log(`  from: ${vendorSrc} (${srcEntries.length} top-level entries, ${fs.readdirSync(vendorSrc).length} total entries)`);
  console.log(`  to:   ${vendorDest}`);

  // Load keepSet from bundle-vendor-deps.
  // When the bundle pipeline runs, it writes .bundle-keepset.json listing
  // exactly which packages are needed at runtime. This prevents bloat from
  // packages that reappear between bundling and electron-builder packing.
  //
  // FAIL-FAST: If bundle ran (.bundled marker exists), keepSet MUST exist.
  // A missing or corrupt keepSet after bundling indicates a pipeline bug.
  /** @type {Set<string>} */
  let keepSet;
  /** @type {Set<string>} */
  const keptScopes = new Set();
  const keepSetPath = path.join(vendorSrc, ".bundle-keepset.json");
  const vendorDistDir = path.resolve(vendorSrc, "..", "dist");
  const bundledMarker = path.join(vendorDistDir, ".bundled");
  const bundleRan = fs.existsSync(bundledMarker);

  if (fs.existsSync(keepSetPath)) {
    // Parse strictly — corrupt JSON must fail the build, not silently
    // fall back to a full (bloated) copy.
    const keepList = JSON.parse(fs.readFileSync(keepSetPath, "utf8"));
    keepSet = new Set(keepList);
    for (const pkg of keepSet) {
      if (pkg.startsWith("@")) keptScopes.add(pkg.split("/")[0]);
    }
    console.log(`[copy-vendor-deps] Loaded keepset: ${keepSet.size} packages across ${keptScopes.size} scopes`);
  } else if (bundleRan) {
    // Bundle ran but keepSet is missing — this is a bug, not a fallback scenario.
    throw new Error(
      `[copy-vendor-deps] FATAL: bundle-vendor-deps ran (.bundled marker exists) ` +
      `but .bundle-keepset.json is missing. This would silently copy ALL packages. ` +
      `Investigate why the keepSet file was not written or was deleted.`
    );
  } else {
    // Neither bundle nor keepSet — this is a dev/pack build without prune+bundle.
    // Allow full copy but warn.
    keepSet = new Set();
    console.log("[copy-vendor-deps] No keepset and no bundle marker — full copy mode (dev/pack build).");
  }

  // Skip files that break macOS universal (arm64+x64) merge:
  // 1. Most native binaries (.node, .dylib) — architecture-specific and cause
  //    lipo merge conflicts in universal builds.
  //    EXCEPTION: sharp's .node binary is required at runtime for image
  //    processing (resizing, metadata). The gateway subprocess uses sharp to
  //    sanitize images before sending them to the AI model. Without it, all
  //    inbound images are silently dropped. For universal builds, sharp's
  //    .node is architecture-specific but is listed in x64ArchFiles in the
  //    electron-builder config so the merge tool handles it correctly.
  // 2. ALL .bin/ directories (top-level and nested) — contain symlinks with
  //    relative targets that resolve differently in x64 vs arm64 temp dirs,
  //    causing the universal merge tool to see them as unique files.
  //    Not needed at runtime (just CLI convenience links).
  // 3. Absolute symlinks — resolve to different absolute paths in each arch
  //    build. Relative symlinks (pnpm's .pnpm/ links) are safe and must be
  //    preserved so Node.js can resolve vendor runtime dependencies.
  // 4. Build-only packages (esbuild, rolldown, etc.) — contain arch-specific
  //    Mach-O binaries with no file extension, causing universal merge errors.
  //    These are bundler/compiler tools not needed at runtime.
  const SKIP_EXTS = new Set([".node", ".dylib"]);
  // Files not needed at runtime — skipping these cuts file count by ~34K
  // and saves ~170MB, significantly reducing NSIS install time on Windows.
  const SKIP_RUNTIME_EXTS = new Set([
    ".map",                          // source maps (14K files, ~93MB)
    ".md", ".mdx",                   // documentation (2.7K files)
    ".c", ".h", ".cc", ".cpp",       // native module build sources
    ".gyp", ".gypi",                 // node-gyp build files
  ]);
  // TypeScript declarations (.d.ts, .d.mts, .d.cts) — 17K+ files, ~76MB
  const DTS_RE = /\.d\.[mc]?ts$/;
  const SKIP_PACKAGE_PATTERNS = [
    /[\\/]\.pnpm[\\/](@esbuild|esbuild|@rolldown|rolldown)[+@]/,
  ];
  // Native binaries that ARE required at runtime and must not be skipped.
  // sharp is needed by the gateway for image sanitization (resize/metadata).
  // This includes both the .node addon (@img/sharp-darwin-*) and the libvips
  // shared library (@img/sharp-libvips-darwin-*) it links against.
  // koffi is a C FFI module used by pi-tui (transitive dep of the gateway CLI).
  const ALLOWED_NATIVE_PATTERNS = [
    /[\\/]@img[\\/]sharp-/,
    /[\\/]koffi[\\/]/,
  ];
  let skippedCount = 0;

  // Collect relative symlinks encountered during cpSync so we can recreate
  // them in the destination after the copy. cpSync's filter runs before the
  // copy, so we cannot create the symlink inside the filter callback (the
  // parent directory may not exist yet). Instead we record { dest, target }
  // pairs and replay them in a second pass.
  /** @type {Array<{dest: string, target: string}>} */
  const deferredSymlinks = [];

  fs.cpSync(vendorSrc, vendorDest, {
    recursive: true,
    filter: (src) => {
      // If keepSet is non-empty, restrict to only those packages.
      // This is the primary gate — prevents copying packages that were
      // removed by bundle-vendor-deps BFS but reappeared in vendorSrc.
      if (keepSet.size > 0) {
        const rel = path.relative(vendorSrc, src);
        if (rel !== "") {
          const parts = rel.split(path.sep);
          if (parts[0].startsWith(".")) {
            // Skip .pnpm entirely — with hoisted mode, packages are real
            // directories, not symlinks into .pnpm.
            // Other dotfiles (.bin) are handled by existing checks below.
            if (parts[0] === ".pnpm") {
              skippedCount++;
              return false;
            }
          } else if (parts[0].startsWith("@")) {
            if (parts.length === 1) {
              // @scope dir: allow only if keepSet has entries in this scope
              if (!keptScopes.has(parts[0])) {
                skippedCount++;
                return false;
              }
            } else {
              // @scope/name or deeper: check the full package name
              const pkgName = parts[0] + "/" + parts[1];
              if (!keepSet.has(pkgName)) {
                skippedCount++;
                return false;
              }
            }
          } else {
            // Unscoped package: check directly
            if (!keepSet.has(parts[0])) {
              skippedCount++;
              return false;
            }
          }
        }
      }

      const basename = path.basename(src);
      // Skip ALL .bin directories at any depth
      if (basename === ".bin") {
        skippedCount++;
        return false;
      }
      // Skip build-only packages (esbuild, rolldown) — not needed at runtime
      if (SKIP_PACKAGE_PATTERNS.some((re) => re.test(src))) {
        skippedCount++;
        return false;
      }
      // Handle symlinks: preserve relative ones (pnpm), skip absolute ones
      try {
        const stat = fs.lstatSync(src);
        if (stat.isSymbolicLink()) {
          const target = fs.readlinkSync(src);
          if (path.isAbsolute(target)) {
            // Absolute symlink — breaks across build dirs, skip
            skippedCount++;
            return false;
          }
          // Relative symlink (pnpm node_modules → .pnpm/) — defer recreation
          const rel = path.relative(vendorSrc, src);
          deferredSymlinks.push({ dest: path.join(vendorDest, rel), target });
          // Return false so cpSync doesn't try to copy (it can't copy symlinks
          // correctly across dirs). We'll recreate them after the copy.
          return false;
        }
      } catch {
        // If we can't stat, skip it
        skippedCount++;
        return false;
      }
      const ext = path.extname(src);
      if (SKIP_EXTS.has(ext)) {
        // Allow whitelisted native modules (e.g. sharp)
        if (ALLOWED_NATIVE_PATTERNS.some((re) => re.test(src))) {
          return true;
        }
        skippedCount++;
        return false;
      }
      // Skip files not needed at runtime (type declarations, source maps, docs, build sources)
      if (SKIP_RUNTIME_EXTS.has(ext) || DTS_RE.test(basename)) {
        skippedCount++;
        return false;
      }
      return true;
    },
  });

  // Second pass: recreate relative symlinks (pnpm's node_modules structure)
  let symlinkCount = 0;
  for (const { dest, target } of deferredSymlinks) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.symlinkSync(target, dest);
      symlinkCount++;
    } catch (err) {
      // Symlink target may have been pruned (e.g. esbuild) — not critical
      console.log(`[copy-vendor-deps] Warning: failed to create symlink ${path.relative(vendorDest, dest)} -> ${target}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Count top-level entries to report
  const entries = fs.readdirSync(vendorDest).filter((e) => !e.startsWith("."));
  const keepInfo = keepSet.size > 0 ? ` (keepset: ${keepSet.size} packages)` : " (no keepset, full copy)";
  console.log(`[copy-vendor-deps] Done — ${entries.length} top-level packages copied${keepInfo}, ${symlinkCount} symlinks recreated, ${skippedCount} entries skipped.`);

  // Post-copy verification: ensure every keepSet package exists in destination.
  // A missing package means it was absent from vendorSrc (deleted between
  // bundle and pack) and would cause a runtime "Cannot find module" error.
  if (keepSet.size > 0) {
    const missing = [];
    for (const pkg of keepSet) {
      const destPkg = path.join(vendorDest, ...pkg.split("/"));
      if (!fs.existsSync(destPkg)) {
        missing.push(pkg);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `[copy-vendor-deps] FATAL: ${missing.length} keepset package(s) missing from destination:\n` +
        `  ${missing.join(", ")}\n` +
        `These packages were expected by BFS but not found in vendor/openclaw/node_modules.\n` +
        `This would cause runtime "Cannot find module" errors.`
      );
    }
    console.log(`[copy-vendor-deps] Verified: all ${keepSet.size} keepset packages present in destination.`);
  }

  // ── Clean up .ts source files from pre-bundled extensions ──
  // When bundle-vendor-deps runs, Phase 0.5b writes CJS bundles to
  // .prebundled-extensions/ which electron-builder overlays on top of the
  // vendor extensions/ copy.  The result: each extension dir has BOTH
  // index.ts (from vendor) and index.js (from overlay).
  //
  // OpenClaw's plugin discovery searches ["index.ts", "index.js", ...] and
  // picks the FIRST match.  If index.ts is still present, the gateway loads
  // it through jiti/babel → 30 s startup delay.  Delete .ts source files
  // from extension dirs that have a bundled index.js to force the fast path.
  //
  // This only runs when the bundle pipeline ran (bundleRan === true).
  // Pack-only builds (no bundle) keep the .ts files so jiti can load them.
  const extensionsDest = path.join(resourcesDir, "vendor", "openclaw", "extensions");
  if (bundleRan && fs.existsSync(extensionsDest)) {
    let cleanedExts = 0;
    let cleanedFiles = 0;

    for (const ext of fs.readdirSync(extensionsDest, { withFileTypes: true })) {
      if (!ext.isDirectory()) continue;
      const extDir = path.join(extensionsDest, ext.name);
      const hasBundle = fs.existsSync(path.join(extDir, "index.js"));
      if (!hasBundle) continue;

      // Remove .ts source files (not .d.ts) and src/ directory
      cleanedExts++;
      const indexTs = path.join(extDir, "index.ts");
      if (fs.existsSync(indexTs)) {
        fs.unlinkSync(indexTs);
        cleanedFiles++;
      }
      const srcDir = path.join(extDir, "src");
      if (fs.existsSync(srcDir)) {
        const count = countFiles(srcDir);
        fs.rmSync(srcDir, { recursive: true, force: true });
        cleanedFiles += count;
      }

      // Fix package.json: ./index.ts → ./index.js + remove "type": "module"
      // The .prebundled-extensions overlay should have already written a fixed
      // package.json, but if the overlay didn't apply (e.g. electron-builder
      // race or platform quirk), the original package.json still references
      // ./index.ts which we just deleted → "escapes package directory" error.
      // Also remove "type": "module" so the CJS bundle isn't misidentified.
      const pkgPath = path.join(extDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          let changed = false;
          const raw = JSON.stringify(pkgJson);
          if (raw.includes("./index.ts")) {
            Object.assign(pkgJson, JSON.parse(raw.replace(/\.\/index\.ts/g, "./index.js")));
            changed = true;
          }
          if (pkgJson.type === "module") {
            delete pkgJson.type;
            changed = true;
          }
          if (changed) {
            fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
            cleanedFiles++;
          }
        } catch {
          // Corrupt package.json — skip silently, the bundle should work without it
        }
      }
    }

    if (cleanedExts > 0) {
      console.log(`[copy-vendor-deps] Cleaned .ts source files from ${cleanedExts} pre-bundled extensions (${cleanedFiles} files removed).`);
    }
  }
};
