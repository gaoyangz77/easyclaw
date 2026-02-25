import { describe, it, expect } from "vitest";
import { createEasyClawContext } from "./easyclaw-context.js";

describe("createEasyClawContext", () => {
  const handler = createEasyClawContext();

  it("returns prependContext with EasyClaw runtime block", () => {
    const result = handler({ prompt: "hello" });
    expect(result.prependContext).toContain("EasyClaw Runtime Environment");
    expect(result.prependContext).toContain("EasyClaw Desktop Application");
    expect(result.prependContext).toContain("`gateway` tool");
    expect(result.prependContext).toContain("`easyclaw` tool");
  });

  it("does not return systemPrompt", () => {
    const result = handler({ prompt: "hello" });
    expect(result).not.toHaveProperty("systemPrompt");
  });

  it("tells AI not to use openclaw CLI", () => {
    const result = handler({ prompt: "hello" });
    expect(result.prependContext).toContain("Do NOT attempt to run any `openclaw` commands");
    expect(result.prependContext).toContain("OpenClaw CLI Quick Reference");
  });

  it("mentions gateway lifecycle is auto-managed", () => {
    const result = handler({ prompt: "hello" });
    expect(result.prependContext).toContain("automatically managed by EasyClaw");
  });
});
