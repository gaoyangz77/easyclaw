/**
 * @easyclaw/telemetry
 *
 * Privacy-first telemetry client for EasyClaw desktop application.
 *
 * Features:
 * - Batch upload (10 events or 30s, whichever comes first)
 * - Retry logic with exponential backoff
 * - In-memory queue management
 * - Runtime tracking
 * - User opt-in required
 * - No PII collection
 *
 * @packageDocumentation
 */

export { RemoteTelemetryClient } from "./client.js";
export type { TelemetryEvent, TelemetryConfig } from "./types.js";
