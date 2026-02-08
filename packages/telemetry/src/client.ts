import { randomUUID } from "node:crypto";
import type { TelemetryConfig, TelemetryEvent } from "./types.js";

/**
 * RemoteTelemetryClient sends telemetry events to a remote endpoint.
 *
 * Features:
 * - Batch upload (collect N events or wait M seconds, whichever comes first)
 * - Retry logic with exponential backoff (3 attempts)
 * - In-memory queue management
 * - Runtime tracking (start time, uptime calculation)
 * - Graceful shutdown with flush
 * - Privacy-first: no PII, user opt-in required
 */
export class RemoteTelemetryClient {
  private readonly config: Required<TelemetryConfig>;
  private readonly sessionId: string;
  private readonly startTime: number;
  private readonly queue: TelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(config: TelemetryConfig) {
    // Normalize config with defaults
    this.config = {
      ...config,
      batchSize: config.batchSize ?? 10,
      flushInterval: config.flushInterval ?? 30000, // 30s
    };

    // Generate unique session ID for this app run
    this.sessionId = randomUUID();
    this.startTime = Date.now();

    // Start auto-flush timer if enabled
    if (this.config.enabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Track an event by queueing it for batch upload.
   *
   * @param eventType - Event type identifier (e.g., "app.started")
   * @param metadata - Event-specific metadata (no PII)
   */
  track(eventType: string, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled || this.isShuttingDown) {
      return;
    }

    const event: TelemetryEvent = {
      eventType,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userId: this.config.userId,
      version: this.config.version,
      platform: this.config.platform,
      metadata,
    };

    this.queue.push(event);

    // Auto-flush if batch size reached
    if (this.queue.length >= this.config.batchSize) {
      // Don't await to avoid blocking caller
      void this.flush();
    }
  }

  /**
   * Send all queued events to the remote endpoint.
   * Uses exponential backoff retry logic (3 attempts).
   *
   * @returns Promise that resolves when flush completes
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    // Take a snapshot of the queue and clear it
    const eventsToSend = [...this.queue];
    this.queue.length = 0;

    // Retry with exponential backoff
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.sendBatch(eventsToSend);
        return; // Success
      } catch (error) {
        if (attempt === maxAttempts) {
          // Final attempt failed, log and give up
          console.error(
            `[RemoteTelemetryClient] Failed to send ${eventsToSend.length} events after ${maxAttempts} attempts`,
            error
          );
          return;
        }

        // Calculate backoff delay: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await this.sleep(backoffMs);
      }
    }
  }

  /**
   * Gracefully shutdown the client by flushing pending events.
   * Stops the auto-flush timer and sends any remaining events.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop auto-flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any pending events
    await this.flush();
  }

  /**
   * Get the current uptime in milliseconds.
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get the session ID for this app run.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the current queue size.
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Send a batch of events to the remote endpoint via HTTP POST.
   *
   * @private
   */
  private async sendBatch(events: TelemetryEvent[]): Promise<void> {
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}`
      );
    }
  }

  /**
   * Start the auto-flush timer.
   *
   * @private
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushInterval);

    // Prevent timer from keeping process alive
    this.flushTimer.unref();
  }

  /**
   * Sleep for the specified duration.
   *
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
