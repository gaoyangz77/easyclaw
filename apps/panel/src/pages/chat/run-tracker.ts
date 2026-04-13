/**
 * Run lifecycle types, constants, and helpers.
 *
 * The actual state machine lives in ChatRunStateModel (MST).  This module
 * provides the shared type definitions consumed by the bridge, controller,
 * and tests.
 *
 * See ADR-022 for design rationale.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunPhase =
  | "queued"
  | "processing"
  | "awaiting_llm"
  | "tooling"
  | "generating"
  | "done"
  | "error"
  | "aborted";

export const ACTIVE_PHASES = new Set<RunPhase>(["queued", "processing", "awaiting_llm", "tooling", "generating"]);

export type RunSource = "local" | "wechat" | "telegram" | "unknown";

// ---------------------------------------------------------------------------
// Actions — dispatched by SSE bridge, translated by controller into MST calls
// ---------------------------------------------------------------------------

export type RunAction =
  // SSE bridge (panel-server -> chat page)
  | { type: "TOOL_START"; runId: string; toolName: string }
  | { type: "TOOL_RESULT"; runId: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to wait after LIFECYCLE_END before force-transitioning to done. */
export const FINAL_FALLBACK_MS = 5_000;

/** How long a completed runId stays in the "recently completed" set to suppress phantom runs. */
export const RECENTLY_COMPLETED_TTL_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function channelToSource(channel: string): RunSource {
  if (channel === "wechat") return "wechat";
  if (channel === "telegram") return "telegram";
  return "unknown";
}
