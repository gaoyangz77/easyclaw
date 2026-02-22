import { describe, it, expect, vi } from "vitest";
import { RunTracker } from "./run-tracker.js";
import type { RunAction } from "./run-tracker.js";

function createTracker() {
  const onChange = vi.fn();
  const tracker = new RunTracker(onChange);
  return { tracker, onChange };
}

describe("RunTracker", () => {
  // ---------------------------------------------------------------------------
  // LOCAL_SEND
  // ---------------------------------------------------------------------------
  describe("LOCAL_SEND", () => {
    it("creates a run in processing phase", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      const run = tracker.getRun("r1");
      expect(run).toBeDefined();
      expect(run!.phase).toBe("processing");
      expect(run!.source).toBe("local");
      expect(tracker.getLocalRunId()).toBe("r1");
    });
  });

  // ---------------------------------------------------------------------------
  // EXTERNAL_INBOUND
  // ---------------------------------------------------------------------------
  describe("EXTERNAL_INBOUND", () => {
    it("creates a run in queued phase", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "r1", sessionKey: "s1", channel: "wechat" });
      const run = tracker.getRun("r1");
      expect(run).toBeDefined();
      expect(run!.phase).toBe("queued");
      expect(run!.source).toBe("wechat");
    });

    it("maps telegram channel", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "r1", sessionKey: "s1", channel: "telegram" });
      expect(tracker.getRun("r1")!.source).toBe("telegram");
    });

    it("maps unknown channel", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "r1", sessionKey: "s1", channel: "discord" });
      expect(tracker.getRun("r1")!.source).toBe("unknown");
    });
  });

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------
  describe("state transitions", () => {
    it("queued → awaiting_llm on LIFECYCLE_START", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "r1", sessionKey: "s1", channel: "wechat" });
      tracker.dispatch({ type: "LIFECYCLE_START", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("awaiting_llm");
    });

    it("processing → tooling on TOOL_START", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "TOOL_START", runId: "r1", toolName: "browser" });
      const run = tracker.getRun("r1")!;
      expect(run.phase).toBe("tooling");
      expect(run.toolName).toBe("browser");
    });

    it("tooling → awaiting_llm on TOOL_RESULT", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "TOOL_START", runId: "r1", toolName: "browser" });
      tracker.dispatch({ type: "TOOL_RESULT", runId: "r1" });
      const run = tracker.getRun("r1")!;
      expect(run.phase).toBe("awaiting_llm");
      expect(run.toolName).toBeUndefined();
    });

    it("processing → generating on ASSISTANT_STREAM", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "ASSISTANT_STREAM", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("generating");
    });

    it("tooling does NOT transition to generating on ASSISTANT_STREAM", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "TOOL_START", runId: "r1", toolName: "browser" });
      tracker.dispatch({ type: "ASSISTANT_STREAM", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("tooling");
    });

    it("generating → tooling on TOOL_START", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "ASSISTANT_STREAM", runId: "r1" });
      tracker.dispatch({ type: "TOOL_START", runId: "r1", toolName: "exec" });
      expect(tracker.getRun("r1")!.phase).toBe("tooling");
    });

    it("processing → awaiting_llm on LIFECYCLE_START", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "LIFECYCLE_START", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("awaiting_llm");
    });

    it("awaiting_llm → generating on ASSISTANT_STREAM", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "LIFECYCLE_START", runId: "r1" });
      tracker.dispatch({ type: "ASSISTANT_STREAM", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("generating");
    });

    it("awaiting_llm → generating on CHAT_DELTA", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "LIFECYCLE_START", runId: "r1" });
      tracker.dispatch({ type: "CHAT_DELTA", runId: "r1", text: "hi" });
      expect(tracker.getRun("r1")!.phase).toBe("generating");
    });

    it("queued → generating on CHAT_DELTA (race condition)", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "r1", sessionKey: "s1", channel: "wechat" });
      tracker.dispatch({ type: "CHAT_DELTA", runId: "r1", text: "hello" });
      const run = tracker.getRun("r1")!;
      expect(run.phase).toBe("generating");
      expect(run.streaming).toBe("hello");
    });
  });

  // ---------------------------------------------------------------------------
  // Terminal states
  // ---------------------------------------------------------------------------
  describe("terminal states", () => {
    it("CHAT_FINAL → done", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("done");
      expect(tracker.getLocalRunId()).toBeNull();
    });

    it("CHAT_ERROR → error", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_ERROR", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("error");
      expect(tracker.getLocalRunId()).toBeNull();
    });

    it("CHAT_ABORTED → aborted", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_ABORTED", runId: "r1" });
      expect(tracker.getRun("r1")!.phase).toBe("aborted");
      expect(tracker.getLocalRunId()).toBeNull();
    });

    it("CHAT_FINAL clears toolName", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "TOOL_START", runId: "r1", toolName: "browser" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "r1" });
      expect(tracker.getRun("r1")!.toolName).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // CHAT_DELTA
  // ---------------------------------------------------------------------------
  describe("CHAT_DELTA", () => {
    it("updates streaming text without changing phase", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "ASSISTANT_STREAM", runId: "r1" });
      tracker.dispatch({ type: "CHAT_DELTA", runId: "r1", text: "Hello" });
      const run = tracker.getRun("r1")!;
      expect(run.phase).toBe("generating");
      expect(run.streaming).toBe("Hello");
    });

    it("does not update terminal-state runs", () => {
      const { tracker, onChange } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "r1" });
      onChange.mockClear();
      tracker.dispatch({ type: "CHAT_DELTA", runId: "r1", text: "late" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // RUN_CLEANUP
  // ---------------------------------------------------------------------------
  describe("RUN_CLEANUP", () => {
    it("removes a run", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "RUN_CLEANUP", runId: "r1" });
      expect(tracker.isTracked("r1")).toBe(false);
    });

    it("does not fire onChange for unknown runId", () => {
      const { tracker, onChange } = createTracker();
      onChange.mockClear();
      tracker.dispatch({ type: "RUN_CLEANUP", runId: "unknown" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // isTracked
  // ---------------------------------------------------------------------------
  describe("isTracked", () => {
    it("returns true for active run", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      expect(tracker.isTracked("r1")).toBe(true);
    });

    it("returns true for terminal-state run (not yet cleaned up)", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "r1" });
      expect(tracker.isTracked("r1")).toBe(true);
    });

    it("returns false for unknown runId", () => {
      const { tracker } = createTracker();
      expect(tracker.isTracked("unknown")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getView
  // ---------------------------------------------------------------------------
  describe("getView", () => {
    it("returns idle view when no runs", () => {
      const { tracker } = createTracker();
      const view = tracker.getView();
      expect(view.isActive).toBe(false);
      expect(view.displayPhase).toBeNull();
      expect(view.displayToolName).toBeNull();
      expect(view.displayStreaming).toBeNull();
      expect(view.canAbort).toBe(false);
      expect(view.abortTargetRunId).toBeNull();
    });

    it("shows local run phase", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      const view = tracker.getView();
      expect(view.isActive).toBe(true);
      expect(view.displayPhase).toBe("processing");
      expect(view.canAbort).toBe(true);
      expect(view.abortTargetRunId).toBe("r1");
    });

    it("shows tool name when tooling", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "TOOL_START", runId: "r1", toolName: "browser" });
      const view = tracker.getView();
      expect(view.displayPhase).toBe("tooling");
      expect(view.displayToolName).toBe("browser");
    });

    it("does not show toolName when not tooling", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      const view = tracker.getView();
      expect(view.displayToolName).toBeNull();
    });

    it("prioritises local run over external run", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "ext1", sessionKey: "s1", channel: "wechat" });
      tracker.dispatch({ type: "LOCAL_SEND", runId: "local1", sessionKey: "s1" });
      const view = tracker.getView();
      expect(view.displayPhase).toBe("processing"); // local
      expect(view.abortTargetRunId).toBe("local1");
    });

    it("falls back to external run when no local run", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "ext1", sessionKey: "s1", channel: "wechat" });
      const view = tracker.getView();
      expect(view.displayPhase).toBe("queued");
      expect(view.canAbort).toBe(true);
      expect(view.abortTargetRunId).toBe("ext1");
    });

    it("excludes terminal-state runs from activeRuns", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "r1" });
      const view = tracker.getView();
      expect(view.activeRuns.size).toBe(0);
      expect(view.isActive).toBe(false);
    });

    it("shows streaming text from display run", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_DELTA", runId: "r1", text: "Hello world" });
      const view = tracker.getView();
      expect(view.displayStreaming).toBe("Hello world");
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent runs
  // ---------------------------------------------------------------------------
  describe("concurrent runs", () => {
    it("tracks multiple runs simultaneously", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "ext1", sessionKey: "s1", channel: "wechat" });
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "ext2", sessionKey: "s1", channel: "telegram" });
      tracker.dispatch({ type: "LOCAL_SEND", runId: "local1", sessionKey: "s1" });
      const view = tracker.getView();
      expect(view.activeRuns.size).toBe(3);
    });

    it("finishing one run does not affect others", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "ext1", sessionKey: "s1", channel: "wechat" });
      tracker.dispatch({ type: "LOCAL_SEND", runId: "local1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "ext1" });
      const view = tracker.getView();
      expect(view.activeRuns.size).toBe(1);
      expect(view.displayPhase).toBe("processing");
      expect(view.abortTargetRunId).toBe("local1");
    });

    it("picks most recent external run when no local run", () => {
      const now = Date.now();
      vi.spyOn(Date, "now")
        .mockReturnValueOnce(now)       // ext1 startedAt
        .mockReturnValueOnce(now + 100); // ext2 startedAt
      const { tracker } = createTracker();
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "ext1", sessionKey: "s1", channel: "wechat" });
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "ext2", sessionKey: "s1", channel: "telegram" });
      vi.restoreAllMocks();
      const view = tracker.getView();
      expect(view.abortTargetRunId).toBe("ext2");
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup and reset
  // ---------------------------------------------------------------------------
  describe("cleanup", () => {
    it("removes only terminal-state runs", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "r2", sessionKey: "s1", channel: "wechat" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "r1" });
      tracker.cleanup();
      expect(tracker.isTracked("r1")).toBe(false);
      expect(tracker.isTracked("r2")).toBe(true);
    });
  });

  describe("reset", () => {
    it("clears everything", () => {
      const { tracker } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "EXTERNAL_INBOUND", runId: "r2", sessionKey: "s1", channel: "wechat" });
      tracker.reset();
      expect(tracker.isTracked("r1")).toBe(false);
      expect(tracker.isTracked("r2")).toBe(false);
      expect(tracker.getLocalRunId()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // onChange callback
  // ---------------------------------------------------------------------------
  describe("onChange", () => {
    it("fires on state change", () => {
      const { tracker, onChange } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("does not fire when action has no effect", () => {
      const { tracker, onChange } = createTracker();
      // ABORT_REQUESTED doesn't change state
      tracker.dispatch({ type: "ABORT_REQUESTED" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does not fire for TOOL_START on unknown runId", () => {
      const { tracker, onChange } = createTracker();
      tracker.dispatch({ type: "TOOL_START", runId: "unknown", toolName: "x" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // No-op actions for unknown or terminal runs
  // ---------------------------------------------------------------------------
  describe("no-op for invalid transitions", () => {
    it("LIFECYCLE_START on unknown run does nothing", () => {
      const { tracker, onChange } = createTracker();
      tracker.dispatch({ type: "LIFECYCLE_START", runId: "unknown" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("TOOL_RESULT on non-tooling run does nothing", () => {
      const { tracker, onChange } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      onChange.mockClear();
      tracker.dispatch({ type: "TOOL_RESULT", runId: "r1" }); // phase is processing, not tooling
      expect(onChange).not.toHaveBeenCalled();
    });

    it("ASSISTANT_STREAM on done run does nothing", () => {
      const { tracker, onChange } = createTracker();
      tracker.dispatch({ type: "LOCAL_SEND", runId: "r1", sessionKey: "s1" });
      tracker.dispatch({ type: "CHAT_FINAL", runId: "r1" });
      onChange.mockClear();
      tracker.dispatch({ type: "ASSISTANT_STREAM", runId: "r1" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
