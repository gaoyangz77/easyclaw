import { createHash } from "node:crypto";
import type { BrowserProfileSessionStatePolicy, SessionStateRuntimeTarget } from "@rivonclaw/core";
import { DEFAULT_SESSION_STATE_POLICY } from "@rivonclaw/core";
import { createLogger } from "@rivonclaw/logger";
import { SessionSnapshotStore, createNoopBackupProvider } from "./session-state/index.js";
import type { SnapshotManifest } from "./session-state/index.js";
import type { BrowserSessionAdapter, BrowserCookie, SessionStateBackupProvider } from "./session-state/index.js";

const log = createLogger("browser-profile-runtime");

/**
 * Callback that resolves the persisted session state policy for a profile.
 *
 * In production this reads from the profile's stored config
 * (SQLite / cloud-synced metadata). Returns null if the profile has
 * no explicit policy, in which case DEFAULT_SESSION_STATE_POLICY applies.
 */
export type ProfilePolicyResolver = (
  profileId: string,
) => Promise<BrowserProfileSessionStatePolicy | null> | BrowserProfileSessionStatePolicy | null;

/** Runtime state summary for a profile (computed, not persisted). */
export interface RuntimeStateSummary {
  profileId: string;
  hasSnapshot: boolean;
  snapshotMeta: SnapshotManifest | null;
  policy: BrowserProfileSessionStatePolicy;
  lastRestoreAt?: number;
  lastCheckpointAt?: number;
}

/** Result of a checkpoint operation. */
export interface CheckpointResult {
  skipped: boolean;
  reason: "no_change" | "mode_off" | "written";
  cookieCount?: number;
  hash?: string;
}

/** Per-profile checkpoint timer state. */
interface CheckpointTimer {
  timer: ReturnType<typeof setInterval>;
  profileId: string;
  adapter: BrowserSessionAdapter;
  target: SessionStateRuntimeTarget;
}

/**
 * Compute a stable SHA-256 hash of a cookie array.
 *
 * Cookies are sorted by (domain, path, name) before hashing to ensure
 * deterministic output regardless of browser enumeration order.
 */
export function computeCookieHash(cookies: BrowserCookie[]): string {
  const sorted = [...cookies].sort((a, b) => {
    const d = a.domain.localeCompare(b.domain);
    if (d !== 0) return d;
    const p = a.path.localeCompare(b.path);
    if (p !== 0) return p;
    return a.name.localeCompare(b.name);
  });
  const payload = JSON.stringify(sorted);
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * BrowserProfileRuntimeService — desktop runtime/data-plane service.
 *
 * Owns the session state lifecycle for managed browser profiles:
 * - prepare: ensure directories and resolve policy
 * - restoreSessionState: load cookies from snapshot into browser
 * - checkpointSessionState: read cookies, diff against last snapshot, write if changed
 * - flushSessionState: force-write current cookies regardless of diff
 * - startCheckpointTimer / stopCheckpointTimer: periodic checkpoint management
 *
 * Policy resolution order (first non-null wins):
 * 1. profileResolver callback (reads from profile model / storage)
 * 2. DEFAULT_SESSION_STATE_POLICY from @rivonclaw/core
 *
 * Storage modes:
 * - storage="local": Local is the sole authority. No cloud interaction.
 * - storage="cloud": Cloud-authoritative mode. Cloud is the source of
 *   truth; local is a performance cache. Restore compares cloud and local
 *   manifests by updatedAt to select the fresher snapshot.
 *
 * Other notes:
 * - Supports cookies_only mode fully
 * - cookies_and_storage mode is stubbed (logs warning, operates on cookies only)
 * - No browser process watcher — flush must be called explicitly
 */
export class BrowserProfileRuntimeService {
  private readonly store: SessionSnapshotStore;
  private readonly profileResolver: ProfilePolicyResolver;
  private readonly backupProvider: SessionStateBackupProvider;
  private readonly checkpointTimers: Map<string, CheckpointTimer> = new Map();
  private readonly lastRestoreAt: Map<string, number> = new Map();
  private readonly lastCheckpointAt: Map<string, number> = new Map();

  constructor(
    store: SessionSnapshotStore,
    profileResolver?: ProfilePolicyResolver,
    backupProvider?: SessionStateBackupProvider,
  ) {
    this.store = store;
    this.profileResolver = profileResolver ?? (() => null);
    this.backupProvider = backupProvider ?? createNoopBackupProvider();
  }

  /**
   * Prepare a profile for session state management.
   * Ensures the session-state directory exists and returns the effective policy.
   */
  async prepare(profileId: string, target: SessionStateRuntimeTarget): Promise<BrowserProfileSessionStatePolicy> {
    await this.store.ensureDir(target, profileId);
    return this.getSessionStatePolicy(profileId);
  }

  /**
   * Load the snapshot manifest for a profile.
   * Returns null if no snapshot has been taken yet.
   */
  async loadSnapshotMeta(target: SessionStateRuntimeTarget, profileId: string): Promise<SnapshotManifest | null> {
    return this.store.readManifest(target, profileId);
  }

  /**
   * Save/update the snapshot manifest for a profile.
   */
  async saveSnapshotMeta(target: SessionStateRuntimeTarget, profileId: string, meta: SnapshotManifest): Promise<void> {
    await this.store.writeManifest(target, profileId, meta);
  }

  /**
   * Get the effective session state policy for a profile.
   *
   * Resolves from the profile model via the injected resolver.
   * Falls back to DEFAULT_SESSION_STATE_POLICY if the resolver returns null.
   */
  async getSessionStatePolicy(profileId: string): Promise<BrowserProfileSessionStatePolicy> {
    const resolved = await this.profileResolver(profileId);
    return resolved ?? DEFAULT_SESSION_STATE_POLICY;
  }

  /**
   * Check whether session state should be restored when this profile's browser launches.
   */
  async shouldRestoreOnLaunch(target: SessionStateRuntimeTarget, profileId: string): Promise<boolean> {
    const policy = await this.getSessionStatePolicy(profileId);
    if (policy.mode === "off") return false;
    return this.store.hasManifest(target, profileId);
  }

  // ── Restore ──────────────────────────────────────────────────────────────

  /**
   * Restore session state into the browser.
   *
   * For storage="local": reads from local snapshot only.
   * For storage="cloud": compares cloud and local manifests by updatedAt
   * and uses the fresher snapshot. Cloud is authoritative — local is a cache.
   *
   * Errors are logged but do not propagate — restore must not crash the runtime.
   */
  async restoreSessionState(
    profileId: string,
    adapter: BrowserSessionAdapter,
    target: SessionStateRuntimeTarget,
  ): Promise<boolean> {
    const policy = await this.getSessionStatePolicy(profileId);
    if (policy.mode === "off") {
      log.debug(`[${profileId}] restore skipped: mode=off`);
      return false;
    }

    try {
      let raw: Buffer | null = null;

      if (policy.storage === "cloud") {
        // Cloud-authoritative: compare cloud and local manifests by updatedAt
        const localManifest = await this.store.readManifest(target, profileId);
        let cloudData: { manifest: SnapshotManifest; payload: Buffer } | null = null;

        try {
          cloudData = await this.backupProvider.download(profileId);
        } catch (err) {
          log.warn(`[${profileId}] cloud download failed (non-fatal):`, err);
        }

        if (cloudData && !localManifest) {
          // Cloud exists, no local — use cloud
          log.info(`[${profileId}] no local snapshot, using cloud`);
          await this.store.writeCookieSnapshot(target, profileId, cloudData.payload);
          await this.store.writeManifest(target, profileId, cloudData.manifest);
          raw = cloudData.payload;
        } else if (cloudData && localManifest && cloudData.manifest.updatedAt > localManifest.updatedAt) {
          // Cloud is fresher — use cloud
          log.info(`[${profileId}] cloud snapshot is fresher, using cloud`);
          await this.store.writeCookieSnapshot(target, profileId, cloudData.payload);
          await this.store.writeManifest(target, profileId, cloudData.manifest);
          raw = cloudData.payload;
        } else if (localManifest) {
          // Local exists and is fresher (or cloud unavailable) — use local cache
          log.info(`[${profileId}] using local cache`);
          raw = await this.store.readCookieSnapshot(target, profileId);
        }
        // else: neither cloud nor local exists — raw stays null
      } else {
        // storage="local": local is the sole authority
        raw = await this.store.readCookieSnapshot(target, profileId);
      }

      if (!raw) {
        log.debug(`[${profileId}] restore skipped: no snapshot available`);
        return false;
      }

      const cookies: BrowserCookie[] = JSON.parse(raw.toString("utf-8"));
      await adapter.replaceCookies(cookies);
      this.lastRestoreAt.set(profileId, Date.now());
      log.info(`[${profileId}] restored ${cookies.length} cookies from snapshot (replaced)`);
      return true;
    } catch (err) {
      log.warn(`[${profileId}] restore failed (non-fatal):`, err);
      return false;
    }
  }

  // ── Checkpoint (incremental diff) ────────────────────────────────────────

  /**
   * Checkpoint current browser session state to disk.
   *
   * 1. Reads cookies from the browser via adapter
   * 2. Computes a stable hash
   * 3. Compares with the last manifest hash — skips write if unchanged
   * 4. Writes snapshot + manifest only when data actually changed
   */
  async checkpointSessionState(
    profileId: string,
    adapter: BrowserSessionAdapter,
    target: SessionStateRuntimeTarget,
  ): Promise<CheckpointResult> {
    const policy = await this.getSessionStatePolicy(profileId);
    if (policy.mode === "off") {
      return { skipped: true, reason: "mode_off" };
    }

    if (policy.mode === "cookies_and_storage") {
      log.warn(`[${profileId}] cookies_and_storage mode not yet implemented; checkpointing cookies only`);
    }

    const cookies = await adapter.getCookies();
    const hash = computeCookieHash(cookies);

    // Incremental diff: compare with last manifest
    const existingManifest = await this.store.readManifest(target, profileId);
    if (existingManifest && existingManifest.hash === hash) {
      log.debug(`[${profileId}] checkpoint skipped: no change (hash=${hash.slice(0, 12)}…)`);
      return { skipped: true, reason: "no_change", cookieCount: cookies.length, hash };
    }

    // Data changed — write snapshot + manifest
    const payload = Buffer.from(JSON.stringify(cookies), "utf-8");
    await this.store.writeCookieSnapshot(target, profileId, payload);

    const manifest: SnapshotManifest = {
      profileId,
      target,
      updatedAt: Date.now(),
      hash,
      cookieCount: cookies.length,
    };
    await this.store.writeManifest(target, profileId, manifest);
    this.lastCheckpointAt.set(profileId, Date.now());

    // Cloud backup — best-effort, non-blocking
    if (policy.storage === "cloud") {
      this.backupProvider.upload(profileId, manifest, payload).catch((err) => {
        log.warn(`[${profileId}] cloud backup upload failed (non-fatal):`, err);
      });
    }

    log.info(`[${profileId}] checkpoint written: ${cookies.length} cookies, hash=${hash.slice(0, 12)}…`);
    return { skipped: false, reason: "written", cookieCount: cookies.length, hash };
  }

  // ── Flush (forced write) ─────────────────────────────────────────────────

  /**
   * Write current browser session state to disk if data changed.
   *
   * Called on task end or explicit close. Unlike checkpoint, flush does not
   * rely on the periodic timer, but still skips writing identical data.
   */
  async flushSessionState(
    profileId: string,
    adapter: BrowserSessionAdapter,
    target: SessionStateRuntimeTarget,
  ): Promise<void> {
    const policy = await this.getSessionStatePolicy(profileId);
    if (policy.mode === "off") {
      log.debug(`[${profileId}] flush skipped: mode=off`);
      return;
    }

    if (policy.mode === "cookies_and_storage") {
      log.warn(`[${profileId}] cookies_and_storage mode not yet implemented; flushing cookies only`);
    }

    const cookies = await adapter.getCookies();
    const hash = computeCookieHash(cookies);

    // Skip if data hasn't changed since last write
    const existingManifest = await this.store.readManifest(target, profileId);
    if (existingManifest && existingManifest.hash === hash) {
      log.debug(`[${profileId}] flush skipped: no change`);
      return;
    }

    const payload = Buffer.from(JSON.stringify(cookies), "utf-8");
    await this.store.writeCookieSnapshot(target, profileId, payload);

    const manifest: SnapshotManifest = {
      profileId,
      target,
      updatedAt: Date.now(),
      hash,
      cookieCount: cookies.length,
    };
    await this.store.writeManifest(target, profileId, manifest);
    this.lastCheckpointAt.set(profileId, Date.now());

    // Cloud backup — best-effort, non-blocking
    if (policy.storage === "cloud") {
      this.backupProvider.upload(profileId, manifest, payload).catch((err) => {
        log.warn(`[${profileId}] cloud backup upload failed (non-fatal):`, err);
      });
    }

    log.info(`[${profileId}] flush written: ${cookies.length} cookies`);
  }

  // ── Checkpoint Timer ─────────────────────────────────────────────────────

  /**
   * Start a periodic checkpoint timer for a profile.
   *
   * Reads checkpointIntervalSec from the profile's policy and sets up
   * a repeating timer. If a timer is already running for this profile,
   * the old one is stopped first.
   */
  async startCheckpointTimer(
    profileId: string,
    adapter: BrowserSessionAdapter,
    target: SessionStateRuntimeTarget,
  ): Promise<void> {
    // Stop any existing timer for this profile
    this.stopCheckpointTimer(profileId);

    const policy = await this.getSessionStatePolicy(profileId);
    if (policy.mode === "off") {
      log.debug(`[${profileId}] checkpoint timer not started: mode=off`);
      return;
    }

    const intervalMs = policy.checkpointIntervalSec * 1000;
    if (intervalMs <= 0) {
      log.debug(`[${profileId}] checkpoint timer not started: interval=0`);
      return;
    }

    const timer = setInterval(async () => {
      try {
        await this.checkpointSessionState(profileId, adapter, target);
      } catch (err) {
        log.warn(`[${profileId}] periodic checkpoint failed (non-fatal):`, err);
      }
    }, intervalMs);

    // Don't prevent Node.js from exiting due to checkpoint timers
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    this.checkpointTimers.set(profileId, { timer, profileId, adapter, target });
    log.info(`[${profileId}] checkpoint timer started: every ${policy.checkpointIntervalSec}s`);
  }

  /**
   * Stop the periodic checkpoint timer for a profile.
   * No-op if no timer is running.
   */
  stopCheckpointTimer(profileId: string): void {
    const existing = this.checkpointTimers.get(profileId);
    if (existing) {
      clearInterval(existing.timer);
      this.checkpointTimers.delete(profileId);
      log.info(`[${profileId}] checkpoint timer stopped`);
    }
  }

  /**
   * Stop all checkpoint timers. Call on service shutdown.
   */
  stopAllCheckpointTimers(): void {
    for (const [profileId] of this.checkpointTimers) {
      this.stopCheckpointTimer(profileId);
    }
  }

  /**
   * Check if a checkpoint timer is running for a profile.
   */
  hasCheckpointTimer(profileId: string): boolean {
    return this.checkpointTimers.has(profileId);
  }

  // ── Runtime State Summary ────────────────────────────────────────────────

  /**
   * Get a runtime state summary for a profile (for UI/diagnostics).
   */
  async getRuntimeStateSummary(target: SessionStateRuntimeTarget, profileId: string): Promise<RuntimeStateSummary> {
    const policy = await this.getSessionStatePolicy(profileId);
    const snapshotMeta = await this.store.readManifest(target, profileId);
    return {
      profileId,
      hasSnapshot: snapshotMeta !== null,
      snapshotMeta,
      policy,
      lastRestoreAt: this.lastRestoreAt.get(profileId),
      lastCheckpointAt: this.lastCheckpointAt.get(profileId),
    };
  }
}
