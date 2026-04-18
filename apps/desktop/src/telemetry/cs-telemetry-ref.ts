import type { RemoteTelemetryClient } from "@rivonclaw/telemetry";

/**
 * Module-level reference to the CS business-telemetry client.
 *
 * Set once during app bootstrap (`main.ts` → `setCsTelemetryClient`), read
 * from anywhere that needs to emit a CS BI event (the bridge/session
 * forwarding paths, and the panel-server route that relays plugin emits).
 *
 * Mirrors the pattern of `auth/session-ref.ts` and `app/storage-ref.ts` so
 * cross-module access does not require threading a dependency through every
 * constructor. Emitters are fire-and-forget; reading `null` simply drops
 * the event (unit tests / headless runs without telemetry init).
 */
let client: RemoteTelemetryClient | null = null;

export function setCsTelemetryClient(instance: RemoteTelemetryClient | null): void {
  client = instance;
}

export function getCsTelemetryClient(): RemoteTelemetryClient | null {
  return client;
}

/**
 * Fire-and-forget emit. Silent no-op when the client is missing — CS BI
 * data is statistical, not transactional; a dropped event must never block
 * the business path. Any internal client-side error is already logged by
 * `RemoteTelemetryClient.flush`.
 */
export function emitCsTelemetry(
  eventType: "cs.message" | "cs.token_snapshot" | "cs.tool_call",
  metadata: Record<string, unknown>,
): void {
  client?.track(eventType, metadata);
}
