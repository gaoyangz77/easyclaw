#!/usr/bin/env node

/**
 * Test script for Permissions page integration
 * Tests the complete flow: UI → API → SQLite → OpenClaw config → Gateway reload
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const API_BASE = "http://127.0.0.1:3210/api";
const OPENCLAW_CONFIG = join(homedir(), ".easyclaw", "openclaw", "openclaw.json");

async function fetchJson(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function testPermissionsFlow() {
  console.log("🧪 Testing Permissions Integration Flow\n");

  // Step 1: Fetch current permissions
  console.log("1️⃣  Fetching current permissions...");
  const current = await fetchJson("/permissions");
  console.log("   Current permissions:", JSON.stringify(current, null, 2));

  // Step 2: Update permissions with test data
  console.log("\n2️⃣  Updating permissions with test data...");
  const testData = {
    readPaths: ["/Users/gaoyangz/Desktop/AMC"],
    writePaths: ["/Users/gaoyangz/projects"],
  };
  const updated = await fetchJson("/permissions", {
    method: "PUT",
    body: JSON.stringify(testData),
  });
  console.log("   Updated permissions:", JSON.stringify(updated, null, 2));

  // Step 3: Verify persistence by fetching again
  console.log("\n3️⃣  Verifying persistence (re-fetch)...");
  const verified = await fetchJson("/permissions");
  console.log("   Verified permissions:", JSON.stringify(verified, null, 2));

  const isPersisted =
    JSON.stringify(verified.permissions.readPaths) ===
      JSON.stringify(testData.readPaths) &&
    JSON.stringify(verified.permissions.writePaths) ===
      JSON.stringify(testData.writePaths);
  console.log(isPersisted ? "   ✅ SQLite persistence: OK" : "   ❌ SQLite persistence: FAILED");

  // Step 4: Check OpenClaw config
  console.log("\n4️⃣  Checking OpenClaw config...");
  try {
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, "utf-8"));
    const binds = config?.agents?.defaults?.sandbox?.docker?.binds || [];
    console.log("   Docker binds:", JSON.stringify(binds, null, 2));

    const expectedBinds = [
      "/Users/gaoyangz/Desktop/AMC:/Users/gaoyangz/Desktop/AMC:ro",
      "/Users/gaoyangz/projects:/Users/gaoyangz/projects:rw",
    ];

    const configOk =
      binds.length === expectedBinds.length &&
      binds.every((bind) => expectedBinds.includes(bind));

    console.log(configOk ? "   ✅ OpenClaw config: OK" : "   ❌ OpenClaw config: FAILED");
  } catch (err) {
    console.log("   ❌ Failed to read OpenClaw config:", err.message);
  }

  // Step 5: Clean up
  console.log("\n5️⃣  Cleaning up test data...");
  await fetchJson("/permissions", {
    method: "PUT",
    body: JSON.stringify({ readPaths: [], writePaths: [] }),
  });
  console.log("   ✅ Test data cleared");

  console.log("\n🎉 Test completed!");
}

testPermissionsFlow().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
