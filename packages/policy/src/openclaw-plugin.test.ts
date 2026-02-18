import { describe, it, expect } from "vitest";
import { createPolicyInjector } from "./policy-injector.js";
import { createGuardEvaluator } from "./guard-evaluator.js";
import type {
  PolicyProvider,
  GuardProvider,
  AgentStartContext,
  ToolCallContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicyProvider(policyView: string): PolicyProvider {
  return { getCompiledPolicyView: () => policyView };
}

function makeGuardProvider(
  guards: Array<{ id: string; ruleId: string; content: string }>,
): GuardProvider {
  return { getActiveGuards: () => guards };
}

function makeGuardContent(
  condition: string,
  action: string,
  reason: string,
): string {
  return JSON.stringify({ type: "guard", condition, action, reason });
}

// ---------------------------------------------------------------------------
// Policy Injector Tests (without guards)
// ---------------------------------------------------------------------------

describe("createPolicyInjector", () => {
  it("returns original context when no policy is available", () => {
    const handler = createPolicyInjector(makePolicyProvider(""));
    const ctx: AgentStartContext = { prependContext: "existing context" };

    const result = handler(ctx);

    expect(result.prependContext).toBe("existing context");
  });

  it("prepends policy block when policy exists", () => {
    const handler = createPolicyInjector(
      makePolicyProvider("Do not use sudo."),
    );
    const ctx: AgentStartContext = { prependContext: "" };

    const result = handler(ctx);

    expect(result.prependContext).toContain("--- EasyClaw Policy ---");
    expect(result.prependContext).toContain("Do not use sudo.");
    expect(result.prependContext).toContain("--- End Policy ---");
  });

  it("preserves existing prependContext after policy block", () => {
    const handler = createPolicyInjector(
      makePolicyProvider("Be careful with files."),
    );
    const ctx: AgentStartContext = { prependContext: "System instructions here" };

    const result = handler(ctx);

    expect(result.prependContext).toContain("--- EasyClaw Policy ---");
    expect(result.prependContext).toContain("Be careful with files.");
    expect(result.prependContext).toContain("--- End Policy ---");
    expect(result.prependContext).toContain("System instructions here");
    // Policy should come before existing context
    const policyEnd = result.prependContext.indexOf("--- End Policy ---");
    const existingStart = result.prependContext.indexOf(
      "System instructions here",
    );
    expect(policyEnd).toBeLessThan(existingStart);
  });

  it("handles empty string policy by passing through", () => {
    const handler = createPolicyInjector(makePolicyProvider(""));
    const ctx: AgentStartContext = { prependContext: "" };

    const result = handler(ctx);

    expect(result.prependContext).toBe("");
  });

  it("handles empty prependContext with policy present", () => {
    const handler = createPolicyInjector(
      makePolicyProvider("Rule: always explain."),
    );
    const ctx: AgentStartContext = { prependContext: "" };

    const result = handler(ctx);

    expect(result.prependContext).toContain("Rule: always explain.");
    // Should not have a trailing newline + empty context appended
    expect(result.prependContext).not.toContain("\n\n\n");
  });
});

// ---------------------------------------------------------------------------
// Policy Injector Tests (with guard injection)
// ---------------------------------------------------------------------------

describe("createPolicyInjector with guards", () => {
  it("injects guard directives into prependContext", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent(
            "Current time is after 22:00",
            "block",
            "Don't disturb after 10pm",
          ),
        },
      ]),
    );
    const ctx: AgentStartContext = { prependContext: "" };

    const result = handler(ctx);

    expect(result.prependContext).toContain("--- EasyClaw Guards (MUST enforce) ---");
    expect(result.prependContext).toContain("[BLOCK]");
    expect(result.prependContext).toContain("Current time is after 22:00");
    expect(result.prependContext).toContain("Don't disturb after 10pm");
    expect(result.prependContext).toContain("--- End Guards ---");
  });

  it("injects both policy and guards in correct order", () => {
    const handler = createPolicyInjector(
      makePolicyProvider("Be polite."),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:write_file", "block", "No writing"),
        },
      ]),
    );
    const ctx: AgentStartContext = { prependContext: "existing" };

    const result = handler(ctx);

    // Policy comes first
    const policyIdx = result.prependContext.indexOf("--- EasyClaw Policy ---");
    const guardsIdx = result.prependContext.indexOf("--- EasyClaw Guards");
    const existingIdx = result.prependContext.indexOf("existing");

    expect(policyIdx).toBeLessThan(guardsIdx);
    expect(guardsIdx).toBeLessThan(existingIdx);
  });

  it("formats guard with different condition and reason", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent(
            "Time is after 22:00",
            "block",
            "Quiet hours!",
          ),
        },
      ]),
    );
    const result = handler({ prependContext: "" });

    // Should show both condition and reason separated by —
    expect(result.prependContext).toContain("[BLOCK] Time is after 22:00 — Quiet hours!");
  });

  it("formats guard with same condition and reason without duplication", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent(
            "Block all file deletions after 6pm",
            "block",
            "Block all file deletions after 6pm",
          ),
        },
      ]),
    );
    const result = handler({ prependContext: "" });

    // Should NOT duplicate the text
    expect(result.prependContext).toContain("[BLOCK] Block all file deletions after 6pm");
    expect(result.prependContext).not.toContain("—");
  });

  it("injects multiple guards as separate lines", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:write_file", "block", "No writing"),
        },
        {
          id: "g2",
          ruleId: "r2",
          content: makeGuardContent("path:/etc/*", "block", "System protected"),
        },
      ]),
    );
    const result = handler({ prependContext: "" });

    expect(result.prependContext).toContain("[BLOCK] tool:write_file — No writing");
    expect(result.prependContext).toContain("[BLOCK] path:/etc/* — System protected");
  });

  it("passes through when no policy and no guards", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([]),
    );
    const result = handler({ prependContext: "original" });

    expect(result.prependContext).toBe("original");
  });

  it("injects guards even when no policy exists", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:*", "block", "All blocked"),
        },
      ]),
    );
    const result = handler({ prependContext: "" });

    expect(result.prependContext).not.toContain("--- EasyClaw Policy ---");
    expect(result.prependContext).toContain("--- EasyClaw Guards");
    expect(result.prependContext).toContain("[BLOCK] tool:* — All blocked");
  });

  it("skips malformed guard content gracefully", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        { id: "g1", ruleId: "r1", content: "not json" },
        {
          id: "g2",
          ruleId: "r2",
          content: makeGuardContent("tool:exec", "block", "No exec"),
        },
      ]),
    );
    const result = handler({ prependContext: "" });

    // Malformed guard skipped, valid one injected
    expect(result.prependContext).toContain("[BLOCK]");
    expect(result.prependContext).toContain("No exec");
  });

  it("skips guard with no condition and no reason", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: JSON.stringify({ type: "guard", action: "block" }),
        },
      ]),
    );
    const result = handler({ prependContext: "" });

    // No guards to inject → pass through
    expect(result.prependContext).toBe("");
  });

  it("uppercases the action in the directive", () => {
    const handler = createPolicyInjector(
      makePolicyProvider(""),
      makeGuardProvider([
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:*", "confirm", "Please confirm"),
        },
      ]),
    );
    const result = handler({ prependContext: "" });

    expect(result.prependContext).toContain("[CONFIRM]");
  });

  it("works without guardProvider (backward compatible)", () => {
    const handler = createPolicyInjector(makePolicyProvider("A policy."));
    const result = handler({ prependContext: "" });

    expect(result.prependContext).toContain("A policy.");
    expect(result.prependContext).not.toContain("Guards");
  });
});

// ---------------------------------------------------------------------------
// Guard Evaluator Tests
// ---------------------------------------------------------------------------

describe("createGuardEvaluator", () => {
  it("returns pass-through when no guards exist", () => {
    const handler = createGuardEvaluator(makeGuardProvider([]));
    const ctx: ToolCallContext = {
      toolName: "write_file",
      params: { path: "/tmp/test.txt" },
    };

    const result = handler(ctx);

    expect(result.block).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it("blocks tool call matching tool name condition", () => {
    const guards = [
      {
        id: "g1",
        ruleId: "r1",
        content: makeGuardContent(
          "tool:write_file",
          "block",
          "File writing is not allowed",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));
    const ctx: ToolCallContext = {
      toolName: "write_file",
      params: { path: "/tmp/test.txt" },
    };

    const result = handler(ctx);

    expect(result.block).toBe(true);
    expect(result.blockReason).toBe("File writing is not allowed");
  });

  it("blocks tool call matching path condition", () => {
    const guards = [
      {
        id: "g2",
        ruleId: "r2",
        content: makeGuardContent(
          "path:/etc/*",
          "block",
          "Cannot modify system files",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));
    const ctx: ToolCallContext = {
      toolName: "write_file",
      params: { path: "/etc/passwd" },
    };

    const result = handler(ctx);

    expect(result.block).toBe(true);
    expect(result.blockReason).toBe("Cannot modify system files");
  });

  it("allows tool call that does not match any guard", () => {
    const guards = [
      {
        id: "g3",
        ruleId: "r3",
        content: makeGuardContent(
          "tool:delete_file",
          "block",
          "Deletion not allowed",
        ),
      },
      {
        id: "g4",
        ruleId: "r4",
        content: makeGuardContent(
          "path:/etc/*",
          "block",
          "System files protected",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));
    const ctx: ToolCallContext = {
      toolName: "read_file",
      params: { path: "/home/user/doc.txt" },
    };

    const result = handler(ctx);

    expect(result.block).toBeUndefined();
  });

  it("first blocking guard wins when multiple guards match", () => {
    const guards = [
      {
        id: "g5",
        ruleId: "r5",
        content: makeGuardContent(
          "tool:write_file",
          "block",
          "First guard: no writing",
        ),
      },
      {
        id: "g6",
        ruleId: "r6",
        content: makeGuardContent(
          "tool:write_file",
          "block",
          "Second guard: also no writing",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));
    const ctx: ToolCallContext = {
      toolName: "write_file",
      params: {},
    };

    const result = handler(ctx);

    expect(result.block).toBe(true);
    expect(result.blockReason).toBe("First guard: no writing");
  });

  it("handles malformed guard content gracefully without crashing", () => {
    const guards = [
      {
        id: "g7",
        ruleId: "r7",
        content: "this is not valid json",
      },
      {
        id: "g8",
        ruleId: "r8",
        content: JSON.stringify({ type: "guard" }), // missing required fields
      },
      {
        id: "g9",
        ruleId: "r9",
        content: makeGuardContent(
          "tool:write_file",
          "block",
          "Valid guard after malformed ones",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));
    const ctx: ToolCallContext = {
      toolName: "write_file",
      params: {},
    };

    const result = handler(ctx);

    // Should skip malformed guards and still process the valid one
    expect(result.block).toBe(true);
    expect(result.blockReason).toBe("Valid guard after malformed ones");
  });

  it("catch-all guard (tool:*) blocks everything", () => {
    const guards = [
      {
        id: "g10",
        ruleId: "r10",
        content: makeGuardContent(
          "tool:*",
          "block",
          "All tools are blocked",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));

    const result1 = handler({
      toolName: "write_file",
      params: {},
    });
    expect(result1.block).toBe(true);
    expect(result1.blockReason).toBe("All tools are blocked");

    const result2 = handler({
      toolName: "read_file",
      params: {},
    });
    expect(result2.block).toBe(true);
    expect(result2.blockReason).toBe("All tools are blocked");

    const result3 = handler({
      toolName: "execute_command",
      params: { cmd: "ls" },
    });
    expect(result3.block).toBe(true);
    expect(result3.blockReason).toBe("All tools are blocked");
  });

  it("path condition matches any string param, not just 'path'", () => {
    const guards = [
      {
        id: "g11",
        ruleId: "r11",
        content: makeGuardContent(
          "path:/etc/*",
          "block",
          "System path blocked",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));
    const ctx: ToolCallContext = {
      toolName: "copy_file",
      params: { source: "/etc/hosts", destination: "/tmp/hosts" },
    };

    const result = handler(ctx);

    expect(result.block).toBe(true);
    expect(result.blockReason).toBe("System path blocked");
  });

  it("path condition does not match non-string param values", () => {
    const guards = [
      {
        id: "g12",
        ruleId: "r12",
        content: makeGuardContent(
          "path:/etc/*",
          "block",
          "System path blocked",
        ),
      },
    ];
    const handler = createGuardEvaluator(makeGuardProvider(guards));
    const ctx: ToolCallContext = {
      toolName: "some_tool",
      params: { count: 42, flag: true, nested: { path: "/etc/shadow" } },
    };

    const result = handler(ctx);

    expect(result.block).toBeUndefined();
  });
});
