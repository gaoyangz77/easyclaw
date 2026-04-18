import { createServer } from "node:http";
import type { ServerResponse, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, normalize } from "node:path";
import { formatError, IMAGE_EXT_TO_MIME, resolvePanelPort, getApiBaseUrl } from "@rivonclaw/core";
import { createLogger } from "@rivonclaw/logger";
import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import { resolveOpenClawStateDir } from "@rivonclaw/gateway";
import { resolveMediaBase } from "../utils/media-paths.js";
import { createUsageRuntime } from "../usage/runtime.js";
import { initMobileManagerEnv } from "./store/desktop-store.js";
import { rootStore } from "./store/desktop-store.js";
import { runtimeStatusStore } from "./store/runtime-status-store.js";
import { openClawConnector } from "../openclaw/index.js";
import type { AuthSessionManager } from "../auth/session.js";
import type { SessionLifecycleManager } from "../browser-profiles/session-lifecycle-manager.js";
import type { ManagedBrowserService } from "../browser-profiles/managed-browser-service.js";
import { CloudClient } from "../cloud/cloud-client.js";
import { startPairingNotifier } from "../channels/pairing-notifier.js";
import type { ApiContext } from "./api-context.js";
import { sendJson } from "../infra/api/route-utils.js";
import { handleStoreStream } from "./store-stream-routes.js";
import { handleRuntimeStatusStream } from "./runtime-status-stream-routes.js";
import { RouteRegistry } from "../infra/api/route-registry.js";
import { registerAllHandlers } from "./register-all.js";

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
    if (!res.writable) {
      chatEventSSEClients.delete(res);
      continue;
    }
    res.write(msg, (err) => {
      if (err) {
        console.warn("[panel-server] SSE write failed, removing client:", err.message);
        chatEventSSEClients.delete(res);
      }
    });
  }
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

// --- PanelServerOptions ---

export interface PanelServerOptions {
  port?: number;
  panelDistDir: string;
  storage: Storage;
  secretStore: SecretStore;
  proxyRouterPort: number;
  gatewayPort: number;
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
  onExtrasChange?: () => void;
  onPermissionsChange?: () => void;
  onToolSelectionChange?: (effectiveToolIds: string[]) => void;
  onBrowserChange?: () => void;
  onAutoLaunchChange?: (enabled: boolean) => void;
  onAuthChange?: () => void;
  onChannelConfigured?: (channelId: string) => void;
  onOAuthFlow?: (provider: string) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  onOAuthAcquire?: (provider: string) => Promise<{ email?: string; tokenPreview: string; manualMode?: boolean; authUrl?: string; flowId?: string }>;
  onOAuthSave?: (provider: string, options: { proxyUrl?: string; label?: string; model?: string }) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  /** Rotate stored OAuth credentials for an existing key in place (no new row).
   *  `idTokenCaptureFailed` propagates back to the Panel so the Reauth modal
   *  can warn the user about the narrow OAuth server-side rotation race. */
  onOAuthReauth?: (keyId: string) => Promise<{ ok: true; idTokenCaptureFailed: boolean }>;
  onOAuthManualComplete?: (provider: string, callbackUrl: string) => Promise<{ email?: string; tokenPreview: string }>;
  onOAuthPoll?: (flowId: string) => { status: "pending" | "completed" | "failed"; tokenPreview?: string; email?: string; error?: string };
  onTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  /** Emit a CS business-telemetry event (bypasses user opt-in). See `ApiContext.onCsTelemetryTrack`. */
  onCsTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  vendorDir: string;
  /** Node.js binary path for spawning OpenClaw CLI commands (e.g. doctor). */
  nodeBin: string;
  deviceId?: string;
  getUpdateResult?: () => {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string | null;
  } | null;
  getGatewayInfo?: () => { wsUrl: string; token?: string };
  changelogPath?: string;
  onUpdateDownload?: () => Promise<void>;
  onUpdateCancel?: () => void;
  onUpdateInstall?: () => Promise<void>;
  getUpdateDownloadState?: () => { status: string;[key: string]: unknown };
  authSession?: AuthSessionManager;
  proxyFetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  sessionLifecycleManager?: SessionLifecycleManager;
  managedBrowserService?: ManagedBrowserService;
  channelManager?: import("../channels/channel-manager.js").ChannelManagerInstance;
}

// --- Route registry (all endpoints registered here) ---
const registry = new RouteRegistry();
registerAllHandlers(registry);

/**
 * Create and start a local HTTP server that serves the panel SPA
 * and provides REST API endpoints backed by real storage.
 *
 * Returns a promise that resolves once the server is bound, providing
 * the Server instance and the actual port (useful when port 0 is used
 * for OS-assigned dynamic allocation).
 */
export async function startPanelServer(options: PanelServerOptions): Promise<{ server: Server; port: number }> {
  const requestedPort = options.port ?? resolvePanelPort();
  const distDir = resolve(options.panelDistDir);
  const { storage, secretStore, proxyRouterPort, gatewayPort, onRuleChange, onProviderChange, onOpenFileDialog, sttManager, onSttChange, onExtrasChange, onPermissionsChange, onToolSelectionChange, onBrowserChange, onAutoLaunchChange, onAuthChange, onChannelConfigured, onOAuthFlow, onOAuthAcquire, onOAuthSave, onOAuthReauth, onOAuthManualComplete, onOAuthPoll, onTelemetryTrack, onCsTelemetryTrack, vendorDir, nodeBin, deviceId, getUpdateResult, getGatewayInfo, changelogPath, onUpdateDownload, onUpdateCancel, onUpdateInstall, getUpdateDownloadState, authSession, sessionLifecycleManager, managedBrowserService, channelManager } = options;

  // Read changelog.json once at startup (cached in closure)
  let changelogEntries: unknown[] = [];
  if (changelogPath && existsSync(changelogPath)) {
    try {
      changelogEntries = JSON.parse(readFileSync(changelogPath, "utf-8"));
    } catch (err) {
      log.warn("Failed to read changelog.json:", err);
    }
  }

  // Ensure vendor OpenClaw functions read from RivonClaw's state dir
  process.env.OPENCLAW_STATE_DIR = resolveOpenClawStateDir();

  // --- Per-Key/Model Usage Tracking ---
  const { snapshotEngine, queryService } = createUsageRuntime(storage);

  // Mobile Chat Pairing Manager (MST model on desktop store)
  initMobileManagerEnv({
    storage,
    controlPlaneUrl: getApiBaseUrl(getSystemLocale()),
    stateDir: resolveOpenClawStateDir(),
    getRpcClient: () => { try { return openClawConnector.ensureRpcReady(); } catch { return null; } },
  });

  // Hydrate runtime-status AppSettings from persisted storage
  runtimeStatusStore.loadAppSettings(storage.settings.getAll());

  // Publish device identity so Panel can derive CS bridge eligibility
  if (deviceId) runtimeStatusStore.setDeviceId(deviceId);

  // Reconcile usage snapshot for the active key on startup
  const activeKeyOnStartup = storage.providerKeys.getActive();
  if (activeKeyOnStartup) {
    snapshotEngine.reconcileOnStartup(activeKeyOnStartup.id, activeKeyOnStartup.provider, activeKeyOnStartup.model).catch((err) => {
      log.error(`Failed to reconcile usage for key ${activeKeyOnStartup.id}:`, err);
    });
  }

  // Start pairing notifier
  const pairingNotifier = startPairingNotifier(proxyRouterPort, pushChatSSE);

  // Build the ApiContext object passed to all route handlers
  const ctx: ApiContext = {
    storage, secretStore, proxyRouterPort, gatewayPort,
    onRuleChange, onProviderChange, onOpenFileDialog,
    sttManager, onSttChange, onExtrasChange, onPermissionsChange, onToolSelectionChange, onBrowserChange, onAutoLaunchChange, onAuthChange,
    onChannelConfigured, onOAuthFlow, onOAuthAcquire, onOAuthSave, onOAuthReauth, onOAuthManualComplete, onOAuthPoll,
    onTelemetryTrack, onCsTelemetryTrack, vendorDir, nodeBin, deviceId, getUpdateResult, getGatewayInfo,
    snapshotEngine, queryService, mobileManager: rootStore.mobileManager, authSession,
    cloudClient: authSession ? new CloudClient(authSession, getSystemLocale(), options.proxyFetch) : undefined,
    sessionLifecycleManager,
    managedBrowserService,
    channelManager,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${requestedPort}`);
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
      const cleanup = () => chatEventSSEClients.delete(res);
      req.on("close", cleanup);
      res.on("error", cleanup);
      return;
    }

    // SSE endpoint for MST store patch sync (Desktop → Panel)
    if (pathname === "/api/store/stream" && req.method === "GET") {
      handleStoreStream(req, res);
      return;
    }

    // SSE endpoint for runtime status patch sync (Desktop → Panel)
    if (pathname === "/api/status/stream" && req.method === "GET") {
      handleRuntimeStatusStream(req, res);
      return;
    }

    // Serve media files from ~/.rivonclaw/openclaw/media/
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
        onUpdateDownload().catch(() => { });
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

      try {
        if (await registry.dispatch(req, res, url, pathname, ctx)) return;
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

  server.on("close", () => pairingNotifier.stop());

  const actualPort = await new Promise<number>((resolve, reject) => {
    server.listen(requestedPort, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      log.info(`Panel server listening on http://127.0.0.1:${addr.port}`);
      resolve(addr.port);
    });
    server.on("error", reject);
  });

  return { server, port: actualPort };
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
