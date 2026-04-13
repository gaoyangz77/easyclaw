import { types, type Instance } from "mobx-state-tree";
import type { RunSource, RunPhase } from "../../run-tracker.js";

// ---------------------------------------------------------------------------
// Active phase set — phases that represent an in-progress run
// ---------------------------------------------------------------------------

const ACTIVE_PHASES = new Set<RunPhase>(["queued", "processing", "awaiting_llm", "tooling", "generating"]);

// ---------------------------------------------------------------------------
// RunEntryModel — per-run mutable state within the MST tree
// ---------------------------------------------------------------------------

export const RunEntryModel = types
  .model("RunEntry", {
    runId: types.identifier,
    source: types.string,     // RunSource
    sessionKey: types.string,
    phase: types.string,      // RunPhase
    toolName: types.maybeNull(types.string),
    streaming: types.maybeNull(types.string),
    /**
     * Cumulative character offset of streaming text that has been flushed
     * (committed as a message bubble) across tool-call boundaries.
     * When the gateway sends accumulated text across an entire agent turn,
     * this offset is used to slice off already-committed content so that
     * the streaming bubble and final commit only show new text.
     */
    flushedOffset: 0,
    startedAt: types.number,
  });

export type IRunEntry = Instance<typeof RunEntryModel>;

// ---------------------------------------------------------------------------
// ChatRunStateModel — true source of truth for run lifecycle state
// ---------------------------------------------------------------------------

/**
 * Per-session run state model.  This is the authoritative owner of run
 * lifecycle data — phase transitions, streaming text, flushed offsets,
 * recently-completed tracking, and display derivation all live here.
 *
 * Timers (FINAL_FALLBACK, recently-completed TTL) are side effects owned
 * by ChatGatewayController, which calls actions on this model when they fire.
 *
 * Components observe this model's views for reactive rendering.
 */
export const ChatRunStateModel = types
  .model("ChatRunState", {
    runs: types.map(RunEntryModel),
    localRunId: types.maybeNull(types.string),
    recentlyCompletedIds: types.array(types.string),

    // Lifecycle tracking (controller sets these for reactivity)
    externalPending: false,
    lastAgentStream: types.maybeNull(types.string),
    lastActivityAt: 0,
    sendStartedAt: 0,
  })
  .views((self) => ({
    /** Whether any run is in an active (non-terminal) phase. */
    get isActive(): boolean {
      for (const run of self.runs.values()) {
        if (ACTIVE_PHASES.has(run.phase as RunPhase)) return true;
      }
      return false;
    },

    /**
     * The "display" run — local run prioritised, then most-recently-started
     * external run.  Only active runs are candidates.
     */
    get displayRun(): IRunEntry | null {
      // Local run first
      if (self.localRunId) {
        const local = self.runs.get(self.localRunId);
        if (local && ACTIVE_PHASES.has(local.phase as RunPhase)) return local;
      }
      // Fall back to most-recently-started active external run
      let latest: IRunEntry | null = null;
      for (const run of self.runs.values()) {
        if (!ACTIVE_PHASES.has(run.phase as RunPhase)) continue;
        if (!latest || run.startedAt > latest.startedAt) latest = run;
      }
      return latest;
    },

    /** Phase to display (from display run). */
    get displayPhase(): RunPhase | null {
      const dr = this.displayRun;
      return dr ? (dr.phase as RunPhase) : null;
    },

    /** Tool name when displayPhase === "tooling". */
    get displayToolName(): string | null {
      const dr = this.displayRun;
      if (!dr || dr.phase !== "tooling") return null;
      return dr.toolName ?? null;
    },

    /** Streaming text buffer of the display run (sliced to exclude flushed content). */
    get displayStreaming(): string | null {
      const dr = this.displayRun;
      if (!dr || !dr.streaming) return null;
      return dr.flushedOffset > 0 ? dr.streaming.slice(dr.flushedOffset) : dr.streaming;
    },

    /**
     * Cumulative flushed offset for the display run.  Used by the CHAT_FINAL
     * handler to strip already-committed text from the final message.
     */
    get displayFlushedOffset(): number {
      const dr = this.displayRun;
      return dr?.flushedOffset ?? 0;
    },

    /** Whether the stop button should be enabled. */
    get canAbort(): boolean {
      return this.abortTargetRunId !== null;
    },

    /** runId to pass to chat.abort — local run first, then display run. */
    get abortTargetRunId(): string | null {
      // Local run first
      if (self.localRunId) {
        const local = self.runs.get(self.localRunId);
        if (local && ACTIVE_PHASES.has(local.phase as RunPhase)) return local.runId;
      }
      // Fall back to display run
      const dr = this.displayRun;
      return dr?.runId ?? null;
    },

    /** Local run ID — only if the local run is active. */
    get activeLocalRunId(): string | null {
      if (!self.localRunId) return null;
      const local = self.runs.get(self.localRunId);
      if (!local || !ACTIVE_PHASES.has(local.phase as RunPhase)) return null;
      return self.localRunId;
    },

    /** Streaming text of the local run (null if no active local run or no text yet). */
    get localStreaming(): string | null {
      if (!self.localRunId) return null;
      const local = self.runs.get(self.localRunId);
      if (!local || !ACTIVE_PHASES.has(local.phase as RunPhase)) return null;
      return local.streaming ?? null;
    },

    /** Check whether a runId is being tracked (active or terminal). */
    isTracked(runId: string): boolean {
      return self.runs.has(runId);
    },

    /** Check whether a runId was recently completed (within the TTL window). */
    isRecentlyCompleted(runId: string): boolean {
      return self.recentlyCompletedIds.includes(runId);
    },
  }))
  .actions((self) => ({
    // --- Run lifecycle actions (replaces RunTracker.dispatch) ---

    beginLocalRun(runId: string, sessionKey: string) {
      self.localRunId = runId;
      self.runs.put({
        runId,
        source: "local" as RunSource,
        sessionKey,
        phase: "processing" as RunPhase,
        toolName: null,
        streaming: null,
        flushedOffset: 0,
        startedAt: Date.now(),
      });
    },

    beginExternalRun(runId: string, sessionKey: string, source: RunSource) {
      self.runs.put({
        runId,
        source,
        sessionKey,
        phase: "queued" as RunPhase,
        toolName: null,
        streaming: null,
        flushedOffset: 0,
        startedAt: Date.now(),
      });
    },

    /** Transition a run into tooling phase.  Flushes streaming → flushedOffset. */
    startTool(runId: string, toolName: string) {
      const run = self.runs.get(runId);
      if (!run || !ACTIVE_PHASES.has(run.phase as RunPhase)) return;
      // Accumulate flushed offset from streaming text
      if (run.streaming) {
        run.flushedOffset = run.streaming.length;
      }
      run.phase = "tooling";
      run.toolName = toolName;
      run.streaming = null;
    },

    /** Transition from tooling → awaiting_llm when tool completes. */
    finishTool(runId: string) {
      const run = self.runs.get(runId);
      if (!run || run.phase !== "tooling") return;
      run.phase = "awaiting_llm";
      run.toolName = null;
    },

    /** Transition queued/processing → awaiting_llm on lifecycle start. */
    markLifecycleStart(runId: string) {
      const run = self.runs.get(runId);
      if (!run) return;
      if (run.phase === "queued" || run.phase === "processing") {
        run.phase = "awaiting_llm";
      }
    },

    /** Transition to generating on assistant stream event. */
    markAssistantStream(runId: string) {
      const run = self.runs.get(runId);
      if (!run || !ACTIVE_PHASES.has(run.phase as RunPhase)) return;
      // Do not promote out of tooling — assistant stream during tool use is ignored
      if (run.phase === "tooling") return;
      run.phase = "generating";
    },

    /** Append/replace streaming text delta. */
    appendDelta(runId: string, text: string) {
      const run = self.runs.get(runId);
      if (!run || !ACTIVE_PHASES.has(run.phase as RunPhase)) return;
      run.streaming = text;
      // Promote to generating if still waiting (race: delta before assistant stream)
      if (run.phase === "queued" || run.phase === "awaiting_llm") {
        run.phase = "generating";
      }
    },

    /** Terminal: run completed successfully. */
    finalizeRun(runId: string) {
      const run = self.runs.get(runId);
      if (!run) return;
      run.phase = "done";
      run.toolName = null;
      if (self.localRunId === runId) self.localRunId = null;
    },

    /** Terminal: run failed with error. */
    failRun(runId: string) {
      const run = self.runs.get(runId);
      if (!run) return;
      run.phase = "error";
      run.toolName = null;
      if (self.localRunId === runId) self.localRunId = null;
    },

    /** Terminal: run was aborted by user. */
    abortRun(runId: string) {
      const run = self.runs.get(runId);
      if (!run) return;
      run.phase = "aborted";
      run.toolName = null;
      if (self.localRunId === runId) self.localRunId = null;
    },

    /** Fallback terminal: force-transition active run to done. */
    forceDone(runId: string) {
      const run = self.runs.get(runId);
      if (!run || !ACTIVE_PHASES.has(run.phase as RunPhase)) return;
      run.phase = "done";
      run.toolName = null;
      if (self.localRunId === runId) self.localRunId = null;
    },

    /** Mark a runId as recently completed for phantom run suppression. */
    markRecentlyCompleted(runId: string) {
      if (!self.recentlyCompletedIds.includes(runId)) {
        self.recentlyCompletedIds.push(runId);
      }
    },

    /** Clear a runId from the recently-completed set. */
    clearRecentlyCompleted(runId: string) {
      const idx = self.recentlyCompletedIds.indexOf(runId);
      if (idx !== -1) self.recentlyCompletedIds.splice(idx, 1);
    },

    /** Remove all terminal-state runs from the map. Returns the removed runIds. */
    cleanupTerminalRuns(): string[] {
      const removed: string[] = [];
      for (const [id, run] of self.runs) {
        if (!ACTIVE_PHASES.has(run.phase as RunPhase)) {
          removed.push(id);
        }
      }
      for (const id of removed) {
        self.runs.delete(id);
        if (self.localRunId === id) self.localRunId = null;
      }
      return removed;
    },

    /**
     * Update the flushed offset for a run.  Called when the async history-patch
     * mechanism recovers additional characters that were still in the gateway's
     * throttle buffer at the time of tool_start.
     */
    updateFlushedOffset(runId: string, newOffset: number) {
      const run = self.runs.get(runId);
      if (run && newOffset > run.flushedOffset) {
        run.flushedOffset = newOffset;
      }
    },

    /** Get a specific run's snapshot for external reading. */
    getRun(runId: string) {
      return self.runs.get(runId) ?? null;
    },

    // --- Lifecycle tracking ---

    setExternalPending(v: boolean) {
      self.externalPending = v;
    },
    setLastAgentStream(v: string | null) {
      self.lastAgentStream = v;
    },
    setLastActivity(ts: number) {
      self.lastActivityAt = ts;
    },
    setSendStartedAt(ts: number) {
      self.sendStartedAt = ts;
    },

    // --- Full reset ---

    /** Clear all run state. Called on disconnect, session reset, watchdog timeout. */
    resetAll() {
      self.runs.clear();
      self.localRunId = null;
      self.recentlyCompletedIds.clear();
      self.externalPending = false;
      self.lastAgentStream = null;
      self.lastActivityAt = 0;
      self.sendStartedAt = 0;
    },
  }));

export type IChatRunState = Instance<typeof ChatRunStateModel>;
