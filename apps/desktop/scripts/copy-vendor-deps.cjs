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
  // 3. Symlinks — resolve to different absolute paths in each arch build.
  const SKIP_EXTS = new Set([".node", ".dylib"]);
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

  fs.cpSync(vendorSrc, vendorDest, {
    recursive: true,
    filter: (src) => {
      const basename = path.basename(src);
      // Skip ALL .bin directories at any depth
      if (basename === ".bin") {
        skippedCount++;
        return false;
      }
      // Skip symlinks (they resolve differently per-arch build dir)
      try {
        const stat = fs.lstatSync(src);
        if (stat.isSymbolicLink()) {
          skippedCount++;
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
      return true;
    },
  });

  // Count top-level entries to report
  const entries = fs.readdirSync(vendorDest).filter((e) => !e.startsWith("."));
  console.log(`[copy-vendor-deps] Done — ${entries.length} top-level packages copied, ${skippedCount} native binaries skipped.`);
};
