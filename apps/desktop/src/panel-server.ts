import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, resolve, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";
import type { ArtifactStatus, ArtifactType, LLMProvider } from "@easyclaw/core";
import { PROVIDER_BASE_URLS, getDefaultModelForProvider, providerSecretKey, parseProxyUrl, reconstructProxyUrl } from "@easyclaw/core";
import { readFullModelCatalog, resolveOpenClawConfigPath, readExistingConfig, resolveOpenClawStateDir, GatewayRpcClient, writeChannelAccount, removeChannelAccount, syncPermissions } from "@easyclaw/gateway";
import { loadCostUsageSummary, discoverAllSessions, loadSessionCostSummary } from "../../../vendor/openclaw/src/infra/session-cost-usage.js";
import type { CostUsageSummary, SessionCostSummary } from "../../../vendor/openclaw/src/infra/session-cost-usage.js";
import type { ChannelsStatusSnapshot } from "@easyclaw/core";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";

const log = createLogger("panel-server");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// --- Usage Types and Helpers ---

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  recordCount: number;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>;
  byProvider: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>;
}

interface UsageFilter {
  since?: string;
  until?: string;
  model?: string;
  provider?: string;
}

// Simple cache with TTL for usage data
const usageCache = new Map<string, { data: UsageSummary; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds (matching OpenClaw's cache)

function getCachedUsage(cacheKey: string): UsageSummary | null {
  const cached = usageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  usageCache.delete(cacheKey);
  return null;
}

function setCachedUsage(cacheKey: string, data: UsageSummary): void {
  usageCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

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

function resolveAllowFromPath(channelId: string): string {
  const stateDir = resolveOpenClawStateDir();
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

async function readAllowFromList(channelId: string): Promise<string[]> {
  try {
    const filePath = resolveAllowFromPath(channelId);
    const content = await fs.readFile(filePath, "utf-8");
    const data: AllowFromStore = JSON.parse(content);
    return Array.isArray(data.allowFrom) ? data.allowFrom : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAllowFromList(channelId: string, allowFrom: string[]): Promise<void> {
  const filePath = resolveAllowFromPath(channelId);
  const data: AllowFromStore = { version: 1, allowFrom };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function transformToUsageSummary(
  costSummary: CostUsageSummary,
  sessionSummaries: SessionCostSummary[]
): UsageSummary {
  // Aggregate byModel and byProvider from session summaries
  const byModelMap = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>();

  const byProviderMap = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>();

  for (const session of sessionSummaries) {
    if (!session.modelUsage) continue;

    for (const modelUsage of session.modelUsage) {
      const model = modelUsage.model || "unknown";
      const provider = modelUsage.provider || "unknown";

      // Aggregate by model
      const modelKey = `${provider}/${model}`;
      const modelEntry = byModelMap.get(modelKey) || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        count: 0,
      };
      modelEntry.inputTokens += modelUsage.totals.input;
      modelEntry.outputTokens += modelUsage.totals.output;
      modelEntry.totalTokens += modelUsage.totals.totalTokens;
      modelEntry.estimatedCostUsd += modelUsage.totals.totalCost;
      modelEntry.count += modelUsage.count;
      byModelMap.set(modelKey, modelEntry);

      // Aggregate by provider
      const providerEntry = byProviderMap.get(provider) || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        count: 0,
      };
      providerEntry.inputTokens += modelUsage.totals.input;
      providerEntry.outputTokens += modelUsage.totals.output;
      providerEntry.totalTokens += modelUsage.totals.totalTokens;
      providerEntry.estimatedCostUsd += modelUsage.totals.totalCost;
      providerEntry.count += modelUsage.count;
      byProviderMap.set(provider, providerEntry);
    }
  }

  return {
    totalInputTokens: costSummary.totals.input,
    totalOutputTokens: costSummary.totals.output,
    totalTokens: costSummary.totals.totalTokens,
    totalEstimatedCostUsd: costSummary.totals.totalCost,
    recordCount: costSummary.daily.length,
    byModel: Object.fromEntries(byModelMap),
    byProvider: Object.fromEntries(byProviderMap),
  };
}

function emptyUsageSummary(): UsageSummary {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalEstimatedCostUsd: 0,
    recordCount: 0,
    byModel: {},
    byProvider: {},
  };
}

// --- Channel Message Senders ---

/** Detect system locale: "zh" for Chinese systems, "en" for everything else. */
function getSystemLocale(): "zh" | "en" {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

const PAIRING_MESSAGES = {
  zh: [
    "💡 [EasyClaw] 您的配对请求已收到。",
    "",
    "请前往管理面板 → 通道，选择要配对的通道并点击「白名单」完成配对。",
  ].join("\n"),
  en: [
    "💡 [EasyClaw] Your pairing request has been received.",
    "",
    "Please go to the panel → Channels, find the channel you want to match and click the \"Whitelist\" button.",
  ].join("\n"),
};

const APPROVAL_MESSAGES = {
  zh: "✅ [EasyClaw] 您的访问已获批准！现在可以开始和我对话了。",
  en: "✅ [EasyClaw] Your access has been approved! You can start chatting now.",
};

/**
 * Read the first account config for a channel from the OpenClaw config.
 * Returns { accountId, config } or null.
 */
function resolveFirstChannelAccount(channelId: string): { accountId: string; config: Record<string, unknown> } | null {
  try {
    const configPath = resolveOpenClawConfigPath();
    const fullConfig = readExistingConfig(configPath);
    const channels = (fullConfig.channels ?? {}) as Record<string, unknown>;
    const channel = (channels[channelId] ?? {}) as Record<string, unknown>;
    const accounts = (channel.accounts ?? {}) as Record<string, Record<string, unknown>>;
    for (const [accountId, config] of Object.entries(accounts)) {
      if (config && typeof config === "object") {
        return { accountId, config };
      }
    }
  } catch (err) {
    log.error(`Failed to resolve ${channelId} account config:`, err);
  }
  return null;
}

// Telegram: POST https://api.telegram.org/bot{token}/sendMessage
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("telegram");
  const botToken = account?.config.botToken;
  if (!botToken || typeof botToken !== "string") {
    log.error("Telegram: no bot token found");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Telegram sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Telegram sendMessage error:", err);
    return false;
  }
}

// Feishu: Get tenant_access_token, then POST to /im/v1/messages
const feishuTokenCache: { token?: string; expiresAt?: number } = {};

async function getFeishuTenantToken(appId: string, appSecret: string, domain: string): Promise<string | null> {
  if (feishuTokenCache.token && feishuTokenCache.expiresAt && Date.now() < feishuTokenCache.expiresAt) {
    return feishuTokenCache.token;
  }
  const host = domain === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  try {
    const res = await fetch(`https://${host}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { tenant_access_token?: string; expire?: number };
    if (!data.tenant_access_token) return null;
    feishuTokenCache.token = data.tenant_access_token;
    feishuTokenCache.expiresAt = Date.now() + ((data.expire ?? 7200) - 60) * 1000;
    return data.tenant_access_token;
  } catch (err) {
    log.error("Feishu tenant token error:", err);
    return null;
  }
}

async function sendFeishuMessage(chatId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("feishu");
  if (!account) return false;
  const appId = account.config.appId as string;
  const appSecret = account.config.appSecret as string;
  const domain = (account.config.domain as string) ?? "feishu";
  if (!appId || !appSecret) {
    log.error("Feishu: missing appId or appSecret");
    return false;
  }
  const token = await getFeishuTenantToken(appId, appSecret, domain);
  if (!token) return false;
  const host = domain === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  try {
    const res = await fetch(`https://${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Feishu sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Feishu sendMessage error:", err);
    return false;
  }
}

// LINE: POST https://api.line.me/v2/bot/message/push
async function sendLineMessage(chatId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("line");
  const token = account?.config.channelAccessToken;
  if (!token || typeof token !== "string") {
    log.error("LINE: no channel access token found");
    return false;
  }
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: chatId,
        messages: [{ type: "text", text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`LINE sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("LINE sendMessage error:", err);
    return false;
  }
}

// Mattermost: Create DM channel, then POST message
async function sendMattermostMessage(userId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("mattermost");
  const botToken = account?.config.botToken as string | undefined;
  const baseUrl = account?.config.baseUrl as string | undefined;
  if (!botToken || !baseUrl) {
    log.error("Mattermost: missing botToken or baseUrl");
    return false;
  }
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${botToken}`,
  };
  try {
    // Get bot's own user ID
    const meRes = await fetch(`${baseUrl}/api/v4/users/me`, { headers });
    if (!meRes.ok) return false;
    const me = await meRes.json() as { id: string };

    // Create/get DM channel
    const dmRes = await fetch(`${baseUrl}/api/v4/channels/direct`, {
      method: "POST",
      headers,
      body: JSON.stringify([me.id, userId]),
    });
    if (!dmRes.ok) return false;
    const dm = await dmRes.json() as { id: string };

    // Post message
    const res = await fetch(`${baseUrl}/api/v4/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel_id: dm.id, message: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Mattermost sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Mattermost sendMessage error:", err);
    return false;
  }
}

/**
 * Send a message to a user on the given channel.
 * Returns true if successfully sent, false otherwise.
 */
async function sendChannelMessage(channelId: string, userId: string, text: string): Promise<boolean> {
  switch (channelId) {
    case "telegram": return sendTelegramMessage(userId, text);
    case "feishu": return sendFeishuMessage(userId, text);
    case "line": return sendLineMessage(userId, text);
    case "mattermost": return sendMattermostMessage(userId, text);
    default:
      log.info(`Channel ${channelId}: message sending not supported yet`);
      return false;
  }
}

/**
 * Watch pairing request files for ALL channels and send follow-up messages
 * when new pairing requests are created by OpenClaw.
 */
function startPairingNotifier(): { stop: () => void } {
  const credentialsDir = join(resolveOpenClawStateDir(), "credentials");
  // Track known codes per channel to avoid duplicate notifications
  const knownCodes = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Initialize known codes from all existing pairing files
  async function initKnownCodes() {
    try {
      const files = await fs.readdir(credentialsDir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith("-pairing.json")) continue;
        try {
          const content = await fs.readFile(join(credentialsDir, file), "utf-8");
          const data = JSON.parse(content) as PairingStore;
          if (Array.isArray(data.requests)) {
            for (const req of data.requests) {
              if (req.code) knownCodes.add(req.code);
            }
          }
        } catch {
          // Ignore per-file errors
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  async function checkForNewRequests() {
    try {
      const files = await fs.readdir(credentialsDir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith("-pairing.json")) continue;
        const channelId = file.replace("-pairing.json", "");

        const content = await fs.readFile(join(credentialsDir, file), "utf-8").catch(() => "");
        if (!content) continue;

        const data = JSON.parse(content) as PairingStore;
        if (!Array.isArray(data.requests)) continue;

        for (const req of data.requests) {
          if (!req.code || knownCodes.has(req.code)) continue;
          knownCodes.add(req.code);

          const message = PAIRING_MESSAGES[getSystemLocale()];

          log.info(`Sending pairing follow-up to ${channelId} user ${req.id}`);
          sendChannelMessage(channelId, req.id, message);
        }
      }
    } catch (err) {
      log.error("Pairing notifier check failed:", err);
    }
  }

  // Initialize
  initKnownCodes();

  // Watch for file changes
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    fs.mkdir(credentialsDir, { recursive: true }).then(() => {
      try {
        watcher = watch(credentialsDir, (_eventType, filename) => {
          if (!filename?.endsWith("-pairing.json")) return;

          // Debounce rapid changes
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(checkForNewRequests, 500);
        });
        log.info("Pairing notifier watching:", credentialsDir);
      } catch (err) {
        log.error("Failed to start pairing file watcher:", err);
      }
    });
  } catch (err) {
    log.error("Failed to create credentials directory:", err);
  }

  return {
    stop: () => {
      if (watcher) watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}

export interface PanelServerOptions {
  /** Port to listen on. Default: 3210 */
  port?: number;
  /** Directory containing the built panel files. */
  panelDistDir: string;
  /** Storage instance for SQLite-backed persistence. */
  storage: Storage;
  /** Secret store for API keys (Keychain on macOS, encrypted file elsewhere). */
  secretStore: SecretStore;
  /** Gateway RPC client getter (returns null if gateway not connected) */
  getRpcClient?: () => GatewayRpcClient | null;
  /** Callback fired when a rule is created, updated, or deleted. */
  onRuleChange?: (action: "created" | "updated" | "deleted", ruleId: string) => void;
  /**
   * Callback fired when provider settings change.
   * @param hint.configOnly - true if only the config file changed (e.g. model switch).
   *   When true, the gateway can be reloaded via SIGUSR1 instead of a full restart.
   * @param hint.keyOnly - true if only an API key changed (add/activate/delete).
   *   When true, only auth-profiles.json needs syncing — no restart at all.
   */
  onProviderChange?: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => void;
  /** Callback to open a native file/directory picker dialog. Returns the selected path or null. */
  onOpenFileDialog?: () => Promise<string | null>;
  /** STT manager instance for voice transcription (optional). */
  sttManager?: {
    transcribe(audio: Buffer, format: string): Promise<string | null>;
    isEnabled(): boolean;
    getProvider(): string | null;
    initialize(): Promise<void>;
  };
  /** Callback fired when STT settings change. */
  onSttChange?: () => void;
  /** Callback fired when file permissions change. Requires gateway restart to apply env vars. */
  onPermissionsChange?: () => void;
  /** Callback fired when a channel account is created or updated. */
  onChannelConfigured?: (channelId: string) => void;
  /** Override path to the vendored OpenClaw directory (for packaged app). */
  vendorDir?: string;
}

/**
 * Parse the JSON body from an incoming HTTP request.
 */
function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Validate an API key by making a lightweight call to the provider's API.
 * Returns { valid: true } or { valid: false, error: "..." }.
 */
async function validateProviderApiKey(
  provider: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const baseUrl = PROVIDER_BASE_URLS[provider as LLMProvider];
  if (!baseUrl) {
    return { valid: false, error: "Unknown provider" };
  }

  // Amazon Bedrock uses AWS Sig v4 — skip validation
  if (provider === "amazon-bedrock") {
    return { valid: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  // Set up proxy if provided (to prevent IP pollution/bans)
  let dispatcher: import("undici").Dispatcher | undefined;
  if (proxyUrl) {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent(proxyUrl);
    log.info(`Using proxy for validation: ${proxyUrl.replace(/\/\/[^:]+:[^@]+@/, '//*****:*****@')}`);
  }

  try {
    let res: Response;

    if (provider === "anthropic") {
      const isOAuthToken = apiKey.startsWith("sk-ant-oat01-");
      log.info(`Validating Anthropic ${isOAuthToken ? "OAuth token" : "API key"}...`);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };

      if (isOAuthToken) {
        // OAuth/setup tokens require Claude Code identity headers to authenticate.
        headers["Authorization"] = `Bearer ${apiKey}`;
        headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20";
        headers["user-agent"] = "claude-cli/2.1.2 (external, cli)";
        headers["x-app"] = "cli";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      } else {
        headers["x-api-key"] = apiKey;
      }

      const body: Record<string, unknown> = {
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      };

      if (isOAuthToken) {
        body.system = "You are Claude Code, Anthropic's official CLI for Claude.";
      }

      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    } else {
      // OpenAI-compatible providers: GET /models
      log.info(`Validating ${provider} API key via ${baseUrl}/models ...`);
      res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    }

    log.info(`Validation response: ${res.status} ${res.statusText}`);
    if (res.status === 401 || res.status === 403) {
      // Read response body to distinguish real auth errors from firewall blocks
      const body = await res.text().catch(() => "");
      log.info(`Validation response body: ${body.slice(0, 300)}`);

      // Anthropic returns {"type":"error","error":{"type":"authentication_error",...}}
      // OpenAI returns {"error":{"code":"invalid_api_key",...}}
      // A firewall 403 will have completely different content (HTML block page, etc.)
      const isRealAuthError =
        body.includes("authentication_error") ||
        body.includes("invalid_api_key") ||
        body.includes("invalid_x-api-key") ||
        body.includes("Incorrect API key") ||
        body.includes('"unauthorized"');

      if (isRealAuthError) {
        return { valid: false, error: "Invalid API key" };
      }

      // 403 from firewall/proxy — not a key issue, likely network restriction
      return { valid: false, error: `Provider returned ${res.status} — this may be a network issue (firewall/proxy). Response: ${body.slice(0, 200)}` };
    }

    // Any non-2xx response is suspicious — don't accept the key
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.info(`Validation non-2xx response: ${res.status} body: ${body.slice(0, 300)}`);
      return { valid: false, error: `Provider returned ${res.status}: ${body.slice(0, 200)}` };
    }

    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("API key validation failed:", msg);
    if (msg.includes("abort")) {
      return { valid: false, error: "Validation timed out — check your network connection" };
    }
    return { valid: false, error: `Network error: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sync the active key for a provider to the canonical secret store slot.
 * The gateway reads `{provider}-api-key` — this keeps it in sync with multi-key management.
 */
async function syncActiveKey(
  provider: string,
  storage: Storage,
  secretStore: SecretStore,
): Promise<void> {
  const activeKey = storage.providerKeys.getDefault(provider);
  const canonicalKey = providerSecretKey(provider as LLMProvider);
  if (activeKey) {
    const keyValue = await secretStore.get(`provider-key-${activeKey.id}`);
    if (keyValue) {
      await secretStore.set(canonicalKey, keyValue);
      log.info(`Synced active key for ${provider} (${activeKey.label}) to ${canonicalKey}`);
    }
  } else {
    await secretStore.delete(canonicalKey);
    log.info(`No active key for ${provider}, removed ${canonicalKey}`);
  }
}

/**
 * Create and start a local HTTP server that serves the panel SPA
 * and provides REST API endpoints backed by real storage.
 *
 * Binds to 127.0.0.1 only for security (no external access).
 */
export function startPanelServer(options: PanelServerOptions): Server {
  const port = options.port ?? 3210;
  const distDir = resolve(options.panelDistDir);
  const { storage, secretStore, getRpcClient, onRuleChange, onProviderChange, onOpenFileDialog, sttManager, onSttChange, onPermissionsChange, onChannelConfigured, vendorDir } = options;

  // Ensure vendor OpenClaw functions (loadCostUsageSummary, discoverAllSessions)
  // read from EasyClaw's state dir (~/.easyclaw/openclaw/) instead of ~/.openclaw/
  process.env.OPENCLAW_STATE_DIR = resolveOpenClawStateDir();

  // Start pairing notifier to send follow-up messages to Telegram users
  const pairingNotifier = startPairingNotifier();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (pathname.startsWith("/api/")) {
      try {
        await handleApiRoute(req, res, url, pathname, storage, secretStore, getRpcClient, onRuleChange, onProviderChange, onOpenFileDialog, sttManager, onSttChange, onPermissionsChange, onChannelConfigured, vendorDir);
      } catch (err) {
        log.error("API error:", err);
        sendJson(res, 500, { error: "Internal server error" });
      }
      return;
    }

    // Static file serving for panel SPA
    serveStatic(res, distDir, pathname);
  });

  server.listen(port, "127.0.0.1", () => {
    log.info("Panel server listening on http://127.0.0.1:" + port);
  });

  server.on("close", () => pairingNotifier.stop());

  return server;
}

/**
 * Extract a route parameter from a pathname pattern like /api/rules/:id
 */
function extractIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  // Must be a single path segment (no slashes)
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest;
}

async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pathname: string,
  storage: Storage,
  secretStore: SecretStore,
  getRpcClient?: () => GatewayRpcClient | null,
  onRuleChange?: (action: "created" | "updated" | "deleted", ruleId: string) => void,
  onProviderChange?: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => void,
  onOpenFileDialog?: () => Promise<string | null>,
  sttManager?: {
    transcribe(audio: Buffer, format: string): Promise<string | null>;
    isEnabled(): boolean;
    getProvider(): string | null;
  },
  onSttChange?: () => void,
  onPermissionsChange?: () => void,
  onChannelConfigured?: (channelId: string) => void,
  vendorDir?: string,
): Promise<void> {
  // --- Status ---
  if (pathname === "/api/status" && req.method === "GET") {
    const ruleCount = storage.rules.getAll().length;
    const artifactCount = storage.artifacts.getAll().length;
    sendJson(res, 200, { status: "ok", ruleCount, artifactCount });
    return;
  }

  // --- Rules ---
  if (pathname === "/api/rules" && req.method === "GET") {
    const rules = storage.rules.getAll();
    const allArtifacts = storage.artifacts.getAll();

    // Build a map of ruleId -> latest artifact
    const artifactByRuleId = new Map<string, { status: ArtifactStatus; type: ArtifactType }>();
    for (const artifact of allArtifacts) {
      // Last artifact wins (they are ordered by compiled_at ASC, so last is most recent)
      artifactByRuleId.set(artifact.ruleId, {
        status: artifact.status,
        type: artifact.type,
      });
    }

    const enrichedRules = rules.map((rule) => {
      const artifact = artifactByRuleId.get(rule.id);
      return {
        ...rule,
        artifactStatus: artifact?.status,
        artifactType: artifact?.type,
      };
    });

    sendJson(res, 200, { rules: enrichedRules });
    return;
  }

  if (pathname === "/api/rules" && req.method === "POST") {
    const body = (await parseBody(req)) as { text?: string };
    if (!body.text || typeof body.text !== "string") {
      sendJson(res, 400, { error: "Missing required field: text" });
      return;
    }

    const id = randomUUID();
    const created = storage.rules.create({ id, text: body.text });
    onRuleChange?.("created", id);
    sendJson(res, 201, created);
    return;
  }

  // Rules with ID: PUT /api/rules/:id, DELETE /api/rules/:id
  const ruleId = extractIdFromPath(pathname, "/api/rules/");
  if (ruleId) {
    if (req.method === "PUT") {
      const body = (await parseBody(req)) as { text?: string };
      if (!body.text || typeof body.text !== "string") {
        sendJson(res, 400, { error: "Missing required field: text" });
        return;
      }

      const updated = storage.rules.update(ruleId, { text: body.text });
      if (!updated) {
        sendJson(res, 404, { error: "Rule not found" });
        return;
      }

      onRuleChange?.("updated", ruleId);
      sendJson(res, 200, updated);
      return;
    }

    if (req.method === "DELETE") {
      storage.artifacts.deleteByRuleId(ruleId);
      const deleted = storage.rules.delete(ruleId);
      if (!deleted) {
        sendJson(res, 404, { error: "Rule not found" });
        return;
      }

      onRuleChange?.("deleted", ruleId);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  // --- Settings ---
  if (pathname === "/api/settings" && req.method === "GET") {
    const settings = storage.settings.getAll();
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      masked[key] = value;
    }

    // Check the secret store for API keys and report as "configured" (never expose actual keys)
    const provider = settings["llm-provider"];
    if (provider) {
      const secretKey = `${provider}-api-key`;
      const keyValue = await secretStore.get(secretKey);
      const hasKey = keyValue !== null && keyValue !== "";
      if (hasKey) {
        masked[secretKey] = "configured";
      }
    }

    sendJson(res, 200, { settings: masked });
    return;
  }

  if (pathname === "/api/settings/validate-key" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string; apiKey?: string; proxyUrl?: string };
    if (!body.provider || !body.apiKey) {
      sendJson(res, 400, { valid: false, error: "Missing provider or apiKey" });
      return;
    }
    const result = await validateProviderApiKey(body.provider, body.apiKey, body.proxyUrl);
    sendJson(res, 200, result);
    return;
  }

  // --- Telemetry Settings ---
  if (pathname === "/api/settings/telemetry" && req.method === "GET") {
    const enabledStr = storage.settings.get("telemetry_enabled");
    const enabled = enabledStr === "true";
    sendJson(res, 200, { enabled });
    return;
  }

  if (pathname === "/api/settings/telemetry" && req.method === "PUT") {
    const body = (await parseBody(req)) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      sendJson(res, 400, { error: "Missing required field: enabled (boolean)" });
      return;
    }
    storage.settings.set("telemetry_enabled", body.enabled ? "true" : "false");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/settings" && req.method === "PUT") {
    const body = (await parseBody(req)) as Record<string, string>;
    let providerChanged = false;
    let sttChanged = false;
    for (const [key, value] of Object.entries(body)) {
      if (typeof key === "string" && typeof value === "string") {
        if (key.endsWith("-api-key")) {
          // API keys go to the secure secret store (Keychain/encrypted file),
          // NOT SQLite — so they are available to buildGatewayEnv.
          if (value) {
            await secretStore.set(key, value);
          } else {
            await secretStore.delete(key);
          }
          providerChanged = true;
        } else {
          storage.settings.set(key, value);
          if (key === "llm-provider") {
            providerChanged = true;
          }
          if (key === "stt.enabled" || key === "stt.provider") {
            sttChanged = true;
          }
        }
      }
    }
    sendJson(res, 200, { ok: true });
    if (providerChanged) {
      onProviderChange?.();
    }
    if (sttChanged) {
      onSttChange?.();
    }
    return;
  }

  // --- STT Credentials Status ---
  if (pathname === "/api/stt/credentials" && req.method === "GET") {
    try {
      const hasGroqKey = !!(await secretStore.get("stt-groq-apikey"));
      const hasVolcengineAppKey = !!(await secretStore.get("stt-volcengine-appkey"));
      const hasVolcengineAccessKey = !!(await secretStore.get("stt-volcengine-accesskey"));

      sendJson(res, 200, {
        groq: hasGroqKey,
        volcengine: hasVolcengineAppKey && hasVolcengineAccessKey,
      });
      return;
    } catch (err) {
      log.error("Failed to check STT credentials", err);
      sendJson(res, 500, { error: "Failed to check credentials" });
      return;
    }
  }

  // --- STT Credentials ---
  if (pathname === "/api/stt/credentials" && req.method === "PUT") {
    const body = (await parseBody(req)) as {
      provider?: string;
      apiKey?: string;
      appKey?: string;
      accessKey?: string;
    };

    if (!body.provider) {
      sendJson(res, 400, { error: "Missing provider" });
      return;
    }

    try {
      if (body.provider === "groq") {
        if (!body.apiKey) {
          sendJson(res, 400, { error: "Missing apiKey for Groq provider" });
          return;
        }
        await secretStore.set("stt-groq-apikey", body.apiKey);
      } else if (body.provider === "volcengine") {
        if (!body.appKey || !body.accessKey) {
          sendJson(res, 400, { error: "Missing appKey or accessKey for Volcengine provider" });
          return;
        }
        await secretStore.set("stt-volcengine-appkey", body.appKey);
        await secretStore.set("stt-volcengine-accesskey", body.accessKey);
      } else {
        sendJson(res, 400, { error: "Unknown provider" });
        return;
      }

      sendJson(res, 200, { ok: true });
      // Reinitialize STT manager with new credentials
      onSttChange?.();
      return;
    } catch (err) {
      log.error("Failed to save STT credentials", err);
      sendJson(res, 500, { error: "Failed to save credentials" });
      return;
    }
  }

  // --- STT Transcribe ---
  if (pathname === "/api/stt/transcribe" && req.method === "POST") {
    if (!sttManager || !sttManager.isEnabled()) {
      sendJson(res, 503, { error: "STT service not enabled or not configured" });
      return;
    }

    const body = (await parseBody(req)) as {
      audio?: string; // Base64-encoded audio
      format?: string; // Audio format (e.g., "wav", "mp3", "ogg")
    };

    if (!body.audio || !body.format) {
      sendJson(res, 400, { error: "Missing audio or format" });
      return;
    }

    try {
      // Decode base64 audio
      const audioBuffer = Buffer.from(body.audio, "base64");

      // Transcribe
      const text = await sttManager.transcribe(audioBuffer, body.format);

      if (text === null) {
        sendJson(res, 500, { error: "Transcription failed" });
        return;
      }

      sendJson(res, 200, {
        text,
        provider: sttManager.getProvider(),
      });
      return;
    } catch (err) {
      log.error("STT transcription error", err);
      sendJson(res, 500, { error: "Transcription failed: " + String(err) });
      return;
    }
  }

  // --- STT Status ---
  if (pathname === "/api/stt/status" && req.method === "GET") {
    const enabled = sttManager?.isEnabled() ?? false;
    const provider = sttManager?.getProvider() ?? null;
    sendJson(res, 200, { enabled, provider });
    return;
  }

  // --- Provider Keys ---
  if (pathname === "/api/provider-keys" && req.method === "GET") {
    const keys = storage.providerKeys.getAll();

    // Reconstruct full proxy URLs (base URL + credentials from keychain)
    const keysWithProxy = await Promise.all(
      keys.map(async (key) => {
        if (!key.proxyBaseUrl) {
          return key;
        }

        // Try to get credentials from keychain
        const credentials = await secretStore.get(`proxy-auth-${key.id}`);
        const proxyUrl = credentials ? reconstructProxyUrl(key.proxyBaseUrl, credentials) : key.proxyBaseUrl;

        return { ...key, proxyUrl };
      })
    );

    sendJson(res, 200, { keys: keysWithProxy });
    return;
  }

  if (pathname === "/api/provider-keys" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      provider?: string;
      label?: string;
      model?: string;
      apiKey?: string;
      proxyUrl?: string;
    };
    if (!body.provider || !body.apiKey) {
      sendJson(res, 400, { error: "Missing required fields: provider, apiKey" });
      return;
    }

    // Validate key before saving
    const validation = await validateProviderApiKey(body.provider, body.apiKey);
    if (!validation.valid) {
      sendJson(res, 422, { error: validation.error || "Invalid API key" });
      return;
    }

    const id = randomUUID();
    const model = body.model || getDefaultModelForProvider(body.provider as LLMProvider).modelId;
    const label = body.label || "Default";

    // Parse proxy URL if provided (Option B: smart split)
    let proxyBaseUrl: string | null = null;
    if (body.proxyUrl?.trim()) {
      try {
        const proxyConfig = parseProxyUrl(body.proxyUrl.trim());
        proxyBaseUrl = proxyConfig.baseUrl;

        // If proxy has authentication, store credentials in keychain
        if (proxyConfig.hasAuth && proxyConfig.credentials) {
          await secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
        }
      } catch (error) {
        sendJson(res, 400, { error: `Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
    }

    // Check if this is the first key for this provider
    const existingKeys = storage.providerKeys.getByProvider(body.provider);
    const isFirst = existingKeys.length === 0;

    const entry = storage.providerKeys.create({
      id,
      provider: body.provider,
      label,
      model,
      isDefault: isFirst,
      proxyBaseUrl,
      createdAt: "",
      updatedAt: "",
    });

    // Store the actual key in secret store
    await secretStore.set(`provider-key-${id}`, body.apiKey);

    // If first key for this provider, set as active provider
    if (isFirst) {
      const currentProvider = storage.settings.get("llm-provider");
      if (!currentProvider) {
        storage.settings.set("llm-provider", body.provider);
      }
    }

    // Sync the active key to canonical slot
    await syncActiveKey(body.provider, storage, secretStore);

    // First key for provider needs config update (default model), others just need auth profile sync
    onProviderChange?.(isFirst ? { configOnly: true } : { keyOnly: true });

    sendJson(res, 201, entry);
    return;
  }

  // Provider key activate: POST /api/provider-keys/:id/activate
  if (pathname.startsWith("/api/provider-keys/") && pathname.endsWith("/activate") && req.method === "POST") {
    const id = pathname.slice("/api/provider-keys/".length, -"/activate".length);
    const entry = storage.providerKeys.getById(id);
    if (!entry) {
      sendJson(res, 404, { error: "Key not found" });
      return;
    }

    // Check if model changes (must compare BEFORE setDefault overwrites)
    const oldDefault = storage.providerKeys.getDefault(entry.provider);
    const modelChanged = oldDefault?.model !== entry.model;
    const activeProvider = storage.settings.get("llm-provider");

    storage.providerKeys.setDefault(id);
    await syncActiveKey(entry.provider, storage, secretStore);

    // If model changed on the active provider → config update + SIGUSR1
    // If same model (e.g. key rotation) → just sync auth profile, zero disruption
    if (modelChanged && entry.provider === activeProvider) {
      onProviderChange?.({ configOnly: true });
    } else {
      onProviderChange?.({ keyOnly: true });
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  // Provider key with ID: PUT /api/provider-keys/:id, DELETE /api/provider-keys/:id
  if (pathname.startsWith("/api/provider-keys/")) {
    const id = pathname.slice("/api/provider-keys/".length);
    // Skip if contains slash (handled by activate above)
    if (!id.includes("/")) {
      if (req.method === "PUT") {
        const body = (await parseBody(req)) as { label?: string; model?: string; proxyUrl?: string };
        const existing = storage.providerKeys.getById(id);
        if (!existing) {
          sendJson(res, 404, { error: "Key not found" });
          return;
        }

        // Handle proxy URL update if provided
        let proxyBaseUrl: string | null | undefined = undefined;
        if (body.proxyUrl !== undefined) {
          if (body.proxyUrl === "" || body.proxyUrl === null) {
            // Clear proxy
            proxyBaseUrl = null;
            await secretStore.delete(`proxy-auth-${id}`);
          } else {
            // Update proxy
            try {
              const proxyConfig = parseProxyUrl(body.proxyUrl.trim());
              proxyBaseUrl = proxyConfig.baseUrl;

              // Update or clear credentials in keychain
              if (proxyConfig.hasAuth && proxyConfig.credentials) {
                await secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
              } else {
                await secretStore.delete(`proxy-auth-${id}`);
              }
            } catch (error) {
              sendJson(res, 400, { error: `Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}` });
              return;
            }
          }
        }

        const updated = storage.providerKeys.update(id, {
          label: body.label,
          model: body.model,
          proxyBaseUrl,
        });

        // If model or proxy changed on the active key of the active provider, trigger gateway update
        const activeProvider = storage.settings.get("llm-provider");
        const modelChanged = body.model && body.model !== existing.model;
        const proxyChanged = proxyBaseUrl !== undefined && proxyBaseUrl !== existing.proxyBaseUrl;
        if (existing.isDefault && existing.provider === activeProvider && (modelChanged || proxyChanged)) {
          // Model-only change can use SIGUSR1 reload (config file only, no env var change)
          onProviderChange?.({ configOnly: modelChanged && !proxyChanged });
        }

        sendJson(res, 200, updated);
        return;
      }

      if (req.method === "DELETE") {
        const existing = storage.providerKeys.getById(id);
        if (!existing) {
          sendJson(res, 404, { error: "Key not found" });
          return;
        }

        // Delete from DB and secret store
        storage.providerKeys.delete(id);
        await secretStore.delete(`provider-key-${id}`);
        // Also delete proxy credentials if they exist
        await secretStore.delete(`proxy-auth-${id}`);

        // If was default, promote next key for same provider
        let promotedModel: string | undefined;
        if (existing.isDefault) {
          const remaining = storage.providerKeys.getByProvider(existing.provider);
          if (remaining.length > 0) {
            storage.providerKeys.setDefault(remaining[0].id);
            promotedModel = remaining[0].model;
          }
        }

        // Sync active key (may have promoted a new default or removed the profile)
        await syncActiveKey(existing.provider, storage, secretStore);

        // If the promoted key has a different model (or last key removed), config needs updating
        const activeProvider = storage.settings.get("llm-provider");
        const modelChanged = existing.isDefault && existing.provider === activeProvider
          && promotedModel !== existing.model;
        onProviderChange?.(modelChanged ? { configOnly: true } : { keyOnly: true });

        sendJson(res, 200, { ok: true });
        return;
      }
    }
  }

  // --- Model Catalog ---
  if (pathname === "/api/models" && req.method === "GET") {
    const catalog = await readFullModelCatalog(undefined, vendorDir);
    sendJson(res, 200, { models: catalog });
    return;
  }

  // --- Channels ---

  // GET /api/channels/status - Get real-time channel status from OpenClaw gateway
  if (pathname === "/api/channels/status" && req.method === "GET") {
    const rpcClient = getRpcClient?.();

    if (!rpcClient || !rpcClient.isConnected()) {
      sendJson(res, 503, {
        error: "Gateway not connected",
        snapshot: null
      });
      return;
    }

    try {
      const probe = url.searchParams.get("probe") === "true";
      const timeoutMs = 8000;

      const snapshot = await rpcClient.request<ChannelsStatusSnapshot>(
        "channels.status",
        { probe, timeoutMs },
        timeoutMs + 2000 // Add 2s buffer for request timeout
      );

      sendJson(res, 200, { snapshot });
    } catch (err) {
      log.error("Failed to fetch channels status:", err);
      sendJson(res, 500, {
        error: String(err),
        snapshot: null
      });
    }
    return;
  }

  // POST /api/channels/accounts - Add new channel account
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
      return;
    }

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return;
    }

    try {
      const configPath = resolveOpenClawConfigPath();

      // Prepare the account config (including secrets)
      const accountConfig: Record<string, unknown> = {
        ...body.config,
        enabled: body.config.enabled ?? true,
      };

      // Add name if provided
      if (body.name) {
        accountConfig.name = body.name;
      }

      // Store secrets in both Keychain AND config file
      // OpenClaw reads secrets from config file, not Keychain
      if (body.secrets && typeof body.secrets === "object") {
        for (const [secretKey, secretValue] of Object.entries(body.secrets)) {
          if (secretValue) {
            // Store in Keychain for backup/UI display
            const storeKey = `channel-${body.channelId}-${body.accountId}-${secretKey}`;
            await secretStore.set(storeKey, secretValue);
            log.info(`Stored secret for ${body.channelId}/${body.accountId}: ${secretKey}`);

            // ALSO write to config file (OpenClaw expects secrets here)
            accountConfig[secretKey] = secretValue;
          }
        }
      }

      // Write the account config to OpenClaw config.json
      writeChannelAccount({
        configPath,
        channelId: body.channelId,
        accountId: body.accountId,
        config: accountConfig,
      });

      sendJson(res, 201, {
        ok: true,
        channelId: body.channelId,
        accountId: body.accountId,
      });

      // Notify gateway to reload config (config-only change, no env vars)
      onProviderChange?.({ configOnly: true });

      // Track channel configuration
      onChannelConfigured?.(body.channelId);
    } catch (err) {
      log.error("Failed to create channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // PUT /api/channels/accounts/:channelId/:accountId - Update channel account
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "PUT") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return;
    }

    const [channelId, accountId] = parts;
    const body = (await parseBody(req)) as {
      name?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
    };

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return;
    }

    try {
      const configPath = resolveOpenClawConfigPath();

      // Read existing account config so we can merge (preserves secrets not re-sent)
      const existingFullConfig = readExistingConfig(configPath);
      const existingChannels = (existingFullConfig.channels ?? {}) as Record<string, unknown>;
      const existingChannel = (existingChannels[channelId] ?? {}) as Record<string, unknown>;
      const existingAccounts = (existingChannel.accounts ?? {}) as Record<string, unknown>;
      const existingAccountConfig = (existingAccounts[accountId] ?? {}) as Record<string, unknown>;

      // Merge: start with existing config, overlay new config on top
      const accountConfig: Record<string, unknown> = { ...existingAccountConfig, ...body.config };

      // Add name if provided
      if (body.name !== undefined) {
        accountConfig.name = body.name;
      }

      // Update secrets in both Keychain AND config file
      // OpenClaw reads secrets from config file, not Keychain
      if (body.secrets && typeof body.secrets === "object") {
        for (const [secretKey, secretValue] of Object.entries(body.secrets)) {
          const storeKey = `channel-${channelId}-${accountId}-${secretKey}`;
          if (secretValue) {
            // Update in Keychain
            await secretStore.set(storeKey, secretValue);
            log.info(`Updated secret for ${channelId}/${accountId}: ${secretKey}`);

            // ALSO write to config file (OpenClaw expects secrets here)
            accountConfig[secretKey] = secretValue;
          } else {
            // Empty value means delete the secret
            await secretStore.delete(storeKey);
            log.info(`Deleted secret for ${channelId}/${accountId}: ${secretKey}`);
            // Don't add to config when deleting
          }
        }
      }

      // Write the updated account config
      writeChannelAccount({
        configPath,
        channelId,
        accountId,
        config: accountConfig,
      });

      sendJson(res, 200, {
        ok: true,
        channelId,
        accountId,
      });

      // Notify gateway to reload config
      onProviderChange?.({ configOnly: true });

      // Track channel configuration
      onChannelConfigured?.(channelId);
    } catch (err) {
      log.error("Failed to update channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // DELETE /api/channels/accounts/:channelId/:accountId - Remove channel account
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return;
    }

    const [channelId, accountId] = parts;

    try {
      const configPath = resolveOpenClawConfigPath();

      // Remove all secrets for this account
      const allSecretKeys = await secretStore.listKeys();
      const accountSecretPrefix = `channel-${channelId}-${accountId}-`;
      for (const key of allSecretKeys) {
        if (key.startsWith(accountSecretPrefix)) {
          await secretStore.delete(key);
          log.info(`Deleted secret: ${key}`);
        }
      }

      // Remove the account from config
      removeChannelAccount({
        configPath,
        channelId,
        accountId,
      });

      sendJson(res, 200, {
        ok: true,
        channelId,
        accountId,
      });

      // Notify gateway to reload config
      onProviderChange?.({ configOnly: true });
    } catch (err) {
      log.error("Failed to delete channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // GET /api/pairing/requests/:channelId - Get pending pairing requests
  if (pathname.startsWith("/api/pairing/requests/") && req.method === "GET") {
    const channelId = pathname.slice("/api/pairing/requests/".length);
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return;
    }

    try {
      const requests = await readPairingRequests(channelId);
      sendJson(res, 200, { requests });
    } catch (err) {
      log.error(`Failed to list pairing requests for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // GET /api/pairing/allowlist/:channelId - Get current allowlist
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "GET") {
    const channelId = pathname.slice("/api/pairing/allowlist/".length).split("/")[0];
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return;
    }

    try {
      const allowlist = await readAllowFromList(channelId);
      sendJson(res, 200, { allowlist });
    } catch (err) {
      log.error(`Failed to read allowlist for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // POST /api/pairing/approve - Approve a pairing code
  if (pathname === "/api/pairing/approve" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelId?: string;
      code?: string;
      locale?: string;
    };

    if (!body.channelId || !body.code) {
      sendJson(res, 400, { error: "Missing required fields: channelId, code" });
      return;
    }

    try {
      const requests = await readPairingRequests(body.channelId);
      const codeUpper = body.code.trim().toUpperCase();
      const requestIndex = requests.findIndex(r => r.code.toUpperCase() === codeUpper);

      if (requestIndex < 0) {
        sendJson(res, 404, { error: "Pairing code not found or expired" });
        return;
      }

      const request = requests[requestIndex];

      // Remove from pending requests
      requests.splice(requestIndex, 1);
      await writePairingRequests(body.channelId, requests);

      // Add to allowlist
      const allowlist = await readAllowFromList(body.channelId);
      if (!allowlist.includes(request.id)) {
        allowlist.push(request.id);
        await writeAllowFromList(body.channelId, allowlist);
      }

      sendJson(res, 200, {
        ok: true,
        id: request.id,
        entry: request,
      });

      log.info(`Approved pairing for ${body.channelId}: ${request.id}`);

      // Send approval confirmation to the user via their channel
      const locale = (body.locale === "zh" ? "zh" : "en") as "zh" | "en";
      const confirmMsg = APPROVAL_MESSAGES[locale];
      sendChannelMessage(body.channelId, request.id, confirmMsg).then(ok => {
        if (ok) log.info(`Sent approval confirmation to ${body.channelId} user ${request.id}`);
      });
    } catch (err) {
      log.error("Failed to approve pairing:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // DELETE /api/pairing/allowlist/:channelId/:entry - Remove from allowlist
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/pairing/allowlist/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/pairing/allowlist/:channelId/:entry" });
      return;
    }

    const [channelId, entry] = parts.map(decodeURIComponent);

    try {
      const allowlist = await readAllowFromList(channelId);
      const filtered = allowlist.filter(e => e !== entry);
      const changed = filtered.length !== allowlist.length;

      if (changed) {
        await writeAllowFromList(channelId, filtered);
        log.info(`Removed from ${channelId} allowlist: ${entry}`);
      }

      sendJson(res, 200, {
        ok: true,
        changed,
        allowFrom: filtered,
      });
    } catch (err) {
      log.error("Failed to remove from allowlist:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  if (pathname === "/api/channels" && req.method === "GET") {
    const channels = storage.channels.getAll();
    sendJson(res, 200, { channels });
    return;
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
    return;
  }

  if (pathname.startsWith("/api/channels/") && req.method === "DELETE") {
    const id = pathname.slice("/api/channels/".length);
    const deleted = storage.channels.delete(id);
    if (deleted) {
      onRuleChange?.("channel-deleted", id);
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 404, { error: "Channel not found" });
    }
    return;
  }

  // --- Permissions ---
  if (pathname === "/api/permissions" && req.method === "GET") {
    const permissions = storage.permissions.get();
    sendJson(res, 200, { permissions });
    return;
  }

  if (pathname === "/api/permissions" && req.method === "PUT") {
    const body = (await parseBody(req)) as { readPaths?: string[]; writePaths?: string[] };
    const permissions = storage.permissions.update({
      readPaths: body.readPaths ?? [],
      writePaths: body.writePaths ?? [],
    });

    // Sync permissions to OpenClaw config (docker bind mounts)
    try {
      syncPermissions(permissions);
      log.info("Synced filesystem permissions to OpenClaw config");

      // Trigger gateway restart for permissions change
      // Note: Permissions require environment variable update (EASYCLAW_FILE_PERMISSIONS),
      // which requires a full gateway restart to apply the updated env vars.
      onPermissionsChange?.();
    } catch (err) {
      log.error("Failed to sync permissions to OpenClaw:", err);
      // Still return success to the client since permissions were saved to SQLite
    }

    sendJson(res, 200, { permissions });
    return;
  }

  // --- Workspace Path ---
  if (pathname === "/api/workspace" && req.method === "GET") {
    // Return the OpenClaw workspace path (where the gateway process is running)
    // This is typically the directory where EasyClaw desktop app is running
    const workspacePath = process.cwd();
    sendJson(res, 200, { workspacePath });
    return;
  }

  // --- Usage ---
  if (pathname === "/api/usage" && req.method === "GET") {
    const filter: UsageFilter = {};
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");
    if (since) filter.since = since;
    if (until) filter.until = until;

    // Check cache first
    const cacheKey = `usage-${filter.since ?? "all"}-${filter.until ?? "all"}`;
    const cached = getCachedUsage(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    try {
      // Parse date filters to timestamps
      const startMs = filter.since ? new Date(filter.since).getTime() : undefined;
      const endMs = filter.until ? new Date(filter.until).getTime() : undefined;

      // Load OpenClaw config for cost estimation
      const configPath = resolveOpenClawConfigPath();
      const config = readExistingConfig(configPath);

      // Call OpenClaw's aggregation function for totals
      const costSummary = await loadCostUsageSummary({
        startMs,
        endMs,
        config,
        // agentId: undefined (scan all agents)
      });

      // Discover all sessions and load their summaries for byModel/byProvider breakdown
      const sessions = await discoverAllSessions({ startMs, endMs });
      const sessionSummaries: SessionCostSummary[] = [];

      for (const session of sessions) {
        const summary = await loadSessionCostSummary({
          sessionFile: session.sessionFile,
          config,
          startMs,
          endMs,
        });
        if (summary && summary.modelUsage) {
          sessionSummaries.push(summary);
        }
      }

      // Transform to frontend UsageSummary format with byModel/byProvider
      const summary = transformToUsageSummary(costSummary, sessionSummaries);

      // Cache the result
      setCachedUsage(cacheKey, summary);

      sendJson(res, 200, summary);
    } catch (error) {
      log.error("Failed to load usage data", error);
      sendJson(res, 200, emptyUsageSummary());
    }
    return;
  }

  // --- File Dialog ---
  if (pathname === "/api/file-dialog" && req.method === "POST") {
    if (!onOpenFileDialog) {
      sendJson(res, 501, { error: "File dialog not available" });
      return;
    }
    const selected = await onOpenFileDialog();
    sendJson(res, 200, { path: selected });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(
  res: ServerResponse,
  distDir: string,
  pathname: string,
): void {
  // Prevent directory traversal
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(distDir, safePath);

  // If the path doesn't point to an existing file, serve index.html (SPA fallback)
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  // Ensure the resolved path is within distDir (prevent traversal)
  const resolvedFile = resolve(filePath);
  const resolvedDist = resolve(distDir);
  if (!resolvedFile.startsWith(resolvedDist)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
