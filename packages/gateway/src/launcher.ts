import { spawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  cpSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "@rivonclaw/core";
import { createLogger } from "@rivonclaw/logger";
import type {
  GatewayLaunchOptions,
  GatewayState,
  GatewayStatus,
  GatewayEvents,
} from "./types.js";

const log = createLogger("gateway");

const DEFAULT_INITIAL_BACKOFF_MS = DEFAULTS.gateway.initialBackoffMs;
const DEFAULT_MAX_BACKOFF_MS = DEFAULTS.gateway.maxBackoffMs;
const DEFAULT_HEALTHY_THRESHOLD_MS = DEFAULTS.gateway.healthyThresholdMs;
/** Skip reload if the gateway was spawned less than this many ms ago. */
const STARTUP_GRACE_MS = DEFAULTS.gateway.startupGraceMs;

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

    // If the gateway was spawned very recently, it's still initializing and
    // will read the latest config file when it finishes starting up.
    // Skip the reload to avoid killing a process that hasn't started listening.
    const uptime = this.lastStartedAt
      ? Date.now() - this.lastStartedAt.getTime()
      : 0;
    if (uptime < STARTUP_GRACE_MS) {
      log.info(
        `Gateway started ${uptime}ms ago, skipping reload (config already on disk)`,
      );
      return;
    }

    // Windows doesn't support SIGUSR1 — fall back to stop+start
    if (process.platform === "win32") {
      log.debug("Windows detected, falling back to stop+start for reload");
      await this.stop();
      await this.start();
      return;
    }

    log.info(`Sending SIGUSR1 to gateway (PID ${this.process.pid}) for graceful reload`);
    this.process.kill("SIGUSR1");
  }

  /** Gracefully stop the gateway process and its entire process tree. */
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
    const pid = proc.pid;

    return new Promise<void>((resolve) => {
      const killTimeout = setTimeout(() => {
        log.warn("Gateway did not exit gracefully, sending SIGKILL to process group");
        this.killProcessTree(proc, pid, "SIGKILL");
      }, 5000);

      proc.once("exit", () => {
        clearTimeout(killTimeout);
        this.process = null;
        this.setState("stopped");
        resolve();
      });

      // Kill the entire process group (openclaw + openclaw-gateway)
      // so child processes don't become orphans
      this.killProcessTree(proc, pid, "SIGTERM");
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

    // !! CRITICAL — DO NOT REMOVE OR MODIFY WITHOUT EXPLICIT OWNER APPROVAL !!
    //
    // Prevent the gateway from spawning a detached child on config-triggered
    // restarts (chokidar → SIGUSR1 → restartGatewayProcessWithFreshPid).
    // The launcher already manages the process lifecycle, so respawning would
    // create an orphaned gateway that holds the port while the launcher also
    // tries to restart — causing "port already in use" failures.
    //
    // Removing this line causes a race condition between the gateway's
    // self-respawn and the launcher's auto-restart that is extremely hard to
    // reproduce, test, and debug. The symptom is a permanently orphaned
    // gateway process that blocks all future startups.
    env["OPENCLAW_NO_RESPAWN"] = "1";

    // Skip browser control server at startup.  The browser plugin service
    // blocks the event loop for 15-30 s on Windows during express/route
    // initialization, causing RPC handshake timeouts and delayed webchat.
    // Browser tools remain functional — the browser-request handler calls
    // startBrowserControlServiceFromConfig() on first use.
    env["OPENCLAW_SKIP_BROWSER_CONTROL_SERVER"] = "1";

    log.debug("[spawn:1] env built, seeding compile cache...");

    // Sanitize env vars inherited from the parent (Electron main process) or
    // CI environment that can cause the ELECTRON_RUN_AS_NODE child to hang.
    //
    // NODE_COMPILE_CACHE — V8 compile cache for entry.js (~22 MB). The build
    //   pipeline pre-warms this cache using the Electron binary so the first
    //   startup skips the ~3-4 s parse+compile phase. The shipped cache lives
    //   in dist/compile-cache/ (read-only in packaged apps), so we copy it to
    //   the user's writable stateDir on first launch or after app updates
    //   (detected via a .version marker). Subsequent restarts reuse the cache.
    //
    // NODE_V8_COVERAGE — Coverage instrumentation can hang if the output
    //   directory doesn't exist or isn't writable by the child process.
    delete env.NODE_COMPILE_CACHE;
    if (this.options.stateDir) {
      const userCacheDir = join(this.options.stateDir, "compile-cache");
      const shippedCacheDir = join(
        dirname(this.options.entryPath),
        "dist",
        "compile-cache",
      );
      const shippedVersionFile = join(shippedCacheDir, ".version");

      // Seed from shipped pre-warmed cache if version changed (new install/update)
      if (existsSync(shippedVersionFile)) {
        try {
          const shippedVer = readFileSync(shippedVersionFile, "utf-8").trim();
          const userVerFile = join(userCacheDir, ".version");
          const userVer = existsSync(userVerFile)
            ? readFileSync(userVerFile, "utf-8").trim()
            : "";
          if (shippedVer !== userVer) {
            mkdirSync(userCacheDir, { recursive: true });
            cpSync(shippedCacheDir, userCacheDir, {
              recursive: true,
              force: true,
            });
            log.info(
              `Seeded compile cache from shipped cache (version: ${shippedVer})`,
            );
          }
        } catch (err) {
          log.warn("Compile cache seeding failed:", err);
        }
      }

      env.NODE_COMPILE_CACHE = userCacheDir;
    }

    log.debug("[spawn:2] compile cache done, writing preload...");

    // ── Startup profiler preload ──
    // Inject a CJS preload script that logs timing milestones to stderr.
    // The script is written to stateDir so it works in packaged apps too.
    if (this.options.stateDir) {
      const preloadPath = join(this.options.stateDir, "startup-timer.cjs");
      try {
        const thisDir = fileURLToPath(new URL(".", import.meta.url));
        const srcPreload = join(thisDir, "startup-timer.cjs");
        // In dev: src/startup-timer.cjs exists next to the TS source
        // In prod: startup-timer.cjs is copied to dist/ by tsdown
        if (existsSync(srcPreload)) {
          writeFileSync(preloadPath, readFileSync(srcPreload));
        } else {
          // Fallback: write a minimal inline version with the plugin-sdk
          // resolution fix. Without this, jiti babel-transforms the 17 MB
          // plugin-sdk on every startup because native require can't find
          // "openclaw/plugin-sdk" and jiti's nested-require cache misses.
          writeFileSync(
            preloadPath,
            `"use strict";
if(process.platform==="win32"){const cp=require("child_process"),oS=cp.spawn;cp.spawn=function(c,a,o){if(a!=null&&!Array.isArray(a)){o=a;a=[]}const l=String(c).toLowerCase();if(l.includes("powershell")||l.includes("pwsh")){if(Array.isArray(a)){a=[...a];for(let i=0;i<a.length;i++){if(String(a[i]).toLowerCase()==="-command"&&i+1<a.length){a[i+1]="[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "+a[i+1];break}}}return oS.call(this,c,a,o)}if(l.includes("cmd")){if(Array.isArray(a)){a=[...a];for(let i=0;i<a.length;i++){if(String(a[i]).toLowerCase()==="/c"&&i+1<a.length){a[i+1]="chcp 65001>nul & "+a[i+1];break}}}return oS.call(this,c,a,o)}return oS.call(this,c,a,o)}}
const t0=performance.now(),V=!!process.env.RIVONCLAW_STARTUP_DEBUG,path=require("path"),Module=require("module");
let sdkPath=null,sdkDir=null;
const origRes=Module._resolveFilename;
Module._resolveFilename=function(r,p,m,o){if(sdkPath){if(r==="openclaw/plugin-sdk")return sdkPath;if(r.startsWith("openclaw/plugin-sdk/"))return origRes.call(this,path.join(sdkDir,r.slice(20)),p,m,o)}return origRes.call(this,r,p,m,o)};
const origLoad=Module._load;let skipped=false;
Module._load=function(r,p,m){if(!skipped&&/plugin-sdk[/\\\\]index\\.js$/.test(r)){skipped=true;try{sdkPath=origRes.call(Module,r,p,m);sdkDir=require("path").dirname(sdkPath);if(V)process.stderr.write("[startup-timer] plugin-sdk deferred: "+sdkPath+"\\n")}catch{}return{}}const s=performance.now();const res=origLoad.call(this,r,p,m);const d=performance.now()-s;if(V&&d>50)process.stderr.write("[startup-timer] +"+((performance.now()-t0)|0)+"ms require(\\""+r+"\\") took "+(d|0)+"ms\\n");return res};
process.stderr.write("[startup-timer] +0ms preload executing\\n");
const cc=process.env.NODE_COMPILE_CACHE;if(cc)process.stderr.write("[startup-timer] compile-cache: "+cc+"\\n");else process.stderr.write("[startup-timer] compile cache: DISABLED\\n");
setImmediate(()=>process.stderr.write("[startup-timer] +"+(performance.now()-t0|0)+"ms event loop started\\n"));
const ow=process.stdout.write;process.stdout.write=function(c,...a){if(String(c).includes("listening on")){process.stderr.write("[startup-timer] +"+(performance.now()-t0|0)+"ms gateway listening\\n");try{if(typeof Module.flushCompileCache==="function"){Module.flushCompileCache();if(V)process.stderr.write("[startup-timer] compile cache flushed\\n")}}catch{}}return ow.call(this,c,...a)};
`,
          );
        }
        const existingNodeOpts = env.NODE_OPTIONS || "";
        env.NODE_OPTIONS = `--require ${JSON.stringify(preloadPath)} ${existingNodeOpts}`.trim();
      } catch (err) {
        log.warn("Preload script writing failed:", err);
      }
    }

    log.debug(
      `[spawn:3] preload done, spawning: bin=${this.options.nodeBin}, ` +
      `entry=${this.options.entryPath}, cwd=${this.options.stateDir ?? "(none)"}`,
    );

    const spawnTs = performance.now();
    let child: ChildProcess;
    try {
      child = spawn(this.options.nodeBin, [this.options.entryPath, "gateway"], {
        env,
        cwd: this.options.stateDir || undefined,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true, // New process group so we can kill the entire tree on stop
      });
    } catch (err) {
      log.error("spawn() threw synchronously:", err);
      this.lastError = String(err);
      this.setState("stopped");
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return;
    }

    log.debug(`[spawn:4] spawn returned, pid=${child.pid ?? "(null)"}`);

    this.process = child;
    this.lastStartedAt = new Date();

    if (child.pid != null) {
      log.info(`Gateway process started with PID ${child.pid}`);
      this.setState("running");
      this.emit("started", child.pid);
    }

    let readyEmitted = false;

    // Track whether the gateway has produced any output. If it hasn't after
    // 15 seconds, something is seriously wrong (e.g. ELECTRON_RUN_AS_NODE
    // not working, corrupt compile cache causing import() to hang).
    let hasOutput = false;
    const noOutputTimer = setTimeout(() => {
      if (!hasOutput && this.process === child && !this.stopRequested) {
        log.error(
          `Gateway PID ${child.pid} produced no stdout/stderr after 15s. ` +
          `This usually means ELECTRON_RUN_AS_NODE is not working or the ` +
          `V8 compile cache is corrupt. Check NODE_COMPILE_CACHE and NODE_OPTIONS env vars.`,
        );
      }
    }, 15_000);

    child.stdout?.on("data", (data: Buffer) => {
      hasOutput = true;
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        log.info(`[gateway stdout] ${line}`);
        if (!readyEmitted && line.includes("listening on")) {
          readyEmitted = true;
          const elapsed = ((performance.now() - spawnTs) / 1000).toFixed(1);
          log.info(`Gateway ready in ${elapsed}s (spawn → listening)`);
          this.emit("ready");
        }
      }
    });

    // Substrings that identify known harmless gateway warnings:
    // - "closed before connect": caused by EasyClaw's WS readiness probe
    //   (openclaw-connector opens a throwaway WebSocket and immediately closes it)
    // - "dangerouslyDisableDeviceAuth": intentionally set by EasyClaw since the
    //   gateway only listens on localhost and Desktop provides its own auth layer
    const HARMLESS_WARN_PATTERNS = [
      "closed before connect",
      "dangerouslyDisableDeviceAuth",
    ];

    child.stderr?.on("data", (data: Buffer) => {
      hasOutput = true;
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (
          line.startsWith("[startup-timer]") ||
          HARMLESS_WARN_PATTERNS.some((p) => line.includes(p))
        ) {
          log.debug(`[gateway stderr] ${line}`);
        } else {
          log.warn(`[gateway stderr] ${line}`);
        }
      }
    });

    child.on("error", (err: Error) => {
      this.lastError = err.message;
      log.error(`Gateway process error: ${err.message}`);
      this.emit("error", err);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(noOutputTimer);
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
      log.debug(
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

  /**
   * Kill a process and its entire tree.
   * On Unix, sends the signal to the process group via negative PID.
   * On Windows, uses `taskkill /T /F /PID` since negative PIDs don't work.
   */
  private killProcessTree(proc: ChildProcess, pid: number | undefined, signal: NodeJS.Signals): void {
    if (!pid) {
      proc.kill(signal);
      return;
    }

    if (process.platform === "win32") {
      try {
        // /T = kill child processes, /F = force
        execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
      } catch {
        // Process may have already exited
      }
    } else {
      try {
        process.kill(-pid, signal);
      } catch {
        proc.kill(signal);
      }
    }
  }

  private setState(newState: GatewayState): void {
    const oldState = this.state;
    if (oldState !== newState) {
      log.debug(`Gateway state: ${oldState} -> ${newState}`);
      this.state = newState;
    }
  }
}
