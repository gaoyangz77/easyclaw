import { app, BrowserWindow, Menu, Tray, shell, dialog, Notification, session } from "electron";
import { createLogger, enableFileLogging } from "@easyclaw/logger";
import {
  GatewayLauncher,
  GatewayRpcClient,
  resolveVendorEntryPath,
  ensureGatewayConfig,
  resolveOpenClawStateDir,
  writeGatewayConfig,
  buildGatewayEnv,
  readExistingConfig,
  syncAllAuthProfiles,
  syncBackOAuthCredentials,
  clearAllAuthProfiles,
  DEFAULT_GATEWAY_PORT,
  buildExtraProviderConfigs,
  acquireGeminiOAuthToken,
  saveGeminiOAuthCredentials,
  validateGeminiAccessToken,
  startManualOAuthFlow,
  completeManualOAuthFlow,
} from "@easyclaw/gateway";
import type { OAuthFlowResult, AcquiredOAuthCredentials } from "@easyclaw/gateway";
import type { GatewayState } from "@easyclaw/gateway";
import { resolveModelConfig, ALL_PROVIDERS, LOCAL_PROVIDER_IDS, getDefaultModelForProvider, getProviderMeta, providerSecretKey, reconstructProxyUrl, parseProxyUrl } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { createStorage } from "@easyclaw/storage";
import { createSecretStore } from "@easyclaw/secrets";
import { ArtifactPipeline, syncSkillsForRule, cleanupSkillsForDeletedRule } from "@easyclaw/rules";
import type { LLMConfig } from "@easyclaw/rules";
import { ProxyRouter } from "@easyclaw/proxy-router";
import type { ProxyRouterConfig } from "@easyclaw/proxy-router";
import { RemoteTelemetryClient } from "@easyclaw/telemetry";
import { getDeviceId } from "@easyclaw/device-id";
import { checkForUpdate, downloadAndVerify, getPlatformKey, installWindows, installMacOS, resolveAppBundlePath, isNewerVersion } from "@easyclaw/updater";
import type { UpdateCheckResult, UpdateDownloadState, DownloadProgress } from "@easyclaw/updater";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { createConnection } from "node:net";
import { createTrayIcon } from "./tray-icon.js";
import { buildTrayMenu } from "./tray-menu.js";
import { startPanelServer } from "./panel-server.js";
import { SttManager } from "./stt-manager.js";

const log = createLogger("desktop");

const PANEL_PORT = 3210;
const PANEL_URL = process.env.PANEL_DEV_URL || `http://127.0.0.1:${PANEL_PORT}`;
const PROXY_ROUTER_PORT = 9999;

// Resolve Volcengine STT CLI script path.
// In packaged app: bundled into Resources/.
// In dev: resolve relative to the bundled output (apps/desktop/dist/) → packages/gateway/dist/.
const sttCliPath = app.isPackaged
  ? join(process.resourcesPath, "volcengine-stt-cli.mjs")
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/gateway/dist/volcengine-stt-cli.mjs");

/**
 * Migrate old-style `{provider}-api-key` secrets to the new provider_keys table.
 * Only runs if the provider_keys table is empty (first upgrade).
 */
async function migrateOldProviderKeys(
  storage: import("@easyclaw/storage").Storage,
  secretStore: import("@easyclaw/secrets").SecretStore,
): Promise<void> {
  const existing = storage.providerKeys.getAll();
  if (existing.length > 0) return; // already migrated

  const activeProvider = storage.settings.get("llm-provider");

  for (const provider of ALL_PROVIDERS) {
    const secretKey = providerSecretKey(provider);
    const keyValue = await secretStore.get(secretKey);
    if (keyValue && keyValue !== "") {
      const id = crypto.randomUUID();
      const model = getDefaultModelForProvider(provider)?.modelId ?? "";
      storage.providerKeys.create({
        id,
        provider,
        label: "Default",
        model,
        isDefault: true,
        createdAt: "",
        updatedAt: "",
      });
      // Store under new key format for consistency
      await secretStore.set(`provider-key-${id}`, keyValue);
      log.info(`Migrated ${provider} key to provider_keys table (id: ${id})`);
    }
  }
}

/**
 * Resolve path to the proxy router configuration file.
 */
function resolveProxyRouterConfigPath(): string {
  const stateDir = resolveOpenClawStateDir();
  return join(stateDir, "proxy-router.json");
}

/**
 * Well-known domain to provider mapping for major LLM APIs.
 * Auto-generated from PROVIDERS baseUrl in packages/core/src/models.ts,
 * with manual overrides for domains not derivable from baseUrl.
 */
const DOMAIN_TO_PROVIDER: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const p of ALL_PROVIDERS) {
    const meta = getProviderMeta(p);
    if (!meta) continue;
    try {
      const domain = new URL(meta.baseUrl).hostname;
      if (!map[domain]) map[domain] = p; // first (root) provider wins for shared domains
    } catch { /* skip invalid URLs */ }
  }
  // Amazon Bedrock regional endpoints (only us-east-1 is derived from baseUrl)
  Object.assign(map, {
    "bedrock-runtime.us-west-2.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.eu-west-1.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.eu-central-1.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.ap-southeast-1.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.ap-northeast-1.amazonaws.com": "amazon-bedrock",
  });
  // Google Gemini CLI OAuth (Cloud Code API) — not in baseUrl
  map["cloudcode-pa.googleapis.com"] = "gemini";
  map["oauth2.googleapis.com"] = "gemini";
  return map;
})();

/**
 * Parse Electron's PAC-format proxy string into a URL.
 * Examples: "DIRECT" → null, "PROXY 127.0.0.1:1087" → "http://127.0.0.1:1087",
 * "SOCKS5 127.0.0.1:1080" → "socks5://127.0.0.1:1080"
 */
function parsePacProxy(pac: string): string | null {
  const trimmed = pac.trim();
  if (!trimmed || trimmed === "DIRECT") return null;

  // PAC can return multiple entries separated by ";", take the first non-DIRECT one
  for (const entry of trimmed.split(";")) {
    const part = entry.trim();
    if (!part || part === "DIRECT") continue;

    const match = part.match(/^(PROXY|SOCKS5?|SOCKS4|HTTPS)\s+(.+)$/i);
    if (!match) continue;

    const [, type, hostPort] = match;
    const upper = type.toUpperCase();
    if (upper === "PROXY" || upper === "HTTPS") {
      return `http://${hostPort}`;
    }
    if (upper === "SOCKS5" || upper === "SOCKS") {
      return `socks5://${hostPort}`;
    }
    if (upper === "SOCKS4") {
      return `socks5://${hostPort}`; // Treat SOCKS4 as SOCKS5 (compatible for CONNECT)
    }
  }
  return null;
}

/**
 * Detect system proxy using Electron's session.resolveProxy().
 * Works with PAC auto-config and global proxy modes on macOS and Windows.
 */
async function detectSystemProxy(): Promise<string | null> {
  try {
    const pac = await session.defaultSession.resolveProxy("https://www.google.com");
    log.debug(`resolveProxy returned: "${pac}"`);
    const parsed = parsePacProxy(pac);
    log.debug(`Parsed system proxy: ${parsed ?? "(none/DIRECT)"}`);
    return parsed;
  } catch (err) {
    log.warn("Failed to detect system proxy:", err);
    return null;
  }
}

/**
 * Write proxy router configuration file.
 * Called whenever provider keys or proxies change.
 */
async function writeProxyRouterConfig(
  storage: import("@easyclaw/storage").Storage,
  secretStore: import("@easyclaw/secrets").SecretStore,
  systemProxy?: string | null,
): Promise<void> {
  const configPath = resolveProxyRouterConfigPath();
  const config: ProxyRouterConfig = {
    ts: Date.now(),
    domainToProvider: DOMAIN_TO_PROVIDER,
    activeKeys: {},
    keyProxies: {},
    systemProxy: systemProxy ?? null,
  };

  // For each provider, find active key and its proxy
  for (const provider of ALL_PROVIDERS) {
    const defaultKey = storage.providerKeys.getDefault(provider);
    if (defaultKey) {
      config.activeKeys[provider] = defaultKey.id;

      // Reconstruct full proxy URL if configured
      if (defaultKey.proxyBaseUrl) {
        const credentials = await secretStore.get(`proxy-auth-${defaultKey.id}`);
        const proxyUrl = credentials
          ? reconstructProxyUrl(defaultKey.proxyBaseUrl, credentials)
          : defaultKey.proxyBaseUrl;
        config.keyProxies[defaultKey.id] = proxyUrl;
      } else {
        config.keyProxies[defaultKey.id] = null; // Direct connection
      }
    }
  }

  // Write config file
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  log.debug(`Proxy router config written: ${Object.keys(config.activeKeys).length} providers configured`);
}

/**
 * Build proxy environment variables pointing to local proxy router.
 * Returns fixed proxy URL (127.0.0.1:9999) regardless of configuration.
 * The router handles dynamic routing based on its config file.
 *
 * Chinese-domestic channel domains (Feishu, WeCom) are excluded via NO_PROXY
 * since they don't need GFW bypass. GFW-blocked channel domains (Telegram,
 * Discord, Slack, LINE) go through the proxy router so the system proxy can
 * route them out.
 */
function buildProxyEnv(): Record<string, string> {
  const localProxyUrl = `http://127.0.0.1:${PROXY_ROUTER_PORT}`;
  const noProxy = [
    "localhost",
    "127.0.0.1",
    // RFC 1918 private networks — LAN-deployed models (e.g. Ollama on another machine)
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    // Chinese-domestic channel APIs — no GFW bypass needed, connect directly
    "open.feishu.cn",
    "open.larksuite.com",
    "qyapi.weixin.qq.com",
  ].join(",");
  return {
    HTTP_PROXY: localProxyUrl,
    HTTPS_PROXY: localProxyUrl,
    http_proxy: localProxyUrl,
    https_proxy: localProxyUrl,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

/**
 * Write a CJS module that injects undici's EnvHttpProxyAgent as the global fetch dispatcher.
 * Node.js native fetch() does NOT respect HTTP_PROXY env vars by default, so this is needed
 * to make ALL fetch() calls (Telegram/Discord/Slack SDKs, etc.) go through the proxy router.
 *
 * The module is loaded via NODE_OPTIONS=--require before the gateway entry point.
 * It uses createRequire to resolve undici from the vendor's node_modules.
 */
function writeProxySetupModule(stateDir: string, vendorDir: string): string {
  const setupPath = join(stateDir, "proxy-setup.cjs");
  const code = `\
"use strict";
const { createRequire } = require("node:module");
const path = require("node:path");
try {
  const vendorDir = ${JSON.stringify(vendorDir)};
  const vendorRequire = createRequire(path.join(vendorDir, "package.json"));
  const { setGlobalDispatcher, EnvHttpProxyAgent } = vendorRequire("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
} catch (_) {}
`;
  writeFileSync(setupPath, code, "utf-8");
  return setupPath;
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let lastSystemProxy: string | null = null;

// Ensure only one instance of the desktop app runs at a time.
// If the lock is held by a stale process (unclean shutdown), kill it and relaunch.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  let killedStale = false;
  try {
    if (process.platform === "win32") {
      // On Windows, use WMIC to find EasyClaw.exe PIDs
      const out = execSync('wmic process where "name=\'EasyClaw.exe\'" get ProcessId 2>nul', {
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      const pids = out
        .split("\n")
        .slice(1) // skip header row
        .map((line) => parseInt(line.trim(), 10))
        .filter((pid) => pid !== process.pid && !isNaN(pid));
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
          killedStale = true;
        } catch {}
      }
    } else {
      // On macOS/Linux, use pgrep
      const out = execSync("pgrep -x EasyClaw 2>/dev/null || true", {
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      const pids = out
        .split("\n")
        .filter(Boolean)
        .map(Number)
        .filter((pid) => pid !== process.pid && !isNaN(pid));
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
          killedStale = true;
        } catch {}
      }
    }
  } catch {}

  if (killedStale) {
    // Stale process found and killed — relaunch so the new instance gets the lock
    app.relaunch();
  }
  app.exit(0);
}

app.on("second-instance", () => {
  log.warn("Attempted to start second instance - showing existing window");
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    app.dock?.show();
  }
});

// macOS: clicking the dock icon when the window is hidden should re-show it
app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  enableFileLogging();
  log.info(`EasyClaw desktop starting (build: ${__BUILD_TIMESTAMP__})`);

  // Show dock icon immediately. LSUIElement=true in Info.plist hides it by default
  // (which also prevents child processes like the gateway from showing dock icons).
  // We explicitly show it for the main process here.
  app.dock?.show();

  // --- Device ID ---
  let deviceId: string;
  try {
    deviceId = getDeviceId();
    log.info(`Device ID: ${deviceId.slice(0, 8)}...`);
  } catch (err) {
    log.error("Failed to get device ID:", err);
    deviceId = "unknown";
  }

  // Initialize storage and secrets
  const storage = createStorage();
  const secretStore = createSecretStore();

  // Initialize telemetry client (opt-out: enabled by default, user can disable via consent dialog or Settings)
  // In dev mode, telemetry is OFF unless DEV_TELEMETRY=1 is set (avoids polluting production data)
  const telemetryEnabled = !app.isPackaged
    ? process.env.DEV_TELEMETRY === "1"
    : storage.settings.get("telemetry_enabled") !== "false";
  const locale = app.getLocale().startsWith("zh") ? "zh" : "en";
  const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT
    || (locale === "zh" ? "https://t-cn.easy-claw.com/" : "https://t.easy-claw.com/");
  let telemetryClient: RemoteTelemetryClient | null = null;

  if (telemetryEnabled) {
    try {
      telemetryClient = new RemoteTelemetryClient({
        endpoint: telemetryEndpoint,
        enabled: true,
        version: app.getVersion(),
        platform: process.platform,
        locale,
        deviceId,
      });
      log.info("Telemetry client initialized (user opted in)");
    } catch (error) {
      // Fire-and-forget: don't crash if telemetry fails to initialize
      log.error("Failed to initialize telemetry client:", error);
    }
  } else {
    log.info("Telemetry disabled (user preference)");
  }

  // --- Update checker ---
  let currentState: GatewayState = "stopped";
  let latestUpdateResult: UpdateCheckResult | null = null;

  async function performUpdateCheck(): Promise<void> {
    const region = locale === "zh" ? "cn" : "us";
    const result = await checkForUpdate(app.getVersion(), { region });
    latestUpdateResult = result;
    if (result.updateAvailable) {
      log.info(`Update available: v${result.latestVersion}`);
      // Invalidate stale ready download if a newer version supersedes it
      const rv = readyCache.version;
      if (rv && rv !== result.latestVersion) {
        log.info(`Clearing stale ready download v${rv} (latest is v${result.latestVersion})`);
        readyCache.clear();
        updateDownloadState = { status: "idle" };
      }
      telemetryClient?.track("app.update_available", {
        currentVersion: app.getVersion(),
        latestVersion: result.latestVersion,
      });
      const isZh = systemLocale === "zh";
      const notification = new Notification({
        title: isZh ? "EasyClaw 有新版本" : "EasyClaw Update Available",
        body: isZh
          ? `新版本 v${result.latestVersion} 已发布，点击查看详情。`
          : `A new version v${result.latestVersion} is available. Click to download.`,
      });
      notification.on("click", () => {
        showMainWindow();
      });
      notification.show();
    }
    // Refresh tray to show/hide update item
    updateTray(currentState);
  }

  // NOTE: performUpdateCheck() calls updateTray() which requires `tray` to be
  // initialized. The fire-and-forget call is deferred to after tray creation
  // (search for "Deferred: startup update check" below).

  // --- In-app update download/install ---
  let updateDownloadState: UpdateDownloadState = { status: "idle" };
  let downloadAbortController: AbortController | null = null;

  /** Persists which version has been downloaded and is ready to install. */
  class ReadyUpdateCache {
    private readonly versionFile: string;
    readonly filePath: string;

    constructor(tempDir: string) {
      this.versionFile = join(tempDir, "easyclaw-ready-version");
      const ext = process.platform === "darwin" ? "zip" : "exe";
      this.filePath = join(tempDir, `easyclaw-update.${ext}`);
    }

    /** The version that is downloaded and ready, or null if nothing is ready. */
    get version(): string | null {
      try {
        const v = readFileSync(this.versionFile, "utf-8").trim();
        if (v && existsSync(this.filePath)) return v;
      } catch {}
      return null;
    }

    save(version: string): void {
      try { writeFileSync(this.versionFile, version, "utf-8"); } catch {}
    }

    clear(): void {
      try { unlinkSync(this.versionFile); } catch {}
      try { unlinkSync(this.filePath); } catch {}
    }
  }

  const readyCache = new ReadyUpdateCache(app.getPath("temp"));

  // Restore ready state from previous session
  const restoredVersion = readyCache.version;
  if (restoredVersion && isNewerVersion(app.getVersion(), restoredVersion)) {
    updateDownloadState = { status: "ready", filePath: readyCache.filePath };
    log.info(`Restored ready update: v${restoredVersion} at ${readyCache.filePath}`);
  } else if (restoredVersion) {
    // Same or older than current version — already installed, clean up
    log.info(`Clearing stale ready update v${restoredVersion} (current is v${app.getVersion()})`);
    readyCache.clear();
  }

  async function performUpdateDownload(): Promise<void> {
    if (!latestUpdateResult?.updateAvailable || !latestUpdateResult.download) {
      throw new Error("No update available");
    }
    if (updateDownloadState.status === "downloading" || updateDownloadState.status === "verifying") {
      log.info(`Update download already ${updateDownloadState.status}, ignoring duplicate request`);
      return;
    }
    // If already ready, check if it's for the same version being requested
    if (updateDownloadState.status === "ready") {
      const rv = readyCache.version;
      if (rv === latestUpdateResult.latestVersion) {
        log.info(`Update v${rv} already downloaded, ignoring duplicate request`);
        return;
      }
      // Ready version is stale (newer version available), clear and re-download
      log.info(`Clearing stale download v${rv} to download v${latestUpdateResult.latestVersion}`);
      readyCache.clear();
    }

    const platform = getPlatformKey();
    const download = latestUpdateResult.download;

    let downloadUrl: string;
    let expectedSha256: string;
    let expectedSize: number;

    if (platform === "mac") {
      // Use zip for in-app update on macOS
      if (!download.zipUrl || !download.zipSha256) {
        // Fallback: open browser for DMG
        shell.openExternal(download.url);
        return;
      }
      downloadUrl = download.zipUrl;
      expectedSha256 = download.zipSha256;
      expectedSize = download.zipSize ?? download.size;
    } else {
      downloadUrl = download.url;
      expectedSha256 = download.sha256;
      expectedSize = download.size;
    }

    downloadAbortController = new AbortController();
    updateDownloadState = { status: "downloading", percent: 0, downloadedBytes: 0, totalBytes: expectedSize };
    mainWindow?.setProgressBar(0);

    try {
      const result = await downloadAndVerify(
        downloadUrl,
        readyCache.filePath,
        expectedSha256,
        expectedSize,
        (progress: DownloadProgress) => {
          updateDownloadState = {
            status: "downloading",
            percent: progress.percent,
            downloadedBytes: progress.downloaded,
            totalBytes: progress.total,
          };
          mainWindow?.setProgressBar(progress.percent / 100);
        },
        downloadAbortController.signal,
      );

      readyCache.save(latestUpdateResult.latestVersion!);
      updateDownloadState = { status: "ready", filePath: result.filePath };
      mainWindow?.setProgressBar(-1);
      log.info(`Update v${latestUpdateResult.latestVersion} downloaded and verified: ${result.filePath}`);
      telemetryClient?.track("app.update_downloaded", {
        version: latestUpdateResult.latestVersion,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateDownloadState = { status: "error", message };
      mainWindow?.setProgressBar(-1);
      log.error(`Update download failed: ${message}`);
    } finally {
      downloadAbortController = null;
    }
  }

  async function performUpdateInstall(): Promise<void> {
    if (updateDownloadState.status !== "ready") {
      throw new Error("No downloaded update ready to install");
    }

    const filePath = updateDownloadState.filePath;
    const platform = getPlatformKey();
    updateDownloadState = { status: "installing" };
    // Don't call readyCache.clear() here — the installer needs the file.
    // Cleanup happens on next startup: new version sees readyVersion == currentVersion → clear.

    telemetryClient?.track("app.update_installing", {
      version: latestUpdateResult?.latestVersion,
    });

    isQuitting = true; // prevent close-to-tray
    if (platform === "win") {
      await installWindows(filePath, () => app.quit());
    } else {
      const appBundlePath = resolveAppBundlePath();
      await installMacOS(filePath, appBundlePath, () => app.quit());
    }
  }

  // Detect system proxy and write proxy router config BEFORE starting the router.
  // This ensures the router has a valid config (with systemProxy) from the very first request,
  // preventing "No config loaded, using direct connection" race during startup.
  lastSystemProxy = await detectSystemProxy();
  if (lastSystemProxy) {
    log.info(`System proxy detected: ${lastSystemProxy}`);
  } else {
    log.info("No system proxy detected (DIRECT)");
  }
  await writeProxyRouterConfig(storage, secretStore, lastSystemProxy);

  // Start proxy router (config is already on disk)
  const proxyRouter = new ProxyRouter({
    port: PROXY_ROUTER_PORT,
    configPath: resolveProxyRouterConfigPath(),
    onConfigReload: (config) => {
      log.debug(`Proxy router config reloaded: ${Object.keys(config.activeKeys).length} providers`);
    },
  });

  await proxyRouter.start().catch((err) => {
    log.error("Failed to start proxy router:", err);
  });

  // Track app.started event (version + platform are already top-level fields on every event)
  telemetryClient?.track("app.started");

  // Track heartbeat every 5 minutes
  const heartbeatTimer = telemetryClient
    ? setInterval(() => {
        telemetryClient?.track("app.heartbeat", {
          uptimeMs: telemetryClient.getUptime(),
        });
      }, 5 * 60 * 1000)
    : null;

  // Migrate old-style provider secrets to provider_keys table
  migrateOldProviderKeys(storage, secretStore).catch((err) => {
    log.error("Failed to migrate old provider keys:", err);
  });

  // Initialize gateway launcher
  const stateDir = resolveOpenClawStateDir();
  const configPath = ensureGatewayConfig();

  // Resolve current default model from DB and sync to gateway config on every startup.
  // This ensures config is always consistent with what the user selected in the panel.
  const startupProvider = storage.settings.get("llm-provider") as LLMProvider | undefined;
  const startupRegion = storage.settings.get("region") ?? "us";
  let startupModelId: string | undefined;
  if (startupProvider) {
    const activeKey = storage.providerKeys.getDefault(startupProvider);
    if (activeKey?.model) startupModelId = activeKey.model;
  }
  const startupModelConfig = resolveModelConfig({
    region: startupRegion,
    userProvider: startupProvider,
    userModelId: startupModelId,
  });

  // Read STT settings
  const sttEnabled = storage.settings.get("stt.enabled") === "true";
  const sttProvider = (storage.settings.get("stt.provider") || "groq") as "groq" | "volcengine";

  // In packaged app, plugins/extensions live in Resources/.
  // In dev, config-writer auto-resolves via monorepo root.
  const filePermissionsPluginPath = app.isPackaged
    ? join(process.resourcesPath, "extensions", "file-permissions", "dist", "easyclaw-file-permissions.mjs")
    : undefined;
  const extensionsDir = app.isPackaged
    ? join(process.resourcesPath, "extensions")
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../../extensions");

  // Temporary storage for pending OAuth credentials (between acquire and save steps)
  let pendingOAuthCreds: AcquiredOAuthCredentials | null = null;
  // PKCE verifier for pending manual OAuth flow (between start and manual-complete steps)
  let pendingManualOAuthVerifier: string | null = null;

  // Check if there's an active Gemini OAuth key — if so, enable the plugin
  // and route Google models through the "google-gemini-cli" provider (Bearer auth).
  function isGeminiOAuthActive(): boolean {
    return storage.providerKeys.getAll()
      .some((k) => k.provider === "gemini" && k.authType === "oauth" && k.isDefault);
  }
  // Resolve model for OAuth: when Gemini OAuth is active, route to "google-gemini-cli"
  // (Cloud Code Assist API with Bearer auth) instead of "google" (Generative AI API
  // with x-goog-api-key header which rejects OAuth tokens).
  function resolveGeminiOAuthModel(provider: string, modelId: string): { provider: string; modelId: string } {
    if (!isGeminiOAuthActive() || provider !== "gemini") {
      return { provider, modelId };
    }
    return { provider: "google-gemini-cli", modelId };
  }
  const hasGeminiOAuth = isGeminiOAuthActive();

  writeGatewayConfig({
    configPath,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    enableChatCompletions: true,
    commandsRestart: true,
    enableFilePermissions: true,
    extensionsDir,
    enableGeminiCliAuth: hasGeminiOAuth,
    skipBootstrap: false,
    filePermissionsPluginPath,
    defaultModel: resolveGeminiOAuthModel(startupModelConfig.provider, startupModelConfig.modelId),
    stt: {
      enabled: sttEnabled,
      provider: sttProvider,
      nodeBin: process.execPath,
      sttCliPath,
    },
    extraProviders: buildExtraProviderConfigs(),
    localProviderOverrides: buildLocalProviderOverrides(),
    forceStandaloneBrowser: true,
    agentWorkspace: join(stateDir, "workspace"),
    extraSkillDirs: [join(stateDir, "skills")],
  });

  // Clean up any existing openclaw processes before starting.
  // First do a fast TCP probe (~1ms) to check if the port is in use.
  // Only run the expensive lsof/netstat cleanup when something is actually listening.
  const portInUse = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ port: DEFAULT_GATEWAY_PORT, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => { resolve(false); });
  });

  if (portInUse) {
    log.info(`Port ${DEFAULT_GATEWAY_PORT} is in use, killing existing openclaw processes`);
    try {
      if (process.platform === "win32") {
        // Find PIDs listening on the gateway port and kill their process trees
        const netstatOut = execSync("netstat -ano", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], shell: "cmd.exe" });
        const pids = new Set<string>();
        for (const line of netstatOut.split("\n")) {
          if (line.includes(`:${DEFAULT_GATEWAY_PORT}`) && line.includes("LISTENING")) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid)) pids.add(pid);
          }
        }
        for (const pid of pids) {
          try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore", shell: "cmd.exe" }); } catch {}
        }
        // Also try by name as fallback for packaged openclaw binaries
        try { execSync("taskkill /f /im openclaw-gateway.exe 2>nul & taskkill /f /im openclaw.exe 2>nul & exit /b 0", { stdio: "ignore", shell: "cmd.exe" }); } catch {}
      } else {
        execSync(`lsof -ti :${DEFAULT_GATEWAY_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" });
        execSync("pkill -x 'openclaw-gateway' || true; pkill -x 'openclaw' || true", { stdio: "ignore" });
      }
      log.info("Cleaned up existing openclaw processes");
    } catch (err) {
      log.warn("Failed to cleanup openclaw processes:", err);
    }
  } else {
    log.info("No existing openclaw process on port, skipping cleanup");
  }

  // In packaged app, vendor lives in Resources/vendor/openclaw (extraResources).
  // In dev, resolveVendorEntryPath() resolves relative to source via import.meta.url.
  const vendorDir = app.isPackaged
    ? join(process.resourcesPath, "vendor", "openclaw")
    : undefined;

  const launcher = new GatewayLauncher({
    entryPath: resolveVendorEntryPath(vendorDir),
    nodeBin: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    configPath,
    stateDir,
  });

  // Initialize gateway RPC client for channels.status and other RPC calls
  let rpcClient: GatewayRpcClient | null = null;
  async function connectRpcClient(): Promise<void> {
    if (rpcClient) {
      rpcClient.stop();
    }

    const config = readExistingConfig(configPath);
    const gw = config.gateway as Record<string, unknown> | undefined;
    const port = (gw?.port as number) ?? DEFAULT_GATEWAY_PORT;
    const auth = gw?.auth as Record<string, unknown> | undefined;
    const token = auth?.token as string | undefined;

    rpcClient = new GatewayRpcClient({
      url: `ws://127.0.0.1:${port}`,
      token,
      deviceIdentityPath: join(stateDir, "identity", "device.json"),
      onConnect: () => {
        log.info("Gateway RPC client connected");
      },
      onClose: () => {
        log.info("Gateway RPC client disconnected");
      },
    });

    await rpcClient.start();
  }

  function disconnectRpcClient(): void {
    if (rpcClient) {
      rpcClient.stop();
      rpcClient = null;
    }
  }

  // Initialize artifact pipeline with LLM config resolver
  const pipeline = new ArtifactPipeline({
    storage,
    resolveLLMConfig: async (): Promise<LLMConfig | null> => {
      const config = readExistingConfig(configPath);
      const gw = config.gateway as Record<string, unknown> | undefined;
      const auth = gw?.auth as Record<string, unknown> | undefined;
      const token = auth?.token as string | undefined;
      if (!token) return null;

      const port = (gw?.port as number) ?? DEFAULT_GATEWAY_PORT;
      return {
        gatewayUrl: `http://127.0.0.1:${port}`,
        authToken: token,
      };
    },
  });

  // Log pipeline events
  pipeline.on("compiled", (ruleId, artifact) => {
    log.info(`Rule ${ruleId} compiled → ${artifact.type} (${artifact.status})`);
  });
  pipeline.on("failed", (ruleId, error) => {
    log.error(`Rule ${ruleId} compilation failed: ${error.message}`);
  });

  /**
   * Handle rule create/update: trigger async LLM compilation in the background.
   * The compilation runs asynchronously — errors are logged, not thrown.
   */
  function handleRuleCompile(ruleId: string): void {
    const rule = storage.rules.getById(ruleId);
    if (!rule) {
      log.warn(`Rule ${ruleId} not found for compilation`);
      return;
    }

    // Fire and forget — compilation happens in the background
    syncSkillsForRule(pipeline, rule).catch((err) => {
      log.error(`Background compilation failed for rule ${ruleId}:`, err);
    });
  }

  /**
   * Called when STT settings or credentials change.
   * Regenerates gateway config and restarts gateway to apply new env vars.
   */
  async function handleSttChange(): Promise<void> {
    log.info("STT settings changed, regenerating config and restarting gateway");

    // Read updated STT settings
    const sttEnabled = storage.settings.get("stt.enabled") === "true";
    const sttProvider = (storage.settings.get("stt.provider") || "groq") as "groq" | "volcengine";

    // Regenerate OpenClaw config with updated STT/audio settings
    writeGatewayConfig({
      configPath,
      stt: {
        enabled: sttEnabled,
        provider: sttProvider,
        nodeBin: process.execPath,
        sttCliPath,
      },
    });

    // Rebuild environment with updated STT credentials (GROQ_API_KEY, etc.)
    const secretEnv = await buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath);
    launcher.setEnv({ ...secretEnv, ...buildFullProxyEnv() });

    // Reinitialize STT manager
    await sttManager.initialize().catch((err) => {
      log.error("Failed to reinitialize STT manager:", err);
    });

    // Full restart to apply new environment variables and config
    await launcher.stop();
    await launcher.start();
  }

  /**
   * Called when file permissions change.
   * Rebuilds environment variables and restarts the gateway to apply the new permissions.
   */
  async function handlePermissionsChange(): Promise<void> {
    log.info("File permissions changed, rebuilding environment and restarting gateway");

    // Rebuild environment with updated file permissions
    const secretEnv = await buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath);
    launcher.setEnv({ ...secretEnv, ...buildFullProxyEnv() });

    // Full restart to apply new environment variables
    await launcher.stop();
    await launcher.start();
  }

  function buildLocalProviderOverrides(): Record<string, { baseUrl: string; models: Array<{ id: string; name: string }> }> {
    const overrides: Record<string, { baseUrl: string; models: Array<{ id: string; name: string }> }> = {};
    for (const localProvider of LOCAL_PROVIDER_IDS) {
      const activeKey = storage.providerKeys.getDefault(localProvider);
      if (!activeKey) continue;
      const meta = getProviderMeta(localProvider);
      let baseUrl = activeKey.baseUrl || meta?.baseUrl || "http://localhost:11434/v1";
      // Ollama's OpenAI-compatible endpoint lives under /v1; users typically
      // enter just the server URL (e.g. http://localhost:11434), so normalise.
      if (!baseUrl.match(/\/v\d\/?$/)) {
        baseUrl = baseUrl.replace(/\/+$/, "") + "/v1";
      }
      const modelId = activeKey.model;
      if (modelId) {
        overrides[localProvider] = {
          baseUrl,
          models: [{ id: modelId, name: modelId }],
        };
      }
    }
    return overrides;
  }

  /**
   * Called when provider settings change (API key added/removed, default changed, proxy changed).
   *
   * Hint modes:
   * - `keyOnly: true` — Only an API key changed (add/activate/delete).
   *   Syncs auth-profiles.json and proxy router config. No restart needed.
   * - `configOnly: true` — Only the config file changed (e.g. model switch).
   *   Updates gateway config and performs a full gateway restart.
   *   Full restart is required because SIGUSR1 reload re-reads config but
   *   agent sessions keep their existing model (only new sessions get the new default).
   * - Neither — Updates all configs and restarts gateway.
   *   Full restart ensures model changes take effect immediately.
   */
  async function handleProviderChange(hint?: { configOnly?: boolean; keyOnly?: boolean }): Promise<void> {
    const keyOnly = hint?.keyOnly === true;
    const configOnly = hint?.configOnly === true;
    log.info(`Provider settings changed (keyOnly=${keyOnly}, configOnly=${configOnly})`);

    // Always sync auth profiles and proxy router config so OpenClaw has current state on disk
    await Promise.all([
      syncAllAuthProfiles(stateDir, storage, secretStore),
      writeProxyRouterConfig(storage, secretStore, lastSystemProxy),
    ]);

    if (keyOnly) {
      // Key-only change: auth profiles + proxy config synced, done.
      // OpenClaw re-reads auth-profiles.json on every LLM turn,
      // proxy router re-reads its config file on change (fs.watch).
      // No restart needed — zero disruption.
      log.info("Key-only change, configs synced (no restart needed)");
      return;
    }

    if (configOnly) {
      // Config-only change (e.g. channel add/delete): the config file was
      // already modified by the caller. Just tell the running gateway to
      // re-read it via SIGUSR1 — no process restart needed.
      log.info("Config-only change, sending graceful reload to gateway");
      await launcher.reload();
      return;
    }

    // Read current provider/region settings
    const provider = storage.settings.get("llm-provider") as LLMProvider | undefined;
    const region = locale === "zh" ? "cn" : "us";

    // Get the active key's model for the active provider
    let userModelId: string | undefined;
    if (provider) {
      const activeKey = storage.providerKeys.getDefault(provider);
      if (activeKey?.model) {
        userModelId = activeKey.model;
      }
    }

    // Resolve the effective model config
    const modelConfig = resolveModelConfig({
      region,
      userProvider: provider,
      userModelId,
    });

    // Rewrite the OpenClaw config with the new default model
    writeGatewayConfig({
      configPath,
      defaultModel: resolveGeminiOAuthModel(modelConfig.provider, modelConfig.modelId),
      extraProviders: buildExtraProviderConfigs(),
      localProviderOverrides: buildLocalProviderOverrides(),
    });

    // Full gateway restart to ensure model change takes effect.
    // SIGUSR1 graceful reload re-reads config but agent sessions keep their
    // existing model assignment. A stop+start creates fresh sessions with
    // the new default model from config.
    log.info("Config updated, performing full gateway restart for model change");
    await launcher.stop();
    await launcher.start();
    // RPC client reconnects automatically via the "ready" event handler.
  }

  // Determine system locale for tray menu i18n
  const systemLocale = app.getLocale().startsWith("zh") ? "zh" : "en";

  // Create tray
  const tray = new Tray(createTrayIcon("stopped"));

  function updateTray(state: GatewayState) {
    currentState = state;
    tray.setImage(createTrayIcon(state));
    tray.setContextMenu(
      buildTrayMenu(state, {
        onOpenPanel: () => {
          if (mainWindow && !mainWindow.webContents.getURL()) {
            mainWindow.loadURL(PANEL_URL);
          }
          showMainWindow();
        },
        onRestartGateway: async () => {
          await launcher.stop();
          await launcher.start();
        },
        onCheckForUpdates: async () => {
          try {
            await performUpdateCheck();
            const isZh = systemLocale === "zh";
            if (latestUpdateResult?.updateAvailable && latestUpdateResult.download) {
              const { response } = await dialog.showMessageBox({
                type: "info",
                title: isZh ? "发现新版本" : "Update Available",
                message: isZh
                  ? `新版本 v${latestUpdateResult.latestVersion} 已发布，当前版本为 v${app.getVersion()}。`
                  : `A new version v${latestUpdateResult.latestVersion} is available. You are currently on v${app.getVersion()}.`,
                buttons: isZh ? ["下载", "稍后"] : ["Download", "Later"],
              });
              if (response === 0) {
                showMainWindow();
                performUpdateDownload().catch((e) => log.error("Update download failed:", e));
              }
            } else {
              dialog.showMessageBox({
                type: "info",
                title: isZh ? "检查更新" : "Check for Updates",
                message: isZh
                  ? `当前版本 v${app.getVersion()} 已是最新。`
                  : `v${app.getVersion()} is already the latest version.`,
                buttons: isZh ? ["好"] : ["OK"],
              });
            }
          } catch (err) {
            log.warn("Manual update check failed:", err);
            const isZh = systemLocale === "zh";
            dialog.showMessageBox({
              type: "error",
              title: isZh ? "检查更新" : "Check for Updates",
              message: isZh ? "检查更新失败，请稍后重试。" : "Failed to check for updates. Please try again later.",
              buttons: isZh ? ["好"] : ["OK"],
            });
          }
        },
        onQuit: () => {
          app.quit();
        },
        updateInfo: latestUpdateResult?.updateAvailable && latestUpdateResult.download
          ? {
              latestVersion: latestUpdateResult.latestVersion!,
              onDownload: () => {
                showMainWindow();
                performUpdateDownload().catch((e) => log.error("Update download failed:", e));
              },
            }
          : undefined,
      }, systemLocale),
    );
  }

  tray.setToolTip("EasyClaw");

  // Windows/Linux: clicking the tray icon should show/hide the window.
  // macOS uses the context menu on click, so skip this handler there.
  if (process.platform !== "darwin") {
    tray.on("click", () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }

  updateTray("stopped");

  // Deferred: startup update check (must run after tray creation)
  performUpdateCheck().catch((err) => {
    log.warn("Startup update check failed:", err);
  });

  // Re-check every 4 hours
  const updateCheckTimer = setInterval(() => {
    performUpdateCheck().catch((err) => {
      log.warn("Periodic update check failed:", err);
    });
  }, 4 * 60 * 60 * 1000);

  // Create main panel window (hidden initially, loaded when gateway starts)
  const isDev = !!process.env.PANEL_DEV_URL;
  mainWindow = new BrowserWindow({
    width: isDev ? 1800 : 1200,
    height: 800,
    show: false,
    title: "EasyClaw",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Open external links in system browser instead of new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Open DevTools in dev mode
  if (process.env.PANEL_DEV_URL) {
    mainWindow.webContents.openDevTools();
  }

  // Allow opening DevTools in prod via Ctrl+Shift+I / Cmd+Option+I
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    const isMac = process.platform === "darwin";
    const devToolsShortcut = isMac
      ? input.meta && input.alt && input.key === "i"
      : input.control && input.shift && input.key === "I";
    if (devToolsShortcut) {
      mainWindow!.webContents.toggleDevTools();
    }
  });

  // Hide to tray instead of quitting when window is closed
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow!.hide();
    }
  });

  function showMainWindow() {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    app.dock?.show();
  }

  // Listen to gateway events
  let firstStart = true;
  launcher.on("started", () => {
    log.info("Gateway started");
    updateTray("running");

    if (firstStart) {
      firstStart = false;
      mainWindow?.loadURL(PANEL_URL);
      showMainWindow();
    }
  });

  launcher.on("ready", () => {
    log.info("Gateway ready (listening)");
    connectRpcClient().catch((err) => {
      log.error("Failed to initiate RPC client after gateway ready:", err);
    });
  });

  launcher.on("stopped", () => {
    log.info("Gateway stopped");
    disconnectRpcClient();
    updateTray("stopped");
  });

  launcher.on("restarting", (attempt, delayMs) => {
    log.info(`Gateway restarting (attempt ${attempt}, delay ${delayMs}ms)`);
    updateTray("starting");

    // Track gateway restart
    telemetryClient?.track("gateway.restarted", {
      attempt,
      delayMs,
    });
  });

  launcher.on("error", (error) => {
    log.error("Gateway error:", error);
  });

  // Track uncaught exceptions
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception:", error);

    // Sanitize paths to remove usernames (e.g., /Users/john/... → ~/...)
    const sanitizePath = (s: string) =>
      s.replace(/(?:\/Users\/|\/home\/|C:\\Users\\)[^\s/\\]+/gi, "~");

    // Track error event with truncated + sanitized stack trace (first 5 lines)
    const stackLines = error.stack?.split("\n") ?? [];
    const truncatedStack = sanitizePath(stackLines.slice(0, 5).join("\n"));

    telemetryClient?.track("app.error", {
      errorMessage: sanitizePath(error.message),
      errorStack: truncatedStack,
    });
  });

  // Initialize STT manager
  const sttManager = new SttManager(storage, secretStore);
  await sttManager.initialize();

  // Start the panel server
  const panelDistDir = app.isPackaged
    ? join(process.resourcesPath, "panel-dist")
    : resolve(__dirname, "../../panel/dist");
  const changelogPath = resolve(__dirname, "../changelog.json");
  startPanelServer({
    port: PANEL_PORT,
    panelDistDir,
    changelogPath,
    vendorDir,
    storage,
    secretStore,
    deviceId,
    getRpcClient: () => rpcClient,
    getUpdateResult: () => latestUpdateResult,
    onUpdateDownload: () => performUpdateDownload(),
    onUpdateCancel: () => {
      downloadAbortController?.abort();
      updateDownloadState = { status: "idle" };
      mainWindow?.setProgressBar(-1);
    },
    onUpdateInstall: () => performUpdateInstall(),
    getUpdateDownloadState: () => updateDownloadState,
    getGatewayInfo: () => {
      const config = readExistingConfig(configPath);
      const gw = config.gateway as Record<string, unknown> | undefined;
      const port = (gw?.port as number) ?? DEFAULT_GATEWAY_PORT;
      const auth = gw?.auth as Record<string, unknown> | undefined;
      const token = auth?.token as string | undefined;
      return { wsUrl: `ws://127.0.0.1:${port}`, token };
    },
    onRuleChange: (action, ruleId) => {
      log.info(`Rule ${action}: ${ruleId}`);
      if (action === "created" || action === "updated") {
        handleRuleCompile(ruleId);

        // Track rule creation
        if (action === "created") {
          // Get the artifact to determine type (policy/guard/action-bundle)
          const artifacts = storage.artifacts.getByRuleId(ruleId);
          const artifactType = artifacts[0]?.type;
          telemetryClient?.track("rule.created", {
            artifactType,
          });
        }
      } else if (action === "deleted") {
        cleanupSkillsForDeletedRule(pipeline, ruleId);
      }
    },
    onProviderChange: (hint) => {
      handleProviderChange(hint).catch((err) => {
        log.error("Failed to handle provider change:", err);
      });
    },
    onOpenFileDialog: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "openFile", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    },
    sttManager,
    onSttChange: () => {
      handleSttChange().catch((err) => {
        log.error("Failed to handle STT change:", err);
      });
    },
    onPermissionsChange: () => {
      handlePermissionsChange().catch((err) => {
        log.error("Failed to handle permissions change:", err);
      });
    },
    onOAuthAcquire: async (provider: string): Promise<{ email?: string; tokenPreview: string; manualMode?: boolean; authUrl?: string }> => {
      const proxyRouterUrl = `http://127.0.0.1:${PROXY_ROUTER_PORT}`;
      try {
        const acquired = await acquireGeminiOAuthToken({
          openUrl: (url) => shell.openExternal(url),
          onStatusUpdate: (msg) => log.info(`OAuth: ${msg}`),
          proxyUrl: proxyRouterUrl,
        });
        // Store credentials temporarily until onOAuthSave is called
        pendingOAuthCreds = acquired;
        log.info(`OAuth acquired for ${provider}, email=${acquired.email ?? "(none)"}`);
        return { email: acquired.email, tokenPreview: acquired.tokenPreview };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Port 8085") || msg.includes("EADDRINUSE")) {
          log.warn("OAuth callback server failed, falling back to manual mode");
          const manual = await startManualOAuthFlow({
            onStatusUpdate: (m: string) => log.info(`OAuth manual: ${m}`),
            proxyUrl: proxyRouterUrl,
          });
          pendingManualOAuthVerifier = manual.verifier;
          await shell.openExternal(manual.authUrl);
          return { email: undefined, tokenPreview: "", manualMode: true, authUrl: manual.authUrl };
        }
        throw err;
      }
    },
    onOAuthManualComplete: async (provider: string, callbackUrl: string): Promise<{ email?: string; tokenPreview: string }> => {
      const verifier = pendingManualOAuthVerifier;
      if (!verifier) {
        throw new Error("No pending manual OAuth flow. Please start the sign-in process first.");
      }
      const proxyRouterUrl = `http://127.0.0.1:${PROXY_ROUTER_PORT}`;
      const acquired = await completeManualOAuthFlow(callbackUrl, verifier, proxyRouterUrl);
      pendingOAuthCreds = acquired;
      pendingManualOAuthVerifier = null;
      log.info(`OAuth manual complete for ${provider}, email=${acquired.email ?? "(none)"}`);
      return { email: acquired.email, tokenPreview: acquired.tokenPreview };
    },
    onOAuthSave: async (provider: string, options: { proxyUrl?: string; label?: string; model?: string }): Promise<OAuthFlowResult> => {
      if (!pendingOAuthCreds) {
        throw new Error("No pending OAuth credentials. Please sign in first.");
      }
      const creds = pendingOAuthCreds;

      // Priority: per-key proxy > proxy router (system proxy) > direct
      const validationProxy = options.proxyUrl?.trim() || `http://127.0.0.1:${PROXY_ROUTER_PORT}`;
      const validation = await validateGeminiAccessToken(creds.credentials.access, validationProxy, creds.credentials.projectId);
      if (!validation.valid) {
        throw new Error(validation.error || "Token validation failed");
      }

      // Parse proxy URL if provided
      let proxyBaseUrl: string | null = null;
      let proxyCredentials: string | null = null;
      if (options.proxyUrl?.trim()) {
        const proxyConfig = parseProxyUrl(options.proxyUrl.trim());
        proxyBaseUrl = proxyConfig.baseUrl;
        if (proxyConfig.hasAuth && proxyConfig.credentials) {
          proxyCredentials = proxyConfig.credentials;
        }
      }

      // Save credentials + create provider key
      const result = await saveGeminiOAuthCredentials(creds.credentials, storage, secretStore, {
        proxyBaseUrl,
        proxyCredentials,
        label: options.label,
        model: options.model,
      });
      pendingOAuthCreds = null;

      // Enable plugin + sync auth profiles + rewrite config with google-gemini-cli model
      await syncAllAuthProfiles(stateDir, storage, secretStore);
      await writeProxyRouterConfig(storage, secretStore, lastSystemProxy);
      // Resolve the model to write: prefer user-selected model from the form,
      // fall back to current settings, then to the default CLI model.
      const oauthModelId = options.model
        ?? storage.providerKeys.getDefault("gemini")?.model
        ?? "gemini-2.5-pro";
      writeGatewayConfig({
        configPath,
        enableGeminiCliAuth: true,
        defaultModel: resolveGeminiOAuthModel("gemini", oauthModelId),
        extraProviders: buildExtraProviderConfigs(),
      });
      // Restart gateway to pick up new plugin + auth profile
      await launcher.stop();
      await launcher.start();
      // RPC client reconnects automatically via the "ready" event handler.
      return result;
    },
    onChannelConfigured: (channelId) => {
      log.info(`Channel configured: ${channelId}`);
      telemetryClient?.track("channel.configured", {
        channelType: channelId,
      });
    },
    onTelemetryTrack: (eventType, metadata) => {
      telemetryClient?.track(eventType, metadata);
    },
  });

  // Sync auth profiles + build env, then start gateway.
  // System proxy and proxy router config were already written before proxyRouter.start().
  const workspacePath = stateDir;

  // Write the proxy setup CJS module once and build the NODE_OPTIONS string.
  // This is reused by all restart paths (handleSttChange, handlePermissionsChange)
  // so the --require is never accidentally dropped.
  const resolvedVendorDir = vendorDir ?? join(import.meta.dirname, "..", "..", "..", "vendor", "openclaw");
  const proxySetupPath = writeProxySetupModule(stateDir, resolvedVendorDir);
  // Quote the path — Windows usernames with spaces break unquoted --require.
  // Use forward slashes: NODE_OPTIONS parser treats backslashes as escape chars,
  // stripping them from Windows paths (C:\Users → CUsers). Node.js require()
  // accepts forward slashes on Windows.
  const gatewayNodeOptions = `--require "${proxySetupPath.replaceAll("\\", "/")}"`;

  /**
   * Build the complete proxy env including NODE_OPTIONS.
   * Centralised so every restart path gets --require proxy-setup.cjs.
   */
  function buildFullProxyEnv(): Record<string, string> {
    const env = buildProxyEnv();
    env.NODE_OPTIONS = gatewayNodeOptions;
    return env;
  }

  Promise.all([
    syncAllAuthProfiles(stateDir, storage, secretStore),
    buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath),
  ])
    .then(([, secretEnv]) => {
      // Debug: Log which API keys are configured (without showing values)
      const configuredKeys = Object.keys(secretEnv).filter(k => k.endsWith('_API_KEY') || k.endsWith('_OAUTH_TOKEN'));
      log.info(`Initial API keys: ${configuredKeys.join(', ') || '(none)'}`);
      log.info(`Proxy router: http://127.0.0.1:${PROXY_ROUTER_PORT} (dynamic routing enabled)`);

      // Log file permissions status (without showing paths)
      if (secretEnv.EASYCLAW_FILE_PERMISSIONS) {
        const perms = JSON.parse(secretEnv.EASYCLAW_FILE_PERMISSIONS);
        log.info(`File permissions: workspace=${perms.workspacePath}, read=${perms.readPaths.length}, write=${perms.writePaths.length}`);
      }

      // Set env vars: API keys + proxy (incl. NODE_OPTIONS) + file permissions
      launcher.setEnv({ ...secretEnv, ...buildFullProxyEnv() });
      return launcher.start();
    })
    .catch((err) => {
      log.error("Failed to start gateway:", err);
    });

  // Re-detect system proxy every 30 seconds and update config if changed
  const proxyPollTimer = setInterval(async () => {
    try {
      const proxy = await detectSystemProxy();
      if (proxy !== lastSystemProxy) {
        log.info(`System proxy changed: ${lastSystemProxy ?? "(none)"} → ${proxy ?? "(none)"}`);
        lastSystemProxy = proxy;
        await writeProxyRouterConfig(storage, secretStore, lastSystemProxy);
      }
    } catch (err) {
      log.warn("System proxy re-detection failed:", err);
    }
  }, 30_000);

  log.info("EasyClaw desktop ready");

  // Cleanup on quit — Electron does NOT await async before-quit callbacks,
  // so we must preventDefault() to pause the quit, run async cleanup, then app.exit().
  let cleanupDone = false;
  app.on("before-quit", (event) => {
    isQuitting = true;

    if (cleanupDone) return; // Already cleaned up, let the quit proceed
    event.preventDefault();  // Pause quit until async cleanup finishes

    // Stop all periodic timers so they don't keep the event loop alive
    clearInterval(proxyPollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    clearInterval(updateCheckTimer);

    const cleanup = async () => {
      // Kill gateway and proxy router FIRST — these are critical.
      // If later steps (telemetry, oauth sync) hang, at least the gateway is dead.
      await Promise.all([
        launcher.stop(),
        proxyRouter.stop(),
      ]);

      // Clear sensitive API keys from disk before quitting
      clearAllAuthProfiles(stateDir);

      // Sync back any refreshed OAuth tokens to Keychain before clearing
      try {
        await syncBackOAuthCredentials(stateDir, storage, secretStore);
      } catch (err) {
        log.error("Failed to sync back OAuth credentials:", err);
      }

      // Track app.stopped with runtime
      if (telemetryClient) {
        const runtimeMs = telemetryClient.getUptime();
        telemetryClient.track("app.stopped", { runtimeMs });

        // Graceful shutdown: flush pending telemetry events
        await telemetryClient.shutdown();
        log.info("Telemetry client shut down gracefully");
      }

      storage.close();
    };

    // Global shutdown timeout — force exit if cleanup takes too long
    const SHUTDOWN_TIMEOUT_MS = 10_000;
    Promise.race([
      cleanup(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Shutdown timed out")), SHUTDOWN_TIMEOUT_MS),
      ),
    ])
      .catch((err) => {
        log.error("Cleanup error during quit:", err);
      })
      .finally(() => {
        cleanupDone = true;
        app.exit(0); // Now actually exit — releases single-instance lock
      });
  });
});
