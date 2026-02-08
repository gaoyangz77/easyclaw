#!/usr/bin/env node
/**
 * Verify that DOMAIN_TO_PROVIDER mapping in apps/desktop/src/main.ts
 * includes all domains from PROVIDER_BASE_URLS in packages/core/src/models.ts
 *
 * Usage:
 *   node scripts/verify-proxy-domains.mjs
 *
 * Exit codes:
 *   0 - All domains present
 *   1 - Missing domains found
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// Extract PROVIDER_BASE_URLS from models.ts
function extractProviderBaseUrls() {
  const modelsPath = join(rootDir, "packages/core/src/models.ts");
  const content = readFileSync(modelsPath, "utf-8");

  // Find PROVIDER_BASE_URLS object
  const match = content.match(/export const PROVIDER_BASE_URLS[^=]+=\s*{([^}]+)}/s);
  if (!match) {
    throw new Error("Could not find PROVIDER_BASE_URLS in models.ts");
  }

  const urls = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    const urlMatch = line.match(/^\s*(?:"([^"]+)"|(\w+)):\s*"([^"]+)"/);
    if (urlMatch) {
      const provider = urlMatch[1] || urlMatch[2];
      const url = urlMatch[3];
      urls[provider] = url;
    }
  }

  return urls;
}

// Extract DOMAIN_TO_PROVIDER from main.ts
function extractDomainToProvider() {
  const mainPath = join(rootDir, "apps/desktop/src/main.ts");
  const content = readFileSync(mainPath, "utf-8");

  // Find DOMAIN_TO_PROVIDER object
  const match = content.match(/const DOMAIN_TO_PROVIDER[^=]+=\s*{([^}]+)}/s);
  if (!match) {
    throw new Error("Could not find DOMAIN_TO_PROVIDER in main.ts");
  }

  const domains = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    if (line.trim().startsWith("//")) continue; // Skip comments
    const domainMatch = line.match(/^\s*"([^"]+)":\s*"([^"]+)"/);
    if (domainMatch) {
      const domain = domainMatch[1];
      const provider = domainMatch[2];
      domains[domain] = provider;
    }
  }

  return domains;
}

// Main verification
try {
  console.log("🔍 Verifying proxy domain mappings...\n");

  const baseUrls = extractProviderBaseUrls();
  const domainMapping = extractDomainToProvider();

  const missing = [];
  const correct = [];

  for (const [provider, url] of Object.entries(baseUrls)) {
    const domain = new URL(url).hostname;
    const mappedProvider = domainMapping[domain];

    if (!mappedProvider) {
      missing.push({ provider, domain, url });
    } else if (mappedProvider === provider) {
      correct.push({ provider, domain });
    } else {
      console.log(`⚠️  Domain mismatch: ${domain}`);
      console.log(`   Expected: "${provider}"`);
      console.log(`   Got: "${mappedProvider}"`);
    }
  }

  // Report results
  console.log(`✅ Correct mappings: ${correct.length}`);
  for (const { provider, domain } of correct) {
    console.log(`   ${provider.padEnd(20)} → ${domain}`);
  }

  if (missing.length > 0) {
    console.log(`\n❌ Missing mappings: ${missing.length}`);
    console.log("\nAdd these to DOMAIN_TO_PROVIDER in apps/desktop/src/main.ts:\n");
    for (const { provider, domain } of missing) {
      console.log(`  "${domain}": "${provider}",`);
    }

    // Special handling for multi-region providers
    const multiRegion = missing.filter(m => m.domain.includes("amazonaws.com"));
    if (multiRegion.length > 0) {
      console.log("\n⚠️  Note: AWS Bedrock has multiple regional endpoints.");
      console.log("   Consider adding all major regions:");
      const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1'];
      for (const region of regions) {
        console.log(`  "bedrock-runtime.${region}.amazonaws.com": "amazon-bedrock",`);
      }
    }

    process.exit(1);
  }

  console.log("\n✅ All provider domains are mapped correctly!");
  process.exit(0);

} catch (err) {
  console.error("❌ Verification failed:", err.message);
  process.exit(1);
}
