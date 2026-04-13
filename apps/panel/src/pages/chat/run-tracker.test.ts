import { describe, it, expect, vi } from "vitest";
import { ChatRunStateModel } from "./store/models/ChatRunStateModel.js";
import type { IChatRunState } from "./store/models/ChatRunStateModel.js";

function createRunState(): IChatRunState {
  return ChatRunStateModel.create({});
}

describe("ChatRunStateModel", () => {
  // ---------------------------------------------------------------------------
  // beginLocalRun (was LOCAL_SEND)
  // ---------------------------------------------------------------------------
  describe("beginLocalRun", () => {
    it("creates a run in processing phase", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      const run = rs.getRun("r1");
      expect(run).not.toBeNull();
      expect(run!.phase).toBe("processing");
      expect(run!.source).toBe("local");
      expect(rs.localRunId).toBe("r1");
    });
  });

  // ---------------------------------------------------------------------------
  // beginExternalRun (was EXTERNAL_INBOUND)
  // ---------------------------------------------------------------------------
  describe("beginExternalRun", () => {
    it("creates a run in queued phase", () => {
      const rs = createRunState();
      rs.beginExternalRun("r1", "s1", "wechat");
      const run = rs.getRun("r1");
      expect(run).not.toBeNull();
      expect(run!.phase).toBe("queued");
      expect(run!.source).toBe("wechat");
    });

    it("maps telegram source", () => {
      const rs = createRunState();
      rs.beginExternalRun("r1", "s1", "telegram");
      expect(rs.getRun("r1")!.source).toBe("telegram");
    });

    it("maps unknown source", () => {
      const rs = createRunState();
      rs.beginExternalRun("r1", "s1", "unknown");
      expect(rs.getRun("r1")!.source).toBe("unknown");
    });
  });

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------
  describe("state transitions", () => {
    it("queued -> awaiting_llm on markLifecycleStart", () => {
      const rs = createRunState();
      rs.beginExternalRun("r1", "s1", "wechat");
      rs.markLifecycleStart("r1");
      expect(rs.getRun("r1")!.phase).toBe("awaiting_llm");
    });

    it("processing -> tooling on startTool", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.startTool("r1", "browser");
      const run = rs.getRun("r1")!;
      expect(run.phase).toBe("tooling");
      expect(run.toolName).toBe("browser");
    });

    it("tooling -> awaiting_llm on finishTool", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.startTool("r1", "browser");
      rs.finishTool("r1");
      const run = rs.getRun("r1")!;
      expect(run.phase).toBe("awaiting_llm");
      expect(run.toolName).toBeNull();
    });

    it("processing -> generating on markAssistantStream", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.markAssistantStream("r1");
      expect(rs.getRun("r1")!.phase).toBe("generating");
    });

    it("tooling does NOT transition to generating on markAssistantStream", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.startTool("r1", "browser");
      rs.markAssistantStream("r1");
      expect(rs.getRun("r1")!.phase).toBe("tooling");
    });

    it("generating -> tooling on startTool", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.markAssistantStream("r1");
      rs.startTool("r1", "exec");
      expect(rs.getRun("r1")!.phase).toBe("tooling");
    });

    it("processing -> awaiting_llm on markLifecycleStart", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.markLifecycleStart("r1");
      expect(rs.getRun("r1")!.phase).toBe("awaiting_llm");
    });

    it("awaiting_llm -> generating on markAssistantStream", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.markLifecycleStart("r1");
      rs.markAssistantStream("r1");
      expect(rs.getRun("r1")!.phase).toBe("generating");
    });

    it("awaiting_llm -> generating on appendDelta", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.markLifecycleStart("r1");
      rs.appendDelta("r1", "hi");
      expect(rs.getRun("r1")!.phase).toBe("generating");
    });

    it("queued -> generating on appendDelta (race condition)", () => {
      const rs = createRunState();
      rs.beginExternalRun("r1", "s1", "wechat");
      rs.appendDelta("r1", "hello");
      const run = rs.getRun("r1")!;
      expect(run.phase).toBe("generating");
      expect(run.streaming).toBe("hello");
    });
  });

  // ---------------------------------------------------------------------------
  // Terminal states
  // ---------------------------------------------------------------------------
  describe("terminal states", () => {
    it("finalizeRun -> done", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      expect(rs.getRun("r1")!.phase).toBe("done");
      expect(rs.localRunId).toBeNull();
    });

    it("failRun -> error", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.failRun("r1");
      expect(rs.getRun("r1")!.phase).toBe("error");
      expect(rs.localRunId).toBeNull();
    });

    it("abortRun -> aborted", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.abortRun("r1");
      expect(rs.getRun("r1")!.phase).toBe("aborted");
      expect(rs.localRunId).toBeNull();
    });

    it("finalizeRun clears toolName", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.startTool("r1", "browser");
      rs.finalizeRun("r1");
      expect(rs.getRun("r1")!.toolName).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // appendDelta (was CHAT_DELTA)
  // ---------------------------------------------------------------------------
  describe("appendDelta", () => {
    it("updates streaming text without changing phase", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.markAssistantStream("r1");
      rs.appendDelta("r1", "Hello");
      const run = rs.getRun("r1")!;
      expect(run.phase).toBe("generating");
      expect(run.streaming).toBe("Hello");
    });

    it("does not update terminal-state runs", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      rs.appendDelta("r1", "late");
      expect(rs.getRun("r1")!.streaming).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // cleanupTerminalRuns (was RUN_CLEANUP)
  // ---------------------------------------------------------------------------
  describe("cleanupTerminalRuns", () => {
    it("removes only terminal-state runs", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.beginExternalRun("r2", "s1", "wechat");
      rs.finalizeRun("r1");
      rs.cleanupTerminalRuns();
      expect(rs.isTracked("r1")).toBe(false);
      expect(rs.isTracked("r2")).toBe(true);
    });

    it("returns removed runIds", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      const removed = rs.cleanupTerminalRuns();
      expect(removed).toEqual(["r1"]);
    });
  });

  // ---------------------------------------------------------------------------
  // isTracked
  // ---------------------------------------------------------------------------
  describe("isTracked", () => {
    it("returns true for active run", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      expect(rs.isTracked("r1")).toBe(true);
    });

    it("returns true for terminal-state run (not yet cleaned up)", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      expect(rs.isTracked("r1")).toBe(true);
    });

    it("returns false for unknown runId", () => {
      const rs = createRunState();
      expect(rs.isTracked("unknown")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Views (was getView)
  // ---------------------------------------------------------------------------
  describe("views", () => {
    it("returns idle view when no runs", () => {
      const rs = createRunState();
      expect(rs.isActive).toBe(false);
      expect(rs.displayPhase).toBeNull();
      expect(rs.displayToolName).toBeNull();
      expect(rs.displayStreaming).toBeNull();
      expect(rs.canAbort).toBe(false);
      expect(rs.abortTargetRunId).toBeNull();
    });

    it("shows local run phase", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      expect(rs.isActive).toBe(true);
      expect(rs.displayPhase).toBe("processing");
      expect(rs.canAbort).toBe(true);
      expect(rs.abortTargetRunId).toBe("r1");
    });

    it("shows tool name when tooling", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.startTool("r1", "browser");
      expect(rs.displayPhase).toBe("tooling");
      expect(rs.displayToolName).toBe("browser");
    });

    it("does not show toolName when not tooling", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      expect(rs.displayToolName).toBeNull();
    });

    it("prioritises local run over external run", () => {
      const rs = createRunState();
      rs.beginExternalRun("ext1", "s1", "wechat");
      rs.beginLocalRun("local1", "s1");
      expect(rs.displayPhase).toBe("processing"); // local
      expect(rs.abortTargetRunId).toBe("local1");
    });

    it("falls back to external run when no local run", () => {
      const rs = createRunState();
      rs.beginExternalRun("ext1", "s1", "wechat");
      expect(rs.displayPhase).toBe("queued");
      expect(rs.canAbort).toBe(true);
      expect(rs.abortTargetRunId).toBe("ext1");
    });

    it("excludes terminal-state runs from isActive", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      expect(rs.isActive).toBe(false);
    });

    it("shows streaming text from display run", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "Hello world");
      expect(rs.displayStreaming).toBe("Hello world");
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent runs
  // ---------------------------------------------------------------------------
  describe("concurrent runs", () => {
    it("tracks multiple runs simultaneously", () => {
      const rs = createRunState();
      rs.beginExternalRun("ext1", "s1", "wechat");
      rs.beginExternalRun("ext2", "s1", "telegram");
      rs.beginLocalRun("local1", "s1");
      // Count active runs
      let activeCount = 0;
      for (const run of rs.runs.values()) {
        if (["queued", "processing", "awaiting_llm", "tooling", "generating"].includes(run.phase)) {
          activeCount++;
        }
      }
      expect(activeCount).toBe(3);
    });

    it("finishing one run does not affect others", () => {
      const rs = createRunState();
      rs.beginExternalRun("ext1", "s1", "wechat");
      rs.beginLocalRun("local1", "s1");
      rs.finalizeRun("ext1");
      expect(rs.isActive).toBe(true);
      expect(rs.displayPhase).toBe("processing");
      expect(rs.abortTargetRunId).toBe("local1");
    });

    it("picks most recent external run when no local run", () => {
      const now = Date.now();
      vi.spyOn(Date, "now")
        .mockReturnValueOnce(now)       // ext1 startedAt
        .mockReturnValueOnce(now + 100); // ext2 startedAt
      const rs = createRunState();
      rs.beginExternalRun("ext1", "s1", "wechat");
      rs.beginExternalRun("ext2", "s1", "telegram");
      vi.restoreAllMocks();
      expect(rs.abortTargetRunId).toBe("ext2");
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup and reset
  // ---------------------------------------------------------------------------
  describe("cleanupTerminalRuns", () => {
    it("removes only terminal-state runs", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.beginExternalRun("r2", "s1", "wechat");
      rs.finalizeRun("r1");
      rs.cleanupTerminalRuns();
      expect(rs.isTracked("r1")).toBe(false);
      expect(rs.isTracked("r2")).toBe(true);
    });
  });

  describe("resetAll", () => {
    it("clears everything", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.beginExternalRun("r2", "s1", "wechat");
      rs.resetAll();
      expect(rs.isTracked("r1")).toBe(false);
      expect(rs.isTracked("r2")).toBe(false);
      expect(rs.localRunId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // TOOL_START clears streaming
  // ---------------------------------------------------------------------------
  describe("startTool clears streaming", () => {
    it("clears streaming text when entering tooling phase", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "partial text");
      expect(rs.getRun("r1")!.streaming).toBe("partial text");

      rs.startTool("r1", "browser");
      expect(rs.getRun("r1")!.streaming).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // flushedOffset — deduplication across tool-call boundaries
  // ---------------------------------------------------------------------------
  describe("flushedOffset", () => {
    it("starts at 0", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      expect(rs.getRun("r1")!.flushedOffset).toBe(0);
    });

    it("records streaming length on startTool", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "Hello world");
      rs.startTool("r1", "browser");
      expect(rs.getRun("r1")!.flushedOffset).toBe(11); // "Hello world".length
    });

    it("accumulates across multiple tool calls", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      // First generation: 10 chars
      rs.appendDelta("r1", "0123456789");
      rs.startTool("r1", "tool1");
      expect(rs.getRun("r1")!.flushedOffset).toBe(10);

      // After tool completes, new accumulated text includes old + new
      rs.finishTool("r1");
      rs.appendDelta("r1", "0123456789ABCDE"); // 15 chars total
      rs.startTool("r1", "tool2");
      expect(rs.getRun("r1")!.flushedOffset).toBe(15);
    });

    it("does not change flushedOffset when no streaming text at startTool", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      // startTool without any prior appendDelta
      rs.startTool("r1", "browser");
      expect(rs.getRun("r1")!.flushedOffset).toBe(0);
    });

    it("displayStreaming slices off flushed prefix", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "pre-tool");
      rs.startTool("r1", "browser");
      rs.finishTool("r1");
      // Gateway sends accumulated text: pre-tool + new content
      rs.appendDelta("r1", "pre-toolNEW CONTENT");

      expect(rs.displayStreaming).toBe("NEW CONTENT");
      expect(rs.displayFlushedOffset).toBe(8); // "pre-tool".length
    });

    it("displayFlushedOffset is 0 when no tools used", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "Hello");
      expect(rs.displayStreaming).toBe("Hello");
      expect(rs.displayFlushedOffset).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // updateFlushedOffset
  // ---------------------------------------------------------------------------
  describe("updateFlushedOffset", () => {
    it("increases flushed offset when patched text is longer", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "partial");
      rs.startTool("r1", "browser");
      expect(rs.getRun("r1")!.flushedOffset).toBe(7); // "partial".length

      // History patch recovered more text
      rs.updateFlushedOffset("r1", 20);
      expect(rs.getRun("r1")!.flushedOffset).toBe(20);
    });

    it("does not decrease flushed offset", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "1234567890");
      rs.startTool("r1", "browser");
      expect(rs.getRun("r1")!.flushedOffset).toBe(10);

      rs.updateFlushedOffset("r1", 5);
      expect(rs.getRun("r1")!.flushedOffset).toBe(10); // stays at 10
    });

    it("is a no-op for unknown runs", () => {
      const rs = createRunState();
      // Should not throw
      rs.updateFlushedOffset("unknown", 100);
    });
  });

  // ---------------------------------------------------------------------------
  // Views — activeLocalRunId and localStreaming
  // ---------------------------------------------------------------------------
  describe("activeLocalRunId / localStreaming", () => {
    it("returns activeLocalRunId and localStreaming for active local run", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "hi");
      expect(rs.activeLocalRunId).toBe("r1");
      expect(rs.localStreaming).toBe("hi");
    });

    it("returns null activeLocalRunId when local run is terminal", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      expect(rs.activeLocalRunId).toBeNull();
      expect(rs.localStreaming).toBeNull();
    });

    it("returns null when no local run exists", () => {
      const rs = createRunState();
      rs.beginExternalRun("ext1", "s1", "wechat");
      expect(rs.activeLocalRunId).toBeNull();
      expect(rs.localStreaming).toBeNull();
    });

    it("returns null localStreaming when local run has no streaming text", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      expect(rs.activeLocalRunId).toBe("r1");
      expect(rs.localStreaming).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // No-op actions for unknown or terminal runs
  // ---------------------------------------------------------------------------
  describe("no-op for invalid transitions", () => {
    it("markLifecycleStart on unknown run does nothing", () => {
      const rs = createRunState();
      // Should not throw
      rs.markLifecycleStart("unknown");
      expect(rs.runs.size).toBe(0);
    });

    it("finishTool on non-tooling run does nothing", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finishTool("r1"); // phase is processing, not tooling
      expect(rs.getRun("r1")!.phase).toBe("processing");
    });

    it("markAssistantStream on done run does nothing", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      rs.markAssistantStream("r1");
      expect(rs.getRun("r1")!.phase).toBe("done");
    });

    it("startTool on unknown runId does nothing", () => {
      const rs = createRunState();
      rs.startTool("unknown", "x");
      expect(rs.runs.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // forceDone (fallback terminal transition — timer logic in controller)
  // ---------------------------------------------------------------------------
  describe("forceDone", () => {
    it("transitions active run to done", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.markAssistantStream("r1");
      expect(rs.getRun("r1")!.phase).toBe("generating");

      rs.forceDone("r1");
      expect(rs.getRun("r1")!.phase).toBe("done");
      expect(rs.localRunId).toBeNull();
    });

    it("clears toolName when force-done from tooling", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.startTool("r1", "browser");
      expect(rs.getRun("r1")!.toolName).toBe("browser");

      rs.forceDone("r1");
      expect(rs.getRun("r1")!.toolName).toBeNull();
      expect(rs.getRun("r1")!.phase).toBe("done");
    });

    it("does nothing for already-terminal runs", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");

      rs.forceDone("r1");
      expect(rs.getRun("r1")!.phase).toBe("done");
    });

    it("does nothing for unknown runId", () => {
      const rs = createRunState();
      rs.forceDone("unknown");
      expect(rs.runs.size).toBe(0);
    });

    it("transitions all active phases to done", () => {
      const phases = ["queued", "processing", "awaiting_llm", "tooling", "generating"] as const;
      for (const phase of phases) {
        const rs = createRunState();
        // Set up a run and manipulate it to the desired phase
        if (phase === "queued") {
          rs.beginExternalRun("r1", "s1", "wechat");
        } else {
          rs.beginLocalRun("r1", "s1");
          if (phase === "awaiting_llm") {
            rs.markLifecycleStart("r1");
          } else if (phase === "tooling") {
            rs.startTool("r1", "t");
          } else if (phase === "generating") {
            rs.markAssistantStream("r1");
          }
          // "processing" is the initial state for beginLocalRun, no extra action needed
        }

        expect(rs.getRun("r1")!.phase).toBe(phase);
        rs.forceDone("r1");
        expect(rs.getRun("r1")!.phase).toBe("done");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // recentlyCompleted (phantom run suppression — timer logic in controller)
  // ---------------------------------------------------------------------------
  describe("recentlyCompleted", () => {
    it("marks run as recently completed", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      rs.markRecentlyCompleted("r1");
      rs.cleanupTerminalRuns();

      // Run is no longer tracked but is recently completed
      expect(rs.isTracked("r1")).toBe(false);
      expect(rs.isRecentlyCompleted("r1")).toBe(true);
    });

    it("clearRecentlyCompleted removes the runId", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      rs.markRecentlyCompleted("r1");

      expect(rs.isRecentlyCompleted("r1")).toBe(true);
      rs.clearRecentlyCompleted("r1");
      expect(rs.isRecentlyCompleted("r1")).toBe(false);
    });

    it("marks run as recently completed on finalizeRun (via markRecentlyCompleted)", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      rs.markRecentlyCompleted("r1");

      // Still tracked (not yet cleaned up) but also recently completed
      expect(rs.isTracked("r1")).toBe(true);
      expect(rs.isRecentlyCompleted("r1")).toBe(true);
    });

    it("works for failRun", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.failRun("r1");
      rs.markRecentlyCompleted("r1");
      rs.cleanupTerminalRuns();

      expect(rs.isTracked("r1")).toBe(false);
      expect(rs.isRecentlyCompleted("r1")).toBe(true);
    });

    it("works for abortRun", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.abortRun("r1");
      rs.markRecentlyCompleted("r1");
      rs.cleanupTerminalRuns();

      expect(rs.isTracked("r1")).toBe(false);
      expect(rs.isRecentlyCompleted("r1")).toBe(true);
    });

    it("works for forceDone", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.forceDone("r1");
      rs.markRecentlyCompleted("r1");
      rs.cleanupTerminalRuns();

      expect(rs.isTracked("r1")).toBe(false);
      expect(rs.isRecentlyCompleted("r1")).toBe(true);
    });

    it("resetAll clears recently completed state", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      rs.markRecentlyCompleted("r1");
      rs.cleanupTerminalRuns();

      expect(rs.isRecentlyCompleted("r1")).toBe(true);

      rs.resetAll();
      expect(rs.isRecentlyCompleted("r1")).toBe(false);
    });

    it("returns false for unknown runId", () => {
      const rs = createRunState();
      expect(rs.isRecentlyCompleted("unknown")).toBe(false);
    });

    it("does not duplicate when markRecentlyCompleted is called twice", () => {
      const rs = createRunState();
      rs.markRecentlyCompleted("r1");
      rs.markRecentlyCompleted("r1");
      expect(rs.recentlyCompletedIds.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle tracking fields
  // ---------------------------------------------------------------------------
  describe("lifecycle tracking", () => {
    it("setExternalPending / setLastAgentStream / setLastActivity / setSendStartedAt", () => {
      const rs = createRunState();
      rs.setExternalPending(true);
      expect(rs.externalPending).toBe(true);
      rs.setLastAgentStream("tool");
      expect(rs.lastAgentStream).toBe("tool");
      rs.setLastActivity(12345);
      expect(rs.lastActivityAt).toBe(12345);
      rs.setSendStartedAt(67890);
      expect(rs.sendStartedAt).toBe(67890);
    });

    it("resetAll clears lifecycle tracking fields", () => {
      const rs = createRunState();
      rs.setExternalPending(true);
      rs.setLastAgentStream("assistant");
      rs.setLastActivity(99999);
      rs.setSendStartedAt(88888);
      rs.resetAll();
      expect(rs.externalPending).toBe(false);
      expect(rs.lastAgentStream).toBeNull();
      expect(rs.lastActivityAt).toBe(0);
      expect(rs.sendStartedAt).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases — multiple operations
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    it("beginLocalRun replaces previous local run reference", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.beginLocalRun("r2", "s1");
      expect(rs.localRunId).toBe("r2");
      // Both runs exist
      expect(rs.isTracked("r1")).toBe(true);
      expect(rs.isTracked("r2")).toBe(true);
    });

    it("finalizeRun on non-local run does not clear localRunId", () => {
      const rs = createRunState();
      rs.beginLocalRun("local1", "s1");
      rs.beginExternalRun("ext1", "s1", "wechat");
      rs.finalizeRun("ext1");
      expect(rs.localRunId).toBe("local1");
    });

    it("appendDelta does not affect terminal runs", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.appendDelta("r1", "initial");
      rs.finalizeRun("r1");
      rs.appendDelta("r1", "should-not-apply");
      expect(rs.getRun("r1")!.streaming).toBe("initial");
    });

    it("startTool on terminal run does nothing", () => {
      const rs = createRunState();
      rs.beginLocalRun("r1", "s1");
      rs.finalizeRun("r1");
      rs.startTool("r1", "browser");
      expect(rs.getRun("r1")!.phase).toBe("done");
    });
  });
});
