#!/usr/bin/env node
// Smoke test: verify that EasyClaw extension bundles have no unresolvable
// external imports.  In packaged Electron builds, extensions/*/node_modules
// is stripped by electron-builder, so every non-node: import must be either
// a relative path (./…) or bundled inline by tsdown.
//
// Checks the full import chain starting from each extension's gateway entry
// point (openclaw-plugin.mjs or the openclaw.extensions paths in package.json).
//
// Run after `pnpm build` in each extension (or the monorepo-wide build).
// Exit code 0 = clean, 1 = leaked externals found.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXTENSIONS_DIR = join(ROOT, "extensions");

// Regex: top-level static import/export … from "specifier"
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+.*?\s+from\s+["']([^"']+)["']/g;
// Dynamic import()
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function isAllowedSpecifier(spec) {
  if (spec.startsWith("node:")) return true;
  if (spec.startsWith(".")) return true;
  return false;
}

function extractSpecifiers(filePath) {
  const code = readFileSync(filePath, "utf-8");
  const specs = [];
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      specs.push(m[1]);
    }
  }
  return specs;
}

/** Recursively walk the import graph from an entry file, collecting external imports. */
function walkImports(entryPath, extDir) {
  const externals = new Map(); // specifier -> [source files]
  const visited = new Set();

  function visit(filePath) {
    const resolved = resolve(filePath);
    if (visited.has(resolved)) return;
    if (!existsSync(resolved)) return;
    visited.add(resolved);

    for (const spec of extractSpecifiers(resolved)) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        // Follow relative imports within the extension
        let target = resolve(dirname(resolved), spec);
        // Try with .mjs extension if not found
        if (!existsSync(target) && !target.endsWith(".mjs") && !target.endsWith(".js")) {
          if (existsSync(target + ".mjs")) target += ".mjs";
          else if (existsSync(target + ".js")) target += ".js";
        }
        // Only follow files within the extension dir
        if (target.startsWith(extDir) && existsSync(target)) {
          visit(target);
        }
        continue;
      }
      // External import
      const sources = externals.get(spec) ?? [];
      const rel = resolved.slice(extDir.length + 1);
      if (!sources.includes(rel)) sources.push(rel);
      externals.set(spec, sources);
    }
  }

  visit(entryPath);
  return externals;
}

let failed = false;

for (const name of readdirSync(EXTENSIONS_DIR)) {
  const extDir = join(EXTENSIONS_DIR, name);
  if (!statSync(extDir).isDirectory()) continue;

  // Determine entry points: from package.json openclaw.extensions, fallback to openclaw-plugin.mjs
  const entryPoints = [];
  const pkgPath = join(extDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const exts = pkg.openclaw?.extensions;
      if (Array.isArray(exts)) {
        for (const ext of exts) {
          const p = resolve(extDir, ext);
          if (existsSync(p)) entryPoints.push(p);
        }
      }
    } catch { /* ignore */ }
  }
  if (entryPoints.length === 0) {
    const fallback = join(extDir, "openclaw-plugin.mjs");
    if (existsSync(fallback)) entryPoints.push(fallback);
  }
  if (entryPoints.length === 0) continue;

  for (const entry of entryPoints) {
    const externals = walkImports(entry, extDir);
    if (externals.size > 0) {
      const rel = entry.slice(extDir.length + 1);
      const details = [...externals.entries()]
        .map(([spec, sources]) => `  ${spec} (from ${sources.join(", ")})`)
        .join("\n");
      console.error(`FAIL  ${name}/${rel}\n${details}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error(
    "\nExtension bundles must not have external npm imports.\n" +
    "In packaged builds, extensions/*/node_modules is stripped.\n" +
    "Fix: add the dependency to noExternal/inlineOnly in tsdown.config.ts,\n" +
    "or replace the import with a local definition.\n"
  );
  process.exit(1);
} else {
  console.log("OK  All extension bundles have no leaked external imports.");
}
