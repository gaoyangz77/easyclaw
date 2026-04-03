import { types, flow, getRoot, type Instance } from "mobx-state-tree";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import type { Storage } from "@rivonclaw/storage";
import { readExistingConfig, writeChannelAccount, removeChannelAccount } from "@rivonclaw/gateway";
import type { GatewayRpcClient } from "@rivonclaw/gateway";
import type { ChannelsStatusSnapshot } from "@rivonclaw/core";
import { resolveCredentialsDir } from "@rivonclaw/core/node";
import { createLogger } from "@rivonclaw/logger";
import { syncOwnerAllowFrom } from "../auth/owner-sync.js";

const log = createLogger("channel-manager");

// ---------------------------------------------------------------------------
// Environment interface -- late-initialized infrastructure dependencies.
// ---------------------------------------------------------------------------

export interface ChannelManagerEnv {
  storage: Storage;
  configPath: string;
  stateDir: string;
  getRpcClient: () => GatewayRpcClient | null;
}

// ---------------------------------------------------------------------------
// Pairing / AllowFrom file I/O helpers (module-level, used by actions)
// ---------------------------------------------------------------------------

export interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

interface PairingStore {
  version: number;
  requests: PairingRequest[];
}

interface AllowFromStore {
  version: number;
  allowFrom: string[];
}

function resolvePairingPath(channelId: string): string {
  return join(resolveCredentialsDir(), `${channelId}-pairing.json`);
}

async function readPairingRequests(channelId: string): Promise<PairingRequest[]> {
  try {
    const filePath = resolvePairingPath(channelId);
    const content = await fs.readFile(filePath, "utf-8");
    const data: PairingStore = JSON.parse(content);
    return Array.isArray(data.requests) ? data.requests : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writePairingRequests(channelId: string, requests: PairingRequest[]): Promise<void> {
  const filePath = resolvePairingPath(channelId);
  const data: PairingStore = { version: 1, requests };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function resolveAllowFromPathForChannel(channelId: string, accountId?: string): string {
  const credDir = resolveCredentialsDir();
  const normalized = accountId?.trim().toLowerCase() || "";
  if (normalized) {
    return join(credDir, `${channelId}-${normalized}-allowFrom.json`);
  }
  return join(credDir, `${channelId}-allowFrom.json`);
}

async function readAllowFromList(channelId: string, accountId?: string): Promise<string[]> {
  try {
    const filePath = resolveAllowFromPathForChannel(channelId, accountId);
    const content = await fs.readFile(filePath, "utf-8");
    const data: AllowFromStore = JSON.parse(content);
    return Array.isArray(data.allowFrom) ? data.allowFrom : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAllowFromList(channelId: string, allowFrom: string[], accountId?: string): Promise<void> {
  const filePath = resolveAllowFromPathForChannel(channelId, accountId);
  const data: AllowFromStore = { version: 1, allowFrom };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** Read and merge allowFrom entries from all scoped + legacy files for a channel. */
async function readAllAllowFromLists(channelId: string): Promise<string[]> {
  const credentialsDir = resolveCredentialsDir();
  const prefix = `${channelId}-`;
  const suffix = "-allowFrom.json";
  const allEntries = new Set<string>();

  let files: string[];
  try {
    files = await fs.readdir(credentialsDir);
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  for (const file of files) {
    // Match both legacy "{channelId}-allowFrom.json" and scoped "{channelId}-{accountId}-allowFrom.json"
    if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;

    try {
      const content = await fs.readFile(join(credentialsDir, file), "utf-8");
      const data: AllowFromStore = JSON.parse(content);
      if (Array.isArray(data.allowFrom)) {
        for (const entry of data.allowFrom) allEntries.add(entry);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return [...allEntries];
}

// ---------------------------------------------------------------------------
// MST Model
// ---------------------------------------------------------------------------

export const ChannelManagerModel = types
  .model("ChannelManager", {
    initialized: types.optional(types.boolean, false),
  })
  .volatile(() => ({
    _env: null as ChannelManagerEnv | null,
  }))
  .views((self) => ({
    get root(): any {
      return getRoot(self);
    },
  }))
  .views((self) => ({
    /**
     * Build plugin entries for all channels that have at least one account.
     * Also includes mobile if any active pairing exists.
     * Returns Record<string, { enabled: boolean }> for gateway config plugins.entries.
     */
    buildPluginEntries(): Record<string, { enabled: boolean }> {
      const env = self._env;
      if (!env) return {};

      const entries: Record<string, { enabled: boolean }> = {};

      // Channel accounts from root store
      const channelIds = new Set<string>();
      for (const a of self.root.channelAccounts as any[]) {
        channelIds.add(a.channelId);
      }
      for (const channelId of channelIds) {
        entries[channelId] = { enabled: true };
      }

      // Mobile channel uses a separate pairing system (mobile_pairings table)
      const pairings = env.storage.mobilePairings.getAllPairings();
      if (pairings.length > 0) {
        entries.mobile = { enabled: true };
      }

      return entries;
    },

    /**
     * Build channel account configs for gateway config write-back.
     * Does NOT include mobile accounts (mobile plugin manages its own config).
     */
    buildConfigAccounts(): Array<{ channelId: string; accountId: string; config: Record<string, unknown> }> {
      return self.root.channelAccounts
        .filter((a: any) => a.channelId !== "mobile")
        .map((a: any) => ({
          channelId: a.channelId,
          accountId: a.accountId,
          config: a.config,
        }));
    },
  }))
  .actions((self) => {
    function getEnv(): ChannelManagerEnv {
      if (!self._env) throw new Error("ChannelManager not initialized -- call setEnv() first");
      return self._env;
    }

    /**
     * One-time migration: import and enrich channel accounts from openclaw.json into SQLite.
     * Only runs if the migration flag is not set.
     *
     * Two cases:
     * 1. SQLite is empty → import all accounts from config (first-run upgrade)
     * 2. SQLite has data → enrich existing records with fields that config has but SQLite lacks
     *    (secret backfill from older versions that stored secrets only in config/keychain)
     */
    function runMigrationIfNeeded(): void {
      const { storage, configPath } = getEnv();

      if (storage.settings.get("channel-migration-done") === "1") return;

      let existingConfig: Record<string, unknown>;
      try {
        existingConfig = readExistingConfig(configPath);
      } catch {
        // No config file -- nothing to migrate
        storage.settings.set("channel-migration-done", "1");
        return;
      }

      const channels = existingConfig.channels;
      if (!channels || typeof channels !== "object") {
        storage.settings.set("channel-migration-done", "1");
        return;
      }

      const existingAccounts = storage.channelAccounts.list();
      const sqliteMap = new Map(existingAccounts.map((a) => [`${a.channelId}:${a.accountId}`, a]));

      for (const [channelId, channelData] of Object.entries(channels as Record<string, unknown>)) {
        if (channelId === "mobile") continue; // mobile uses mobile_pairings
        if (!channelData || typeof channelData !== "object") continue;
        const accounts = (channelData as Record<string, unknown>).accounts;
        if (!accounts || typeof accounts !== "object") continue;

        for (const [accountId, accountData] of Object.entries(accounts as Record<string, unknown>)) {
          const configObj = typeof accountData === "object" && accountData !== null
            ? (accountData as Record<string, unknown>)
            : {};
          const key = `${channelId}:${accountId}`;
          const sqliteRecord = sqliteMap.get(key);

          if (!sqliteRecord) {
            // Config has account that SQLite doesn't → import
            storage.channelAccounts.upsert(
              channelId,
              accountId,
              typeof configObj.name === "string" ? configObj.name : null,
              configObj,
            );
          } else {
            // Both have it → merge any fields config has that SQLite lacks
            // (secret backfill from older versions)
            let needsUpdate = false;
            const merged = { ...sqliteRecord.config };
            for (const [k, v] of Object.entries(configObj)) {
              if (v !== undefined && v !== null && !(k in merged)) {
                merged[k] = v;
                needsUpdate = true;
              }
            }
            if (needsUpdate) {
              storage.channelAccounts.upsert(channelId, accountId, sqliteRecord.name, merged);
            }
          }
        }
      }

      if (existingAccounts.length === 0) {
        log.info("Migrated channel accounts from config file to SQLite");
      }

      storage.settings.set("channel-migration-done", "1");
    }

    return {
      /** Set the environment dependencies. Called once during startup. */
      setEnv(env: ChannelManagerEnv) {
        self._env = env;
      },

      /** Initialize from SQLite. Runs migration if needed, then loads all accounts. */
      init() {
        runMigrationIfNeeded();

        const { storage } = getEnv();
        const allAccounts = storage.channelAccounts.list();
        (getRoot(self) as any).loadChannelAccounts(
          allAccounts.map((a) => ({
            channelId: a.channelId,
            accountId: a.accountId,
            name: a.name,
            config: a.config,
          })),
        );

        self.initialized = true;
        log.info(`Channel manager initialized with ${allAccounts.length} account(s)`);
      },

      /**
       * Create a new channel account.
       * Writes to SQLite + config file, updates MST state, triggers full config rebuild.
       */
      addAccount(params: {
        channelId: string;
        accountId: string;
        name?: string;
        config: Record<string, unknown>;
        secrets?: Record<string, string>;
      }) {
        const { storage, configPath } = getEnv();

        const accountConfig: Record<string, unknown> = { ...params.config };

        // Merge secrets into config -- secrets are stored alongside other config
        // in both SQLite and openclaw.json. The vendor gateway reads them directly.
        if (params.secrets && typeof params.secrets === "object") {
          for (const [secretKey, secretValue] of Object.entries(params.secrets)) {
            if (secretValue) {
              accountConfig[secretKey] = secretValue;
            }
          }
        }

        // Write to config file
        writeChannelAccount({
          configPath,
          channelId: params.channelId,
          accountId: params.accountId,
          config: accountConfig,
        });

        // Persist to SQLite (source of truth)
        storage.channelAccounts.upsert(
          params.channelId,
          params.accountId,
          params.name ?? null,
          accountConfig,
        );

        // Update MST state via root store
        const entry = {
          channelId: params.channelId,
          accountId: params.accountId,
          name: params.name ?? null,
          config: accountConfig,
        };
        (getRoot(self) as any).upsertChannelAccount(entry);

        // No explicit reload needed — writeChannelAccount already modified the config
        // file and the gateway's chokidar watcher will detect the change automatically.

        return entry;
      },

      /**
       * Update an existing channel account.
       * Reads existing config, merges new values, writes back to SQLite + config file.
       */
      updateAccount(params: {
        channelId: string;
        accountId: string;
        name?: string;
        config: Record<string, unknown>;
        secrets?: Record<string, string>;
      }) {
        const { storage, configPath } = getEnv();

        // Read existing config from file for merge
        const existingFullConfig = readExistingConfig(configPath);
        const existingChannels = (existingFullConfig.channels ?? {}) as Record<string, unknown>;
        const existingChannel = (existingChannels[params.channelId] ?? {}) as Record<string, unknown>;
        const existingAccounts = (existingChannel.accounts ?? {}) as Record<string, unknown>;
        const existingAccountConfig = (existingAccounts[params.accountId] ?? {}) as Record<string, unknown>;

        const accountConfig: Record<string, unknown> = { ...existingAccountConfig, ...params.config };

        if (params.name !== undefined) {
          accountConfig.name = params.name;
        }

        // Merge secrets
        if (params.secrets && typeof params.secrets === "object") {
          for (const [secretKey, secretValue] of Object.entries(params.secrets)) {
            if (secretValue) {
              accountConfig[secretKey] = secretValue;
            } else {
              delete accountConfig[secretKey];
            }
          }
        }

        // Write to config file
        writeChannelAccount({ configPath, channelId: params.channelId, accountId: params.accountId, config: accountConfig });

        // Persist to SQLite (source of truth)
        storage.channelAccounts.upsert(params.channelId, params.accountId, params.name ?? null, accountConfig);

        // Update MST state via root store
        const entry = {
          channelId: params.channelId,
          accountId: params.accountId,
          name: params.name ?? null,
          config: accountConfig,
        };
        (getRoot(self) as any).upsertChannelAccount(entry);

        // No explicit reload needed — writeChannelAccount already modified the config
        // file and the gateway's chokidar watcher will detect the change automatically.

        return entry;
      },

      /**
       * Remove a channel account.
       * Cleans up config file, state files (WeChat), allowFrom files, and SQLite.
       */
      removeAccount(channelId: string, accountId: string) {
        const { storage, configPath, stateDir } = getEnv();

        // Remove from config file
        removeChannelAccount({ configPath, channelId, accountId });

        // WeChat plugin stores its own state files (account index + credential files).
        // Clean them up so the plugin doesn't re-register the account on reload.
        if (channelId === "openclaw-weixin") {
          const weixinStateDir = join(stateDir, "openclaw-weixin");
          // Remove credential file
          fs.rm(join(weixinStateDir, "accounts", `${accountId}.json`), { force: true }).catch(() => {});
          // Remove accountId from index
          (async () => {
            try {
              const indexPath = join(weixinStateDir, "accounts.json");
              const raw = await fs.readFile(indexPath, "utf-8");
              const ids: string[] = JSON.parse(raw);
              const updated = ids.filter((id: string) => id !== accountId);
              await fs.writeFile(indexPath, JSON.stringify(updated, null, 2), "utf-8");
            } catch { /* index file may not exist */ }
          })();
        }

        // Remove account-scoped allowFrom file to prevent orphaned recipients
        const allowFromPath = resolveAllowFromPathForChannel(channelId, accountId);
        fs.rm(allowFromPath, { force: true }).catch(() => {});

        // Remove from SQLite
        storage.channelAccounts.delete(channelId, accountId);

        // Update MST state via root store
        (getRoot(self) as any).removeChannelAccount(channelId, accountId);

        // No explicit reload needed — removeChannelAccount already modified the config
        // file and the gateway's chokidar watcher will detect the change automatically.
      },

      // -----------------------------------------------------------------------
      // Channel status
      // -----------------------------------------------------------------------

      /**
       * Query channel status from the gateway and enrich with dmPolicy.
       * The RPC client must be obtained by the caller (route handler awaits gateway readiness).
       */
      getChannelStatus: flow(function* (
        rpcClient: GatewayRpcClient,
        probe: boolean,
        probeTimeoutMs: number,
        clientTimeoutMs: number,
      ) {
        const snapshot: ChannelsStatusSnapshot = yield rpcClient.request(
          "channels.status",
          { probe, timeoutMs: probeTimeoutMs },
          clientTimeoutMs,
        );

        // Enrich with dmPolicy. Read from config file for the full fallback chain
        // (account config → channel root config → "pairing").
        try {
          const { configPath } = getEnv();
          const fullConfig = readExistingConfig(configPath);
          const channelsCfg = (fullConfig.channels ?? {}) as Record<string, Record<string, unknown>>;

          for (const [channelId, accounts] of Object.entries(snapshot.channelAccounts)) {
            const chCfg = channelsCfg[channelId] ?? {};
            const rootDmPolicy = chCfg.dmPolicy as string | undefined;
            const accountsCfg = (chCfg.accounts ?? {}) as Record<string, Record<string, unknown>>;

            for (const account of accounts) {
              if (!account.dmPolicy) {
                const acctCfg = accountsCfg[account.accountId];
                account.dmPolicy = (acctCfg?.dmPolicy as string) ?? rootDmPolicy ?? "pairing";
              }
            }
          }
        } catch {
          // Non-critical enrichment
        }

        return snapshot;
      }),

      // -----------------------------------------------------------------------
      // Pairing operations
      // -----------------------------------------------------------------------

      /** Read pending pairing requests for a channel from its pairing state file. */
      getPairingRequests: flow(function* (channelId: string) {
        return (yield readPairingRequests(channelId)) as PairingRequest[];
      }),

      /**
       * Approve a pairing request: validate code, update allowlist, register recipient.
       * Returns the recipient ID and the matched pairing entry.
       */
      approvePairing: flow(function* (params: { channelId: string; code: string }) {
        const requests: PairingRequest[] = yield readPairingRequests(params.channelId);
        const codeUpper = params.code.trim().toUpperCase();
        const requestIndex = requests.findIndex((r) => r.code.toUpperCase() === codeUpper);

        if (requestIndex < 0) {
          throw new Error("Pairing code not found or expired");
        }

        const request = requests[requestIndex];
        const accountId = request.meta?.accountId;

        // Remove from pairing requests
        requests.splice(requestIndex, 1);
        yield writePairingRequests(params.channelId, requests);

        // Add to allowlist
        const allowlist: string[] = yield readAllowFromList(params.channelId, accountId);
        if (!allowlist.includes(request.id)) {
          allowlist.push(request.id);
          yield writeAllowFromList(params.channelId, allowlist, accountId);
        }

        // Register recipient, auto-assign owner for first-ever recipient
        const { storage, configPath } = getEnv();
        const isFirstRecipient = !storage.channelRecipients.hasAnyOwner();
        storage.channelRecipients.ensureExists(params.channelId, request.id, isFirstRecipient);
        if (isFirstRecipient) {
          syncOwnerAllowFrom(storage, configPath);
        }

        log.info(`Approved pairing for ${params.channelId}: ${request.id}`);

        return { recipientId: request.id, entry: request };
      }),

      /**
       * Get the merged allowlist for a channel, enriched with labels, owner flags,
       * and gateway session recipients (for channels like WeChat with no pairing flow).
       */
      getAllowlist: flow(function* (channelId: string, accountId?: string) {
        const { storage, getRpcClient: getRpc } = getEnv();

        const allowlist: string[] = yield readAllAllowFromLists(channelId);
        const meta = storage.channelRecipients.getRecipientMeta(channelId);
        const labels: Record<string, string> = {};
        const owners: Record<string, boolean> = {};
        for (const [id, data] of Object.entries(meta)) {
          if (data.label) labels[id] = data.label;
          owners[id] = data.isOwner;
        }

        // Merge recipients from gateway sessions (WeChat -- no pairing flow)
        const rpcClient = getRpc();
        if (rpcClient?.isConnected()) {
          try {
            type SessionRow = { lastChannel?: string; lastTo?: string; lastAccountId?: string };
            const result: { sessions: SessionRow[] } = yield rpcClient.request(
              "sessions.list",
              { includeGlobal: false, includeUnknown: false },
              5_000,
            );
            // Gateway session lastTo may use arbitrary prefixes set by each
            // channel plugin (e.g. "telegram:12345", "user:ou_xxx").
            // AllowFrom files store bare IDs ("12345", "ou_xxx").
            // Build a lookup that matches both bare and any prefixed form.
            const allowSet = new Set(allowlist);
            // Also index bare IDs so "user:ou_xxx" can match "ou_xxx"
            const bareIdSet = new Set(allowlist);

            /** Extract the bare recipient ID by stripping any "prefix:" from a session lastTo. */
            function toBareId(lastTo: string): string {
              const colonIdx = lastTo.indexOf(":");
              return colonIdx >= 0 ? lastTo.slice(colonIdx + 1) : lastTo;
            }

            for (const s of result.sessions) {
              if (s.lastChannel !== channelId || !s.lastTo) continue;
              const bare = toBareId(s.lastTo);
              if (allowSet.has(s.lastTo) || bareIdSet.has(bare)) continue;
              if (accountId && s.lastAccountId !== accountId) continue;
              // Push bare ID to keep the allowlist in a consistent format
              allowlist.push(bare);
              bareIdSet.add(bare);
            }
          } catch (err) {
            log.warn(`Failed to query gateway sessions for ${channelId} recipients:`, err);
          }
        }

        return { allowlist, labels, owners };
      }),

      /** Set a display label for a recipient. Empty label removes the recipient metadata. */
      setRecipientLabel(channelId: string, recipientId: string, label: string) {
        const { storage } = getEnv();
        if (label.trim()) {
          storage.channelRecipients.setLabel(channelId, recipientId, label.trim());
        } else {
          storage.channelRecipients.delete(channelId, recipientId);
        }
      },

      /** Set or unset the owner flag for a recipient. Syncs ownerAllowFrom to config. */
      setRecipientOwner(channelId: string, recipientId: string, isOwner: boolean) {
        const { storage, configPath } = getEnv();
        storage.channelRecipients.ensureExists(channelId, recipientId);
        storage.channelRecipients.setOwner(channelId, recipientId, isOwner);
        syncOwnerAllowFrom(storage, configPath);
      },

      /**
       * Remove an entry from a channel's allowlist.
       * For mobile channel, delegates to MobileManager.
       * Returns whether the allowlist was changed.
       */
      removeFromAllowlist: flow(function* (channelId: string, entry: string) {
        const { storage, configPath } = getEnv();

        // Mobile channel: delegate full cleanup to MobileManager
        if (channelId === "mobile") {
          const mobileManager = self.root.mobileManager;
          if (mobileManager?.initialized) {
            const match = (self.root.mobilePairings as any[]).find(
              (p: any) => p.pairingId === entry || p.id === entry,
            );
            if (match) {
              mobileManager.removePairing(match.id);
              return { changed: true };
            }
          }
          return { changed: false };
        }

        // Generic channel: remove entry from all matching allowFrom files
        let changed = false;
        const credentialsDir = resolveCredentialsDir();
        const prefix = `${channelId}-`;
        const suffix = "-allowFrom.json";

        let files: string[];
        try {
          files = yield fs.readdir(credentialsDir);
        } catch (err: any) {
          if (err.code === "ENOENT") files = [];
          else throw err;
        }

        for (const file of files) {
          if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
          const filePath = join(credentialsDir, file);
          try {
            const content: string = yield fs.readFile(filePath, "utf-8");
            const data: AllowFromStore = JSON.parse(content);
            if (!Array.isArray(data.allowFrom)) continue;
            const filtered = data.allowFrom.filter((e: string) => e !== entry);
            if (filtered.length !== data.allowFrom.length) {
              yield fs.writeFile(filePath, JSON.stringify({ version: 1, allowFrom: filtered }, null, 2) + "\n", "utf-8");
              changed = true;
            }
          } catch {
            // Skip unreadable files
          }
        }

        if (changed) {
          log.info(`Removed from ${channelId} allowlist: ${entry}`);
        }

        storage.channelRecipients.delete(channelId, entry);
        syncOwnerAllowFrom(storage, configPath);

        return { changed };
      }),

      // -----------------------------------------------------------------------
      // QR Login (WeChat)
      // -----------------------------------------------------------------------

      /** Start WeChat QR login. Caller must provide a ready RPC client. */
      startQrLogin: flow(function* (
        rpcClient: GatewayRpcClient,
        accountId?: string,
      ) {
        return (yield rpcClient.request("web.login.start", { accountId })) as {
          qrDataUrl?: string;
          message: string;
        };
      }),

      /** Wait for WeChat QR login scan. Long-poll -- caller must provide a ready RPC client. */
      waitQrLogin: flow(function* (
        rpcClient: GatewayRpcClient,
        accountId?: string,
        timeoutMs?: number,
      ) {
        const serverPollMs = timeoutMs ?? 60_000;
        const rpcTimeoutMs = serverPollMs + 15_000;
        return (yield rpcClient.request(
          "web.login.wait",
          { accountId, timeoutMs },
          rpcTimeoutMs,
        )) as { connected: boolean; message: string; accountId?: string };
      }),
    };
  });

export type ChannelManagerInstance = Instance<typeof ChannelManagerModel>;
