// @ts-check
// afterPack hook for electron-builder — copies vendor/openclaw/node_modules
// into the packaged app's extraResources.
//
// electron-builder respects .gitignore files (including the root one that has
// "node_modules/"), which silently blocks node_modules from extraResources copy.
// This hook works around that by copying node_modules manually after packing.

const fs = require("fs");
const path = require("path");

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

  console.log(`[copy-vendor-deps] Copying vendor node_modules...`);
  console.log(`  from: ${vendorSrc}`);
  console.log(`  to:   ${vendorDest}`);

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
  console.log(`[copy-vendor-deps] Done — ${entries.length} top-level packages copied, ${symlinkCount} symlinks recreated, ${skippedCount} native binaries skipped.`);
};
