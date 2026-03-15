// @ts-check
// Pre-dist assertion: verifies that critical workspace build products exist
// before electron-builder begins packaging. Prevents silently producing
// broken installers when `pnpm build` was not run first.

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const artifacts = [
  {
    rel: "packages/gateway/dist/index.mjs",
    label: "gateway launcher",
  },
  {
    rel: "packages/gateway/dist/startup-timer.cjs",
    label: "startup profiler preload",
  },
  {
    rel: "apps/desktop/dist/main.cjs",
    label: "electron main process",
  },
];

const missing = [];

for (const { rel, label } of artifacts) {
  const abs = path.resolve(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    missing.push({ rel, label });
  }
}

if (missing.length > 0) {
  console.error("\n✗ Missing build artifacts — cannot package:\n");
  for (const { rel, label } of missing) {
    console.error(`  • ${rel}  (${label})`);
  }
  console.error("\nRun 'pnpm build' from the repo root, then retry.\n");
  process.exit(1);
}

console.log("✓ All build artifacts present.");
