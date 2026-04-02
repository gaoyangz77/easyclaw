import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Sentinel test for vendor patch 0004: promptMode "raw".
 *
 * Verifies that OpenClaw's system-prompt.ts supports promptMode "raw"
 * which returns ONLY the caller-supplied extraSystemPrompt with no
 * hardcoded identity, runtime, safety, or tooling sections. Without the
 * vendor patch, the PromptMode type lacks "raw" and the early return
 * is missing — causing the CS agent to see AI-identity content that
 * undermines its human persona.
 *
 * When this test fails after a vendor update, re-apply patch 0004 or
 * verify that upstream added equivalent functionality.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VENDOR_FILE = resolve(
  __dirname,
  "../../../../vendor/openclaw/src/agents/system-prompt.ts",
);

/** Check if the vendor source has the promptMode raw patch applied. */
function isVendorPatched(): boolean {
  try {
    const src = readFileSync(VENDOR_FILE, "utf-8");
    return /export type PromptMode\b[^;]*"raw"/.test(src);
  } catch {
    return false;
  }
}

const runOrSkip = isVendorPatched() ? describe : describe.skip;

runOrSkip("vendor patch 0004: promptMode raw", () => {
  const source = readFileSync(VENDOR_FILE, "utf-8");

  it("PromptMode type includes 'raw'", () => {
    expect(source).toMatch(/export type PromptMode\b[^;]*"raw"/);
  });

  it("early return for raw mode exists before none mode check", () => {
    const rawIndex = source.indexOf('if (promptMode === "raw")');
    const noneIndex = source.indexOf('if (promptMode === "none")');

    expect(rawIndex).toBeGreaterThan(-1);
    expect(noneIndex).toBeGreaterThan(-1);
    expect(rawIndex).toBeLessThan(noneIndex);
  });

  it("raw mode returns extraSystemPrompt only", () => {
    // Extract the return statement inside the raw-mode if block
    const rawStart = source.indexOf('if (promptMode === "raw")');
    expect(rawStart).toBeGreaterThan(-1);

    // Find the closing brace of the if block
    const openBrace = source.indexOf("{", rawStart);
    const closeBrace = source.indexOf("}", openBrace);
    const rawBody = source.slice(openBrace, closeBrace + 1);

    // Must return extraSystemPrompt (the caller-supplied prompt)
    expect(rawBody).toContain("extraSystemPrompt");
    // Must NOT contain any hardcoded identity string
    expect(rawBody).not.toContain("You are");
  });
});
