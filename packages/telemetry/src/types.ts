/**
 * Represents a single telemetry event with metadata.
 * Privacy-first: no PII, no conversation content, no API keys.
 */
export interface TelemetryEvent {
  /** Event type identifier (e.g., "app.started", "rule.created") */
  eventType: string;

  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;

  /** Unique session identifier for this app run (UUID) */
  sessionId: string;

  /** Optional anonymous user identifier (e.g., SHA256 hash of MAC address) */
  userId?: string;

  /** Application version (e.g., "0.1.0") */
  version: string;

  /** Platform identifier (e.g., "darwin", "win32") */
  platform: string;

  /** Event-specific metadata (no PII allowed) */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for the RemoteTelemetryClient.
 */
export interface TelemetryConfig {
  /** Remote endpoint URL for telemetry data submission */
  endpoint: string;

  /** Number of events to batch before auto-flush (default: 10) */
  batchSize?: number;

  /** Milliseconds between auto-flush intervals (default: 30000 = 30s) */
  flushInterval?: number;

  /** Whether telemetry is enabled (user opt-in required) */
  enabled: boolean;

  /** Application version */
  version: string;

  /** Platform identifier */
  platform: string;

  /** Optional anonymous user ID */
  userId?: string;
}
