import { describe, it, expect } from "vitest";
import { createGuardEvaluator } from "./guard-evaluator.js";
import type { GuardProvider, ToolCallContext } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Edge case tests for guard evaluator
// ---------------------------------------------------------------------------

describe("guard evaluator edge cases", () => {
  describe("condition format: tool:<name>", () => {
    it("does not match a tool with a similar but different name", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:write_file", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      // "write_files" is not "write_file"
      const result = handler({
        toolName: "write_files",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });

    it("is case-sensitive for tool name matching", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:Write_File", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });
  });

  describe("condition format: path:<pattern>", () => {
    it("matches exact path without wildcard", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("path:/etc/passwd", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "read_file",
        params: { path: "/etc/passwd" },
      });

      expect(result.block).toBe(true);
    });

    it("also matches longer paths when exact path is used (startsWith)", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("path:/etc/", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "read_file",
        params: { path: "/etc/hosts" },
      });

      expect(result.block).toBe(true);
    });

    it("does not match unrelated paths", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("path:/etc/*", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "read_file",
        params: { path: "/home/user/file.txt" },
      });

      expect(result.block).toBeUndefined();
    });

    it("matches multiple params - blocks if any match", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("path:/etc/*", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "copy_file",
        params: { source: "/home/user/file.txt", destination: "/etc/config" },
      });

      expect(result.block).toBe(true);
    });

    it("ignores numeric, boolean, null, and undefined param values", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("path:/etc/*", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "some_tool",
        params: { count: 42, flag: true, value: null, undef: undefined },
      });

      expect(result.block).toBeUndefined();
    });

    it("handles empty params object", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("path:/etc/*", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "some_tool",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });
  });

  describe("unknown condition formats", () => {
    it("does not match unknown condition format (returns pass-through)", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("time:after-6pm", "block", "blocked"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: { path: "/tmp/test" },
      });

      expect(result.block).toBeUndefined();
    });

    it("skips unknown conditions and continues to next guard", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("unknown:condition", "block", "first guard"),
        },
        {
          id: "g2",
          ruleId: "r2",
          content: makeGuardContent("tool:write_file", "block", "second guard"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      expect(result.block).toBe(true);
      expect(result.blockReason).toBe("second guard");
    });
  });

  describe("non-block actions", () => {
    it("does not block when action is 'confirm' (future feature)", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:write_file", "confirm", "Please confirm"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      // "confirm" action is not "block", so the tool call is not blocked
      expect(result.block).toBeUndefined();
    });

    it("does not block when action is 'modify' (future feature)", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:write_file", "modify", "modify params"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: { path: "/tmp/test" },
      });

      expect(result.block).toBeUndefined();
    });
  });

  describe("malformed guard content", () => {
    it("handles empty string content", () => {
      const guards = [
        { id: "g1", ruleId: "r1", content: "" },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });

    it("handles JSON with wrong value types", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: JSON.stringify({
            type: 123,
            condition: true,
            action: null,
            reason: [],
          }),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });

    it("handles JSON array instead of object", () => {
      const guards = [
        { id: "g1", ruleId: "r1", content: "[1, 2, 3]" },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });

    it("handles null JSON", () => {
      const guards = [
        { id: "g1", ruleId: "r1", content: "null" },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });
  });

  describe("multiple guards ordering", () => {
    it("evaluates guards in array order (first match wins)", () => {
      const guards = [
        {
          id: "g1",
          ruleId: "r1",
          content: makeGuardContent("tool:*", "block", "catch-all"),
        },
        {
          id: "g2",
          ruleId: "r2",
          content: makeGuardContent("tool:write_file", "block", "specific"),
        },
      ];
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      const result = handler({
        toolName: "write_file",
        params: {},
      });

      // First guard (catch-all) should win
      expect(result.block).toBe(true);
      expect(result.blockReason).toBe("catch-all");
    });

    it("processes many guards without error", () => {
      const guards = Array.from({ length: 100 }, (_, i) => ({
        id: `g${i}`,
        ruleId: `r${i}`,
        content: makeGuardContent(`tool:tool_${i}`, "block", `Guard ${i}`),
      }));
      const handler = createGuardEvaluator(makeGuardProvider(guards));

      // None match
      const result = handler({
        toolName: "unrelated_tool",
        params: {},
      });

      expect(result.block).toBeUndefined();
    });
  });
});
