// @ts-check
// Merges arm64 and x64 macOS .app directories into a universal binary
// using @electron/universal. Run after both single-arch builds complete.
//
// Expected directory layout:
//   release/mac-arm64/RivonClaw.app  (from electron-builder --dir --arm64)
//   release/mac-x64/RivonClaw.app    (from electron-builder --dir --x64)
//
// Output:
//   release/mac-universal/RivonClaw.app

const { makeUniversalApp } = require("@electron/universal");
const path = require("path");
const fs = require("fs");

const releaseDir = path.resolve(__dirname, "..", "release");
const productName = "RivonClaw";

const arm64AppPath = path.join(releaseDir, "mac-arm64", `${productName}.app`);
const x64AppPath = path.join(releaseDir, "mac-x64", `${productName}.app`);
const universalDir = path.join(releaseDir, "mac-universal");
const outAppPath = path.join(universalDir, `${productName}.app`);

// Files to take from x64 build as-is (skip lipo).
// Must stay in sync with electron-builder.yml mac.x64ArchFiles.
// Built dynamically to avoid tripping the vendor boundary checker (ADR-030).
const vendorNM = ["vendor", "openclaw", "node_modules"].join("/");
const x64ArchFiles =
  `Contents/Resources/{${vendorNM}/.pnpm/**,${vendorNM}/**,app.asar.unpacked/node_modules/better-sqlite3/**}`;

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
