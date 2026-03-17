import { EventEmitter } from "node:events";
import { get as httpGet } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createLogger } from "@rivonclaw/logger";
import type { SessionLifecycleManager } from "./session-lifecycle-manager.js";
import { ManagedProfileCookieAdapter } from "./managed-profile-cookie-adapter.js";

const log = createLogger("managed-browser-service");

/** Port range for managed browser CDP ports (matches vendor allocation). */
const CDP_PORT_RANGE_START = 18800;
const CDP_PORT_RANGE_END = 18899;

/** Registry entry for a managed browser profile. */
export interface ManagedBrowserEntry {
  profileId: string;
  port: number;
  status: "allocated" | "running" | "stopped";
  pid?: number;
}

/**
 * ManagedBrowserService — desktop-side coordinator for RivonClaw-managed
 * multi-profile browser instances.
 *
 * This is the PRIMARY runtime target for session-state persistence.
 * Each managed profile gets its own Chrome instance with a dedicated
 * CDP debugging port from the 18800-18899 range.
 *
 * Responsibilities:
 * - Port allocation: assigns CDP ports from the managed range
 * - Browser launch: spawns Chrome with profile-specific user-data dir
 * - Lifecycle integration: auto-starts/ends session state tracking
 * - Registry: maintains profileId -> port mapping
 *
 * What this does NOT do:
 * - Cloud profile sync (profiles are fetched from cloud by other components)
 * - Gateway config writing (handled by gateway-config-builder)
 * - Vendor browser lifecycle (vendor manages its own instances)
 */
export class ManagedBrowserService extends EventEmitter {
  private readonly registry = new Map<string, ManagedBrowserEntry>();
  private readonly lifecycleManager: SessionLifecycleManager;
  private readonly browserDataDir: string;
  private probeTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(lifecycleManager: SessionLifecycleManager, browserDataDir: string) {
    super();
    this.lifecycleManager = lifecycleManager;
    this.browserDataDir = browserDataDir;
  }

  // -- Port Allocation ------------------------------------------------------

  /** Allocate the next free CDP port for a profile. */
  allocatePort(profileId: string): number {
    // If already allocated, return existing
    const existing = this.registry.get(profileId);
    if (existing) return existing.port;

    const usedPorts = new Set([...this.registry.values()].map(e => e.port));
    for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
      if (!usedPorts.has(port)) {
        this.registry.set(profileId, { profileId, port, status: "allocated" });
        log.info(`[${profileId}] allocated CDP port ${port}`);
        return port;
      }
    }
    throw new Error(`No free CDP ports in range ${CDP_PORT_RANGE_START}-${CDP_PORT_RANGE_END}`);
  }

  /** Register an externally-assigned port for a profile. */
  registerPort(profileId: string, port: number): void {
    const existing = this.registry.get(profileId);
    if (existing && existing.port === port) return;
    this.registry.set(profileId, { profileId, port, status: "allocated" });
    log.info(`[${profileId}] registered external CDP port ${port}`);
  }

  // -- Browser Launch -------------------------------------------------------

  /**
   * Launch a Chrome instance for a managed profile.
   *
   * Spawns Chrome with:
   * - --remote-debugging-port=PORT
   * - --user-data-dir=<browserDataDir>/<profileId>/user-data
   * - Detached + unref'd (survives desktop restart)
   *
   * After launch, starts polling for CDP readiness.
   * When ready, auto-triggers session lifecycle.
   */
  async launchBrowser(profileId: string, chromePath: string): Promise<number> {
    const port = this.allocatePort(profileId);

    // Check if already running
    if (await this.probeCdp(port)) {
      log.info(`[${profileId}] browser already running on port ${port}`);
      await this.onBrowserReady(profileId, port);
      return port;
    }

    // Ensure user-data directory exists
    const userDataDir = join(this.browserDataDir, profileId, "user-data");
    mkdirSync(userDataDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];

    log.info(`[${profileId}] launching Chrome on port ${port}: ${chromePath}`);
    const child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
    child.unref();

    const entry = this.registry.get(profileId)!;
    entry.pid = child.pid;

    // Poll for CDP readiness
    await this.waitForCdpReady(profileId, port, 15_000);
    return port;
  }

  /**
   * Connect to an already-running managed browser.
   *
   * Use this when the browser was launched externally (e.g., by the vendor
   * gateway) but the desktop needs to track its session state.
   */
  async connectBrowser(profileId: string, port: number): Promise<boolean> {
    this.registerPort(profileId, port);

    if (await this.probeCdp(port)) {
      await this.onBrowserReady(profileId, port);
      return true;
    }

    log.warn(`[${profileId}] connectBrowser: CDP not reachable on port ${port}`);
    return false;
  }

  // -- Browser Lifecycle ----------------------------------------------------

  /**
   * Stop tracking a managed browser and end its session.
   * Does NOT kill the browser process.
   */
  async stopTracking(profileId: string): Promise<void> {
    this.clearProbeTimer(profileId);

    if (this.lifecycleManager.hasActiveSession(profileId)) {
      await this.lifecycleManager.endSession(profileId);
    }

    const entry = this.registry.get(profileId);
    if (entry) {
      entry.status = "stopped";
      log.info(`[${profileId}] tracking stopped`);
    }
  }

  /**
   * Shutdown all managed browsers -- end all sessions.
   * Called on app quit.
   */
  async shutdown(): Promise<void> {
    // Clear all probe timers
    for (const profileId of this.probeTimers.keys()) {
      this.clearProbeTimer(profileId);
    }

    // End all sessions managed by this service
    const profileIds = [...this.registry.keys()];
    for (const profileId of profileIds) {
      try {
        await this.stopTracking(profileId);
      } catch (err) {
        log.warn(`[${profileId}] shutdown stopTracking failed:`, err);
      }
    }

    this.registry.clear();
    log.info("managed browser service shut down");
  }

  // -- Registry Introspection -----------------------------------------------

  getEntry(profileId: string): ManagedBrowserEntry | undefined {
    return this.registry.get(profileId);
  }

  getPort(profileId: string): number | null {
    return this.registry.get(profileId)?.port ?? null;
  }

  getAllEntries(): ManagedBrowserEntry[] {
    return [...this.registry.values()];
  }

  getRunningProfiles(): string[] {
    return [...this.registry.values()]
      .filter(e => e.status === "running")
      .map(e => e.profileId);
  }

  hasProfile(profileId: string): boolean {
    return this.registry.has(profileId);
  }

  // -- Internal -------------------------------------------------------------

  private async onBrowserReady(profileId: string, port: number): Promise<void> {
    const entry = this.registry.get(profileId);
    if (entry) entry.status = "running";

    // Auto-start session lifecycle
    const adapter = new ManagedProfileCookieAdapter(profileId, port);
    await this.lifecycleManager.startSession(profileId, adapter, "managed_profile");

    this.emit("browser-ready", profileId, port);
    log.info(`[${profileId}] browser ready on port ${port}, session started`);
  }

  private async waitForCdpReady(profileId: string, port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
      if (await this.probeCdp(port)) {
        await this.onBrowserReady(profileId, port);
        return;
      }
    }

    log.warn(`[${profileId}] Chrome CDP not reachable on port ${port} after ${timeoutMs}ms`);
    const entry = this.registry.get(profileId);
    if (entry) entry.status = "stopped";
  }

  private probeCdp(port: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const req = httpGet(`http://127.0.0.1:${port}/json/version`, res => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  }

  private clearProbeTimer(profileId: string): void {
    const timer = this.probeTimers.get(profileId);
    if (timer) {
      clearInterval(timer);
      this.probeTimers.delete(profileId);
    }
  }
}
