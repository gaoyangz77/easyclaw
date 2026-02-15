import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { calculateBackoff, GatewayLauncher } from "./launcher.js";
import type { GatewayLaunchOptions } from "./types.js";

// ─── calculateBackoff tests ────────────────────────────────────────────────

describe("calculateBackoff", () => {
  it("returns initialBackoffMs for the first attempt", () => {
    expect(calculateBackoff(1, 1000, 30_000)).toBe(1000);
  });

  it("doubles the delay for each subsequent attempt", () => {
    expect(calculateBackoff(2, 1000, 30_000)).toBe(2000);
    expect(calculateBackoff(3, 1000, 30_000)).toBe(4000);
    expect(calculateBackoff(4, 1000, 30_000)).toBe(8000);
  });

  it("caps the delay at maxBackoffMs", () => {
    expect(calculateBackoff(10, 1000, 30_000)).toBe(30_000);
    expect(calculateBackoff(100, 1000, 30_000)).toBe(30_000);
  });

  it("respects custom initial and max values", () => {
    expect(calculateBackoff(1, 500, 5000)).toBe(500);
    expect(calculateBackoff(2, 500, 5000)).toBe(1000);
    expect(calculateBackoff(3, 500, 5000)).toBe(2000);
    expect(calculateBackoff(4, 500, 5000)).toBe(4000);
    expect(calculateBackoff(5, 500, 5000)).toBe(5000);
  });
});

// ─── Mock child_process ────────────────────────────────────────────────────

class MockChildProcess extends EventEmitter {
  pid = 12345;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  killSignals: string[] = [];

  kill(signal?: string): boolean {
    this.killSignals.push(signal ?? "SIGTERM");
    this.killed = true;
    return true;
  }
}

let mockChild: MockChildProcess;

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    mockChild = new MockChildProcess();
    return mockChild;
  }),
}));

vi.mock("@easyclaw/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── GatewayLauncher tests ─────────────────────────────────────────────────

function createLauncher(overrides?: Partial<GatewayLaunchOptions>): GatewayLauncher {
  return new GatewayLauncher({
    entryPath: "/fake/openclaw.mjs",
    initialBackoffMs: 10,  // fast for tests
    maxBackoffMs: 100,
    healthyThresholdMs: 50,
    ...overrides,
  });
}

describe("GatewayLauncher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── State & Status ──

  describe("initial state", () => {
    it("starts in stopped state", () => {
      const launcher = createLauncher();
      const status = launcher.getStatus();
      expect(status.state).toBe("stopped");
      expect(status.pid).toBeNull();
      expect(status.restartCount).toBe(0);
      expect(status.lastStartedAt).toBeNull();
      expect(status.lastError).toBeNull();
    });
  });

  // ── Spawn ──

  describe("start()", () => {
    it("transitions to running state and emits started event", async () => {
      const launcher = createLauncher();
      const startedFn = vi.fn();
      launcher.on("started", startedFn);

      await launcher.start();

      const status = launcher.getStatus();
      expect(status.state).toBe("running");
      expect(status.pid).toBe(12345);
      expect(status.lastStartedAt).toBeInstanceOf(Date);
      expect(startedFn).toHaveBeenCalledWith(12345);
    });

    it("passes correct spawn arguments", async () => {
      const { spawn } = await import("node:child_process");

      const launcher = createLauncher({
        entryPath: "/path/to/openclaw.mjs",
        configPath: "/custom/config.json",
        stateDir: "/custom/state",
        env: { CUSTOM_VAR: "value" },
      });

      await launcher.start();

      expect(spawn).toHaveBeenCalledWith(
        "node",
        ["/path/to/openclaw.mjs", "gateway"],
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
          env: expect.objectContaining({
            OPENCLAW_CONFIG_PATH: "/custom/config.json",
            OPENCLAW_STATE_DIR: "/custom/state",
            CUSTOM_VAR: "value",
          }),
        }),
      );
    });

    it("is a no-op when already running", async () => {
      const { spawn } = await import("node:child_process");

      const launcher = createLauncher();
      await launcher.start();
      await launcher.start(); // should not spawn again

      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Stop ──

  describe("stop()", () => {
    it("sends SIGTERM and transitions to stopped", async () => {
      const launcher = createLauncher();
      await launcher.start();

      const stopPromise = launcher.stop();
      expect(launcher.getStatus().state).toBe("stopping");

      // Simulate process exit
      mockChild.emit("exit", 0, null);
      await stopPromise;

      expect(launcher.getStatus().state).toBe("stopped");
      expect(mockChild.killSignals).toContain("SIGTERM");
    });

    it("is safe to call when already stopped", async () => {
      const launcher = createLauncher();
      await launcher.stop(); // should not throw
      expect(launcher.getStatus().state).toBe("stopped");
    });
  });

  // ── Reload (SIGUSR1) ──

  describe("reload()", () => {
    it.skipIf(process.platform === "win32")("sends SIGUSR1 when the gateway is running", async () => {
      const launcher = createLauncher();
      await launcher.start();

      await launcher.reload();

      expect(mockChild.killSignals).toContain("SIGUSR1");
      expect(launcher.getStatus().state).toBe("running");
    });

    it("falls back to stop+start when the gateway is stopped", async () => {
      const { spawn } = await import("node:child_process");
      const launcher = createLauncher();

      // reload() on a stopped launcher should spawn a new process
      await launcher.reload();

      expect(launcher.getStatus().state).toBe("running");
      expect(spawn).toHaveBeenCalled();
    });
  });

  // ── Restart on crash ──

  describe("auto-restart on crash", () => {
    it("emits restarting event and restarts after crash", async () => {
      const launcher = createLauncher();
      const restartingFn = vi.fn();
      launcher.on("restarting", restartingFn);

      await launcher.start();

      // Simulate crash
      mockChild.emit("exit", 1, null);

      expect(restartingFn).toHaveBeenCalledWith(1, 10); // attempt 1, 10ms delay

      // Advance past the backoff delay
      vi.advanceTimersByTime(10);

      // Should have re-spawned
      expect(launcher.getStatus().state).toBe("running");
    });

    it("uses exponential backoff for repeated crashes", async () => {
      const launcher = createLauncher();
      const restartingFn = vi.fn();
      launcher.on("restarting", restartingFn);

      await launcher.start();

      // First crash
      mockChild.emit("exit", 1, null);
      expect(restartingFn).toHaveBeenLastCalledWith(1, 10);
      vi.advanceTimersByTime(10);

      // Second crash
      mockChild.emit("exit", 1, null);
      expect(restartingFn).toHaveBeenLastCalledWith(2, 20);
      vi.advanceTimersByTime(20);

      // Third crash
      mockChild.emit("exit", 1, null);
      expect(restartingFn).toHaveBeenLastCalledWith(3, 40);
    });

    it("does not restart when stop() was called", async () => {
      const launcher = createLauncher();
      const restartingFn = vi.fn();
      launcher.on("restarting", restartingFn);

      await launcher.start();
      const stopPromise = launcher.stop();
      mockChild.emit("exit", 0, null);
      await stopPromise;

      expect(restartingFn).not.toHaveBeenCalled();
      expect(launcher.getStatus().state).toBe("stopped");
    });

    it("stops after maxRestarts is exceeded", async () => {
      const launcher = createLauncher({ maxRestarts: 2 });
      const errorFn = vi.fn();
      launcher.on("error", errorFn);

      await launcher.start();

      // Crash 1
      mockChild.emit("exit", 1, null);
      vi.advanceTimersByTime(10);

      // Crash 2
      mockChild.emit("exit", 1, null);
      vi.advanceTimersByTime(20);

      // Crash 3 — exceeds maxRestarts (2)
      mockChild.emit("exit", 1, null);

      expect(launcher.getStatus().state).toBe("stopped");
      expect(errorFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("max restarts"),
        }),
      );
    });

    it("resets backoff after healthy threshold", async () => {
      const launcher = createLauncher({
        healthyThresholdMs: 50,
      });
      const restartingFn = vi.fn();
      launcher.on("restarting", restartingFn);

      await launcher.start();

      // Multiple quick crashes to build up backoff
      mockChild.emit("exit", 1, null);
      vi.advanceTimersByTime(10);

      mockChild.emit("exit", 1, null);
      vi.advanceTimersByTime(20);

      // Now advance time so the process appears healthy (>= 50ms)
      vi.advanceTimersByTime(50);

      // Crash after healthy period
      mockChild.emit("exit", 1, null);

      // Backoff should be reset to initial (attempt 1 = 10ms)
      expect(restartingFn).toHaveBeenLastCalledWith(1, 10);
    });
  });

  // ── stdout/stderr logging ──

  describe("stdout/stderr capture", () => {
    it("emits stopped event with exit code and signal", async () => {
      const launcher = createLauncher();
      const stoppedFn = vi.fn();
      launcher.on("stopped", stoppedFn);

      await launcher.start();
      launcher["stopRequested"] = true; // prevent restart
      mockChild.emit("exit", 1, "SIGTERM");

      expect(stoppedFn).toHaveBeenCalledWith(1, "SIGTERM");
    });

    it("captures process error events", async () => {
      const launcher = createLauncher();
      const errorFn = vi.fn();
      launcher.on("error", errorFn);

      await launcher.start();

      const err = new Error("spawn failed");
      mockChild.emit("error", err);

      expect(errorFn).toHaveBeenCalledWith(err);
      expect(launcher.getStatus().lastError).toBe("spawn failed");
    });
  });

  describe("setEnv()", () => {
    it("updates env used for next spawn", async () => {
      const { spawn } = await import("node:child_process");

      const launcher = createLauncher({ env: { FOO: "bar" } });
      await launcher.start();

      // First spawn should have FOO=bar (merged with process.env)
      const firstCall = vi.mocked(spawn).mock.calls.at(-1);
      expect(firstCall?.[2]?.env).toHaveProperty("FOO", "bar");

      // Stop gracefully, then update env
      const stopPromise = launcher.stop();
      mockChild.emit("exit", 0, null);
      await stopPromise;

      launcher.setEnv({ BAZ: "qux" });
      await launcher.start();

      // Second spawn should have BAZ=qux but not FOO
      const secondCall = vi.mocked(spawn).mock.calls.at(-1);
      expect(secondCall?.[2]?.env).toHaveProperty("BAZ", "qux");
      expect(secondCall?.[2]?.env).not.toHaveProperty("FOO");
    });
  });
});
