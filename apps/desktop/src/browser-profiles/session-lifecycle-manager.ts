import { createLogger } from "@rivonclaw/logger";
import type { SessionStateRuntimeTarget } from "@rivonclaw/core";
import { BrowserProfileRuntimeService } from "./runtime-service.js";
import type { BrowserSessionAdapter } from "./session-state/index.js";

const log = createLogger("session-lifecycle");

/**
 * Tracks one active browser profile session.
 * Holds the adapter and metadata needed for flush/stop.
 */
interface ActiveSession {
  profileId: string;
  adapter: BrowserSessionAdapter;
  target: SessionStateRuntimeTarget;
  startedAt: number;
}

/**
 * SessionLifecycleManager — orchestrates session state persistence
 * across task boundaries, profile switches, and process lifecycle.
 *
 * Responsibilities:
 * - startSession: prepare → restore → start checkpoint timer
 * - endSession: flush → stop timer → cleanup
 * - switchProfile: end old → start new (atomic)
 * - endAllSessions: flush all active sessions (shutdown)
 *
 * Best-effort watchers:
 * - Process exit: installs 'beforeExit' handler to flush all sessions
 * - Watcher failures never propagate — they are logged, not thrown
 *
 * What this does NOT do:
 * - No browser process monitoring (no pid/handle watching)
 * - No OpenClaw vendor lifecycle integration
 * - No skill-driven save triggers
 * - No cloud backup (deferred)
 */
export class SessionLifecycleManager {
  private readonly runtimeService: BrowserProfileRuntimeService;
  private readonly activeSessions: Map<string, ActiveSession> = new Map();
  private processExitBound: (() => void) | null = null;

  constructor(runtimeService: BrowserProfileRuntimeService) {
    this.runtimeService = runtimeService;
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  /**
   * Start a managed session for a browser profile.
   *
   * 1. Prepares the session-state directory
   * 2. Restores cookies if policy allows
   * 3. Starts the periodic checkpoint timer
   * 4. Installs process exit watcher if not already installed
   *
   * If a session is already active for this profile, it is ended first.
   */
  async startSession(
    profileId: string,
    adapter: BrowserSessionAdapter,
    target: SessionStateRuntimeTarget = "managed_profile",
  ): Promise<void> {
    // End any existing session for this profile
    if (this.activeSessions.has(profileId)) {
      log.info(`[${profileId}] ending existing session before starting new one`);
      await this.endSession(profileId);
    }

    await this.runtimeService.prepare(profileId, target);

    // Restore — non-fatal
    const restored = await this.runtimeService.restoreSessionState(profileId, adapter, target);
    log.info(`[${profileId}] session started (restored=${restored})`);

    // Start checkpoint timer
    await this.runtimeService.startCheckpointTimer(profileId, adapter, target);

    // Track active session
    this.activeSessions.set(profileId, {
      profileId,
      adapter,
      target,
      startedAt: Date.now(),
    });

    // Install process exit watcher if first session
    this.ensureProcessExitWatcher();
  }

  /**
   * End a managed session — the primary flush call point.
   *
   * 1. Stops the checkpoint timer
   * 2. Flushes current state to disk (forced write)
   * 3. Removes from active sessions
   *
   * Called at:
   * - Task end
   * - Explicit browser close
   * - Profile switch (via switchProfile)
   * - Process shutdown (via endAllSessions)
   */
  async endSession(profileId: string): Promise<void> {
    const session = this.activeSessions.get(profileId);
    if (!session) {
      log.debug(`[${profileId}] endSession: no active session`);
      return;
    }

    // Stop timer first
    this.runtimeService.stopCheckpointTimer(profileId);

    // Flush — capture final state
    try {
      await this.runtimeService.flushSessionState(profileId, session.adapter, session.target);
      log.info(`[${profileId}] session ended: flushed successfully`);
    } catch (err) {
      log.error(`[${profileId}] session end flush failed:`, err);
    }

    this.activeSessions.delete(profileId);

    // Remove process exit watcher if no more sessions
    if (this.activeSessions.size === 0) {
      this.removeProcessExitWatcher();
    }
  }

  /**
   * Switch from one profile to another atomically.
   *
   * 1. Ends the old profile session (flush + stop)
   * 2. Starts the new profile session (prepare + restore + timer)
   */
  async switchProfile(
    fromProfileId: string,
    toProfileId: string,
    toAdapter: BrowserSessionAdapter,
  ): Promise<void> {
    log.info(`switching profile: ${fromProfileId} → ${toProfileId}`);
    await this.endSession(fromProfileId);
    await this.startSession(toProfileId, toAdapter);
  }

  /**
   * End all active sessions — called on service shutdown.
   *
   * Best-effort: errors during individual session flush are logged
   * but do not prevent other sessions from being flushed.
   */
  async endAllSessions(): Promise<void> {
    const profileIds = [...this.activeSessions.keys()];
    if (profileIds.length === 0) return;

    log.info(`ending all sessions: ${profileIds.join(", ")}`);
    for (const profileId of profileIds) {
      try {
        await this.endSession(profileId);
      } catch (err) {
        log.error(`[${profileId}] endAllSessions flush failed (continuing):`, err);
      }
    }
  }

  // ── Introspection ────────────────────────────────────────────────────────

  /** Check if a profile has an active session. */
  hasActiveSession(profileId: string): boolean {
    return this.activeSessions.has(profileId);
  }

  /** Get all active profile IDs. */
  getActiveProfileIds(): string[] {
    return [...this.activeSessions.keys()];
  }

  /** Get the count of active sessions. */
  get activeSessionCount(): number {
    return this.activeSessions.size;
  }

  /** Get the runtime target for an active session, or null if no session. */
  getSessionTarget(profileId: string): SessionStateRuntimeTarget | null {
    return this.activeSessions.get(profileId)?.target ?? null;
  }

  // ── Best-effort process exit watcher ─────────────────────────────────────

  /**
   * Install a process 'beforeExit' handler that flushes all active sessions.
   *
   * This is best-effort:
   * - 'beforeExit' only fires when the event loop is empty (not on SIGTERM/SIGKILL)
   * - Flush errors are logged, not thrown
   * - The watcher is automatically removed when no sessions are active
   */
  private ensureProcessExitWatcher(): void {
    if (this.processExitBound) return;

    this.processExitBound = () => {
      // beforeExit can fire multiple times; guard with session check
      if (this.activeSessions.size === 0) return;

      log.info(`process beforeExit: attempting best-effort flush of ${this.activeSessions.size} session(s)`);

      // We cannot await in beforeExit, but we can schedule the flush.
      // This is inherently best-effort — the process may exit before
      // all flushes complete. For reliable flush, callers must use
      // endAllSessions() explicitly in their shutdown path.
      this.endAllSessions().catch((err) => {
        log.error("process beforeExit: flush failed (best-effort):", err);
      });
    };

    process.on("beforeExit", this.processExitBound);
    log.debug("process exit watcher installed");
  }

  private removeProcessExitWatcher(): void {
    if (!this.processExitBound) return;

    process.removeListener("beforeExit", this.processExitBound);
    this.processExitBound = null;
    log.debug("process exit watcher removed");
  }

  /**
   * Perform a best-effort flush for a specific profile.
   *
   * Unlike endSession, this does NOT stop the timer or remove the session.
   * Used by external watchers (e.g. disconnect detection) that want to
   * capture current state without ending the session.
   *
   * Errors are logged and swallowed — this is always non-fatal.
   */
  async bestEffortFlush(profileId: string): Promise<boolean> {
    const session = this.activeSessions.get(profileId);
    if (!session) {
      log.debug(`[${profileId}] bestEffortFlush: no active session`);
      return false;
    }

    try {
      await this.runtimeService.flushSessionState(profileId, session.adapter, session.target);
      log.info(`[${profileId}] bestEffortFlush: flushed successfully`);
      return true;
    } catch (err) {
      log.warn(`[${profileId}] bestEffortFlush failed (non-fatal):`, err);
      return false;
    }
  }
}
