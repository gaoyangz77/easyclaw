import { app, BrowserWindow, Tray, shell, dialog, Notification } from "electron";
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
  clearAllAuthProfiles,
  DEFAULT_GATEWAY_PORT,
  buildExtraProviderConfigs,
} from "@easyclaw/gateway";
import type { GatewayState } from "@easyclaw/gateway";
import { resolveModelConfig, ALL_PROVIDERS, getDefaultModelForProvider, providerSecretKey, reconstructProxyUrl } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { createStorage } from "@easyclaw/storage";
import { createSecretStore } from "@easyclaw/secrets";
import { ArtifactPipeline, syncSkillsForRule, cleanupSkillsForDeletedRule } from "@easyclaw/rules";
import type { LLMConfig } from "@easyclaw/rules";
import { ProxyRouter } from "@easyclaw/proxy-router";
import type { ProxyRouterConfig } from "@easyclaw/proxy-router";
import { RemoteTelemetryClient } from "@easyclaw/telemetry";
import { getDeviceId } from "@easyclaw/device-id";
import { checkForUpdate } from "@easyclaw/updater";
import type { UpdateCheckResult } from "@easyclaw/updater";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { createTrayIcon } from "./tray-icon.js";
import { buildTrayMenu } from "./tray-menu.js";
import { startPanelServer } from "./panel-server.js";
import { SttManager } from "./stt-manager.js";

const log = createLogger("desktop");

const PANEL_PORT = 3210;
const PANEL_URL = process.env.PANEL_DEV_URL || `http://127.0.0.1:${PANEL_PORT}`;
const PROXY_ROUTER_PORT = 9999;

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
};

/**
 * Write proxy router configuration file.
 * Called whenever provider keys or proxies change.
 */
async function writeProxyRouterConfig(
  storage: import("@easyclaw/storage").Storage,
  secretStore: import("@easyclaw/secrets").SecretStore,
): Promise<void> {
  const configPath = resolveProxyRouterConfigPath();
  const config: ProxyRouterConfig = {
    ts: Date.now(),
    domainToProvider: DOMAIN_TO_PROVIDER,
    activeKeys: {},
    keyProxies: {},
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
 */
function buildProxyEnv(): Record<string, string> {
  const localProxyUrl = `http://127.0.0.1:${PROXY_ROUTER_PORT}`;
  return {
    HTTP_PROXY: localProxyUrl,
    HTTPS_PROXY: localProxyUrl,
    http_proxy: localProxyUrl,
    https_proxy: localProxyUrl,
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "localhost,127.0.0.1",
  };
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Ensure only one instance of the desktop app runs at a time
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.error("Another instance of EasyClaw desktop is already running");
  app.quit();
  process.exit(0);
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

app.whenReady().then(async () => {
  enableFileLogging();
  log.info("EasyClaw desktop starting");

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

  // Initialize telemetry client (privacy-first, user opt-in required)
  // DISABLED: Telemetry endpoint not configured yet
  const telemetryEnabled = false; // storage.settings.get("telemetry_enabled") === "true";
  const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT || "https://telemetry.easyclaw.com/api/telemetry/";
  let telemetryClient: RemoteTelemetryClient | null = null;

  if (telemetryEnabled) {
    try {
      telemetryClient = new RemoteTelemetryClient({
        endpoint: telemetryEndpoint,
        enabled: true,
        version: app.getVersion(),
        platform: process.platform,
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
    const result = await checkForUpdate(app.getVersion());
    latestUpdateResult = result;
    if (result.updateAvailable) {
      log.info(`Update available: v${result.latestVersion}`);
      const isZh = systemLocale === "zh";
      const notification = new Notification({
        title: isZh ? "EasyClaw 有新版本" : "EasyClaw Update Available",
        body: isZh
          ? `新版本 v${result.latestVersion} 已发布，点击查看详情。`
          : `A new version v${result.latestVersion} is available. Click to download.`,
      });
      if (result.download) {
        notification.on("click", () => {
          shell.openExternal(result.download!.url);
        });
      }
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

  // Start proxy router first (before gateway)
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

  // Track app.started event
  telemetryClient?.track("app.started", {
    version: app.getVersion(),
    platform: process.platform,
  });

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

  // In packaged app, the file-permissions plugin lives in Resources/file-permissions-plugin/.
  // In dev, config-writer resolves the plugin path via monorepo root.
  const filePermissionsPluginPath = app.isPackaged
    ? join(process.resourcesPath, "file-permissions-plugin", "easyclaw-file-permissions.mjs")
    : undefined;

  writeGatewayConfig({
    configPath,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    enableChatCompletions: true,
    commandsRestart: true,
    enableFilePermissions: true,
    skipBootstrap: false,
    filePermissionsPluginPath,
    defaultModel: {
      provider: startupModelConfig.provider,
      modelId: startupModelConfig.modelId,
    },
    stt: {
      enabled: sttEnabled,
      provider: sttProvider,
    },
    extraProviders: buildExtraProviderConfigs(),
    forceStandaloneBrowser: true,
  });

  // Clean up any existing gateway processes before starting
  try {
    const { execSync } = await import("node:child_process");
    execSync("pkill -f 'openclaw.*gateway' || true", { stdio: "ignore" });
    log.info("Cleaned up existing gateway processes");
  } catch (err) {
    log.warn("Failed to cleanup gateway processes:", err);
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
      writeProxyRouterConfig(storage, secretStore),
    ]);

    if (keyOnly) {
      // Key-only change: auth profiles + proxy config synced, done.
      // OpenClaw re-reads auth-profiles.json on every LLM turn,
      // proxy router re-reads its config file on change (fs.watch).
      // No restart needed — zero disruption.
      log.info("Key-only change, configs synced (no restart needed)");
      return;
    }

    // Read current provider/region settings
    const provider = storage.settings.get("llm-provider") as LLMProvider | undefined;
    const region = storage.settings.get("region") ?? "us";

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
                shell.openExternal(latestUpdateResult.download.url);
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
          ? { latestVersion: latestUpdateResult.latestVersion!, downloadUrl: latestUpdateResult.download.url }
          : undefined,
      }, systemLocale),
    );
  }

  tray.setToolTip("EasyClaw");
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
      app.dock?.hide();
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

    // Track error event with truncated stack trace (first 5 lines)
    const stackLines = error.stack?.split("\n") ?? [];
    const truncatedStack = stackLines.slice(0, 5).join("\n");

    telemetryClient?.track("app.error", {
      errorMessage: error.message,
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
  startPanelServer({
    port: PANEL_PORT,
    panelDistDir,
    vendorDir,
    storage,
    secretStore,
    deviceId,
    getRpcClient: () => rpcClient,
    getUpdateResult: () => latestUpdateResult,
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
    onChannelConfigured: (channelId) => {
      log.info(`Channel configured: ${channelId}`);
      telemetryClient?.track("channel.configured", {
        channelType: channelId,
      });
    },
  });

  // Sync auth profiles + proxy router config + build env, then start gateway.
  // Auth profiles are synced so OpenClaw has keys on disk from the first LLM turn.
  // Proxy router config is written so dynamic proxy routing is ready.
  // Env vars point to fixed local proxy (127.0.0.1:9999), no need to rebuild on changes.
  // File permissions are injected as EASYCLAW_FILE_PERMISSIONS env var.
  const workspacePath = stateDir;
  Promise.all([
    syncAllAuthProfiles(stateDir, storage, secretStore),
    writeProxyRouterConfig(storage, secretStore),
    buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath),
  ])
    .then(([, , secretEnv]) => {
      // Debug: Log which API keys are configured (without showing values)
      const configuredKeys = Object.keys(secretEnv).filter(k => k.endsWith('_API_KEY') || k.endsWith('_OAUTH_TOKEN'));
      log.info(`Initial API keys: ${configuredKeys.join(', ') || '(none)'}`);
      log.info(`Proxy router: http://127.0.0.1:${PROXY_ROUTER_PORT} (dynamic routing enabled)`);

      // Log file permissions status (without showing paths)
      if (secretEnv.EASYCLAW_FILE_PERMISSIONS) {
        const perms = JSON.parse(secretEnv.EASYCLAW_FILE_PERMISSIONS);
        log.info(`File permissions: workspace=${perms.workspacePath}, read=${perms.readPaths.length}, write=${perms.writePaths.length}`);
      }

      // Set env vars: API keys + fixed proxy URL + file permissions
      const proxyEnv = buildProxyEnv();
      launcher.setEnv({ ...secretEnv, ...proxyEnv });
      return launcher.start();
    })
    .catch((err) => {
      log.error("Failed to start gateway:", err);
    });

  log.info("EasyClaw desktop ready");

  // Cleanup on quit
  app.on("before-quit", async () => {
    isQuitting = true;

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
  });
});
