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
} from "@easyclaw/gateway";
import type { OAuthFlowResult, AcquiredOAuthCredentials } from "@easyclaw/gateway";
import type { GatewayState } from "@easyclaw/gateway";
import { resolveModelConfig, ALL_PROVIDERS, getDefaultModelForProvider, providerSecretKey, reconstructProxyUrl, parseProxyUrl } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { createStorage } from "@easyclaw/storage";
import { createSecretStore } from "@easyclaw/secrets";
import { ArtifactPipeline, syncSkillsForRule, cleanupSkillsForDeletedRule } from "@easyclaw/rules";
import type { LLMConfig } from "@easyclaw/rules";
import { ProxyRouter } from "@easyclaw/proxy-router";
import type { ProxyRouterConfig } from "@easyclaw/proxy-router";
import { RemoteTelemetryClient } from "@easyclaw/telemetry";
import { getDeviceId } from "@easyclaw/device-id";
import { checkForUpdate, downloadAndVerify, getPlatformKey, installWindows, installMacOS, resolveAppBundlePath } from "@easyclaw/updater";
import type { UpdateCheckResult, UpdateDownloadState, DownloadProgress } from "@easyclaw/updater";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
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
 * Domains extracted from PROVIDER_BASE_URLS in packages/core/src/models.ts
 */
const DOMAIN_TO_PROVIDER: Record<string, string> = {
  "api.openai.com": "openai",
  "api.anthropic.com": "anthropic",
  "generativelanguage.googleapis.com": "google",
  "api.deepseek.com": "deepseek",
  "open.bigmodel.cn": "zhipu",
  "api.z.ai": "zai",
  "api.moonshot.cn": "moonshot",
  "dashscope.aliyuncs.com": "qwen",
  "api.groq.com": "groq",
  "api.mistral.ai": "mistral",
  "api.x.ai": "xai",
  "openrouter.ai": "openrouter",
  "api.minimax.chat": "minimax",
  "api.venice.ai": "venice",
  "api.xiaomi.com": "xiaomi",
  "ark.cn-beijing.volces.com": "volcengine",
  // Amazon Bedrock regional endpoints
  "bedrock-runtime.us-east-1.amazonaws.com": "amazon-bedrock",
  "bedrock-runtime.us-west-2.amazonaws.com": "amazon-bedrock",
  "bedrock-runtime.eu-west-1.amazonaws.com": "amazon-bedrock",
  "bedrock-runtime.eu-central-1.amazonaws.com": "amazon-bedrock",
  "bedrock-runtime.ap-southeast-1.amazonaws.com": "amazon-bedrock",
  "bedrock-runtime.ap-northeast-1.amazonaws.com": "amazon-bedrock",
  // Google Gemini CLI OAuth (Cloud Code API)
  "cloudcode-pa.googleapis.com": "google-gemini-cli",
  "oauth2.googleapis.com": "google-gemini-cli",
};

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
    // Find all EasyClaw processes except ourselves and kill them
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
  let latestUpdateResult: UpdateCheckResult | null = null;

  async function performUpdateCheck(): Promise<void> {
    const region = locale === "zh" ? "cn" : "us";
    const result = await checkForUpdate(app.getVersion(), { region });
    latestUpdateResult = result;
    if (result.updateAvailable) {
      log.info(`Update available: v${result.latestVersion}`);
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

  // Check on startup (fire-and-forget, non-blocking)
  performUpdateCheck().catch((err) => {
    log.warn("Startup update check failed:", err);
  });

  // Re-check every 4 hours
  setInterval(() => {
    performUpdateCheck().catch((err) => {
      log.warn("Periodic update check failed:", err);
    });
  }, 4 * 60 * 60 * 1000);

  // --- In-app update download/install ---
  let updateDownloadState: UpdateDownloadState = { status: "idle" };
  let downloadAbortController: AbortController | null = null;

  async function performUpdateDownload(): Promise<void> {
    if (!latestUpdateResult?.updateAvailable || !latestUpdateResult.download) {
      throw new Error("No update available");
    }
    if (updateDownloadState.status === "downloading" || updateDownloadState.status === "verifying") {
      log.info("Update download already in progress, ignoring duplicate request");
      return;
    }

    const platform = getPlatformKey();
    const download = latestUpdateResult.download;

    let downloadUrl: string;
    let expectedSha256: string;
    let expectedSize: number;
    let fileName: string;

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
      fileName = "easyclaw-update.zip";
    } else {
      downloadUrl = download.url;
      expectedSha256 = download.sha256;
      expectedSize = download.size;
      fileName = "easyclaw-update.exe";
    }

    const destPath = join(app.getPath("temp"), fileName);
    downloadAbortController = new AbortController();
    updateDownloadState = { status: "downloading", percent: 0, downloadedBytes: 0, totalBytes: expectedSize };
    mainWindow?.setProgressBar(0);

    try {
      const result = await downloadAndVerify(
        downloadUrl,
        destPath,
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

      updateDownloadState = { status: "ready", filePath: result.filePath };
      mainWindow?.setProgressBar(-1);
      log.info(`Update downloaded and verified: ${result.filePath}`);
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
  if (telemetryClient) {
    setInterval(() => {
      telemetryClient?.track("app.heartbeat", {
        uptimeMs: telemetryClient.getUptime(),
      });
    }, 5 * 60 * 1000); // 5 minutes
  }

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

  // In packaged app, plugins live in Resources/<name>/.
  // In dev, config-writer resolves plugin paths via monorepo root.
  const filePermissionsPluginPath = app.isPackaged
    ? join(process.resourcesPath, "file-permissions-plugin", "easyclaw-file-permissions.mjs")
    : undefined;
  const searchBrowserFallbackPath = app.isPackaged
    ? join(process.resourcesPath, "search-browser-fallback")
    : undefined;

  // Temporary storage for pending OAuth credentials (between acquire and save steps)
  let pendingOAuthCreds: AcquiredOAuthCredentials | null = null;

  // Check if there's an active Gemini OAuth key — if so, enable the plugin
  const hasGeminiOAuth = storage.providerKeys.getAll()
    .some((k) => k.provider === "google-gemini-cli" && k.authType === "oauth" && k.isDefault);

  writeGatewayConfig({
    configPath,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    enableChatCompletions: true,
    commandsRestart: true,
    enableFilePermissions: true,
    enableSearchBrowserFallback: true,
    searchBrowserFallbackPath,
    enableGeminiCliAuth: hasGeminiOAuth,
    skipBootstrap: false,
    filePermissionsPluginPath,
    defaultModel: {
      provider: startupModelConfig.provider,
      modelId: startupModelConfig.modelId,
    },
    stt: {
      enabled: sttEnabled,
      provider: sttProvider,
      nodeBin: process.execPath,
      sttCliPath,
    },
    extraProviders: buildExtraProviderConfigs(),
    forceStandaloneBrowser: true,
    agentWorkspace: join(stateDir, "workspace"),
  });

  // Clean up any existing openclaw processes before starting (both openclaw and openclaw-gateway)
  try {
    execSync("pkill -x 'openclaw-gateway' || true; pkill -x 'openclaw' || true", { stdio: "ignore" });
    log.info("Cleaned up existing openclaw processes");
  } catch (err) {
    log.warn("Failed to cleanup openclaw processes:", err);
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
  let currentState: GatewayState = "stopped";

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
    const proxyEnv = buildProxyEnv();
    launcher.setEnv({ ...secretEnv, ...proxyEnv });

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
    const proxyEnv = buildProxyEnv();
    launcher.setEnv({ ...secretEnv, ...proxyEnv });

    // Full restart to apply new environment variables
    await launcher.stop();
    await launcher.start();
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
      defaultModel: {
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
      },
      extraProviders: buildExtraProviderConfigs(),
    });

    // Full gateway restart to ensure model change takes effect.
    // SIGUSR1 graceful reload re-reads config but agent sessions keep their
    // existing model assignment. A stop+start creates fresh sessions with
    // the new default model from config.
    log.info("Config updated, performing full gateway restart for model change");
    await launcher.stop();
    await launcher.start();

    // Reconnect RPC client after restart to establish fresh WebSocket connection.
    connectRpcClient().catch((err) => {
      log.error("Failed to initiate RPC client reconnect after gateway restart:", err);
    });
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

    // Connect RPC client — auto-reconnect with backoff handles gateway not being ready yet
    connectRpcClient().catch((err) => {
      log.error("Failed to initiate RPC client after gateway start:", err);
    });

    if (firstStart) {
      firstStart = false;
      mainWindow?.loadURL(PANEL_URL);
      showMainWindow();
    }
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
    onOAuthAcquire: async (provider: string): Promise<{ email?: string; tokenPreview: string }> => {
      const proxyRouterUrl = `http://127.0.0.1:${PROXY_ROUTER_PORT}`;
      const acquired = await acquireGeminiOAuthToken({
        openUrl: (url) => shell.openExternal(url),
        onStatusUpdate: (msg) => log.info(`OAuth: ${msg}`),
        proxyUrl: proxyRouterUrl,
      });
      // Store credentials temporarily until onOAuthSave is called
      pendingOAuthCreds = acquired;
      log.info(`OAuth acquired for ${provider}, email=${acquired.email ?? "(none)"}`);
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

      // Enable plugin + sync auth profiles + rewrite config
      await syncAllAuthProfiles(stateDir, storage, secretStore);
      await writeProxyRouterConfig(storage, secretStore, lastSystemProxy);
      writeGatewayConfig({
        configPath,
        enableGeminiCliAuth: true,
        extraProviders: buildExtraProviderConfigs(),
      });
      // Restart gateway to pick up new plugin + auth profile
      await launcher.stop();
      await launcher.start();
      connectRpcClient().catch((err) => {
        log.error("Failed to reconnect RPC after OAuth save:", err);
      });
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

      // Write proxy setup module and set env vars: API keys + proxy + file permissions
      const proxyEnv = buildProxyEnv();
      const resolvedVendorDir = vendorDir ?? join(import.meta.dirname, "..", "..", "..", "vendor", "openclaw");
      const proxySetupPath = writeProxySetupModule(stateDir, resolvedVendorDir);
      proxyEnv.NODE_OPTIONS = `--require ${proxySetupPath}`;
      launcher.setEnv({ ...secretEnv, ...proxyEnv });
      return launcher.start();
    })
    .catch((err) => {
      log.error("Failed to start gateway:", err);
    });

  // Re-detect system proxy every 30 seconds and update config if changed
  setInterval(async () => {
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

    (async () => {
      // Sync back any refreshed OAuth tokens to Keychain before clearing
      try {
        await syncBackOAuthCredentials(stateDir, storage, secretStore);
      } catch (err) {
        log.error("Failed to sync back OAuth credentials:", err);
      }

      // Clear sensitive API keys from disk before quitting
      clearAllAuthProfiles(stateDir);

      // Track app.stopped with runtime
      if (telemetryClient) {
        const runtimeMs = telemetryClient.getUptime();
        telemetryClient.track("app.stopped", { runtimeMs });

        // Graceful shutdown: flush pending telemetry events
        await telemetryClient.shutdown();
        log.info("Telemetry client shut down gracefully");
      }

      await Promise.all([
        launcher.stop(),
        proxyRouter.stop(),
      ]);
      storage.close();
    })()
      .catch((err) => {
        log.error("Cleanup error during quit:", err);
      })
      .finally(() => {
        cleanupDone = true;
        app.exit(0); // Now actually exit — releases single-instance lock
      });
  });
});
