import { createLogger } from "@rivonclaw/logger";
import type { RemoteTelemetryClient } from "@rivonclaw/telemetry";

const log = createLogger("cs-telemetry");

/**
 * Module-level reference to the CS business-telemetry client.
 *
 * Set once during app bootstrap (`main.ts` → `setCsTelemetryClient`), read
 * from anywhere that needs to emit a CS BI event (the bridge/session
 * forwarding paths, and the panel-server route that relays plugin emits).
 *
 * Mirrors the pattern of `auth/session-ref.ts` and `app/storage-ref.ts` so
 * cross-module access does not require threading a dependency through every
 * constructor. Emitters are fire-and-forget but DO log — a silent drop is
 * impossible to diagnose, so every outcome (enqueued / dropped-no-client)
 * leaves a trail in the client log.
 */
let client: RemoteTelemetryClient | null = null;
let droppedCount = 0;

export function setCsTelemetryClient(instance: RemoteTelemetryClient | null): void {
  client = instance;
  log.info(`CS telemetry client ${instance ? "attached" : "detached"}`);
}

export function getCsTelemetryClient(): RemoteTelemetryClient | null {
  return client;
}

/**
 * Fire-and-forget emit. No-op when the client is missing — CS BI data is
 * statistical, not transactional; a dropped event must never block the
 * business path. Drops are counted and logged periodically so you can tell
 * the difference between "nothing emitted" and "emits silently blackholed".
 */
export type CsTelemetryEventType =
  | "cs.message"
  | "cs.token_snapshot"
  | "cs.tool_call"
  | "cs.error";

export function emitCsTelemetry(
  eventType: CsTelemetryEventType,
  metadata: Record<string, unknown>,
): void {
  if (!client) {
    droppedCount++;
    // Log the first drop loudly, then every 50th — same complaint every
    // event would flood the log but a complete silence hides a real bug.
    if (droppedCount === 1 || droppedCount % 50 === 0) {
      log.warn(
        `CS telemetry client not initialized — dropping event (${eventType}); ` +
        `total drops this session: ${droppedCount}`,
      );
    }
    return;
  }
  log.info(
    `emit ${eventType} metadata-keys=${Object.keys(metadata).join(",")} queue-after=${client.getQueueSize() + 1}`,
  );
  client.track(eventType, metadata);
}

/**
 * Closed enum of pipeline stages used as the `stage` dimension of `cs.error`.
 * Kept here so call sites can `DEBUG_STAGES.DELIVER` rather than fat-finger a
 * free-form string that would silently miss a dashboard query.
 */
export const CS_ERROR_STAGE = {
  /** Outbound message send to the platform failed (network / auth / rate limit / content rejection). */
  DELIVER: "deliver",
  /** Agent's full turn text matched a runtime-error pattern and was dropped. */
  SANITIZE: "sanitize",
  /** Gateway chat error with no agent text forwarded for the run. */
  RUN_ERROR: "run_error",
  /** Failed to dispatch the buyer message to the agent (pre-run). */
  DISPATCH: "dispatch",
  /** Backend CS session creation (balance check / server RPC) failed. */
  BACKEND_SESSION: "backend_session",
  /** Gateway-side session setup threw (e.g. shop missing runProfileId). */
  SETUP: "setup",
  /** Buyer/order context resolution failed (conversation details / orders query). */
  CONTEXT_RESOLUTION: "context_resolution",
  /** Buyer image fetch or compression failed; agent only sees the URL. */
  IMAGE_INGEST: "image_ingest",
  /** Agent invoked escalate but shop has no routing configured. */
  ESCALATE_UNCONFIGURED: "escalate_unconfigured",
  /** Relay WebSocket connect / token refresh failed. */
  RELAY_CONNECT: "relay_connect",
  /** Relay server rejected our cs_bind_shops request for one or more shops. */
  SHOP_BIND_REJECTED: "shop_bind_rejected",
} as const;

export type CsErrorStage = (typeof CS_ERROR_STAGE)[keyof typeof CS_ERROR_STAGE];

/** Cap long error strings so a runaway stack trace doesn't balloon the CH column. */
const MAX_ERROR_MESSAGE_LEN = 500;

function formatErrorMessage(err: unknown): string {
  if (!err) return "";
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > MAX_ERROR_MESSAGE_LEN ? msg.slice(0, MAX_ERROR_MESSAGE_LEN) : msg;
}

/**
 * Convenience wrapper around `emitCsTelemetry("cs.error", ...)` that fills in
 * empty-string defaults for every optional field, so CH's NOT NULL DEFAULT ''
 * columns are populated consistently regardless of what context the caller
 * has in scope.
 */
export function emitCsError(
  stage: CsErrorStage,
  fields: {
    shopId?: string;
    platformShopId?: string;
    conversationId?: string;
    runId?: string;
    platform?: string;
    reason?: string;
    errorMessage?: unknown;
    textLength?: number;
  } = {},
): void {
  emitCsTelemetry("cs.error", {
    shopId: fields.shopId ?? "",
    platformShopId: fields.platformShopId ?? "",
    conversationId: fields.conversationId ?? "",
    runId: fields.runId ?? "",
    platform: fields.platform ?? "",
    stage,
    reason: fields.reason ?? "",
    errorMessage: formatErrorMessage(fields.errorMessage),
    textLength: fields.textLength ?? 0,
  });
}
