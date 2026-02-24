import { app, BrowserWindow, Menu, Tray, shell, dialog } from "electron";
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
  acquireGeminiOAuthToken,
  saveGeminiOAuthCredentials,
  validateGeminiAccessToken,
  startManualOAuthFlow,
  completeManualOAuthFlow,
} from "@easyclaw/gateway";
import type { OAuthFlowResult, AcquiredOAuthCredentials } from "@easyclaw/gateway";
import type { GatewayState } from "@easyclaw/gateway";
import { parseProxyUrl } from "@easyclaw/core";
import { createStorage } from "@easyclaw/storage";
import { createSecretStore } from "@easyclaw/secrets";
import { ArtifactPipeline, syncSkillsForRule, cleanupSkillsForDeletedRule } from "@easyclaw/rules";
import type { LLMConfig } from "@easyclaw/rules";
import { ProxyRouter } from "@easyclaw/proxy-router";
import { getDeviceId } from "@easyclaw/device-id";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createConnection } from "node:net";
import { createTrayIcon } from "./tray-icon.js";
import { buildTrayMenu } from "./tray-menu.js";
import { startPanelServer } from "./panel-server.js";
import { stopCS } from "./customer-service-bridge.js";
import { SttManager } from "./stt-manager.js";
import { createCdpManager } from "./cdp-manager.js";
import { PROXY_ROUTER_PORT, resolveProxyRouterConfigPath, detectSystemProxy, writeProxyRouterConfig, buildProxyEnv, writeProxySetupModule } from "./proxy-manager.js";
import { createAutoUpdater } from "./auto-updater.js";
import { resetDevicePairing, cleanupGatewayLock, applyAutoLaunch, migrateOldProviderKeys } from "./startup-utils.js";
import { initTelemetry } from "./telemetry-init.js";
import { createGatewayConfigBuilder } from "./gateway-config-builder.js";

const log = createLogger("desktop");

const PANEL_PORT = 3210;
const PANEL_URL = process.env.PANEL_DEV_URL || `http://127.0.0.1:${PANEL_PORT}`;
// Resolve Volcengine STT CLI script path.
// In packaged app: bundled into Resources/.
// In dev: resolve relative to the bundled output (apps/desktop/dist/) → packages/gateway/dist/.
const sttCliPath = app.isPackaged
  ? join(process.resourcesPath, "volcengine-stt-cli.mjs")
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/gateway/dist/volcengine-stt-cli.mjs");

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

  // Apply auto-launch (login item) setting from DB to OS
  const autoLaunchEnabled = storage.settings.get("auto_launch_enabled") === "true";
  applyAutoLaunch(autoLaunchEnabled);

  // Initialize telemetry client and heartbeat timer
  const locale = app.getLocale().startsWith("zh") ? "zh" : "en";
  const { client: telemetryClient, heartbeatTimer } = initTelemetry(storage, deviceId, locale);

  // --- Auto-updater state (updater instance created after tray) ---
  let currentState: GatewayState = "stopped";
  // updater is initialized after tray creation (search for "createAutoUpdater" below)
  let updater: ReturnType<typeof createAutoUpdater>;

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

  // Migrate old-style provider secrets to provider_keys table
  migrateOldProviderKeys(storage, secretStore).catch((err) => {
    log.error("Failed to migrate old provider keys:", err);
  });

  // Initialize gateway launcher
  const stateDir = resolveOpenClawStateDir();
  resetDevicePairing(stateDir);
  const configPath = ensureGatewayConfig();

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

  // Build gateway config helpers (closures bound to current settings)
  const { buildFullGatewayConfig } = createGatewayConfigBuilder({
    storage, locale, configPath, stateDir, extensionsDir, sttCliPath, filePermissionsPluginPath,
  });

  writeGatewayConfig(buildFullGatewayConfig());

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
        // Use killall (~10ms) instead of pkill which can take 20-50s on macOS
        // due to slow proc_info kernel calls when many processes are running.
        execSync("killall -9 openclaw-gateway 2>/dev/null || true; killall -9 openclaw 2>/dev/null || true", { stdio: "ignore" });
      }
      log.info("Cleaned up existing openclaw processes");
    } catch (err) {
      log.warn("Failed to cleanup openclaw processes:", err);
    }
  } else {
    log.info("No existing openclaw process on port, skipping cleanup");
  }

  // Clean up stale gateway lock file (and kill owner) before starting.
  cleanupGatewayLock(configPath);

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

    // Regenerate full OpenClaw config (reads current STT settings from storage)
    writeGatewayConfig(buildFullGatewayConfig());

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

  const cdpManager = createCdpManager({ storage, launcher, writeGatewayConfig, buildFullGatewayConfig });

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

    // Rewrite full OpenClaw config (reads current provider/model from storage)
    writeGatewayConfig(buildFullGatewayConfig());

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
            await updater.check();
            const isZh = systemLocale === "zh";
            const updateInfo = updater.getLatestInfo();
            if (updateInfo) {
              const { response } = await dialog.showMessageBox({
                type: "info",
                title: isZh ? "发现新版本" : "Update Available",
                message: isZh
                  ? `新版本 v${updateInfo.version} 已发布，当前版本为 v${app.getVersion()}。`
                  : `A new version v${updateInfo.version} is available. You are currently on v${app.getVersion()}.`,
                buttons: isZh ? ["下载", "稍后"] : ["Download", "Later"],
              });
              if (response === 0) {
                showMainWindow();
                updater.download().catch((e: unknown) => log.error("Update download failed:", e));
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
        updateInfo: updater.getLatestInfo()
          ? {
              latestVersion: updater.getLatestInfo()!.version,
              onDownload: () => {
                showMainWindow();
                updater.download().catch((e: unknown) => log.error("Update download failed:", e));
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

  // Initialize auto-updater (all deps available: locale, tray, launcher, etc.)
  updater = createAutoUpdater({
    locale,
    systemLocale,
    getMainWindow: () => mainWindow,
    showMainWindow,
    setIsQuitting: (v) => { isQuitting = v; },
    updateTray: () => updateTray(currentState),
    telemetryTrack: telemetryClient ? (event, meta) => telemetryClient!.track(event, meta) : undefined,
    launcher,
    configPath,
    cleanupGatewayLock,
  });

  updateTray("stopped");

  // Deferred: startup update check (must run after tray creation)
  updater.check().catch((err: unknown) => {
    log.warn("Startup update check failed:", err);
  });

  // Re-check every 4 hours
  const updateCheckTimer = setInterval(() => {
    updater.check().catch((err: unknown) => {
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

  // Enable right-click context menu (cut/copy/paste/select all) for all text inputs
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    // Only show for editable fields or when text is selected
    if (!isEditable && !selectionText) return;

    const menuItems: Electron.MenuItemConstructorOptions[] = [];
    if (isEditable) {
      menuItems.push(
        { label: "Cut", role: "cut", enabled: editFlags.canCut },
      );
    }
    if (selectionText || isEditable) {
      menuItems.push(
        { label: "Copy", role: "copy", enabled: editFlags.canCopy },
      );
    }
    if (isEditable) {
      menuItems.push(
        { label: "Paste", role: "paste", enabled: editFlags.canPaste },
        { type: "separator" },
        { label: "Select All", role: "selectAll", enabled: editFlags.canSelectAll },
      );
    }
    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup();
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
    getUpdateResult: () => {
      const info = updater.getLatestInfo();
      return {
        updateAvailable: info != null,
        currentVersion: app.getVersion(),
        latestVersion: info?.version,
        releaseNotes: typeof info?.releaseNotes === "string"
          ? info.releaseNotes
          : undefined,
      };
    },
    onUpdateDownload: () => updater.download(),
    onUpdateCancel: () => {
      updater.setDownloadState({ status: "idle" });
      mainWindow?.setProgressBar(-1);
    },
    onUpdateInstall: () => updater.install(),
    getUpdateDownloadState: () => updater.getDownloadState(),
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
    onBrowserChange: () => {
      cdpManager.handleBrowserChange().catch((err: unknown) => {
        log.error("Failed to handle browser change:", err);
      });
    },
    onAutoLaunchChange: (enabled: boolean) => {
      applyAutoLaunch(enabled);
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

      // Sync auth profiles + rewrite full config with google-gemini-cli model.
      // Switch the active provider to "gemini" so buildFullGatewayConfig() picks it up.
      storage.settings.set("llm-provider", "gemini");
      await syncAllAuthProfiles(stateDir, storage, secretStore);
      await writeProxyRouterConfig(storage, secretStore, lastSystemProxy);
      writeGatewayConfig(buildFullGatewayConfig());
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
  // Quote the path — Windows usernames with spaces break unquoted --require
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

      // If CDP browser mode was previously saved, ensure Chrome is running with
      // --remote-debugging-port.  This may kill and relaunch Chrome — an inherent
      // requirement of CDP mode (the flag must be present at Chrome startup).
      // If Chrome is already listening on the CDP port, it is reused without restart.
      const savedBrowserMode = storage.settings.get("browser-mode");
      if (savedBrowserMode === "cdp") {
        cdpManager.ensureCdpChrome().catch((err: unknown) => {
          log.warn("Failed to ensure CDP Chrome on startup:", err);
        });
      }

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
      // Stop customer service bridge (closes relay WS + gateway RPC, rejects pending replies)
      stopCS();

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
