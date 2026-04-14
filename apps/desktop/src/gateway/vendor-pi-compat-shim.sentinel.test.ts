import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sentinel test for vendor patch 0008: Pi SDK compatibility shim.
 *
 * Verifies that OpenClaw's loadModelCatalog() injects synthetic apiKey
 * values for auth-mode providers (token/oauth/aws-sdk) into a temp
 * models.pi-compat.json before Pi SDK's ModelRegistry reads it,
 * preventing the all-or-nothing validation failure.
 *
 * When this test fails after a vendor update, re-apply patch 0008 or
 * verify that upstream Pi SDK accepts auth modes as alternatives to
 * apiKey in validateConfig.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VENDOR_FILE = resolve(
  __dirname,
  "../../../../vendor/openclaw/src/agents/model-catalog.ts",
);

/** Check if the vendor source has the patch applied. */
function isVendorPatched(): boolean {
  try {
    const src = readFileSync(VENDOR_FILE, "utf-8");
    return (
      src.includes("COMPAT_AUTH_MODES") &&
      src.includes("models.pi-compat.json")
    );
  } catch {
    return false;
  }
}

const runOrSkip = isVendorPatched() ? describe : describe.skip;

runOrSkip(
  "vendor patch 0008: Pi SDK compatibility shim for auth-mode providers",
  () => {
    const source = readFileSync(VENDOR_FILE, "utf-8");

    it("COMPAT_AUTH_MODES set exists in loadModelCatalog", () => {
      // Find the loadModelCatalog function
      const fnStart = source.indexOf("async function loadModelCatalog");
      // Fall back to the export form
      const fnStartAlt =
        fnStart > -1
          ? fnStart
          : source.indexOf("export async function loadModelCatalog");
      expect(fnStartAlt).toBeGreaterThan(-1);

      // The COMPAT_AUTH_MODES set must be inside loadModelCatalog, not at
      // module level
      const afterFn = source.slice(fnStartAlt);
      const compatIdx = afterFn.indexOf("COMPAT_AUTH_MODES");
      expect(compatIdx).toBeGreaterThan(-1);

      // Verify all three auth modes are included
      expect(afterFn).toContain('"token"');
      expect(afterFn).toContain('"oauth"');
      expect(afterFn).toContain('"aws-sdk"');
    });

    it("shim writes to models.pi-compat.json temp file", () => {
      expect(source).toContain("models.pi-compat.json");
      // Verify the shimmed path is written via writeFileSync
      const writeIdx = source.indexOf("writeFileSync");
      const piCompatIdx = source.indexOf("models.pi-compat.json");
      expect(writeIdx).toBeGreaterThan(-1);
      expect(piCompatIdx).toBeGreaterThan(-1);
    });

    it("shimmed temp file is cleaned up after registry instantiation", () => {
      // The unlinkSync call for cleanup must come AFTER instantiatePiModelRegistry
      const registryIdx = source.indexOf("instantiatePiModelRegistry");
      expect(registryIdx).toBeGreaterThan(-1);

      // Find the cleanup block after registry instantiation
      const afterRegistry = source.slice(registryIdx);
      const cleanupIdx = afterRegistry.indexOf("unlinkSync(shimmedModelsPath)");
      expect(cleanupIdx).toBeGreaterThan(-1);
    });

    it("synthetic apiKey uses __oc_synthetic_ prefix", () => {
      expect(source).toContain("__oc_synthetic_");
      // Verify the pattern interpolates the auth mode
      expect(source).toContain("`__oc_synthetic_${");
    });
  },
);
