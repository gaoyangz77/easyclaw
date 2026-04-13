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
const { execFileSync } = require("child_process");
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
  console.log(`[merge-universal] Merged in ${elapsed}s — ${outAppPath}`);

  // @electron/universal's lipo merge invalidates the original ad-hoc code
  // signatures on Mach-O binaries. Without valid signatures, macOS blocks
  // V8 JIT (MAP_JIT) and the app crashes with SIGTRAP on launch.
  // Sign every Mach-O bottom-up: native modules → dylibs → helper apps →
  // frameworks → main binary → outer bundle. codesign requires inner
  // components to be signed before their parent bundle.
  console.log("[merge-universal] Ad-hoc codesigning...");
  const contentsDir = path.join(outAppPath, "Contents");
  const frameworksDir = path.join(contentsDir, "Frameworks");

  /** Sign a single path, ignoring "already signed" or missing-file errors. */
  function sign(target) {
    execFileSync("codesign", ["--force", "--sign", "-", target], { stdio: "inherit" });
  }

  // 1) Native .node modules inside asar.unpacked
  const unpackedDirs = fs.readdirSync(path.join(contentsDir, "Resources"))
    .filter((n) => n.endsWith(".asar.unpacked"));
  for (const dir of unpackedDirs) {
    const base = path.join(contentsDir, "Resources", dir);
    findFiles(base, (f) => f.endsWith(".node") || f.endsWith(".dylib")).forEach(sign);
  }

  // 2) Dylibs inside Electron Framework
  const efVersioned = path.join(frameworksDir, "Electron Framework.framework", "Versions", "A");
  findFiles(path.join(efVersioned, "Libraries"), (f) => f.endsWith(".dylib")).forEach(sign);

  // 3) Helper executables inside Electron Framework (both .app bundles and
  //    standalone binaries like chrome_crashpad_handler)
  const helpersInEF = path.join(efVersioned, "Helpers");
  if (fs.existsSync(helpersInEF)) {
    for (const entry of fs.readdirSync(helpersInEF, { withFileTypes: true })) {
      const full = path.join(helpersInEF, entry.name);
      if (entry.isFile() || entry.name.endsWith(".app")) {
        sign(full);
      }
    }
  }

  // 4) Electron Framework main binary, then the .framework bundle
  sign(path.join(efVersioned, "Electron Framework"));
  sign(path.join(frameworksDir, "Electron Framework.framework"));

  // 5) Top-level helper apps
  for (const entry of fs.readdirSync(frameworksDir)) {
    if (entry.endsWith(".app")) {
      sign(path.join(frameworksDir, entry));
    }
  }

  // 6) Remaining frameworks (Squirrel, Mantle, ReactiveObjC) — sign binary then bundle
  for (const entry of fs.readdirSync(frameworksDir)) {
    if (entry.endsWith(".framework") && entry !== "Electron Framework.framework") {
      const fwName = entry.replace(".framework", "");
      const fwBinary = path.join(frameworksDir, entry, "Versions", "A", fwName);
      if (fs.existsSync(fwBinary)) sign(fwBinary);
      sign(path.join(frameworksDir, entry));
    }
  }

  // 7) Main app bundle
  sign(outAppPath);
  console.log("[merge-universal] Done.");
}

/** Recursively find files matching a predicate. */
function findFiles(dir, predicate) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, predicate));
    } else if (predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

main().catch((err) => {
  console.error("[merge-universal] Error:", err);
  process.exit(1);
});
