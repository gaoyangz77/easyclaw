#!/usr/bin/env node
/**
 * Audit provider/model sync between EasyClaw and vendor (OpenClaw + pi-ai).
 *
 * Compares three sources:
 *   A) pi-ai vendor catalog provider keys (models.generated.js)
 *   B) OpenClaw resolveImplicitProviders provider keys (regex-parsed)
 *   C) EasyClaw ALL_PROVIDERS + extraModels status (compiled core)
 *
 * Reports:
 *   1) Critical: in ALL_PROVIDERS, no extraModels, NOT in pi-ai → invisible
 *   2) New upstream: in pi-ai or OpenClaw but NOT in ALL_PROVIDERS
 *   3) OK: in ALL_PROVIDERS, no extraModels, covered by pi-ai
 *
 * Usage:
 *   node scripts/audit-provider-sync.mjs
 *
 * Exit codes:
 *   0 - No critical gaps
 *   1 - Critical gaps found (providers invisible in UI)
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Source A: pi-ai vendor catalog provider keys
// ---------------------------------------------------------------------------
async function getPiAiProviders() {
  const piAiPath = join(
    rootDir,
    "vendor/openclaw/node_modules/@mariozechner/pi-ai/dist/models.generated.js",
  );
  if (!existsSync(piAiPath)) {
    console.warn("  [warn] pi-ai models.generated.js not found — skipping vendor catalog");
    return new Set();
  }
  const mod = await import(pathToFileURL(piAiPath).href);
  return new Set(Object.keys(mod.MODELS ?? {}));
}

// ---------------------------------------------------------------------------
// Source B: OpenClaw resolveImplicitProviders provider keys (regex-parsed)
// ---------------------------------------------------------------------------
function getOpenClawImplicitProviders() {
  const filePath = join(
    rootDir,
    "vendor/openclaw/src/agents/models-config.providers.ts",
  );
  if (!existsSync(filePath)) {
    console.warn("  [warn] models-config.providers.ts not found — skipping OpenClaw implicit");
    return new Set();
  }
  const content = readFileSync(filePath, "utf-8");

  // Match patterns like: providers.xxx = or providers["xxx"] =
  const providers = new Set();
  const dotPattern = /providers\.(\w[\w-]*)\s*=/g;
  const bracketPattern = /providers\["([\w-]+)"\]\s*=/g;

  for (const m of content.matchAll(dotPattern)) {
    providers.add(m[1]);
  }
  for (const m of content.matchAll(bracketPattern)) {
    providers.add(m[1]);
  }

  return providers;
}

// ---------------------------------------------------------------------------
// Source C: EasyClaw core
// ---------------------------------------------------------------------------
async function getEasyClawProviders() {
  // Import from compiled output
  const corePath = join(rootDir, "packages/core/dist/index.mjs");
  if (!existsSync(corePath)) {
    console.error("  [error] packages/core/dist/index.mjs not found — run 'pnpm run build' first");
    process.exit(2);
  }
  const core = await import(pathToFileURL(corePath).href);
  const allProviders = new Set(core.ALL_PROVIDERS);
  const withExtraModels = new Set(
    core.ALL_PROVIDERS.filter((p) => core.getProviderMeta(p)?.extraModels?.length > 0),
  );
  // Subscription plans inherit models from parent — they don't need extraModels
  const subscriptionSet = new Set(core.SUBSCRIPTION_PROVIDER_IDS);
  // Local providers discover models at runtime
  const localSet = new Set(core.LOCAL_PROVIDER_IDS);
  return { allProviders, withExtraModels, subscriptionSet, localSet };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== Provider Sync Audit ===\n");

  const piAi = await getPiAiProviders();
  const openClaw = getOpenClawImplicitProviders();
  const { allProviders, withExtraModels, subscriptionSet, localSet } = await getEasyClawProviders();

  // Category 1: CRITICAL — in ALL_PROVIDERS, no extraModels, not in pi-ai,
  // not a subscription plan (inherits from parent), not a local provider (runtime discovery)
  const critical = [];
  for (const p of allProviders) {
    if (withExtraModels.has(p)) continue;
    if (piAi.has(p)) continue;
    if (subscriptionSet.has(p)) continue;
    if (localSet.has(p)) continue;
    critical.push(p);
  }

  // Category 2: New upstream — in pi-ai or OpenClaw but not in ALL_PROVIDERS
  const newUpstream = [];
  for (const p of piAi) {
    if (!allProviders.has(p)) newUpstream.push(`${p} (pi-ai)`);
  }
  for (const p of openClaw) {
    if (!allProviders.has(p)) newUpstream.push(`${p} (openclaw)`);
  }

  // Category 3: OK — in ALL_PROVIDERS, no extraModels, covered by pi-ai
  const ok = [];
  for (const p of allProviders) {
    if (withExtraModels.has(p)) continue;
    if (piAi.has(p)) ok.push(p);
  }

  // Report
  if (critical.length > 0) {
    console.log("[1] CRITICAL — invisible providers (no extraModels, not in vendor catalog):");
    for (const p of critical) {
      console.log(`    - ${p}`);
    }
    console.log(`    Action: add extraModels to packages/core/src/models.ts\n`);
  } else {
    console.log("[1] No critical gaps found.\n");
  }

  if (newUpstream.length > 0) {
    console.log("[2] New upstream providers (not in EasyClaw):");
    for (const p of newUpstream) {
      console.log(`    - ${p}`);
    }
    console.log(`    Action: evaluate adding to LLMProvider type + PROVIDERS registry\n`);
  } else {
    console.log("[2] No new upstream providers.\n");
  }

  if (ok.length > 0) {
    console.log("[3] OK — covered by vendor catalog (no extraModels needed):");
    for (const p of ok) {
      console.log(`    - ${p}`);
    }
    console.log();
  }

  // Summary
  console.log("--- Summary ---");
  console.log(`  EasyClaw providers: ${allProviders.size}`);
  console.log(`  With extraModels:   ${withExtraModels.size}`);
  console.log(`  Pi-ai providers:    ${piAi.size}`);
  console.log(`  OpenClaw implicit:  ${openClaw.size}`);
  console.log(`  Critical gaps:      ${critical.length}`);
  console.log(`  New upstream:       ${newUpstream.length}`);

  if (critical.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
