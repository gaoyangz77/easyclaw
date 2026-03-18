import { describe, it, expect } from "vitest";
import { createRivonClawContext } from "./rivonclaw-context.js";

describe("createRivonClawContext", () => {
  const handler = createRivonClawContext();

  it("returns prependSystemContext with RivonClaw runtime block", () => {
    const result = handler({ prompt: "hello" });
    expect(result.prependSystemContext).toContain("RivonClaw Runtime Environment");
    expect(result.prependSystemContext).toContain("RivonClaw Desktop Application");
    expect(result.prependSystemContext).toContain("`gateway` tool");
    expect(result.prependSystemContext).toContain("`rivonclaw` tool");
  });

  it("does not return systemPrompt", () => {
    const result = handler({ prompt: "hello" });
    expect(result).not.toHaveProperty("systemPrompt");
  });

  it("tells AI not to use openclaw CLI", () => {
    const result = handler({ prompt: "hello" });
    expect(result.prependSystemContext).toContain(
      "Do NOT attempt to run any `openclaw` commands",
    );
    expect(result.prependSystemContext).toContain("OpenClaw CLI Quick Reference");
  });

  it("mentions gateway lifecycle is auto-managed", () => {
    const result = handler({ prompt: "hello" });
    expect(result.prependSystemContext).toContain(
      "automatically managed by RivonClaw",
    );
  });
});
