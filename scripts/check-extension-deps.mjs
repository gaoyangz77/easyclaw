#!/usr/bin/env node
/**
 * Verify that all extensions are listed in apps/desktop devDependencies.
 *
 * Extensions are loaded at runtime by OpenClaw via filesystem discovery,
 * but they must be in desktop's devDependencies so Turbo builds them
 * before desktop during `dev` and `build`.
 *
 * Run: node scripts/check-extension-deps.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = join(root, "extensions");
const desktopPkg = JSON.parse(readFileSync(join(root, "apps", "desktop", "package.json"), "utf8"));
const desktopDevDeps = desktopPkg.devDependencies || {};

const missing = [];
let total = 0;

for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgPath = join(extensionsDir, entry.name, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.name || !pkg.scripts?.build) continue;
  total++;
  if (!(pkg.name in desktopDevDeps)) {
    missing.push(pkg.name);
  }
}

if (missing.length > 0) {
  console.error("ERROR: The following extensions are missing from apps/desktop/package.json devDependencies:");
  for (const name of missing) {
    console.error(`  - ${name}`);
  }
  console.error("\nAdd them with: pnpm --filter @rivonclaw/desktop add -D " + missing.join(" "));
  process.exit(1);
}

console.log(`OK: All ${total} extensions are in desktop devDependencies.`);
