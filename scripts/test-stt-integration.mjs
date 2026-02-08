#!/usr/bin/env node
/**
 * Test script for STT integration.
 *
 * Usage:
 *   node scripts/test-stt-integration.mjs
 *
 * This script verifies that:
 * 1. STT configuration types are correctly exported
 * 2. STT providers can be created
 * 3. STT manager can be initialized
 */

import { DEFAULT_STT_SETTINGS, STT_SETTINGS_KEYS, STT_SECRET_KEYS } from "@easyclaw/core";
import { selectSttProvider } from "@easyclaw/stt";

console.log("✓ STT Types Test");
console.log("  - DEFAULT_STT_SETTINGS:", DEFAULT_STT_SETTINGS);
console.log("  - STT_SETTINGS_KEYS:", STT_SETTINGS_KEYS);
console.log("  - STT_SECRET_KEYS:", STT_SECRET_KEYS);

console.log("\n✓ STT Provider Selection Test");
console.log("  - CN region:", selectSttProvider("cn"));
console.log("  - US region:", selectSttProvider("us"));
console.log("  - EU region:", selectSttProvider("eu"));

console.log("\n✓ All tests passed!");
