import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PATCH_FILE = resolve(
  __dirname,
  "../../../../vendor-patches/openclaw/0009-vendor-openclaw-replace-cli-guidance-for-rivonclaw-desktop.patch",
);
const BRAND_PATCH_FILE = resolve(
  __dirname,
  "../../../../vendor-patches/openclaw/0010-vendor-openclaw-brand-agent-prompt-for-rivonclaw-desktop.patch",
);
const VENDOR_SYSTEM_PROMPT = resolve(
  __dirname,
  "../../../../vendor/openclaw/src/agents/system-prompt.ts",
);

describe("vendor patch 0009: replace OpenClaw CLI guidance", () => {
  const patch = readFileSync(CLI_PATCH_FILE, "utf-8");

  it("removes the upstream OpenClaw CLI quick reference", () => {
    expect(patch).toContain("-    \"## OpenClaw CLI Quick Reference\"");
    expect(patch).toContain("-    \"- openclaw gateway status\"");
    expect(patch).toContain("-    \"If unsure, ask the user to run `openclaw help`");
  });

  it("adds RivonClaw Desktop runtime guidance instead", () => {
    expect(patch).toContain("+    \"## RivonClaw Desktop Runtime\"");
    expect(patch).toContain("Do not run or ask the user to run `openclaw` CLI commands");
    expect(patch).toContain("use first-class runtime tools");
  });

  it("removes the docs-section instruction to run openclaw status", () => {
    expect(patch).toContain("-    \"When diagnosing issues, run `openclaw status` yourself");
    expect(patch).toContain("use available first-class runtime tools instead of shelling out");
  });

  it("is applied to the vendored system prompt source", () => {
    const source = readFileSync(VENDOR_SYSTEM_PROMPT, "utf-8");

    expect(source).not.toContain("## OpenClaw CLI Quick Reference");
    expect(source).not.toContain("openclaw gateway status");
    expect(source).not.toContain("When diagnosing issues, run `openclaw status` yourself");
    expect(source).toContain("## RivonClaw Desktop Runtime");
    expect(source).toContain("Do not run or ask the user to run `openclaw` CLI commands");
  });
});

describe("vendor patch 0010: brand agent prompt for RivonClaw Desktop", () => {
  const patch = readFileSync(BRAND_PATCH_FILE, "utf-8");

  it("brands the primary assistant identity as RivonClaw Desktop", () => {
    expect(patch).toContain('-    return "You are a personal assistant running inside OpenClaw."');
    expect(patch).toContain('+    return "You are a personal assistant running inside RivonClaw Desktop."');
    expect(patch).toContain('-    "You are a personal assistant running inside OpenClaw."');
    expect(patch).toContain('+    "You are a personal assistant running inside RivonClaw Desktop."');
  });

  it("brands user-visible runtime sections while preserving underlying OpenClaw facts", () => {
    expect(patch).toContain('+    gateway: "Restart, apply config, or run updates on the running RivonClaw Desktop gateway"');
    expect(patch).toContain('+    hasGateway && !isMinimal ? "## RivonClaw Desktop Updates" : ""');
    expect(patch).toContain('+          "After restart, RivonClaw pings the last active session automatically."');
    expect(patch).toContain('+    "These user-editable files are loaded by RivonClaw and included below in Project Context."');
    expect(patch).toContain("RivonClaw Desktop manages the underlying OpenClaw gateway lifecycle");
  });

  it("is applied to the vendored system prompt source", () => {
    const source = readFileSync(VENDOR_SYSTEM_PROMPT, "utf-8");

    expect(source).not.toContain("You are a personal assistant running inside OpenClaw.");
    expect(source).not.toContain("## OpenClaw Self-Update");
    expect(source).not.toContain("OpenClaw pings the last active session automatically.");
    expect(source).not.toContain("These user-editable files are loaded by OpenClaw");
    expect(source).toContain("You are a personal assistant running inside RivonClaw Desktop.");
    expect(source).toContain("## RivonClaw Desktop Updates");
    expect(source).toContain("These user-editable files are loaded by RivonClaw");
  });
});
