import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import { types, getRoot, flow, applySnapshot, getSnapshot, type Instance } from "mobx-state-tree";
import { DEFAULTS } from "@rivonclaw/core";
import { resolveCredentialsDir } from "@rivonclaw/core/node";
import { resolveOpenClawConfigPath } from "@rivonclaw/gateway";
import type { GatewayRpcClient } from "@rivonclaw/gateway";
import type { Storage } from "@rivonclaw/storage";
import { syncOwnerAllowFrom } from "../auth/owner-sync.js";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("mobile-manager");

/** How long a pairing code stays valid (ms). Shared with panel via API response. */
export const PAIRING_CODE_TTL_MS = DEFAULTS.desktop.pairingCodeTtlMs;

// ---------------------------------------------------------------------------
// Environment interface -- late-initialized infrastructure dependencies.
// ---------------------------------------------------------------------------

export interface MobileManagerEnv {
  storage: Storage;
  controlPlaneUrl: string;
  stateDir: string;
  getRpcClient: () => GatewayRpcClient | null;
}

// ---------------------------------------------------------------------------
// Allowlist file helpers
// ---------------------------------------------------------------------------

interface AllowFromStore {
  version: number;
  allowFrom: string[];
}

async function readMobileAllowlist(): Promise<string[]> {
  try {
    const filePath = join(resolveCredentialsDir(), "mobile-allowFrom.json");
    const content = await fs.readFile(filePath, "utf-8");
    const data: AllowFromStore = JSON.parse(content);
    return Array.isArray(data.allowFrom) ? data.allowFrom : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeMobileAllowlist(allowFrom: string[]): Promise<void> {
  const credDir = resolveCredentialsDir();
  await fs.mkdir(credDir, { recursive: true });
  const filePath = join(credDir, "mobile-allowFrom.json");
  const data: AllowFromStore = { version: 1, allowFrom };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// MST Model
// ---------------------------------------------------------------------------

export const MobileManagerModel = types
  .model("MobileManager", {
    initialized: types.optional(types.boolean, false),
  })
  .volatile(() => ({
    _env: null as MobileManagerEnv | null,
    activeCode: null as { code: string; expiresAt: number } | null,
    desktopDeviceId: null as string | null,
  }))
  .views((self) => ({
    get root(): any {
      return getRoot(self);
    },
  }))
  .views((self) => ({
    /** Get unexpired active pairing code, or null. */
    getActiveCode(): { code: string; expiresAt: number } | null {
      if (self.activeCode && self.activeCode.expiresAt > Date.now()) {
        return self.activeCode;
      }
      return null;
    },
  }))
  .actions((self) => {
    function getEnv(): MobileManagerEnv {
      if (!self._env) throw new Error("MobileManager not initialized -- call setEnv() first");
      return self._env;
    }

    /**
     * One-time migration: re-key allowlist entries from mobileDeviceId to pairingId.
     */
    let allowlistMigrated = false;

    async function migrateAllowlistToPairingId(): Promise<void> {
      if (allowlistMigrated) return;
      allowlistMigrated = true;

      try {
        const { storage } = getEnv();
        const allPairings = storage.mobilePairings.getAllPairings();
        if (allPairings.length === 0) return;

        const allowlist = await readMobileAllowlist();
        if (allowlist.length === 0) return;

        let changed = false;
        const newAllowlist = [...allowlist];

        for (let i = 0; i < newAllowlist.length; i++) {
          const entry = newAllowlist[i];
          const pairing = allPairings.find(
            (p) => p.mobileDeviceId === entry && p.pairingId && p.pairingId !== entry,
          );
          if (pairing?.pairingId) {
            newAllowlist[i] = pairing.pairingId;
            storage.channelRecipients.delete("mobile", entry);
            storage.channelRecipients.ensureExists("mobile", pairing.pairingId, false);
            changed = true;
            log.info(`Migrated allowlist entry ${entry} -> ${pairing.pairingId}`);
          }
        }

        if (changed) {
          await writeMobileAllowlist(newAllowlist);
          const configPath = resolveOpenClawConfigPath();
          syncOwnerAllowFrom(storage, configPath);
        }
      } catch (err: any) {
        log.error("Allowlist migration failed:", err);
      }
    }

    return {
      /** Set the environment dependencies. Called once during startup. */
      setEnv(env: MobileManagerEnv) {
        self._env = env;
      },

      /** Initialize from SQLite. Loads all pairings into MST, initializes device ID, runs migration. */
      init() {
        const { storage } = getEnv();
        const allPairings = storage.mobilePairings.getAllPairings();
        (getRoot(self) as any).loadMobilePairings(
          allPairings.map((p) => ({
            id: p.id,
            pairingId: p.pairingId ?? null,
            deviceId: p.deviceId,
            accessToken: p.accessToken,
            relayUrl: p.relayUrl,
            createdAt: p.createdAt,
            expiresAt: p.expiresAt ?? null,
            mobileDeviceId: p.mobileDeviceId ?? null,
            name: p.name ?? null,
            status: p.status ?? "active",
          })),
        );

        // Eagerly resolve desktop device ID
        this.getDesktopDeviceId();

        self.initialized = true;
        log.info(`Mobile manager initialized with ${allPairings.length} pairing(s)`);

        // Fire-and-forget migration
        migrateAllowlistToPairingId().catch((err) => {
          log.error("Allowlist migration failed:", err);
        });
      },

      /** Read, generate, or persist the desktop device ID. */
      getDesktopDeviceId(): string {
        if (self.desktopDeviceId) {
          return self.desktopDeviceId;
        }

        const { stateDir } = getEnv();
        if (stateDir) {
          const idDir = join(stateDir, "identity");
          const idPath = join(idDir, "mobile-desktop-id.txt");
          try {
            const stored = readFileSync(idPath, "utf-8").trim();
            if (stored) {
              self.desktopDeviceId = stored;
              return stored;
            }
          } catch {
            // File doesn't exist yet -- will create below
          }

          const id = randomUUID();
          try {
            mkdirSync(idDir, { recursive: true });
            writeFileSync(idPath, id, "utf-8");
          } catch (err) {
            log.error("Failed to persist desktop device ID:", err);
          }
          self.desktopDeviceId = id;
          return id;
        }

        self.desktopDeviceId = randomUUID();
        return self.desktopDeviceId;
      },

      /**
       * Persist a new pairing to SQLite and update the MST store.
       * Returns the pairing data as stored.
       */
      addPairing(data: {
        pairingId?: string;
        deviceId: string;
        accessToken: string;
        relayUrl: string;
        mobileDeviceId?: string;
      }) {
        const { storage } = getEnv();
        const newPairing = storage.mobilePairings.setPairing(data);

        (getRoot(self) as any).upsertMobilePairing({
          id: newPairing.id,
          pairingId: newPairing.pairingId ?? null,
          deviceId: newPairing.deviceId,
          accessToken: newPairing.accessToken,
          relayUrl: newPairing.relayUrl,
          createdAt: newPairing.createdAt,
          expiresAt: newPairing.expiresAt ?? null,
          mobileDeviceId: newPairing.mobileDeviceId ?? null,
          name: newPairing.name ?? null,
          status: newPairing.status ?? "active",
        });

        return newPairing;
      },

      /**
       * Remove a single pairing by its internal ID.
       * Cleans up SQLite, allowlist, channel_recipients, and stops the sync engine.
       */
      removePairing(id: string) {
        const { storage, getRpcClient } = getEnv();

        // Look up pairing from MST to get the allowlist key before deletion
        const pairing = self.root.mobilePairings.find((p: any) => p.id === id);
        const allowlistKey = pairing?.pairingId || pairing?.id;

        // Remove from SQLite
        storage.mobilePairings.removePairingById(id);

        // Remove from MST
        (getRoot(self) as any).removeMobilePairing(id);

        // Async cleanup: allowlist + channel_recipients + RPC (fire-and-forget)
        (async () => {
          try {
            if (allowlistKey) {
              const allowlist = await readMobileAllowlist();
              const filtered = allowlist.filter((e) => e !== allowlistKey);
              if (filtered.length !== allowlist.length) {
                await writeMobileAllowlist(filtered);
              }
              storage.channelRecipients.delete("mobile", allowlistKey);
            }
            const configPath = resolveOpenClawConfigPath();
            syncOwnerAllowFrom(storage, configPath);
          } catch (err: any) {
            log.error("Failed to cleanup allowlist after removePairing:", err);
          }
        })();

        // Stop sync engine
        const rpcClient = getRpcClient();
        if (rpcClient?.isConnected()) {
          rpcClient.request("mobile_chat_stop_sync", {
            pairingId: allowlistKey,
          }).catch((err: any) => {
            log.error("Failed to stop mobile sync via RPC:", err);
          });
        }

        log.info("Mobile pairing disconnected:", id);
      },

      /** Disconnect all pairings. Clears SQLite, allowlist, and stops all sync engines. */
      disconnectAll() {
        const { storage, getRpcClient } = getEnv();

        // Read allowlist entries before clearing (for channel_recipients cleanup)
        const cleanupAllowlist = readMobileAllowlist().then(async (allowlist) => {
          try {
            for (const entry of allowlist) {
              storage.channelRecipients.delete("mobile", entry);
            }
            await writeMobileAllowlist([]);
            const configPath = resolveOpenClawConfigPath();
            syncOwnerAllowFrom(storage, configPath);
          } catch (err: any) {
            log.error("Failed to cleanup allowlist after disconnectAll:", err);
          }
        }).catch((err) => {
          log.error("Failed to read allowlist for disconnectAll cleanup:", err);
        });

        // Clear SQLite
        storage.mobilePairings.clearPairing();

        // Clear active code
        self.activeCode = null;

        // Clear MST
        (getRoot(self) as any).loadMobilePairings([]);

        // Stop all sync engines
        const rpcClient = getRpcClient();
        if (rpcClient?.isConnected()) {
          rpcClient.request("mobile_chat_stop_sync", {
            pairingId: undefined,
          }).catch((err: any) => {
            log.error("Failed to stop mobile sync via RPC:", err);
          });
        }

        log.info("All mobile pairings disconnected");
      },

      /** Mark a pairing as stale in both SQLite and MST. */
      markStale(id: string) {
        const { storage } = getEnv();
        storage.mobilePairings.markPairingStale(id);

        const pairing = self.root.mobilePairings.find((p: any) => p.id === id);
        if (pairing) {
          // Use applySnapshot to modify a node owned by a sibling branch
          applySnapshot(pairing, { ...(getSnapshot(pairing) as Record<string, unknown>), status: "stale" });
        }
      },

      /** Request a new pairing code from the control plane. */
      requestPairingCode: flow(function* () {
        const { controlPlaneUrl } = getEnv();
        const desktopDeviceId = self.desktopDeviceId ?? (self as any).getDesktopDeviceId();

        const res: Response = yield fetch(`${controlPlaneUrl}/v1/mobile/pairing-code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ desktopDeviceId }),
        });
        if (!res.ok) {
          throw new Error(`Failed to request pairing code: ${res.status} ${res.statusText}`);
        }
        const data: { code: string } = yield res.json();
        const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
        self.activeCode = { code: data.code, expiresAt };
        return { code: data.code, expiresAt };
      }),

      /** Get the install URL for the mobile PWA. */
      getInstallUrl: flow(function* () {
        const { controlPlaneUrl } = getEnv();
        const desktopDeviceId = self.desktopDeviceId ?? (self as any).getDesktopDeviceId();

        const res: Response = yield fetch(
          `${controlPlaneUrl}/v1/mobile/install-url?desktopDeviceId=${encodeURIComponent(desktopDeviceId)}`,
        );
        if (!res.ok) {
          throw new Error(`Failed to get install URL: ${res.status} ${res.statusText}`);
        }
        return (yield res.json()) as { url: string };
      }),

      /** Poll the control plane for pairing status. */
      pollPairingStatus: flow(function* (code: string) {
        const { controlPlaneUrl } = getEnv();

        const res: Response = yield fetch(
          `${controlPlaneUrl}/v1/mobile/pairing-status?code=${encodeURIComponent(code)}`,
        );
        if (!res.ok) {
          log.warn(`Pairing status check failed: ${res.status}`);
          return null;
        }
        return (yield res.json()) as {
          paired: boolean;
          accessToken?: string;
          relayUrl?: string;
          pairingId?: string;
          desktopDeviceId?: string;
          mobileDeviceId?: string;
        } | null;
      }),

      /**
       * Complete a pairing: persist, update allowlist, register recipient, start sync engine.
       * Called when polling confirms a successful pairing.
       */
      completePairing(status: {
        accessToken: string;
        relayUrl: string;
        pairingId?: string;
        desktopDeviceId?: string;
        mobileDeviceId?: string;
      }) {
        const { storage, getRpcClient } = getEnv();

        const newPairing = (self as any).addPairing({
          pairingId: status.pairingId,
          deviceId: status.desktopDeviceId || self.desktopDeviceId || "",
          accessToken: status.accessToken,
          relayUrl: status.relayUrl,
          mobileDeviceId: status.mobileDeviceId,
        });

        self.activeCode = null;

        const recipientId = newPairing.pairingId || newPairing.id;

        // Async allowlist + recipient registration (fire-and-forget)
        (async () => {
          try {
            const allowlist = await readMobileAllowlist();
            if (!allowlist.includes(recipientId)) {
              allowlist.push(recipientId);
              await writeMobileAllowlist(allowlist);
            }
            const isFirstRecipient = !storage.channelRecipients.hasAnyOwner();
            storage.channelRecipients.ensureExists("mobile", recipientId, isFirstRecipient);
            if (isFirstRecipient) {
              const configPath = resolveOpenClawConfigPath();
              syncOwnerAllowFrom(storage, configPath);
            }
            log.info("Added recipient to mobile allowlist:", recipientId);
          } catch (err: any) {
            log.error("Failed to update mobile allowlist:", err);
          }
        })();

        // Start sync engine via RPC
        const rpcClient = getRpcClient();
        if (rpcClient?.isConnected()) {
          log.info("Sending mobile_chat_start_sync RPC. relayUrl:", status.relayUrl);
          rpcClient.request("mobile_chat_start_sync", {
            pairingId: newPairing.pairingId || newPairing.id,
            accessToken: status.accessToken,
            relayUrl: status.relayUrl,
            desktopDeviceId: newPairing.deviceId,
            mobileDeviceId: newPairing.mobileDeviceId || newPairing.id,
          }).catch((err: any) => {
            log.error("Failed to start mobile sync via RPC:", err);
          });
        } else {
          log.warn("RPC client not connected -- cannot start sync engine. It will start on next gateway reconnect.");
        }

        log.info("Pairing completed:", recipientId);
      },

      /** Clear the active pairing code. */
      clearActiveCode() {
        self.activeCode = null;
      },

      /** Run allowlist migration (for device-status lazy trigger). */
      runMigration() {
        migrateAllowlistToPairingId().catch((err) => {
          log.error("Lazy allowlist migration failed:", err);
        });
      },
    };
  });

export type MobileManagerInstance = Instance<typeof MobileManagerModel>;

// Re-export allowlist helpers for mobile-graphql.ts (which needs them for registerPairing)
export { readMobileAllowlist, writeMobileAllowlist };
