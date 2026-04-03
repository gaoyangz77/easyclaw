#!/usr/bin/env node
// Smoke test: verify that RivonClaw extension entry graphs do not contain
// unbundled external npm imports. In packaged Electron builds,
// extensions/*/node_modules is stripped, so every non-node import reachable
// from an extension entrypoint must be either relative or bundled inline.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve, dirname, extname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { isAllowlistedVendorRuntimeSpecifier } = require("./vendor-runtime-packages.cjs");
const EXTENSION_ROOTS = [
  {
    label: "workspace",
    dir: join(ROOT, "extensions"),
    mode: "strict",
  },
  {
    label: "vendor",
    dir: join(ROOT, "vendor", "openclaw", "extensions"),
    mode: "vendor-runtime",
  },
];

const SPECIFIER_PATTERNS = {
  staticImport: /(?:^|\n)\s*(?:import|export)\s+.*?\s+from\s+["']([^"']+)["']/g,
  dynamicImport: /import\(\s*["']([^"']+)["']\s*\)/g,
  requireCall: /(?:^|[^\w$.])require\(\s*["']([^"']+)["']\s*\)/g,
  requireResolve: /require\.resolve\(\s*["']([^"']+)["']\s*\)/g,
  createRequireCall: /createRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g,
  moduleCreateRequireCall: /module\.createRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g,
};

// Optional dynamic imports in the upstream @tencent-weixin/openclaw-weixin plugin.
// These have try/catch fallbacks and are not required at runtime.
const CHANNEL_WEIXIN_OPTIONAL_EXTERNALS = new Set(["qrcode-terminal", "silk-wasm"]);

function isAllowedWorkspaceSpecifier(spec) {
  return spec === "openclaw/plugin-sdk" || spec.startsWith("openclaw/plugin-sdk/")
    || CHANNEL_WEIXIN_OPTIONAL_EXTERNALS.has(spec);
}

function isAllowedSpecifier(spec) {
  return spec.startsWith("node:") || spec.startsWith(".");
}

function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCreateRequireAliases(code) {
  const aliases = new Set();
  const aliasRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:createRequire|module\.createRequire)\(/g;
  let match;
  while ((match = aliasRe.exec(code)) !== null) {
    aliases.add(match[1]);
  }
  return [...aliases];
}

function extractSpecifiers(filePath, mode) {
  const code = readFileSync(filePath, "utf-8");
  const records = [];
  const activeKinds = mode === "vendor-runtime"
    ? ["requireCall", "requireResolve", "createRequireCall", "moduleCreateRequireCall"]
    : ["staticImport", "dynamicImport"];

  for (const kind of activeKinds) {
    const re = SPECIFIER_PATTERNS[kind];
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(code)) !== null) {
      records.push({ kind, spec: match[1] });
    }
  }

  if (mode === "vendor-runtime") {
    for (const alias of extractCreateRequireAliases(code)) {
      const aliasCallRe = new RegExp(`(?:^|[^\\w$.])${escapeRegex(alias)}\\(\\s*["']([^"']+)["']\\s*\\)`, "g");
      const aliasResolveRe = new RegExp(`${escapeRegex(alias)}\\.resolve\\(\\s*["']([^"']+)["']\\s*\\)`, "g");
      for (const [kind, re] of [
        ["createRequireAliasCall", aliasCallRe],
        ["createRequireAliasResolve", aliasResolveRe],
      ]) {
        let match;
        while ((match = re.exec(code)) !== null) {
          records.push({ kind, spec: match[1] });
        }
      }
    }
  }

  return records;
}

function resolveRelativeTarget(sourceFile, spec) {
  const base = resolve(dirname(sourceFile), spec);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.cjs`,
    join(base, "index.mjs"),
    join(base, "index.js"),
    join(base, "index.ts"),
    join(base, "index.mts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function collectEntryPoints(extDir) {
  const entryPoints = [];
  const pkgPath = join(extDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const exts = pkg.openclaw?.extensions;
      if (Array.isArray(exts)) {
        for (const ext of exts) {
          const entry = resolve(extDir, ext);
          if (existsSync(entry)) entryPoints.push(entry);
        }
      }
    } catch {}
  }

  for (const fallback of ["openclaw-plugin.mjs", "index.ts", "index.mjs", "index.js"]) {
    const entry = join(extDir, fallback);
    if (existsSync(entry)) entryPoints.push(entry);
  }

  return [...new Set(entryPoints)];
}

/** Recursively walk the import graph from an entry file, collecting external imports. */
function walkImports(entryPath, extDir, mode) {
  const externals = new Map();
  const visited = new Set();

  function visit(filePath) {
    const resolved = resolve(filePath);
    if (visited.has(resolved) || !existsSync(resolved)) return;
    if (!statSync(resolved).isFile()) return;
    visited.add(resolved);

    // Ignore type declaration files in case an entry root references them.
    if (/\.d\.[mc]?ts$/.test(resolved)) return;

    for (const { kind, spec } of extractSpecifiers(resolved, mode)) {
      if (isAllowedSpecifier(spec)) {
        if (spec.startsWith(".")) {
          const target = resolveRelativeTarget(resolved, spec);
          if (target && target.startsWith(extDir)) visit(target);
        }
        continue;
      }

      if (mode === "vendor-runtime" && isAllowlistedVendorRuntimeSpecifier(spec)) {
        continue;
      }

      if (mode === "strict" && isAllowedWorkspaceSpecifier(spec)) {
        continue;
      }

      const key = mode === "vendor-runtime" ? `${kind}:${spec}` : spec;
      const sources = externals.get(key) ?? [];
      const rel = resolved.slice(extDir.length + 1);
      const label = mode === "vendor-runtime" ? `${rel} via ${kind}` : rel;
      if (!sources.includes(label)) sources.push(label);
      externals.set(key, sources);
    }
  }

  visit(entryPath);
  return externals;
}

let failed = false;

for (const { label, dir: rootDir, mode } of EXTENSION_ROOTS) {
  if (!existsSync(rootDir)) continue;

  for (const name of readdirSync(rootDir)) {
    const extDir = join(rootDir, name);
    if (!statSync(extDir).isDirectory()) continue;

    const entryPoints = collectEntryPoints(extDir);
    if (entryPoints.length === 0) continue;

    for (const entry of entryPoints) {
      // Only scan source-like entry files; dist bundle files are checked elsewhere.
      const ext = extname(entry);
      if (![".ts", ".mts", ".js", ".mjs", ".cjs"].includes(ext)) continue;

      const externals = walkImports(entry, extDir, mode);
      if (externals.size > 0) {
        const rel = entry.slice(extDir.length + 1);
        const details = [...externals.entries()]
          .map(([spec, sources]) => `  ${spec} (from ${sources.join(", ")})`)
          .join("\n");
        console.error(`FAIL  ${label}:${name}/${rel}\n${details}`);
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error(
    "\nWorkspace extensions must not leak npm imports from their packaged entry graphs.\n" +
    "Vendor extensions may use runtime loaders only for packages in the shared\n" +
    "vendor runtime allowlist. Add genuinely required packages to the shared\n" +
    "allowlist before bundling/pruning can strip them out.\n"
  );
  process.exit(1);
}

console.log("OK  All extension entry graphs have no leaked external imports.");
console.log("");

// Verify lockfile is up to date. Use `--lockfile-only` (resolves deps without
// downloading/linking) which is ~100x faster than a full `pnpm install`.
try {
  execSync("pnpm install --frozen-lockfile --lockfile-only", {
    cwd: ROOT,
    stdio: "pipe",
  });
  console.log("OK  pnpm-lock.yaml is up to date.");
} catch (err) {
  const stderr = err.stderr?.toString() ?? "";
  const match = stderr.match(/ERR_PNPM_OUTDATED_LOCKFILE.*?\n([\s\S]*?)(?:\n\n|$)/);
  console.error("FAIL  pnpm-lock.yaml is out of date with package.json");
  if (match) {
    console.error(match[0].trim());
  }
  console.error("\nFix: run `pnpm install` and commit the updated pnpm-lock.yaml.\n");
  process.exit(1);
}
