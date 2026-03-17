import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import type { SessionStateRuntimeTarget } from "@rivonclaw/core";
import { manifestPath, cookieSnapshotPath, sessionStateDirPath } from "./paths.js";
import type { SessionStateCrypto } from "./crypto.js";

/**
 * Snapshot metadata stored in manifest.json.
 * Mirrors BrowserProfileSessionSnapshotMeta from @rivonclaw/core.
 */
export interface SnapshotManifest {
  profileId: string;
  target: SessionStateRuntimeTarget;
  updatedAt: number;
  hash: string;
  cookieCount: number;
  storageKeys?: string[];
}

/**
 * Local session state snapshot store.
 *
 * Responsibilities:
 * - Read/write manifest.json for a profile's session state
 * - Read/write cookie snapshot files (via pluggable crypto)
 * - Ensure directory structure exists
 *
 * Design notes:
 * - local-first: no cloud dependency
 * - profile-scoped: each profile has its own session-state directory
 * - target-namespaced: different runtime targets store data in separate directories
 * - cloud: store handles local cache; cloud authority is managed by the runtime service
 * - crypto is required: callers must explicitly provide an implementation.
 *   Use createPlaintextCrypto() in tests only.
 */
export class SessionSnapshotStore {
  private readonly basePath: string;
  private readonly crypto: SessionStateCrypto;

  constructor(basePath: string, crypto: SessionStateCrypto) {
    this.basePath = basePath;
    this.crypto = crypto;
  }

  /** Ensure the session-state directory exists for a target/profile. */
  async ensureDir(target: SessionStateRuntimeTarget, profileId: string): Promise<string> {
    const dir = sessionStateDirPath(this.basePath, target, profileId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** Check whether a manifest exists for this target/profile. */
  async hasManifest(target: SessionStateRuntimeTarget, profileId: string): Promise<boolean> {
    try {
      await access(manifestPath(this.basePath, target, profileId));
      return true;
    } catch {
      return false;
    }
  }

  /** Read the snapshot manifest for a target/profile. Returns null if not found. */
  async readManifest(target: SessionStateRuntimeTarget, profileId: string): Promise<SnapshotManifest | null> {
    try {
      const raw = await readFile(manifestPath(this.basePath, target, profileId), "utf-8");
      return JSON.parse(raw) as SnapshotManifest;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  /** Write or overwrite the snapshot manifest for a target/profile. */
  async writeManifest(target: SessionStateRuntimeTarget, profileId: string, manifest: SnapshotManifest): Promise<void> {
    await this.ensureDir(target, profileId);
    const path = manifestPath(this.basePath, target, profileId);
    await writeFile(path, JSON.stringify(manifest, null, 2), "utf-8");
  }

  /** Read the cookie snapshot, decrypting via the configured crypto. Returns null if not found. */
  async readCookieSnapshot(target: SessionStateRuntimeTarget, profileId: string): Promise<Buffer | null> {
    try {
      const raw = await readFile(cookieSnapshotPath(this.basePath, target, profileId));
      return await this.crypto.decrypt(raw);
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  /** Write the cookie snapshot, encrypting via the configured crypto. */
  async writeCookieSnapshot(target: SessionStateRuntimeTarget, profileId: string, data: Buffer): Promise<void> {
    await this.ensureDir(target, profileId);
    const encrypted = await this.crypto.encrypt(data);
    await writeFile(cookieSnapshotPath(this.basePath, target, profileId), encrypted);
  }
}
