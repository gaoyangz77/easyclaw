#!/usr/bin/env node

/**
 * Vendor Boundary Guard (ADR-030)
 *
 * Ensures application code in apps/, packages/, and extensions/ does not
 * directly import from vendor/openclaw/src/ or vendor/openclaw/node_modules/.
 *
 * Two tiers of permitted vendor access (defined in vendor-boundary-allowlist.json):
 *
 *   sentinels  — permanent drift-detection tests that intentionally read vendor
 *                source to verify RivonClaw assumptions. Not runtime imports.
 *
 *   allowlist  — temporary migration exceptions. Should be empty when the
 *                Phase 2 migration is complete.
 *
 * Exit 0 = all violations are accounted for (PASS)
 * Exit 1 = new violations found (FAIL)
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const SCAN_DIRS = ["apps", "packages", "extensions"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "release", ".git"]);

// Patterns that indicate a vendor boundary crossing.
const VENDOR_IMPORT_RE =
  /(?:from\s+["']|require\s*\(\s*["']|import\s*\(\s*["']|resolve\s*\([^)]*["']|["'])[^"']*vendor\/openclaw\/(?:src|node_modules)\/[^"']*/g;

function extractVendorPath(match) {
  const m = match.match(/vendor\/openclaw\/(?:src|node_modules)\/[^"']*/);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// Load allowlist + sentinels
// ---------------------------------------------------------------------------

const configPath = join(ROOT, "scripts", "vendor-boundary-allowlist.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch {
  console.error(`Could not read config at ${configPath}`);
  process.exit(1);
}

const sentinelEntries = config.sentinels || [];
const allowlistEntries = config.allowlist || [];

// Build lookup sets: "file|vendorPath"
const sentinelSet = new Set(sentinelEntries.map((e) => `${e.file}|${e.vendorPath}`));
const allowlistSet = new Set(allowlistEntries.map((e) => `${e.file}|${e.vendorPath}`));

const sentinelReasons = new Map(sentinelEntries.map((e) => [`${e.file}|${e.vendorPath}`, e.reason]));
const allowlistReasons = new Map(allowlistEntries.map((e) => [`${e.file}|${e.vendorPath}`, e.reason]));

// ---------------------------------------------------------------------------
// Walk directories
// ---------------------------------------------------------------------------

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (SOURCE_EXTENSIONS.has(extOf(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const violations = [];

for (const dir of SCAN_DIRS) {
  const absDir = join(ROOT, dir);
  let files;
  try {
    files = walk(absDir);
  } catch {
    continue;
  }

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      let match;
      VENDOR_IMPORT_RE.lastIndex = 0;
      while ((match = VENDOR_IMPORT_RE.exec(lineText)) !== null) {
        const vp = extractVendorPath(match[0]);
        if (vp) {
          violations.push({
            file: relative(ROOT, filePath),
            line: i + 1,
            vendorPath: vp,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Classify
// ---------------------------------------------------------------------------

const matched = { sentinels: [], allowlisted: [], newViolations: [] };

for (const v of violations) {
  const key = `${v.file}|${v.vendorPath}`;
  if (sentinelSet.has(key)) {
    matched.sentinels.push({ ...v, reason: sentinelReasons.get(key) });
  } else if (allowlistSet.has(key)) {
    matched.allowlisted.push({ ...v, reason: allowlistReasons.get(key) });
  } else {
    matched.newViolations.push(v);
  }
}

// Deduplicate for display
function dedup(arr) {
  const seen = new Set();
  return arr.filter((v) => {
    const key = `${v.file}|${v.vendorPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const uniqueSentinels = dedup(matched.sentinels);
const uniqueAllowlisted = dedup(matched.allowlisted);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("");
console.log("\uD83D\uDD0D Vendor boundary check (ADR-030)");
console.log("");

if (uniqueSentinels.length > 0) {
  console.log(
    `\uD83D\uDEE1\uFE0F  Sentinel tests (${uniqueSentinels.length} permanent drift guard${uniqueSentinels.length === 1 ? "" : "s"}):`,
  );
  for (const v of uniqueSentinels) {
    console.log(`  ${v.file} \u2192 ${v.vendorPath}`);
    console.log(`    ${v.reason}`);
  }
  console.log("");
}

if (uniqueAllowlisted.length > 0) {
  console.log(
    `\u26A0\uFE0F  Temporary exceptions (${uniqueAllowlisted.length} — should be migrated):`,
  );
  for (const v of uniqueAllowlisted) {
    console.log(`  ${v.file} \u2192 ${v.vendorPath}`);
    console.log(`    Reason: ${v.reason}`);
  }
  console.log("");
}

if (matched.newViolations.length > 0) {
  console.log(
    `\u274C NEW vendor boundary violations (${matched.newViolations.length}):`,
  );
  for (const v of matched.newViolations) {
    console.log(`  ${v.file}:${v.line} \u2192 ${v.vendorPath}`);
  }
  console.log("");
  console.log(
    `Result: FAIL \u2014 ${matched.newViolations.length} new violation${matched.newViolations.length === 1 ? "" : "s"} found (see ADR-030)`,
  );
  process.exit(1);
} else {
  const parts = [];
  if (uniqueSentinels.length > 0) parts.push(`${uniqueSentinels.length} sentinel${uniqueSentinels.length === 1 ? "" : "s"}`);
  if (uniqueAllowlisted.length > 0) parts.push(`${uniqueAllowlisted.length} temporary exception${uniqueAllowlisted.length === 1 ? "" : "s"}`);
  const suffix = parts.length > 0 ? `, ${parts.join(", ")}` : "";
  console.log(`Result: PASS (0 new violations${suffix})`);
}
