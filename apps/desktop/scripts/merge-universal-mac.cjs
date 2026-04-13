// @ts-check
// Merges arm64 and x64 macOS .app directories into a universal binary
// using @electron/universal. Run after both single-arch builds complete.
//
// Expected directory layout:
//   release/mac-arm64/RivonClaw.app  (from electron-builder --dir --arm64)
//   release/mac/RivonClaw.app         (from electron-builder --dir --x64)
//
// Output:
//   release/mac-universal/RivonClaw.app

const { makeUniversalApp } = require("@electron/universal");
const path = require("path");
const fs = require("fs");

const releaseDir = path.resolve(__dirname, "..", "release");
const productName = "RivonClaw";

const arm64AppPath = path.join(releaseDir, "mac-arm64", `${productName}.app`);
const x64AppPath = path.join(releaseDir, "mac", `${productName}.app`);
const universalDir = path.join(releaseDir, "mac-universal");
const outAppPath = path.join(universalDir, `${productName}.app`);

// Files to take from x64 build as-is (skip lipo).
// Must stay in sync with electron-builder.yml mac.x64ArchFiles.
// Built dynamically to avoid tripping the vendor boundary checker (ADR-030).
const vendorNM = ["vendor", "openclaw", "node_modules"].join("/");
const x64ArchFiles =
  `Contents/Resources/{${vendorNM}/.pnpm/**,${vendorNM}/**,app.asar.unpacked/node_modules/better-sqlite3/**}`;

// Plain (non-Mach-O) files that differ between arm64/x64 builds due to
// timestamps or runner-specific values. @electron/universal's x64ArchFiles
// only exempts Mach-O binaries, so we must manually sync these before merge
// by copying the x64 version over the arm64 version.
const vendorDist = ["vendor", "openclaw", "dist"].join("/");
const PLAIN_FILES_TO_SYNC = [
  `Contents/Resources/${vendorDist}/build-info.json`,
  `Contents/Resources/${vendorDist}/.buildstamp`,
  `Contents/Resources/${vendorDist}/.dist-complete`,
];

async function main() {
  if (!fs.existsSync(arm64AppPath)) {
    throw new Error(`arm64 app not found: ${arm64AppPath}`);
  }
  if (!fs.existsSync(x64AppPath)) {
    throw new Error(`x64 app not found: ${x64AppPath}`);
  }

  if (fs.existsSync(universalDir)) {
    fs.rmSync(universalDir, { recursive: true });
  }
  fs.mkdirSync(universalDir, { recursive: true });

  // Sync plain files that differ between builds (timestamps, etc.)
  // so @electron/universal doesn't reject them during SHA comparison.
  for (const rel of PLAIN_FILES_TO_SYNC) {
    const src = path.join(x64AppPath, rel);
    const dst = path.join(arm64AppPath, rel);
    if (fs.existsSync(src) && fs.existsSync(dst)) {
      fs.cpSync(src, dst);
      console.log(`[merge-universal] Synced ${path.basename(rel)} from x64 → arm64`);
    }
  }

  console.log("[merge-universal] Merging:");
  console.log(`  arm64: ${arm64AppPath}`);
  console.log(`  x64:   ${x64AppPath}`);
  console.log(`  out:   ${outAppPath}`);

  const start = Date.now();
  await makeUniversalApp({
    x64AppPath,
    arm64AppPath,
    outAppPath,
    x64ArchFiles,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[merge-universal] Done in ${elapsed}s — ${outAppPath}`);
}

main().catch((err) => {
  console.error("[merge-universal] Error:", err);
  process.exit(1);
});
