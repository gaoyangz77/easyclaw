// @ts-check
// Build-time script: creates a tar.gz archive of vendor/openclaw for macOS
// distribution. On macOS (or when ARCHIVE_VENDOR_RUNTIME=1), this replaces the
// 33k+ exploded files with a single archive that is extracted on first launch.
//
// Must run AFTER prune-vendor-deps.cjs (so node_modules is production-only)
// and BEFORE electron-builder (so the archive is available for extraResources).

const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const isMacOS = process.platform === "darwin";
const forceArchive = process.env.ARCHIVE_VENDOR_RUNTIME === "1";

if (!isMacOS && !forceArchive) {
  // Not macOS and not explicitly requested — nothing to do.
  process.exit(0);
}

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const vendorDir = path.resolve(repoRoot, "vendor", "openclaw");
const archivePath = path.join(vendorDir, "vendor-runtime.tar.gz");
const manifestPath = path.join(vendorDir, "vendor-runtime-manifest.json");

if (!fs.existsSync(vendorDir)) {
  console.error("[archive-vendor-runtime] vendor/openclaw not found, aborting.");
  process.exit(1);
}

// ─── Compute version key ───
// SHA256 of (.openclaw-version + sorted patch contents + prune script content),
// truncated to 12 hex chars. This ensures the archive is invalidated when the
// vendor version, patches, or pruning logic changes.

const hash = crypto.createHash("sha256");

// 1. .openclaw-version
const openclawVersionPath = path.join(repoRoot, ".openclaw-version");
const openclawVersion = fs.readFileSync(openclawVersionPath, "utf-8").trim();
hash.update(openclawVersion);

// 2. Sorted patch contents
const patchDir = path.join(repoRoot, "vendor-patches", "openclaw");
if (fs.existsSync(patchDir)) {
  const patches = fs.readdirSync(patchDir)
    .filter((f) => f.endsWith(".patch"))
    .sort();
  for (const p of patches) {
    hash.update(fs.readFileSync(path.join(patchDir, p)));
  }
}

// 3. Prune script content
const pruneScriptPath = path.join(__dirname, "prune-vendor-deps.cjs");
if (fs.existsSync(pruneScriptPath)) {
  hash.update(fs.readFileSync(pruneScriptPath));
}

const version = hash.digest("hex").slice(0, 12);
console.log(`[archive-vendor-runtime] Version key: ${version}`);

// ─── Create tar.gz archive ───
// Archive from WITHIN vendor/openclaw so paths are relative (openclaw.mjs, node_modules/..., etc.)
console.log(`[archive-vendor-runtime] Creating archive at ${archivePath}...`);
const startMs = Date.now();

execSync(
  `tar -czf "${archivePath}" -C "${vendorDir}" --exclude="./vendor-runtime.tar.gz" --exclude="./vendor-runtime-manifest.json" .`,
  { stdio: "inherit", timeout: 300_000 },
);

const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
console.log(`[archive-vendor-runtime] Archive created in ${elapsedSec}s`);

// ─── Validate archive ───
const archiveStats = fs.statSync(archivePath);
const archiveSizeBytes = archiveStats.size;
const archiveSizeMB = (archiveSizeBytes / 1024 / 1024).toFixed(1);

if (archiveSizeBytes < 1024 * 1024) {
  console.error(`[archive-vendor-runtime] FAIL: Archive is only ${archiveSizeBytes} bytes (< 1MB). Something is wrong.`);
  process.exit(1);
}

console.log(`[archive-vendor-runtime] Archive size: ${archiveSizeMB}MB`);

// Verify entry point exists in archive (use grep to avoid buffering the full listing)
try {
  execSync(`tar -tzf "${archivePath}" | grep -q "openclaw\\.mjs"`, {
    timeout: 60_000,
  });
} catch (err) {
  console.error("[archive-vendor-runtime] FAIL: openclaw.mjs not found in archive.");
  process.exit(1);
}

console.log("[archive-vendor-runtime] Archive verification passed (openclaw.mjs found).");

// ─── Write manifest ───
const manifest = {
  version,
  archiveFile: "vendor-runtime.tar.gz",
  openclawVersion,
  archiveSizeBytes,
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
console.log(`[archive-vendor-runtime] Manifest written: ${JSON.stringify(manifest)}`);
