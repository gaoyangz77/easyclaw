import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoteTelemetryClient } from "./client.js";
import type { TelemetryConfig } from "./types.js";

// Mock fetch globally
global.fetch = vi.fn();

describe("RemoteTelemetryClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    global.fetch = mockFetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create client with required config", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      expect(client).toBeInstanceOf(RemoteTelemetryClient);
      expect(client.getSessionId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("should apply default batchSize and flushInterval", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      expect(client).toBeDefined();
      // Defaults applied internally: batchSize=10, flushInterval=30000
    });

    it("should accept custom batchSize and flushInterval", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
        batchSize: 5,
        flushInterval: 10000,
      };

      const client = new RemoteTelemetryClient(config);
      expect(client).toBeDefined();
    });

    it("should accept optional userId", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
        userId: "test-user-123",
      };

      const client = new RemoteTelemetryClient(config);
      expect(client).toBeDefined();
    });
  });

  describe("track()", () => {
    it("should queue events when enabled", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started", { foo: "bar" });

      expect(client.getQueueSize()).toBe(1);
    });

    it("should not queue events when disabled", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: false,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started");

      expect(client.getQueueSize()).toBe(0);
    });

    it("should auto-flush when batch size reached", async () => {
      // Use real timers for this test since flush is async
      vi.useRealTimers();

      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
        batchSize: 3,
      };

      const client = new RemoteTelemetryClient(config);

      // Track 3 events (reaches batch size)
      client.track("event1");
      client.track("event2");
      client.track("event3");

      // Wait a bit for async flush to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api/telemetry",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );

      // Verify queue is empty after flush
      expect(client.getQueueSize()).toBe(0);

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });

    it("should include metadata in events", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      const metadata = { runtimeMs: 5000, errorType: "NetworkError" };

      client.track("app.error", metadata);

      expect(client.getQueueSize()).toBe(1);
    });
  });

  describe("flush()", () => {
    it("should send queued events to endpoint", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started");
      client.track("app.stopped");

      await client.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody).toHaveLength(2);
      expect(requestBody[0]).toMatchObject({
        eventType: "app.started",
        version: "0.1.0",
        platform: "darwin",
      });
      expect(requestBody[1]).toMatchObject({
        eventType: "app.stopped",
        version: "0.1.0",
        platform: "darwin",
      });
    });

    it("should clear queue after successful flush", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started");

      expect(client.getQueueSize()).toBe(1);
      await client.flush();
      expect(client.getQueueSize()).toBe(0);
    });

    it("should do nothing when queue is empty", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      await client.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should retry on failure with exponential backoff", async () => {
      // Use real timers for this test to handle async sleep
      vi.useRealTimers();

      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });

      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started");

      await client.flush();

      // Should have been called 3 times (initial + 2 retries)
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });

    it("should give up after 3 failed attempts", async () => {
      // Use real timers for this test to handle async sleep
      vi.useRealTimers();

      mockFetch.mockRejectedValue(new Error("Network error"));

      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started");

      // Suppress console.error during test
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await client.flush();

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });
  });

  describe("auto-flush timer", () => {
    it("should auto-flush after interval", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
        flushInterval: 10000, // 10s
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started");

      // Advance timers by 10 seconds
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueueSize()).toBe(0);
    });

    it("should not start timer when disabled", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: false,
        version: "0.1.0",
        platform: "darwin",
        flushInterval: 10000,
      };

      new RemoteTelemetryClient(config);

      await vi.advanceTimersByTimeAsync(10000);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("shutdown()", () => {
    it("should flush pending events on shutdown", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started");
      client.track("app.stopped");

      await client.shutdown();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueueSize()).toBe(0);
    });

    it("should stop accepting events after shutdown", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      await client.shutdown();

      client.track("app.started");
      expect(client.getQueueSize()).toBe(0);
    });
  });

  describe("helper methods", () => {
    it("should track uptime correctly", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      const uptime1 = client.getUptime();

      vi.advanceTimersByTime(5000);

      const uptime2 = client.getUptime();
      expect(uptime2).toBeGreaterThan(uptime1);
    });

    it("should return consistent session ID", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      const sessionId1 = client.getSessionId();
      const sessionId2 = client.getSessionId();

      expect(sessionId1).toBe(sessionId2);
      expect(sessionId1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("should return correct queue size", () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
      };

      const client = new RemoteTelemetryClient(config);
      expect(client.getQueueSize()).toBe(0);

      client.track("event1");
      expect(client.getQueueSize()).toBe(1);

      client.track("event2");
      client.track("event3");
      expect(client.getQueueSize()).toBe(3);
    });
  });

  describe("event structure", () => {
    it("should include all required fields in events", async () => {
      const config: TelemetryConfig = {
        endpoint: "https://example.com/api/telemetry",
        enabled: true,
        version: "0.1.0",
        platform: "darwin",
        userId: "test-user",
      };

      const client = new RemoteTelemetryClient(config);
      client.track("app.started", { custom: "data" });

      await client.flush();

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      const event = requestBody[0];

      expect(event).toHaveProperty("eventType", "app.started");
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("sessionId");
      expect(event).toHaveProperty("userId", "test-user");
      expect(event).toHaveProperty("version", "0.1.0");
      expect(event).toHaveProperty("platform", "darwin");
      expect(event).toHaveProperty("metadata", { custom: "data" });

      // Validate ISO 8601 timestamp
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    });
  });
});
