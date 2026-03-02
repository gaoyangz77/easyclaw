import { createLogger } from "@easyclaw/logger";
import { resolveOpenClawConfigPath, readExistingConfig, resolveOpenClawStateDir, writeChannelAccount, removeChannelAccount } from "@easyclaw/gateway";
import type { ChannelsStatusSnapshot } from "@easyclaw/core";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { sendChannelMessage } from "../channel-senders.js";
import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody, proxiedFetch } from "./route-utils.js";

const log = createLogger("panel-server");

// --- Pairing Store Helpers ---

interface PairingRequest {
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
  const stateDir = resolveOpenClawStateDir();
  return join(stateDir, "credentials", `${channelId}-pairing.json`);
}

function resolveAllowFromPath(channelId: string, accountId?: string): string {
  const stateDir = resolveOpenClawStateDir();
  const normalized = accountId?.trim().toLowerCase() || "";
  if (normalized) {
    return join(stateDir, "credentials", `${channelId}-${normalized}-allowFrom.json`);
  }
  return join(stateDir, "credentials", `${channelId}-allowFrom.json`);
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

async function readAllowFromList(channelId: string, accountId?: string): Promise<string[]> {
  try {
    const filePath = resolveAllowFromPath(channelId, accountId);
    const content = await fs.readFile(filePath, "utf-8");
    const data: AllowFromStore = JSON.parse(content);
    return Array.isArray(data.allowFrom) ? data.allowFrom : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAllowFromList(channelId: string, allowFrom: string[], accountId?: string): Promise<void> {
  const filePath = resolveAllowFromPath(channelId, accountId);
  const data: AllowFromStore = { version: 1, allowFrom };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** Read and merge allowFrom entries from all scoped + legacy files for a channel. */
async function readAllAllowFromLists(channelId: string): Promise<string[]> {
  const stateDir = resolveOpenClawStateDir();
  const credentialsDir = join(stateDir, "credentials");
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

const APPROVAL_MESSAGES = {
  zh: "✅ [EasyClaw] 您的访问已获批准！现在可以开始和我对话了。",
  en: "✅ [EasyClaw] Your access has been approved! You can start chatting now.",
};

export const handleChannelRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  const { storage, secretStore, getRpcClient, onRuleChange, onProviderChange, onChannelConfigured } = ctx;

  // GET /api/channels/status
  if (pathname === "/api/channels/status" && req.method === "GET") {
    const rpcClient = getRpcClient?.();

    if (!rpcClient || !rpcClient.isConnected()) {
      sendJson(res, 503, { error: "Gateway not connected", snapshot: null });
      return true;
    }

    try {
      const probe = url.searchParams.get("probe") === "true";
      const timeoutMs = 8000;

      const snapshot = await rpcClient.request<ChannelsStatusSnapshot>(
        "channels.status",
        { probe, timeoutMs },
        timeoutMs + 2000
      );

      try {
        const configPath = resolveOpenClawConfigPath();
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
        // Non-critical
      }

      sendJson(res, 200, { snapshot });
    } catch (err) {
      log.error("Failed to fetch channels status:", err);
      sendJson(res, 500, { error: String(err), snapshot: null });
    }
    return true;
  }

  // POST /api/channels/accounts
  if (pathname === "/api/channels/accounts" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelId?: string;
      accountId?: string;
      name?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
    };

    if (!body.channelId || !body.accountId) {
      sendJson(res, 400, { error: "Missing required fields: channelId, accountId" });
      return true;
    }

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return true;
    }

    try {
      const configPath = resolveOpenClawConfigPath();
      const accountConfig: Record<string, unknown> = {
        ...body.config,
        enabled: body.config.enabled ?? true,
      };

      if (body.name) {
        accountConfig.name = body.name;
      }

      if (body.secrets && typeof body.secrets === "object") {
        for (const [secretKey, secretValue] of Object.entries(body.secrets)) {
          if (secretValue) {
            const storeKey = `channel-${body.channelId}-${body.accountId}-${secretKey}`;
            await secretStore.set(storeKey, secretValue);
            log.info(`Stored secret for ${body.channelId}/${body.accountId}: ${secretKey}`);
            accountConfig[secretKey] = secretValue;
          }
        }
      }

      writeChannelAccount({
        configPath,
        channelId: body.channelId,
        accountId: body.accountId,
        config: accountConfig,
      });

      sendJson(res, 201, { ok: true, channelId: body.channelId, accountId: body.accountId });
      onProviderChange?.({ configOnly: true });
      onChannelConfigured?.(body.channelId);
    } catch (err) {
      log.error("Failed to create channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // PUT /api/channels/accounts/:channelId/:accountId
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "PUT") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return true;
    }

    const [channelId, accountId] = parts.map(decodeURIComponent);
    const body = (await parseBody(req)) as {
      name?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
    };

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return true;
    }

    try {
      const configPath = resolveOpenClawConfigPath();
      const existingFullConfig = readExistingConfig(configPath);
      const existingChannels = (existingFullConfig.channels ?? {}) as Record<string, unknown>;
      const existingChannel = (existingChannels[channelId] ?? {}) as Record<string, unknown>;
      const existingAccounts = (existingChannel.accounts ?? {}) as Record<string, unknown>;
      const existingAccountConfig = (existingAccounts[accountId] ?? {}) as Record<string, unknown>;

      const accountConfig: Record<string, unknown> = { ...existingAccountConfig, ...body.config };

      if (body.name !== undefined) {
        accountConfig.name = body.name;
      }

      if (body.secrets && typeof body.secrets === "object") {
        for (const [secretKey, secretValue] of Object.entries(body.secrets)) {
          const storeKey = `channel-${channelId}-${accountId}-${secretKey}`;
          if (secretValue) {
            await secretStore.set(storeKey, secretValue);
            log.info(`Updated secret for ${channelId}/${accountId}: ${secretKey}`);
            accountConfig[secretKey] = secretValue;
          } else {
            await secretStore.delete(storeKey);
            log.info(`Deleted secret for ${channelId}/${accountId}: ${secretKey}`);
          }
        }
      }

      writeChannelAccount({ configPath, channelId, accountId, config: accountConfig });

      sendJson(res, 200, { ok: true, channelId, accountId });
      onProviderChange?.({ configOnly: true });
      onChannelConfigured?.(channelId);
    } catch (err) {
      log.error("Failed to update channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // DELETE /api/channels/accounts/:channelId/:accountId
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return true;
    }

    const [channelId, accountId] = parts.map(decodeURIComponent);

    try {
      const configPath = resolveOpenClawConfigPath();
      const allSecretKeys = await secretStore.listKeys();
      const accountSecretPrefix = `channel-${channelId}-${accountId}-`;
      for (const key of allSecretKeys) {
        if (key.startsWith(accountSecretPrefix)) {
          await secretStore.delete(key);
          log.info(`Deleted secret: ${key}`);
        }
      }

      removeChannelAccount({ configPath, channelId, accountId });

      sendJson(res, 200, { ok: true, channelId, accountId });
      onProviderChange?.({ configOnly: true });
    } catch (err) {
      log.error("Failed to delete channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /api/pairing/requests/:channelId
  if (pathname.startsWith("/api/pairing/requests/") && req.method === "GET") {
    const channelId = decodeURIComponent(pathname.slice("/api/pairing/requests/".length));
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return true;
    }

    try {
      const requests = await readPairingRequests(channelId);
      sendJson(res, 200, { requests });
    } catch (err) {
      log.error(`Failed to list pairing requests for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /api/pairing/allowlist/:channelId
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "GET") {
    const channelId = decodeURIComponent(pathname.slice("/api/pairing/allowlist/".length).split("/")[0]);
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return true;
    }

    try {
      const allowlist = await readAllAllowFromLists(channelId);
      sendJson(res, 200, { allowlist });
    } catch (err) {
      log.error(`Failed to read allowlist for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // POST /api/pairing/approve
  if (pathname === "/api/pairing/approve" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelId?: string;
      code?: string;
      locale?: string;
    };

    if (!body.channelId || !body.code) {
      sendJson(res, 400, { error: "Missing required fields: channelId, code" });
      return true;
    }

    try {
      const requests = await readPairingRequests(body.channelId);
      const codeUpper = body.code.trim().toUpperCase();
      const requestIndex = requests.findIndex(r => r.code.toUpperCase() === codeUpper);

      if (requestIndex < 0) {
        sendJson(res, 404, { error: "Pairing code not found or expired" });
        return true;
      }

      const request = requests[requestIndex];
      const accountId = request.meta?.accountId;

      requests.splice(requestIndex, 1);
      await writePairingRequests(body.channelId, requests);

      const allowlist = await readAllowFromList(body.channelId, accountId);
      if (!allowlist.includes(request.id)) {
        allowlist.push(request.id);
        await writeAllowFromList(body.channelId, allowlist, accountId);
      }

      sendJson(res, 200, { ok: true, id: request.id, entry: request });

      log.info(`Approved pairing for ${body.channelId}: ${request.id}`);

      const locale = (body.locale === "zh" ? "zh" : "en") as "zh" | "en";
      const confirmMsg = APPROVAL_MESSAGES[locale];
      sendChannelMessage(body.channelId, request.id, confirmMsg, proxiedFetch).then(ok => {
        if (ok) log.info(`Sent approval confirmation to ${body.channelId} user ${request.id}`);
      });
    } catch (err) {
      log.error("Failed to approve pairing:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // DELETE /api/pairing/allowlist/:channelId/:entry
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/pairing/allowlist/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/pairing/allowlist/:channelId/:entry" });
      return true;
    }

    const [channelId, entry] = parts.map(decodeURIComponent);

    try {
      let changed = false;
      const stateDir = resolveOpenClawStateDir();
      const credentialsDir = join(stateDir, "credentials");
      const prefix = `${channelId}-`;
      const suffix = "-allowFrom.json";

      let files: string[];
      try {
        files = await fs.readdir(credentialsDir);
      } catch (err: any) {
        if (err.code === "ENOENT") files = [];
        else throw err;
      }

      // Remove entry from all matching allowFrom files (legacy + scoped)
      for (const file of files) {
        if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
        const filePath = join(credentialsDir, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const data: AllowFromStore = JSON.parse(content);
          if (!Array.isArray(data.allowFrom)) continue;
          const filtered = data.allowFrom.filter((e: string) => e !== entry);
          if (filtered.length !== data.allowFrom.length) {
            await fs.writeFile(filePath, JSON.stringify({ version: 1, allowFrom: filtered }, null, 2) + "\n", "utf-8");
            changed = true;
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (changed) {
        log.info(`Removed from ${channelId} allowlist: ${entry}`);
      }

      const remaining = await readAllAllowFromLists(channelId);
      sendJson(res, 200, { ok: true, changed, allowFrom: remaining });
    } catch (err) {
      log.error("Failed to remove from allowlist:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // --- Legacy Channels ---
  if (pathname === "/api/channels" && req.method === "GET") {
    const channels = storage.channels.getAll();
    sendJson(res, 200, { channels });
    return true;
  }

  if (pathname === "/api/channels" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelType?: string;
      enabled?: boolean;
      accountId?: string;
      settings?: Record<string, unknown>;
    };
    const id = crypto.randomUUID();
    const channel = storage.channels.create({
      id,
      channelType: body.channelType ?? "",
      enabled: body.enabled ?? true,
      accountId: body.accountId ?? "",
      settings: body.settings ?? {},
    });
    onRuleChange?.("channel-created", id);
    sendJson(res, 201, channel);
    return true;
  }

  if (pathname.startsWith("/api/channels/") && req.method === "DELETE" && !pathname.includes("/wecom/")) {
    const id = pathname.slice("/api/channels/".length);
    if (!id.includes("/")) {
      const deleted = storage.channels.delete(id);
      if (deleted) {
        onRuleChange?.("channel-deleted", id);
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 404, { error: "Channel not found" });
      }
      return true;
    }
  }

  return false;
};
