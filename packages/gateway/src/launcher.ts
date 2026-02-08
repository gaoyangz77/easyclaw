import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createLogger } from "@easyclaw/logger";
import type {
  GatewayLaunchOptions,
  GatewayState,
  GatewayStatus,
  GatewayEvents,
} from "./types.js";

const log = createLogger("gateway");

const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_HEALTHY_THRESHOLD_MS = 60_000;

/**
 * Calculate exponential backoff delay.
 * delay = min(initialBackoff * 2^(attempt-1), maxBackoff)
 */
export function calculateBackoff(
  attempt: number,
  initialBackoffMs: number,
  maxBackoffMs: number,
): number {
  const delay = initialBackoffMs * Math.pow(2, attempt - 1);
  return Math.min(delay, maxBackoffMs);
}

export class GatewayLauncher extends EventEmitter<GatewayEvents> {
  private readonly options: Required<
    Pick<
      GatewayLaunchOptions,
      | "entryPath"
      | "nodeBin"
      | "maxRestarts"
      | "initialBackoffMs"
      | "maxBackoffMs"
      | "healthyThresholdMs"
    >
  > &
    GatewayLaunchOptions;

  private process: ChildProcess | null = null;
  private state: GatewayState = "stopped";
  private restartCount = 0;
  private lastStartedAt: Date | null = null;
  private lastError: string | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopRequested = false;

  constructor(options: GatewayLaunchOptions) {
    super();
    this.options = {
      ...options,
      nodeBin: options.nodeBin ?? "node",
      maxRestarts: options.maxRestarts ?? 0,
      initialBackoffMs: options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      healthyThresholdMs:
        options.healthyThresholdMs ?? DEFAULT_HEALTHY_THRESHOLD_MS,
    };
  }

  /** Get the current status of the gateway. */
  getStatus(): GatewayStatus {
    return {
      state: this.state,
      pid: this.process?.pid ?? null,
      restartCount: this.restartCount,
      lastStartedAt: this.lastStartedAt,
      lastError: this.lastError,
    };
  }

  /** Update the environment variables for the next spawn. */
  setEnv(env: Record<string, string>): void {
    this.options.env = env;
  }

  /** Start the gateway process. */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      log.warn("Gateway is already running or starting, ignoring start()");
      return;
    }

    this.stopRequested = false;
    this.restartCount = 0;
    this.spawnProcess();
  }

  /**
   * Send SIGUSR1 to trigger OpenClaw's in-process graceful restart.
   * The gateway re-reads its config file without exiting the process.
   * Note: env vars stay the same — only use for config-file-only changes.
   * Falls back to hard stop+start if the process isn't running.
   */
  async reload(): Promise<void> {
    if (!this.process?.pid || this.state !== "running") {
      log.warn("Gateway not running, falling back to stop+start for reload");
      await this.stop();
      await this.start();
      return;
    }

    log.info(`Sending SIGUSR1 to gateway (PID ${this.process.pid}) for graceful reload`);
    this.process.kill("SIGUSR1");
  }

  /** Gracefully stop the gateway process. */
  async stop(): Promise<void> {
    this.stopRequested = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (!this.process || this.state === "stopped") {
      this.setState("stopped");
      return;
    }

    this.setState("stopping");
    const proc = this.process;

    return new Promise<void>((resolve) => {
      const killTimeout = setTimeout(() => {
        log.warn("Gateway did not exit gracefully, sending SIGKILL");
        proc.kill("SIGKILL");
      }, 5000);

      proc.once("exit", () => {
        clearTimeout(killTimeout);
        this.process = null;
        this.setState("stopped");
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  private spawnProcess(): void {
    this.setState("starting");

    const env: Record<string, string | undefined> = {
      ...process.env,
      ...this.options.env,
    };

    if (this.options.configPath) {
      env["OPENCLAW_CONFIG_PATH"] = this.options.configPath;
    }
    if (this.options.stateDir) {
      env["OPENCLAW_STATE_DIR"] = this.options.stateDir;
    }

    const child = spawn(this.options.nodeBin, [this.options.entryPath, "gateway"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process = child;
    this.lastStartedAt = new Date();

    if (child.pid != null) {
      log.info(`Gateway process started with PID ${child.pid}`);
      this.setState("running");
      this.emit("started", child.pid);
    }

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        log.info(`[gateway stdout] ${line}`);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        log.warn(`[gateway stderr] ${line}`);
      }
    });

    child.on("error", (err: Error) => {
      this.lastError = err.message;
      log.error(`Gateway process error: ${err.message}`);
      this.emit("error", err);
    });

    child.on("exit", (code, signal) => {
      const prevState = this.state;
      this.process = null;

      log.info(
        `Gateway process exited (code=${code}, signal=${signal}, state=${prevState})`,
      );

      this.emit("stopped", code, signal);

      // If stop was explicitly requested, don't restart
      if (this.stopRequested || prevState === "stopping") {
        this.setState("stopped");
        return;
      }

      // Process crashed or exited unexpectedly — attempt restart
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    this.restartCount++;

    // Check if we've exceeded max restarts
    if (
      this.options.maxRestarts > 0 &&
      this.restartCount > this.options.maxRestarts
    ) {
      const msg = `Gateway exceeded max restarts (${this.options.maxRestarts})`;
      log.error(msg);
      this.lastError = msg;
      this.setState("stopped");
      this.emit("error", new Error(msg));
      return;
    }

    // If the process ran long enough, reset backoff
    const runDuration = this.lastStartedAt
      ? Date.now() - this.lastStartedAt.getTime()
      : 0;

    let effectiveAttempt = this.restartCount;
    if (runDuration >= this.options.healthyThresholdMs) {
      log.info(
        "Gateway ran long enough to be considered healthy, resetting backoff",
      );
      effectiveAttempt = 1;
      this.restartCount = 1;
    }

    const delay = calculateBackoff(
      effectiveAttempt,
      this.options.initialBackoffMs,
      this.options.maxBackoffMs,
    );

    log.info(
      `Restarting gateway in ${delay}ms (attempt ${this.restartCount})`,
    );

    this.emit("restarting", this.restartCount, delay);

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopRequested) {
        this.spawnProcess();
      }
    }, delay);
  }

  private setState(newState: GatewayState): void {
    const oldState = this.state;
    if (oldState !== newState) {
      log.debug(`Gateway state: ${oldState} -> ${newState}`);
      this.state = newState;
    }
  }
}
