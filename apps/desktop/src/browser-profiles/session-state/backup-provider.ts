import { createLogger } from "@rivonclaw/logger";
import type { AuthSessionManager } from "../../auth/auth-session.js";
import type { SnapshotManifest } from "./store.js";

const log = createLogger("session-backup");

/**
 * Pluggable backup provider for session state snapshots.
 *
 * The runtime checks `policy.storage` and dispatches to the appropriate
 * provider. "local" is always handled by SessionSnapshotStore directly;
 * "cloud" goes through this interface.
 *
 * In "cloud" mode, the cloud is the authoritative store. Local disk
 * serves as a performance cache but is not the source of truth. Restore
 * compares cloud and local manifests by updatedAt to select the fresher
 * snapshot, ensuring cross-device consistency.
 */
export interface SessionStateBackupProvider {
  /**
   * Upload a session state snapshot to the remote store.
   * Called after a local checkpoint/flush when policy.storage === "cloud".
   *
   * @param profileId - The profile that owns this snapshot
   * @param manifest  - Snapshot metadata (hash, cookieCount, etc.)
   * @param payload   - Encrypted snapshot data (same bytes written locally)
   * @returns true if upload succeeded, false otherwise
   */
  upload(profileId: string, manifest: SnapshotManifest, payload: Buffer): Promise<boolean>;

  /**
   * Download the latest snapshot from the remote store.
   * Called during restore when no local snapshot exists but cloud has one.
   *
   * @returns The snapshot payload, or null if none exists remotely
   */
  download(profileId: string): Promise<{ manifest: SnapshotManifest; payload: Buffer } | null>;

  /**
   * Delete remote snapshot data for a profile.
   * Called when a profile is archived or deleted.
   */
  delete(profileId: string): Promise<void>;
}

/**
 * No-op backup provider — used when cloud backup is not configured.
 * All operations succeed silently without doing anything.
 *
 * @internal
 */
export function createNoopBackupProvider(): SessionStateBackupProvider {
  return {
    async upload() {
      return true;
    },
    async download() {
      return null;
    },
    async delete() {},
  };
}

/**
 * Create a cloud backup provider that uploads/downloads encrypted snapshots
 * via the authenticated GraphQL backend.
 *
 * The payload is already AES-256-GCM encrypted locally — the cloud stores
 * opaque base64 blobs and never sees plaintext cookies.
 *
 * Only supported for managed_profile target. CDP sessions have no cloud
 * profile to back up against.
 */
export function createCloudBackupProvider(authSession: AuthSessionManager): SessionStateBackupProvider {
  return {
    async upload(profileId, manifest, payload) {
      if (!authSession.getAccessToken()) return false;
      try {
        await authSession.graphqlFetch(
          `mutation ($profileId: ID!, $manifest: SessionStateBackupManifestInput!, $payload: String!) {
            uploadSessionStateBackup(profileId: $profileId, manifest: $manifest, payload: $payload)
          }`,
          {
            profileId,
            manifest: {
              profileId: manifest.profileId,
              target: manifest.target,
              updatedAt: manifest.updatedAt,
              hash: manifest.hash,
              cookieCount: manifest.cookieCount,
            },
            payload: payload.toString("base64"),
          },
        );
        return true;
      } catch (err) {
        log.warn(`[${profileId}] cloud backup upload failed:`, err);
        return false;
      }
    },

    async download(profileId) {
      if (!authSession.getAccessToken()) return null;
      try {
        const data = await authSession.graphqlFetch<{
          sessionStateBackup: { manifest: SnapshotManifest; payload: string } | null;
        }>(
          `query ($profileId: ID!) {
            sessionStateBackup(profileId: $profileId) {
              manifest { profileId target updatedAt hash cookieCount }
              payload
            }
          }`,
          { profileId },
        );
        if (!data.sessionStateBackup) return null;
        return {
          manifest: data.sessionStateBackup.manifest,
          payload: Buffer.from(data.sessionStateBackup.payload, "base64"),
        };
      } catch (err) {
        log.warn(`[${profileId}] cloud backup download failed:`, err);
        return null;
      }
    },

    async delete(profileId) {
      if (!authSession.getAccessToken()) return;
      try {
        await authSession.graphqlFetch(
          `mutation ($profileId: ID!) { deleteSessionStateBackup(profileId: $profileId) }`,
          { profileId },
        );
      } catch (err) {
        log.warn(`[${profileId}] cloud backup delete failed:`, err);
      }
    },
  };
}
