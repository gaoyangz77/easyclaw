import { createServer } from "node:http";
import type { ServerResponse, Server } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, resolve, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { formatError, IMAGE_EXT_TO_MIME } from "@easyclaw/core";
import { createLogger } from "@easyclaw/logger";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";
import { resolveOpenClawConfigPath, readExistingConfig, resolveOpenClawStateDir, GatewayRpcClient } from "@easyclaw/gateway";
import { discoverAllSessions, loadSessionCostSummary } from "../../../vendor/openclaw/src/infra/session-cost-usage.js";
import { promises as fs } from "node:fs";
import { resolveMediaBase } from "./media-paths.js";
import { UsageSnapshotEngine } from "./usage-snapshot-engine.js";
import type { ModelUsageTotals } from "./usage-snapshot-engine.js";
import { UsageQueryService } from "./usage-query-service.js";
import { initCSBridge, restoreCS } from "./customer-service-bridge.js";
import { sendChannelMessage } from "./channel-senders.js";
import { createWeComRelay } from "./wecom-relay.js";
import type { ApiContext, RouteHandler } from "./api-routes/api-context.js";
import { sendJson } from "./api-routes/route-utils.js";
import { proxiedFetch } from "./api-routes/route-utils.js";
import { handleRulesRoutes } from "./api-routes/rules-routes.js";
import { handleSettingsRoutes } from "./api-routes/settings-routes.js";
import { handleProviderRoutes } from "./api-routes/provider-routes.js";
import { handleChannelRoutes } from "./api-routes/channel-routes.js";
import { handleUsageRoutes } from "./api-routes/usage-routes.js";
import { handleWecomRoutes } from "./api-routes/wecom-routes.js";
import { handleSkillsRoutes } from "./api-routes/skills-routes.js";
import { handleChatSessionRoutes } from "./api-routes/chat-session-routes.js";

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

// === Chat Event SSE Bridge ===
const chatEventSSEClients = new Set<ServerResponse>();

export function pushChatSSE(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of chatEventSSEClients) {
    res.write(msg);
  }
}

// --- Pairing Notifier ---

interface PairingStore {
  version: number;
  requests: Array<{ id: string; code: string; createdAt: string; lastSeenAt: string; meta?: Record<string, string> }>;
}

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

function startPairingNotifier(): { stop: () => void } {
  const credentialsDir = join(resolveOpenClawStateDir(), "credentials");
  const knownCodes = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
        } catch { /* per-file errors */ }
      }
    } catch { /* directory may not exist */ }
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
          sendChannelMessage(channelId, req.id, message, proxiedFetch);
        }
      }
    } catch (err) {
      log.error("Pairing notifier check failed:", err);
    }
  }

  initKnownCodes();

  let watcher: ReturnType<typeof watch> | null = null;
  try {
    fs.mkdir(credentialsDir, { recursive: true }).then(() => {
      try {
        watcher = watch(credentialsDir, (_eventType, filename) => {
          if (!filename?.endsWith("-pairing.json")) return;
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

// --- PanelServerOptions ---

export interface PanelServerOptions {
  port?: number;
  panelDistDir: string;
  storage: Storage;
  secretStore: SecretStore;
  getRpcClient?: () => GatewayRpcClient | null;
  onRuleChange?: (action: "created" | "updated" | "deleted" | "channel-created" | "channel-deleted", ruleId: string) => void;
  onProviderChange?: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => void;
  onOpenFileDialog?: () => Promise<string | null>;
  sttManager?: {
    transcribe(audio: Buffer, format: string): Promise<string | null>;
    isEnabled(): boolean;
    getProvider(): string | null;
    initialize(): Promise<void>;
  };
  onSttChange?: () => void;
  onPermissionsChange?: () => void;
  onBrowserChange?: () => void;
  onAutoLaunchChange?: (enabled: boolean) => void;
  onChannelConfigured?: (channelId: string) => void;
  onOAuthFlow?: (provider: string) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  onOAuthAcquire?: (provider: string) => Promise<{ email?: string; tokenPreview: string; manualMode?: boolean; authUrl?: string }>;
  onOAuthSave?: (provider: string, options: { proxyUrl?: string; label?: string; model?: string }) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  onOAuthManualComplete?: (provider: string, callbackUrl: string) => Promise<{ email?: string; tokenPreview: string }>;
  onTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  vendorDir?: string;
  deviceId?: string;
  getUpdateResult?: () => {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    download?: { url: string; sha256: string; size: number };
    releaseNotes?: string;
    error?: string;
  } | null;
  getGatewayInfo?: () => { wsUrl: string; token?: string };
  changelogPath?: string;
  onUpdateDownload?: () => Promise<void>;
  onUpdateCancel?: () => void;
  onUpdateInstall?: () => Promise<void>;
  getUpdateDownloadState?: () => { status: string; [key: string]: unknown };
}

// --- Route handlers (dispatched in order, first match wins) ---

const routeHandlers: RouteHandler[] = [
  handleWecomRoutes,     // Must be before channels (wecom/unbind, wecom/bind match channels/ prefix)
  handleRulesRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleChannelRoutes,
  handleUsageRoutes,
  handleSkillsRoutes,
  handleChatSessionRoutes,
];

/**
 * Create and start a local HTTP server that serves the panel SPA
 * and provides REST API endpoints backed by real storage.
 */
export function startPanelServer(options: PanelServerOptions): Server {
  const port = options.port ?? 3210;
  const distDir = resolve(options.panelDistDir);
  const { storage, secretStore, getRpcClient, onRuleChange, onProviderChange, onOpenFileDialog, sttManager, onSttChange, onPermissionsChange, onBrowserChange, onAutoLaunchChange, onChannelConfigured, onOAuthFlow, onOAuthAcquire, onOAuthSave, onOAuthManualComplete, onTelemetryTrack, vendorDir, deviceId, getUpdateResult, getGatewayInfo, changelogPath, onUpdateDownload, onUpdateCancel, onUpdateInstall, getUpdateDownloadState } = options;

  // Create WeCom relay instance
  const wecomRelay = createWeComRelay({ pushChatSSE });
  wecomRelay.initRefs({ storage, sttMgr: sttManager ?? undefined });

  // Initialize the customer service bridge
  initCSBridge({ storage, secretStore, getGatewayInfo, deviceId });

  // Read changelog.json once at startup (cached in closure)
  let changelogEntries: unknown[] = [];
  if (changelogPath && existsSync(changelogPath)) {
    try {
      changelogEntries = JSON.parse(readFileSync(changelogPath, "utf-8"));
    } catch (err) {
      log.warn("Failed to read changelog.json:", err);
    }
  }

  // Ensure vendor OpenClaw functions read from EasyClaw's state dir
  process.env.OPENCLAW_STATE_DIR = resolveOpenClawStateDir();

  // --- Per-Key/Model Usage Tracking ---
  const captureUsage = async (): Promise<Map<string, ModelUsageTotals>> => {
    const result = new Map<string, ModelUsageTotals>();
    try {
      const ocConfigPath = resolveOpenClawConfigPath();
      const ocConfig = readExistingConfig(ocConfigPath);
      const sessions = await discoverAllSessions({});
      for (const s of sessions) {
        const summary = await loadSessionCostSummary({ sessionFile: s.sessionFile, config: ocConfig });
        if (!summary?.modelUsage) continue;
        for (const mu of summary.modelUsage) {
          const key = `${mu.provider ?? "unknown"}/${mu.model ?? "unknown"}`;
          const existing = result.get(key);
          if (existing) {
            existing.inputTokens += mu.totals.input;
            existing.outputTokens += mu.totals.output;
            existing.cacheReadTokens += mu.totals.cacheRead;
            existing.cacheWriteTokens += mu.totals.cacheWrite;
            existing.totalCostUsd = (parseFloat(existing.totalCostUsd) + mu.totals.totalCost).toFixed(6);
          } else {
            result.set(key, {
              inputTokens: mu.totals.input,
              outputTokens: mu.totals.output,
              cacheReadTokens: mu.totals.cacheRead,
              cacheWriteTokens: mu.totals.cacheWrite,
              totalCostUsd: mu.totals.totalCost.toFixed(6),
            });
          }
        }
      }
    } catch (err) {
      log.error("Failed to capture current usage:", err);
    }
    return result;
  };

  const snapshotEngine = new UsageSnapshotEngine(storage, captureUsage);
  const queryService = new UsageQueryService(storage, captureUsage);

  // Reconcile usage snapshot for the active key on startup
  const activeKeyOnStartup = storage.providerKeys.getActive();
  if (activeKeyOnStartup) {
    snapshotEngine.reconcileOnStartup(activeKeyOnStartup.id, activeKeyOnStartup.provider, activeKeyOnStartup.model).catch((err) => {
      log.error(`Failed to reconcile usage for key ${activeKeyOnStartup.id}:`, err);
    });
  }

  // Start pairing notifier
  const pairingNotifier = startPairingNotifier();

  // Build the ApiContext object passed to all route handlers
  const ctx: ApiContext = {
    storage, secretStore, getRpcClient, onRuleChange, onProviderChange, onOpenFileDialog,
    sttManager, onSttChange, onPermissionsChange, onBrowserChange, onAutoLaunchChange,
    onChannelConfigured, onOAuthFlow, onOAuthAcquire, onOAuthSave, onOAuthManualComplete,
    onTelemetryTrack, vendorDir, deviceId, getUpdateResult, getGatewayInfo,
    snapshotEngine, queryService, wecomRelay,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint for chat page real-time events
    if (pathname === "/api/chat/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(":ok\n\n");
      chatEventSSEClients.add(res);
      req.on("close", () => chatEventSSEClients.delete(res));
      return;
    }

    // Serve media files from ~/.easyclaw/openclaw/media/
    if (pathname.startsWith("/api/media/") && req.method === "GET") {
      const mediaBase = resolveMediaBase();
      const relPath = decodeURIComponent(pathname.replace("/api/media/", ""));
      const absPath = resolve(mediaBase, relPath);
      if (!absPath.startsWith(mediaBase + "/")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      try {
        const data = readFileSync(absPath);
        const ext = extname(absPath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": IMAGE_EXT_TO_MIME[ext] ?? "application/octet-stream",
          "Cache-Control": "private, max-age=86400",
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // API routes
    if (pathname.startsWith("/api/")) {
      // Changelog endpoint (uses closure variable changelogEntries)
      if (pathname === "/api/app/changelog" && req.method === "GET") {
        const result = getUpdateResult?.();
        sendJson(res, 200, {
          currentVersion: result?.currentVersion ?? null,
          entries: changelogEntries,
        });
        return;
      }

      // In-app update download/install endpoints (use closure callbacks)
      if (pathname === "/api/app/update/download" && req.method === "POST") {
        if (!onUpdateDownload) {
          sendJson(res, 501, { error: "Not supported" });
          return;
        }
        onUpdateDownload().catch(() => {});
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/app/update/cancel" && req.method === "POST") {
        onUpdateCancel?.();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/app/update/download-status" && req.method === "GET") {
        const state = getUpdateDownloadState?.() ?? { status: "idle" };
        sendJson(res, 200, state);
        return;
      }

      if (pathname === "/api/app/update/install" && req.method === "POST") {
        if (!onUpdateInstall) {
          sendJson(res, 501, { error: "Not supported" });
          return;
        }
        onUpdateInstall()
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((err: unknown) => {
            const msg = formatError(err);
            sendJson(res, 500, { error: msg });
          });
        return;
      }

      // Dispatch to route handlers
      try {
        for (const handler of routeHandlers) {
          const handled = await handler(req, res, url, pathname, ctx);
          if (handled) return;
        }
        // No handler matched
        sendJson(res, 404, { error: "Not found" });
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

  // Restore WeCom relay connection from persisted credentials
  const savedRelayUrl = storage.settings.get("wecom-relay-url");
  if (savedRelayUrl) {
    secretStore.get("wecom-auth-token").then((savedAuthToken) => {
      if (!savedAuthToken) return;
      const gwId = deviceId ?? randomUUID();
      const savedExternalUserId = storage.settings.get("wecom-external-user-id") as string | undefined;
      wecomRelay.setState({
        relayUrl: savedRelayUrl,
        authToken: savedAuthToken,
        connected: false,
        externalUserId: savedExternalUserId,
      });
      const gwInfo = getGatewayInfo?.();
      wecomRelay.start({
        relayUrl: savedRelayUrl,
        authToken: savedAuthToken,
        gatewayId: gwId,
        gatewayWsUrl: gwInfo?.wsUrl ?? "ws://127.0.0.1:28789",
        gatewayToken: gwInfo?.token,
      });
      log.info("WeCom relay: restored from saved credentials");
    }).catch((err) => {
      log.warn("WeCom relay: failed to restore saved credentials:", err);
    });
  }

  // Restore customer service module
  restoreCS().catch((err) => {
    log.warn("CS: failed to restore from saved config:", err);
  });

  return server;
}

function serveStatic(
  res: ServerResponse,
  distDir: string,
  pathname: string,
): void {
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(distDir, safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

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
