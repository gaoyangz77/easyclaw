import { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } from "electron";
import { createLogger, enableFileLogging } from "@rivonclaw/logger";
import {
  GatewayLauncher,
  resolveVendorEntryPath,
  ensureGatewayConfig,
  resolveOpenClawStateDir,
  resolveOpenClawConfigPath,
  writeGatewayConfig,
  buildGatewayEnv,
  readExistingConfig,
  syncAllAuthProfiles,
  syncBackOAuthCredentials,
  clearAllAuthProfiles,
  saveGeminiOAuthCredentials,
  validateGeminiAccessToken,
  completeManualOAuthFlow,
  saveCodexOAuthCredentials,
  startHybridCodexOAuthFlow,
  startHybridGeminiOAuthFlow,
} from "@rivonclaw/gateway";
import type { OAuthFlowResult, AcquiredOAuthCredentials, AcquiredCodexOAuthCredentials } from "@rivonclaw/gateway";
import type { GatewayState } from "@rivonclaw/gateway";
import { parseProxyUrl, resolveGatewayPort, resolvePanelPort, resolveProxyRouterPort, DEFAULTS } from "@rivonclaw/core";
import { resolveUpdateMarkerPath, resolveHeartbeatPath, resolveRivonClawHome, resolveSessionStateDir, findFreePort } from "@rivonclaw/core/node";
import { createStorage } from "@rivonclaw/storage";
import { createSecretStore } from "@rivonclaw/secrets";
import { ArtifactPipeline, syncSkillsForRule, cleanupSkillsForDeletedRule } from "@rivonclaw/rules";
import type { LLMConfig } from "@rivonclaw/rules";
import { ProxyRouter } from "@rivonclaw/proxy-router";
import { getDeviceId } from "@rivonclaw/device-id";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { existsSync, unlinkSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { brandName } from "./i18n/brand.js";
import { createTrayIcon } from "./tray/tray-icon.js";
import { buildTrayMenu } from "./tray/tray-menu.js";
import { startPanelServer, pushChatSSE } from "./panel-server.js";
import { SttManager } from "./utils/stt-manager.js";
import { createCdpManager } from "./browser-profiles/cdp-manager.js";
import { CdpCookieAdapter } from "./browser-profiles/cdp-cookie-adapter.js";
import { resolveProxyRouterConfigPath, detectSystemProxy, writeProxyRouterConfig, buildProxyEnv, writeProxySetupModule } from "./gateway/proxy-manager.js";
import { createAutoUpdater } from "./utils/auto-updater.js";
import { resetDevicePairing, cleanupGatewayLock, applyAutoLaunch } from "./gateway/startup-utils.js";
import { initTelemetry } from "./utils/telemetry-init.js";
import { createGatewayConfigBuilder } from "./gateway/gateway-config-builder.js";
import { createGatewayEventDispatcher } from "./gateway/gateway-event-dispatcher.js";
import { AuthSessionManager } from "./auth/auth-session.js";
import { syncCloudProviderKey } from "./providers/cloud-provider-sync.js";
import { allKeysToMstSnapshots, toMstSnapshot } from "./providers/provider-key-utils.js";
import { syncActiveKey } from "./providers/provider-validator.js";
import { rootStore, initLLMProviderManagerEnv, initChannelManagerEnv } from "./store/desktop-store.js";
import { OAuthSubscriptionClient } from "./cloud/oauth-subscription-client.js";
import { UpdateSubscriptionClient } from "./cloud/update-subscription-client.js";
import { createSessionStateStack, type SessionStateStack } from "./browser-profiles/session-state-wiring.js";
import { createCloudBackupProvider } from "./browser-profiles/session-state/backup-provider.js";
import type { ProfilePolicyResolver } from "./browser-profiles/runtime-service.js";
import type { BrowserProfileSessionStatePolicy } from "@rivonclaw/core";
import { ManagedBrowserService } from "./browser-profiles/managed-browser-service.js";
import { OUR_PLUGIN_IDS } from "./generated/our-plugin-ids.js";

import { initCookieSync, pullAndPersistCookies } from "./browser-profiles/cookie-sync.js";
import { createGatewayConfigHandlers } from "./gateway/gateway-config-handlers.js";
import { connectGateway, disconnectGateway, getCsBridge } from "./gateway/gateway-connection.js";
import { getRpcClient } from "./gateway/rpc-client-ref.js";
import { setAuthSession } from "./auth/auth-session-ref.js";
import { setStorageRef } from "./storage-ref.js";
import { setProviderKeysStore } from "./gateway/provider-keys-ref.js";
import { setVendorDir } from "./gateway/vendor-dir-ref.js";

const log = createLogger("desktop");

function setDockIcon(): void {
  const iconPath = resolve(dirname(fileURLToPath(import.meta.url)), "../build/icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    app.dock?.setIcon(icon);
  }
}

// Late-bound: actual panel port is determined after startPanelServer() resolves.
// PANEL_DEV_URL overrides dynamic allocation entirely (Vite dev server).
let PANEL_URL = process.env.PANEL_DEV_URL || "";
// Resolve Volcengine STT CLI script path.
// In packaged app: bundled into Resources/.
// In dev: resolve relative to the bundled output (apps/desktop/dist/) → packages/gateway/dist/.
const sttCliPath = app.isPackaged
  ? join(process.resourcesPath, "volcengine-stt-cli.mjs")
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/gateway/dist/volcengine-stt-cli.mjs");

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let lastSystemProxy: string | null = null;
// The marker file is written by auto-updater.ts before quitAndInstall().
// It contains the target version (e.g. "1.5.9"). By comparing with app.getVersion()
// we can determine whether this is the NEW app (install succeeded) or the OLD app
// (user opened it while the installer is still running).
const UPDATE_MARKER = resolveUpdateMarkerPath();
const UPDATE_MARKER_MAX_AGE_MS = DEFAULTS.desktop.updateMarkerMaxAgeMs;
let _updateBlocked = false;
if (existsSync(UPDATE_MARKER)) {
  try {
    const targetVersion = readFileSync(UPDATE_MARKER, "utf-8").trim();
    if (targetVersion && targetVersion !== app.getVersion()) {
      // We're the OLD app — installer hasn't finished replacing us yet.
      // Keep the marker so subsequent launch attempts are also blocked.
      const markerAge = Date.now() - statSync(UPDATE_MARKER).mtimeMs;
      if (markerAge < UPDATE_MARKER_MAX_AGE_MS) {
        _updateBlocked = true;
      } else {
        // Marker is stale (>5 min) — installation probably failed, clean up.
        try { unlinkSync(UPDATE_MARKER); } catch { }
      }
    } else {
      // Version matches (new app) or empty marker — installation complete, clean up.
      try { unlinkSync(UPDATE_MARKER); } catch { }
    }
  } catch {
    // Malformed marker — clean up.
    try { unlinkSync(UPDATE_MARKER); } catch { }
  }
}

// ── Single-instance guard ──────────────────────────────────────────────
//
// Electron's requestSingleInstanceLock() prevents duplicate instances.
// However, it alone can't distinguish between two scenarios when the lock
// is already held:
//
//   1. Healthy instance — a normal running app holds the lock.
//      → The new instance should exit quietly; the existing one will show
//        its window via the 'second-instance' event.
//
//   2. Stale instance — the old process hung or crashed without releasing
//      the lock (e.g. after a failed auto-update, or an unclean shutdown
//      where the OS didn't reclaim the socket/pipe).
//      → The new instance must kill the stale process and relaunch,
//        otherwise the user is stuck and can never open the app.
//
// To tell them apart, the running instance writes a heartbeat file
// (~/.rivonclaw/heartbeat.json) containing { pid, ts } every 10 seconds.
// When a second instance can't acquire the lock, it reads the heartbeat:
//   - ts < 30s old  →  healthy, exit
//   - ts > 30s old or missing  →  stale, kill & relaunch
//
// The heartbeat file is cleaned up on normal exit (both before-quit and
// auto-updater cleanup paths).
const HEARTBEAT_PATH = resolveHeartbeatPath();
const HEARTBEAT_INTERVAL_MS = DEFAULTS.desktop.heartbeatIntervalMs;
const HEARTBEAT_STALE_MS = DEFAULTS.desktop.heartbeatStaleMs;

function writeHeartbeat(): void {
  try {
    writeFileSync(HEARTBEAT_PATH, JSON.stringify({ pid: process.pid, ts: Date.now() }));
  } catch { }
}

function removeHeartbeat(): void {
  try { unlinkSync(HEARTBEAT_PATH); } catch { }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  let isStale = true;
  try {
    if (existsSync(HEARTBEAT_PATH)) {
      const data = JSON.parse(readFileSync(HEARTBEAT_PATH, "utf-8"));
      const age = Date.now() - data.ts;
      if (age < HEARTBEAT_STALE_MS) {
        // Heartbeat is fresh — existing instance is healthy
        isStale = false;
      }
    }
  } catch { }

  if (isStale) {
    // Stale or unresponsive process — kill it and relaunch
    let killedStale = false;
    try {
      if (process.platform === "win32") {
        const out = execSync('wmic process where "name=\'RivonClaw.exe\'" get ProcessId 2>nul', {
          encoding: "utf-8",
          timeout: 3000,
        }).trim();
        const pids = out
          .split("\n")
          .slice(1)
          .map((line) => parseInt(line.trim(), 10))
          .filter((pid) => pid !== process.pid && !isNaN(pid));
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
            killedStale = true;
          } catch { }
        }
      } else {
        const out = execSync("pgrep -x RivonClaw 2>/dev/null || true", {
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
          } catch { }
        }
      }
    } catch { }

    if (killedStale) {
      removeHeartbeat();
      app.relaunch();
    }
  }

  app.exit(0);
}

// Lock acquired — start heartbeat so future instances can detect us as healthy
writeHeartbeat();
const singleInstanceHeartbeat = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

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

/**
 * Normalize legacy cron store on disk: rename `jobId` → `id`.
 * The OpenClaw CLI writes jobs with `jobId`, but the gateway's cron service
 * indexes/finds jobs by `id`. Without this normalization, cron.update / cron.remove
 * / cron.run all fail with "unknown cron job id".
 */
function normalizeCronStoreIds(cronStorePath: string): void {
  try {
    const raw = readFileSync(cronStorePath, "utf-8");
    const store = JSON.parse(raw);
    if (!Array.isArray(store?.jobs)) return;

    let changed = false;
    for (const job of store.jobs) {
      if (job.jobId && !job.id) {
        job.id = job.jobId;
        delete job.jobId;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(cronStorePath, JSON.stringify(store, null, 2), "utf-8");
      log.info(`Normalized cron store: renamed jobId → id in ${cronStorePath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("Failed to normalize cron store:", err);
    }
  }
}

app.whenReady().then(async () => {
  // Version mismatch: this is the OLD app launched while the installer is updating.
  // Show an informational dialog and exit — NSIS will launch the new app when done.
  if (_updateBlocked) {
    const isZh = app.getLocale().startsWith("zh");
    const updateLocale = isZh ? "zh" : "en";
    dialog.showMessageBoxSync({
      type: "info",
      title: brandName(updateLocale),
      message: isZh
        ? `${brandName(updateLocale)} 正在更新中，请等待安装完成后再打开。`
        : `${brandName(updateLocale)} is being updated. Please wait for the installation to finish.`,
      buttons: ["OK"],
    });
    app.exit(0);
    return;
  }

  Menu.setApplicationMenu(null);
  enableFileLogging();
  log.info(`RivonClaw desktop starting (build: ${__BUILD_TIMESTAMP__})`);

  // Show dock icon immediately. LSUIElement=true in Info.plist hides it by default
  // (which also prevents child processes like the gateway from showing dock icons).
  // We explicitly show it for the main process here.
  app.dock?.show();
  setDockIcon();

  // --- Device ID ---
  let deviceId: string;
  try {
    deviceId = getDeviceId();
    log.info(`Device ID: ${deviceId.slice(0, 8)}...`);
  } catch (err) {
    log.error("Failed to get device ID:", err);
    deviceId = "unknown";
  }

  // --- Rebrand migration (EasyClaw → RivonClaw) ---
  // TODO(cleanup): Remove after v1.8.0 (see auth/rebrand-migration.ts)
  const { migrateFromEasyClaw } = await import("./auth/rebrand-migration.js");
  await migrateFromEasyClaw();

  // Initialize storage and secrets
  const storage = createStorage();
  setStorageRef(storage);
  setProviderKeysStore(storage.providerKeys);
  const secretStore = createSecretStore();

  // Load provider keys into MST store (before panel server starts, so SSE
  // snapshot includes them on first Panel connect)
  const allKeyEntries = storage.providerKeys.getAll();
  const mstKeySnapshots = await allKeysToMstSnapshots(allKeyEntries, secretStore);
  rootStore.loadProviderKeys(mstKeySnapshots);

  // Client tool specs are loaded via RPC after gateway connects (see gateway-connection.ts).
  // No direct import needed here — avoids module instance duplication across processes.

  // Apply auto-launch (login item) setting from DB to OS
  const autoLaunchEnabled = storage.settings.get("auto_launch_enabled") === "true";
  applyAutoLaunch(autoLaunchEnabled);

  // Initialize telemetry client and heartbeat timer
  const locale = app.getLocale().startsWith("zh") ? "zh" : "en";
  const { client: telemetryClient, heartbeatTimer } = initTelemetry(storage, deviceId, locale);

  // Initialize auth session manager
  const authSession = new AuthSessionManager(secretStore, locale, fetch);
  setAuthSession(authSession);
  authSession.onUserChanged((user) => syncCloudProviderKey(user, storage, secretStore));
  await authSession.loadFromKeychain();
  // Validate session on startup (auth uses native fetch, no proxy dependency)
  authSession.validate().catch(() => {});

  // Initialize cloud OAuth subscription client (GraphQL Subscription via graphql-ws)
  const oauthSubscription = new OAuthSubscriptionClient(locale, (payload) => {
    log.info("OAuth complete notification received, forwarding to Panel", { payload });
    pushChatSSE("oauth-complete", payload);
  });
  // Connect when user is authenticated, disconnect on logout
  authSession.onUserChanged((user) => {
    if (user) {
      oauthSubscription.connect(() => authSession.getAccessToken());
    } else {
      oauthSubscription.disconnect();
    }
  });

  // Initial connect if already authenticated
  oauthSubscription.connect(() => authSession.getAccessToken());

  // --- First-start OpenClaw import ---
  // Only show the import wizard for truly new users:
  //  1. openclaw_import_checked is not set (never checked before)
  //  2. Standalone OpenClaw exists at ~/.openclaw/openclaw.json
  //  3. RivonClaw's own state dir (~/.rivonclaw/openclaw/) does NOT yet exist
  //     (if it exists, this is an existing RivonClaw user upgrading — skip silently)
  const importChecked = storage.settings.get("openclaw_import_checked");
  if (!importChecked) {
    const standaloneDir = join(homedir(), ".openclaw");
    const standaloneConfig = join(standaloneDir, "openclaw.json");
    const defaultStateDir = join(resolveRivonClawHome(), "openclaw");
    if (existsSync(standaloneConfig) && !existsSync(defaultStateDir)) {
      const { response } = await dialog.showMessageBox({
        type: "question",
        buttons: [locale === "zh" ? "使用现有数据" : "Use existing data", locale === "zh" ? "全新开始" : "Start fresh"],
        defaultId: 0,
        title: brandName(locale),
        message: locale === "zh"
          ? "检测到本地已安装的 OpenClaw"
          : "Existing OpenClaw installation detected",
        detail: locale === "zh"
          ? `发现 ${standaloneDir} 中的 OpenClaw 数据（包括 Agent 记忆和文档）。\n是否让 ${brandName(locale)} 直接使用这些数据？`
          : `Found OpenClaw data at ${standaloneDir} (including agent memory and documents).\nWould you like ${brandName(locale)} to use this existing data?`,
      });
      if (response === 0) {
        storage.settings.set("openclaw_state_dir_override", standaloneDir);
      }
    }
    storage.settings.set("openclaw_import_checked", "true");
  }

  // Apply persisted OpenClaw state dir override before resolving any paths
  const stateDirOverride = storage.settings.get("openclaw_state_dir_override");
  if (stateDirOverride) {
    process.env.OPENCLAW_STATE_DIR = stateDirOverride;
  }

  // --- System Dependencies Provisioning ---
  // On first launch, check and optionally install missing system dependencies
  // (git, python, node, uv) that the agent needs to function properly.
  // Runs in the background so the app starts immediately.
  const depsProvisioned = storage.settings.get("deps_provisioned");
  if (!depsProvisioned) {
    import("./deps-provisioner/index.js").then(({ runDepsProvisioner }) => {
      runDepsProvisioner({ storage }).catch((err: unknown) => {
        log.error("Deps provisioner failed:", err);
      });
    });
  }

  // --- Auto-updater state (updater instance created after tray) ---
  let currentState: GatewayState = "stopped";
  // updater is initialized after tray creation (search for "createAutoUpdater" below)
  let updater: ReturnType<typeof createAutoUpdater>;
  // Shared flag: set by runFullCleanup (pre-update) or before-quit handler.
  // When true, the before-quit handler skips all cleanup and lets the app exit immediately.
  let cleanupDone = false;

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
    port: resolveProxyRouterPort(),
    configPath: resolveProxyRouterConfigPath(),
    onConfigReload: (config) => {
      log.debug(`Proxy router config reloaded: ${Object.keys(config.activeKeys).length} providers`);
    },
  });

  await proxyRouter.start().catch((err) => {
    log.error("Failed to start proxy router:", err);
  });

  // Resolve actual ports after services bind to OS-assigned ephemeral ports.
  // Proxy router port is now known (server is listening).
  const actualProxyRouterPort = proxyRouter.getPort();
  log.info(`Proxy router bound to port ${actualProxyRouterPort}`);

  // Gateway port: use env override if set (nonzero), otherwise ask OS for a free port.
  const envGatewayPort = resolveGatewayPort();
  const actualGatewayPort = envGatewayPort !== 0 ? envGatewayPort : await findFreePort();
  log.info(`Gateway will use port ${actualGatewayPort}`);

  // Initialize gateway launcher
  const stateDir = resolveOpenClawStateDir();
  resetDevicePairing(stateDir);
  const configPath = ensureGatewayConfig();

  // In packaged app, plugins/extensions live in Resources/.
  // In dev, config-writer auto-resolves via monorepo root.
  const filePermissionsPluginPath = app.isPackaged
    ? join(process.resourcesPath, "extensions", "rivonclaw-file-permissions", "dist", "rivonclaw-file-permissions.mjs")
    : undefined;
  const extensionsDir = app.isPackaged
    ? join(process.resourcesPath, "extensions")
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../../extensions");

  // Pending OAuth flow state (replaces scalar variables with a flow map for async/non-blocking flows)
  interface PendingOAuthFlow {
    provider: string;
    authUrl: string;
    status: "pending" | "completed" | "failed";
    creds?: AcquiredOAuthCredentials | AcquiredCodexOAuthCredentials;
    error?: string;
    _createdAt: number;
    // Gemini
    verifier?: string;
    cancelCallback?: () => void;
    // Codex
    resolveManualInput?: (url: string) => void;
    rejectManualInput?: (err: Error) => void;
    completionPromise?: Promise<AcquiredOAuthCredentials | AcquiredCodexOAuthCredentials>;
  }
  const pendingOAuthFlows = new Map<string, PendingOAuthFlow>();

  // Clean up abandoned OAuth flows every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [id, flow] of pendingOAuthFlows) {
      if (now - flow._createdAt > 10 * 60 * 1000) {
        pendingOAuthFlows.delete(id);
        log.info(`Cleaned up abandoned OAuth flow ${id}`);
      }
    }
  }, DEFAULTS.desktop.oauthCleanupIntervalMs);

  // One-time backfill: ensure existing allowFrom entries have channel_recipients rows as owners
  const { backfillOwnerMigration } = await import("./auth/owner-migration.js");
  await backfillOwnerMigration(storage, stateDir, configPath);



  // Clean up any stale openclaw processes before starting.
  // With dynamic ports, orphaned processes won't block new instances,
  // so we skip TCP port probing entirely. Only do process-name-based cleanup
  // as a dev convenience (handles stale processes from previous runs).
  //
  // Skip in parallel E2E: killall is process-name-based and would kill
  // gateways belonging to other test workers. Each E2E worker already
  // cleans up its own gateway via ensurePortFree in the fixture teardown.
  if (!process.env.OPENCLAW_ALLOW_MULTI_GATEWAY) {
    try {
      if (process.platform === "win32") {
        try { execSync("taskkill /f /im openclaw-gateway.exe 2>nul & taskkill /f /im openclaw.exe 2>nul & exit /b 0", { stdio: "ignore", shell: "cmd.exe" }); } catch { }
      } else {
        execSync("killall -9 openclaw-gateway 2>/dev/null || true; killall -9 openclaw 2>/dev/null || true", { stdio: "ignore" });
      }
      log.info("Cleaned up existing openclaw processes");
    } catch (err) {
      log.warn("Failed to cleanup openclaw processes:", err);
    }
  }

  // Clean up stale gateway lock file (and kill owner) before starting.
  cleanupGatewayLock(configPath);

  // Normalize legacy cron store: rename jobId → id so the gateway's findJobOrThrow works.
  // The OpenClaw CLI writes "jobId" but the gateway service indexes jobs by "id".
  normalizeCronStoreIds(join(stateDir, "cron", "jobs.json"));

  // In packaged app, vendor lives in Resources/vendor/openclaw (extraResources).
  // In dev, resolveVendorEntryPath() resolves relative to source via import.meta.url.
  const vendorDir = app.isPackaged
    ? join(process.resourcesPath, "vendor", "openclaw")
    : join(import.meta.dirname, "..", "..", "..", "vendor", "openclaw");
  setVendorDir(vendorDir);

  // Force pre-compiled ESM extensions from dist-runtime/ instead of .ts source
  // from extensions/. Without this, the gateway detects the vendor checkout
  // (.git + src/ present) and loads .ts via jiti babel transform, adding ~4s
  // to startup from 1338 extra CJS requires. Set on process.env so it flows
  // through buildGatewayEnv() into every launcher.setEnv() call.
  const distRuntimeExtensions = join(vendorDir, "dist-runtime", "extensions");
  if (existsSync(distRuntimeExtensions)) {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = distRuntimeExtensions;
  }

  // Initialize Channel Manager -- loads accounts from SQLite (runs migration if needed).
  // Must happen BEFORE createGatewayConfigBuilder so that buildPluginEntries() and
  // buildConfigAccounts() have data when buildFullGatewayConfig is first invoked.
  initChannelManagerEnv({
    storage,
    configPath,
    stateDir,
    getRpcClient,
  });

  // Build gateway config helpers (closures bound to current settings)
  const { buildFullGatewayConfig } = createGatewayConfigBuilder({
    storage, secretStore, locale, configPath, stateDir, extensionsDir, sttCliPath, filePermissionsPluginPath, vendorDir,
    channelPluginEntries: () => rootStore.channelManager.buildPluginEntries(),
    channelConfigAccounts: () => rootStore.channelManager.buildConfigAccounts(),
  });

  writeGatewayConfig(await buildFullGatewayConfig(actualGatewayPort));

  // Disable mDNS/Bonjour — desktop app manages its own device pairing.
  // Bonjour's mDNS probing blocks the gateway event loop for 14-16s on
  // Windows (name conflict resolution), delaying RPC handshake.
  {
    const { readFileSync, writeFileSync } = await import("node:fs");
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!raw.discovery) raw.discovery = {};
      if (!raw.discovery.mdns) raw.discovery.mdns = {};
      raw.discovery.mdns.mode = "off";
      writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");
    } catch { /* non-critical */ }
  }

  const launcher = new GatewayLauncher({
    entryPath: resolveVendorEntryPath(vendorDir),
    nodeBin: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1", OPENCLAW_DISABLE_BONJOUR: "1" },
    configPath,
    stateDir,
  });

  // Create the gateway event dispatcher — routes WS events to Panel SSE
  const dispatchGatewayEvent = createGatewayEventDispatcher({
    pushChatSSE,
    chatSessions: storage.chatSessions,
  });

  // Gateway connection deps — passed to connectGateway() on each "ready" event
  const gatewayConnectionDeps = {
    configPath,
    stateDir,
    deviceId,
    gatewayPort: actualGatewayPort,
    storage,
    toolCapability: rootStore.toolCapability,
    ourPluginIds: OUR_PLUGIN_IDS,
    dispatchGatewayEvent,
  };

  // ToolCapability is now an MST sub-model on rootStore — views auto-recompute
  // when tools change (e.g. after ingestGraphQLResponse).
  // Initialize artifact pipeline with LLM config resolver
  const pipeline = new ArtifactPipeline({
    storage,
    resolveLLMConfig: async (): Promise<LLMConfig | null> => {
      const config = readExistingConfig(configPath);
      const gw = config.gateway as Record<string, unknown> | undefined;
      const auth = gw?.auth as Record<string, unknown> | undefined;
      const token = auth?.token as string | undefined;
      if (!token) return null;

      const port = (gw?.port as number) ?? actualGatewayPort;
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

  // Late-bound reference: sessionStateStack is created after cdpManager,
  // so we capture it via a mutable binding that the callback closes over.
  // eslint-disable-next-line prefer-const -- assigned later, after cdpManager creation
  let sessionStateStackRef = null as SessionStateStack | null;

  const cdpManager = createCdpManager({
    storage,
    launcher,
    writeGatewayConfig,
    buildFullGatewayConfig: () => buildFullGatewayConfig(actualGatewayPort),
    onCdpReady: (port) => {
      const stack = sessionStateStackRef;
      if (!stack) {
        log.warn("onCdpReady fired before sessionStateStack initialized — skipping session start");
        return;
      }
      // Check if CDP session-state tracking is enabled (default: true)
      const cdpSessionEnabled = storage.settings.get("session-state-cdp-enabled");
      if (cdpSessionEnabled === "false") {
        log.info("CDP session-state tracking disabled by user setting — skipping");
        return;
      }
      // CDP compatibility session — uses "__cdp__" as the scope key since
      // CDP mode operates on the user's existing Chrome, not an RivonClaw-managed profile.
      const adapter = new CdpCookieAdapter(port);
      stack.lifecycleManager.startSession("__cdp__", adapter, "cdp")
        .catch((err: unknown) => log.warn("Failed to start CDP session state tracking:", err));
    },
  });

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

  tray.setToolTip(brandName(systemLocale));

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
  });

  updateTray("stopped");

  // Startup update check (fallback for non-authenticated users)
  updater.check().catch((err: unknown) => {
    log.warn("Startup update check failed:", err);
  });

  // Real-time update push via GraphQL subscription (replaces 4h polling)
  const updateSubscription = new UpdateSubscriptionClient(locale, app.getVersion(), (payload) => {
    log.info(`Server pushed update: v${payload.version}`);
    updater.setServerPushInfo(payload);
    pushChatSSE("update-available", {
      updateAvailable: true,
      currentVersion: app.getVersion(),
      latestVersion: payload.version,
      downloadUrl: payload.downloadUrl ?? null,
    });
    updater.check().catch((err: unknown) => {
      log.warn("Update check after subscription push failed:", err);
    });
  }, () => {
    log.info("Server dismissed update — clearing banner");
    updater.clearServerPushInfo();
    pushChatSSE("update-available", {
      updateAvailable: false,
      currentVersion: app.getVersion(),
      latestVersion: null,
      downloadUrl: null,
    });
  });
  // Connect/disconnect update subscription with auth lifecycle
  authSession.onUserChanged((user) => {
    if (user) {
      updateSubscription.connect(() => authSession.getAccessToken());
    } else {
      updateSubscription.disconnect();
    }
  });
  // Initial connect if already authenticated
  updateSubscription.connect(() => authSession.getAccessToken());

  // Create main panel window (hidden initially, loaded when gateway starts)
  const isDev = !!process.env.PANEL_DEV_URL;
  mainWindow = new BrowserWindow({
    width: isDev ? 2000 : 1400,
    height: 800,
    show: false,
    title: brandName(systemLocale),
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

  // Safety net: if the gateway doesn't emit "started" within 10 seconds,
  // show the window anyway so the user isn't left staring at nothing.
  // This covers scenarios where spawn() fails, the binary is missing,
  // or the child process crashes before producing output.
  const startupTimeout = setTimeout(() => {
    if (firstStart && mainWindow) {
      log.warn("Gateway did not start within 10s — showing window anyway");
      firstStart = false;
      mainWindow.loadURL(PANEL_URL);
      showMainWindow();
    }
  }, 10_000);

  launcher.on("started", () => {
    log.info("Gateway started");
    updateTray("running");
    clearTimeout(startupTimeout);

    if (firstStart) {
      firstStart = false;
      mainWindow?.loadURL(PANEL_URL);
      showMainWindow();
    }
  });

  launcher.on("ready", () => {
    log.info("Gateway ready (listening)");
    connectGateway(gatewayConnectionDeps).catch((err: unknown) => {
      log.error("Failed to initiate RPC client after gateway ready:", err);
    });
  });

  launcher.on("stopped", () => {
    log.info("Gateway stopped");

    // Pull cookies from the gateway plugin for all running profiles before
    // disconnecting the RPC client. Best-effort: failures are logged.
    const runningProfiles = managedBrowserService.getRunningProfiles();
    const pullPromises = runningProfiles.map(profileId =>
      pullAndPersistCookies(profileId)
        .catch((e: unknown) => log.debug(`Failed to pull cookies for ${profileId} on gateway stop:`, e)),
    );
    Promise.all(pullPromises)
      .catch(() => {}) // swallow aggregate errors
      .finally(() => {
        disconnectGateway();
      });

    updateTray("stopped");

    // Gateway stopped -- managed browsers lose their runtime
    managedBrowserService.shutdown()
      .catch(err => log.warn("Failed to shutdown managed browser service:", err));

    // End any remaining sessions (CDP compatibility)
    sessionStateStack.lifecycleManager.endAllSessions()
      .catch((err) => log.warn("Failed to end sessions on gateway stop:", err));
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

  // Sanitize paths to remove usernames (e.g., /Users/john/... → ~/...)
  const sanitizePath = (s: string) =>
    s.replace(/(?:\/Users\/|\/home\/|C:\\Users\\)[^\s/\\]+/gi, "~");

  // Track uncaught exceptions
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception:", error);

    // Track error event with truncated + sanitized stack trace (first 5 lines)
    const stackLines = error.stack?.split("\n") ?? [];
    const truncatedStack = sanitizePath(stackLines.slice(0, 5).join("\n"));

    telemetryClient?.track("app.error", {
      errorMessage: sanitizePath(error.message),
      errorStack: truncatedStack,
    });
  });

  // Prevent silent process termination from unhandled Promise rejections.
  // Without this, a rejected promise (e.g. during gateway startup) can kill
  // the Electron process with no error log on Windows.
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log.error("Unhandled rejection:", error);

    const stackLines = error.stack?.split("\n") ?? [];
    const truncatedStack = sanitizePath(stackLines.slice(0, 5).join("\n"));

    telemetryClient?.track("app.error", {
      errorMessage: sanitizePath(error.message),
      errorStack: truncatedStack,
      type: "unhandledRejection",
    });
  });

  // Diagnostic: log process exit to catch silent crashes (e.g. antivirus
  // killing the process, native segfaults). The 'exit' event fires
  // synchronously even when the process is terminated externally.
  process.on("exit", (code) => {
    if (!isQuitting) {
      log.error(`Process exiting unexpectedly (code=${code}, isQuitting=false)`);
    }
  });

  // Initialize STT manager
  const sttManager = new SttManager(storage, secretStore);
  await sttManager.initialize();

  // Initialize session state stack for browser profile session persistence.
  // The policy resolver reads sessionStatePolicy from the canonical cloud
  // BrowserProfile model. For CDP-only profiles (__cdp__) or when auth is
  // unavailable, it returns null so the runtime falls back to defaults.
  const policyResolver: ProfilePolicyResolver = async (profileId: string) => {
    if (profileId === "__cdp__") return null;
    if (!authSession?.getAccessToken()) return null;
    try {
      const data = await authSession.graphqlFetch<{
        browserProfile: { sessionStatePolicy: BrowserProfileSessionStatePolicy } | null;
      }>(
        `query ($id: ID!) { browserProfile(id: $id) { sessionStatePolicy { enabled checkpointIntervalSec mode storage } } }`,
        { id: profileId },
      );
      if (!data.browserProfile?.sessionStatePolicy) return null;
      const sp = data.browserProfile.sessionStatePolicy;
      return {
        mode: sp.mode as BrowserProfileSessionStatePolicy["mode"],
        checkpointIntervalSec: sp.checkpointIntervalSec,
        storage: sp.storage as BrowserProfileSessionStatePolicy["storage"],
      };
    } catch {
      return null; // Fall back to default policy on network failure
    }
  };
  const backupProvider = authSession ? createCloudBackupProvider(authSession) : undefined;
  const sessionStateStack = await createSessionStateStack(resolveSessionStateDir(), secretStore, policyResolver, backupProvider);
  sessionStateStackRef = sessionStateStack;

  // Create managed browser service for multi-profile browser management
  const managedBrowserService = new ManagedBrowserService(
    sessionStateStack.lifecycleManager,
    join(stateDir, "managed-browsers"),
  );

  // Wire cookie-sync module to session state and managed browser service
  initCookieSync({
    getSessionStateStack: () => sessionStateStackRef,
    getManagedBrowserEntries: () => managedBrowserService.getAllEntries(),
  });

  // Late-bound config handler refs — configHandlers is created after workspacePath
  // is resolved (post-launcher), but panel-server callbacks need them earlier.
  // The callbacks are only invoked at runtime (user action), never during startup,
  // so the late binding is safe.
  let handleProviderChange!: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => Promise<void>;
  let handleSttChange!: () => Promise<void>;
  let handleExtrasChange!: () => Promise<void>;
  let handlePermissionsChange!: () => Promise<void>;

  // Start the panel server
  const panelDistDir = app.isPackaged
    ? join(process.resourcesPath, "panel-dist")
    : resolve(__dirname, "../../panel/dist");
  const changelogPath = resolve(__dirname, "../changelog.json");
  // In dev mode, use fixed port so Vite's proxy can find us.
  // In production, use OS-assigned port (0) for conflict-free startup.
  const requestedPanelPort = process.env.PANEL_DEV_URL
    ? DEFAULTS.ports.panelDevBackend
    : resolvePanelPort();
  const { port: actualPanelPort } = await startPanelServer({
    port: requestedPanelPort,
    panelDistDir,
    changelogPath,
    vendorDir,
    nodeBin: process.execPath,
    storage,
    secretStore,
    proxyRouterPort: actualProxyRouterPort,
    gatewayPort: actualGatewayPort,
    deviceId,
    getUpdateResult: () => {
      const info = updater.getLatestInfo();
      return {
        updateAvailable: info != null,
        currentVersion: app.getVersion(),
        latestVersion: info?.version,
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
      const port = (gw?.port as number) ?? actualGatewayPort;
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
      // Refresh LLM Manager's model catalog so stale overrides are detected
      rootStore.llmManager.refreshModelCatalog().catch(() => {});
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
    onExtrasChange: () => {
      handleExtrasChange().catch((err) => {
        log.error("Failed to handle extras change:", err);
      });
    },
    onPermissionsChange: () => {
      handlePermissionsChange().catch((err) => {
        log.error("Failed to handle permissions change:", err);
      });
    },
    onToolSelectionChange: undefined, // Tool visibility is controlled by capability-manager at runtime, no gateway restart needed
    sessionLifecycleManager: sessionStateStack.lifecycleManager,
    managedBrowserService,
    onBrowserChange: () => {
      // End all session state tracking BEFORE reconfiguring browser mode.
      // Sessions must flush while the browser is still running.
      managedBrowserService.shutdown()
        .catch((err: unknown) => log.error("Failed to shutdown managed browsers on change:", err))
        .finally(() => {
          sessionStateStack.lifecycleManager.endAllSessions()
            .catch((err: unknown) => log.error("Failed to end sessions on browser change:", err))
            .finally(() => {
              cdpManager.handleBrowserChange().catch((err: unknown) => {
                log.error("Failed to handle browser change:", err);
              });
            });
        });
    },
    onAuthChange: () => {
      // Re-init ToolCapability on auth change (refresh system + extension tools from gateway catalog).
      // Entitled tools come from MST store (populated by Panel's warmToolSpecs via proxy).
      (async () => {
        try {
          const rpc = getRpcClient();
          if (rpc?.isConnected()) {
            const catalog = await rpc.request<{
              groups: Array<{ tools: Array<{ id: string; source: "core" | "plugin"; pluginId?: string }> }>;
            }>("tools.catalog", { includePlugins: true });
            const catalogTools: Array<{ id: string; source: "core" | "plugin"; pluginId?: string }> = [];
            for (const group of catalog.groups ?? []) {
              for (const tool of group.tools ?? []) {
                catalogTools.push({ id: tool.id, source: tool.source, pluginId: tool.pluginId });
              }
            }
            rootStore.toolCapability.init(catalogTools, OUR_PLUGIN_IDS);
          }
          log.info(`ToolCapability auth change: re-initialized`);
        } catch (e) {
          log.warn("Failed to re-init ToolCapability on auth change:", e);
        }
      })().catch(() => {});
    },
    onAutoLaunchChange: (enabled: boolean) => {
      applyAutoLaunch(enabled);
    },
    onOAuthAcquire: async (provider: string) => {
      const proxyRouterUrl = `http://127.0.0.1:${actualProxyRouterPort}`;
      const flowId = randomUUID();

      if (provider === "openai-codex") {
        const hybrid = await startHybridCodexOAuthFlow({
          openUrl: (url) => shell.openExternal(url),
          onStatusUpdate: (msg) => log.info(`OAuth: ${msg}`),
          proxyUrl: proxyRouterUrl,
        }, vendorDir);

        const flow: PendingOAuthFlow = {
          provider,
          authUrl: hybrid.authUrl,
          status: "pending",
          _createdAt: Date.now(),
          resolveManualInput: hybrid.resolveManualInput,
          rejectManualInput: hybrid.rejectManualInput,
          completionPromise: hybrid.completionPromise,
        };

        // Background: when auto flow completes, update flow status
        hybrid.completionPromise
          .then((creds) => {
            flow.status = "completed";
            flow.creds = creds;
            log.info(`Codex OAuth auto-completed for flow ${flowId}`);
          })
          .catch((err) => {
            if (flow.status === "pending") {
              flow.status = "failed";
              flow.error = err instanceof Error ? err.message : String(err);
              log.error(`Codex OAuth failed for flow ${flowId}:`, flow.error);
            }
          });

        pendingOAuthFlows.set(flowId, flow);
        log.info(`Codex hybrid OAuth started, flowId=${flowId}`);
        return { email: undefined, tokenPreview: "", manualMode: true, authUrl: hybrid.authUrl, flowId };
      }

      // Gemini OAuth
      const hybrid = await startHybridGeminiOAuthFlow({
        onStatusUpdate: (msg) => log.info(`OAuth: ${msg}`),
        proxyUrl: proxyRouterUrl,
      });

      await shell.openExternal(hybrid.authUrl);

      const flow: PendingOAuthFlow = {
        provider,
        authUrl: hybrid.authUrl,
        status: "pending",
        _createdAt: Date.now(),
        verifier: hybrid.verifier,
        cancelCallback: hybrid.cancel,
        completionPromise: hybrid.completionPromise,
      };

      // Background: when auto callback completes, update flow status
      hybrid.completionPromise
        .then((creds) => {
          flow.status = "completed";
          flow.creds = creds;
          log.info(`Gemini OAuth auto-completed for flow ${flowId}`);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("cancelled")) {
            // Intentional cancellation (manual-complete took over)
          } else {
            flow.status = "failed";
            flow.error = msg;
            log.error(`Gemini OAuth auto-callback failed for flow ${flowId}: ${msg}`);
          }
        });

      pendingOAuthFlows.set(flowId, flow);
      log.info(`Gemini hybrid OAuth started, flowId=${flowId}`);
      return { email: undefined, tokenPreview: "", manualMode: true, authUrl: hybrid.authUrl, flowId };
    },
    onOAuthManualComplete: async (provider: string, callbackUrl: string) => {
      // Find the pending flow for this provider
      let flowId: string | undefined;
      let flow: PendingOAuthFlow | undefined;
      for (const [id, f] of pendingOAuthFlows) {
        if (f.provider === provider && (f.status === "pending" || f.status === "completed")) {
          flowId = id;
          flow = f;
          break;
        }
      }
      if (!flow || !flowId) {
        throw new Error("No pending OAuth flow. Please start the sign-in process first.");
      }

      // Auto-callback already completed — return its result directly
      if (flow.status === "completed" && flow.creds) {
        log.info(`OAuth flow ${flowId} already auto-completed, returning existing result`);
        const creds = flow.creds as AcquiredOAuthCredentials;
        return { email: creds.email, tokenPreview: creds.tokenPreview };
      }

      const proxyRouterUrl = `http://127.0.0.1:${actualProxyRouterPort}`;

      if (provider === "openai-codex") {
        // Resolve the manual input promise — the vendor's loginOpenAICodex handles the rest
        if (!flow.resolveManualInput) {
          throw new Error("Codex flow missing manual input resolver");
        }
        if (flow.status !== "pending") {
          // Auto-callback already completed — return its result
          return { email: (flow.creds as any)?.email, tokenPreview: (flow.creds as any)?.tokenPreview ?? "" };
        }
        flow.resolveManualInput(callbackUrl);
        // Wait for the vendor flow to complete with the manual input
        const creds = await flow.completionPromise!;
        flow.status = "completed";
        flow.creds = creds;
        log.info(`Codex OAuth manual-completed for flow ${flowId}`);
        return { email: (creds as AcquiredCodexOAuthCredentials).email, tokenPreview: (creds as AcquiredCodexOAuthCredentials).tokenPreview };
      }

      // Gemini: use existing completeManualOAuthFlow
      if (!flow.verifier) {
        throw new Error("Gemini flow missing verifier");
      }
      // Cancel the background callback server
      flow.cancelCallback?.();
      const acquired = await completeManualOAuthFlow(callbackUrl, flow.verifier, proxyRouterUrl);
      flow.status = "completed";
      flow.creds = acquired;
      log.info(`Gemini OAuth manual-completed for flow ${flowId}, email=${acquired.email ?? "(none)"}`);
      return { email: acquired.email, tokenPreview: acquired.tokenPreview };
    },
    onOAuthSave: async (provider: string, options: { proxyUrl?: string; label?: string; model?: string }): Promise<OAuthFlowResult> => {
      // Find completed flow for this provider
      let flowId: string | undefined;
      let flow: PendingOAuthFlow | undefined;
      for (const [id, f] of pendingOAuthFlows) {
        if (f.provider === provider && f.status === "completed" && f.creds) {
          flowId = id;
          flow = f;
          break;
        }
      }
      if (!flow || !flow.creds || !flowId) {
        throw new Error("No pending OAuth credentials. Please sign in first.");
      }
      const creds = flow.creds;

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

      const validationProxy = options.proxyUrl?.trim() || `http://127.0.0.1:${actualProxyRouterPort}`;
      let result: OAuthFlowResult;
      let activeProvider: string;

      if (provider === "openai-codex") {
        const codexCreds = creds as AcquiredCodexOAuthCredentials;
        result = await saveCodexOAuthCredentials(codexCreds.credentials, storage, secretStore, {
          proxyBaseUrl,
          proxyCredentials,
          label: options.label,
          model: options.model,
        });
        activeProvider = "openai-codex";
      } else {
        const geminiCreds = creds as AcquiredOAuthCredentials;
        const validation = await validateGeminiAccessToken(geminiCreds.credentials.access, validationProxy, geminiCreds.credentials.projectId);
        if (!validation.valid) {
          throw new Error(validation.error || "Token validation failed");
        }
        result = await saveGeminiOAuthCredentials(geminiCreds.credentials, storage, secretStore, {
          proxyBaseUrl,
          proxyCredentials,
          label: options.label,
          model: options.model,
        });
        activeProvider = "gemini";
      }

      // Clean up the flow
      pendingOAuthFlows.delete(flowId);

      // Sync auth profiles + rewrite full config.
      // Switch the active provider so buildFullGatewayConfig() picks it up.
      storage.settings.set("llm-provider", activeProvider);
      await syncAllAuthProfiles(stateDir, storage, secretStore);
      await writeProxyRouterConfig(storage, secretStore, lastSystemProxy);
      writeGatewayConfig(await buildFullGatewayConfig(actualGatewayPort));

      // Sync MST state (FIX: OAuth save was missing MST update)
      const oauthMstKeys = await allKeysToMstSnapshots(storage.providerKeys.getAll(), secretStore);
      rootStore.loadProviderKeys(oauthMstKeys);

      // Restart gateway to pick up new plugin + auth profile
      await launcher.stop();
      await launcher.start();
      return result;
    },
    onOAuthPoll: (flowId: string) => {
      const flow = pendingOAuthFlows.get(flowId);
      if (!flow) {
        return { status: "failed" as const, error: "Unknown flow" };
      }
      if (flow.status === "completed" && flow.creds) {
        return {
          status: "completed" as const,
          tokenPreview: (flow.creds as AcquiredOAuthCredentials).tokenPreview ?? "",
          email: (flow.creds as AcquiredOAuthCredentials).email,
        };
      }
      if (flow.status === "failed") {
        return { status: "failed" as const, error: flow.error };
      }
      return { status: "pending" as const };
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
    authSession,
    channelManager: rootStore.channelManager,
  });

  // Now that the panel server is bound, set the actual URL for BrowserWindow.
  if (!process.env.PANEL_DEV_URL) {
    PANEL_URL = `http://127.0.0.1:${actualPanelPort}`;
  }
  log.info(`Panel URL: ${PANEL_URL}`);

  // Sync auth profiles + build env, then start gateway.
  // System proxy and proxy router config were already written before proxyRouter.start().
  const workspacePath = stateDir;

  // Write the proxy setup CJS module once and build the NODE_OPTIONS string.
  // This is reused by all restart paths (handleSttChange, handlePermissionsChange)
  // so the --require is never accidentally dropped.
  const proxySetupPath = writeProxySetupModule(stateDir, vendorDir);
  // Quote the path — Windows usernames with spaces break unquoted --require
  const gatewayNodeOptions = `--require "${proxySetupPath.replaceAll("\\", "/")}"`;


  /**
   * Build the complete proxy env including NODE_OPTIONS.
   * Centralised so every restart path gets --require proxy-setup.cjs.
   */
  function buildFullProxyEnv(): Record<string, string> {
    const env = buildProxyEnv(actualProxyRouterPort);
    env.NODE_OPTIONS = gatewayNodeOptions;
    return env;
  }

  // Assign the late-bound config handlers now that workspacePath is available
  const configHandlers = createGatewayConfigHandlers({
    storage,
    secretStore,
    launcher,
    stateDir,
    workspacePath,
    buildFullGatewayConfig: () => buildFullGatewayConfig(actualGatewayPort),
    writeGatewayConfig,
    buildFullProxyEnv,
    sttManager,
    syncAllAuthProfiles,
    writeProxyRouterConfig,
    getLastSystemProxy: () => lastSystemProxy,
  });
  handleProviderChange = configHandlers.handleProviderChange;
  handleSttChange = configHandlers.handleSttChange;
  handleExtrasChange = configHandlers.handleExtrasChange;
  handlePermissionsChange = configHandlers.handlePermissionsChange;

  // Initialize LLM Provider Manager environment — provider key actions use these deps
  // for direct auth-profiles sync and sessions.patch (no config writes, no restart).
  initLLMProviderManagerEnv({
    storage,
    secretStore,
    getRpcClient,
    toMstSnapshot,
    allKeysToMstSnapshots,
    syncActiveKey,
    syncAllAuthProfiles,
    writeProxyRouterConfig,
    writeDefaultModelToConfig: (gwProvider: string, modelId: string) => {
      // Targeted write: only agents.defaults.model.primary.
      // Chokidar → hot reload (restart-heartbeat), NOT gateway restart.
      const configPath = resolveOpenClawConfigPath();
      const config = readExistingConfig(configPath);
      const agents = (typeof config.agents === "object" && config.agents !== null ? config.agents : {}) as Record<string, unknown>;
      const defaults = (typeof agents.defaults === "object" && agents.defaults !== null ? agents.defaults : {}) as Record<string, unknown>;
      const model = (typeof defaults.model === "object" && defaults.model !== null ? defaults.model : {}) as Record<string, unknown>;
      model.primary = `${gwProvider}/${modelId}`;
      defaults.model = model; agents.defaults = defaults; config.agents = agents;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    },
    writeFullGatewayConfig: async () => {
      writeGatewayConfig(await buildFullGatewayConfig(actualGatewayPort));
    },
    restartGateway: async () => {
      await launcher.stop();
      await launcher.start();
    },
    stateDir,
    getLastSystemProxy: () => lastSystemProxy,
  });

  Promise.all([
    syncAllAuthProfiles(stateDir, storage, secretStore),
    buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath),
  ])
    .then(([, secretEnv]) => {
      // Debug: Log which API keys are configured (without showing values)
      const configuredKeys = Object.keys(secretEnv).filter(k => k.endsWith('_API_KEY') || k.endsWith('_OAUTH_TOKEN'));
      log.info(`Initial API keys: ${configuredKeys.join(', ') || '(none)'}`);
      log.info(`Proxy router: http://127.0.0.1:${actualProxyRouterPort} (dynamic routing enabled)`);

      // Log file permissions status (without showing paths)
      if (secretEnv.RIVONCLAW_FILE_PERMISSIONS) {
        const perms = JSON.parse(secretEnv.RIVONCLAW_FILE_PERMISSIONS);
        log.info(`File permissions: workspace=${perms.workspacePath}, read=${perms.readPaths.length}, write=${perms.writePaths.length}`);
      }

      // Set env vars: API keys + proxy (incl. NODE_OPTIONS) + file permissions
      // RIVONCLAW_PANEL_PORT lets gateway plugins (e.g. capability-manager) call Desktop APIs.
      launcher.setEnv({ ...secretEnv, ...buildFullProxyEnv(), RIVONCLAW_PANEL_PORT: String(actualPanelPort) });

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

  log.info("RivonClaw desktop ready");

  // Register full cleanup for auto-updater — defined here (after all timers)
  // so the closure has access to every dependency. The auto-updater calls this
  // BEFORE quitAndInstall(), eliminating the race condition where NSIS starts
  // overwriting files while the app is still running async cleanup.
  updater.setRunFullCleanup(async () => {
    if (cleanupDone) return;

    isQuitting = true;

    // Stop all periodic timers
    clearInterval(proxyPollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    updateSubscription.disconnect();
    clearInterval(singleInstanceHeartbeat);
    removeHeartbeat();

    await Promise.all([
      launcher.stop(),
      proxyRouter.stop(),
    ]);

    cleanupGatewayLock(configPath);
    clearAllAuthProfiles(stateDir);

    try {
      await syncBackOAuthCredentials(stateDir, storage, secretStore);
    } catch (err) {
      log.error("Failed to sync back OAuth credentials:", err);
    }

    if (telemetryClient) {
      const runtimeMs = telemetryClient.getUptime();
      telemetryClient.track("app.stopped", { runtimeMs });
      await telemetryClient.shutdown();
      log.info("Telemetry client shut down gracefully");
    }

    storage.close();
    cleanupDone = true;
  });

  // Cleanup on quit — Electron does NOT await async before-quit callbacks,
  // so we must preventDefault() to pause the quit, run async cleanup, then app.exit().
  // NOTE: When auto-updater calls install(), runFullCleanup runs first and sets
  // cleanupDone=true, so this handler skips and the app exits immediately.
  app.on("before-quit", (event) => {
    isQuitting = true;

    if (cleanupDone) return; // Already cleaned up (e.g. by auto-updater), let the quit proceed
    event.preventDefault();  // Pause quit until async cleanup finishes

    // Stop all periodic timers so they don't keep the event loop alive
    clearInterval(proxyPollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    updateSubscription.disconnect();
    clearInterval(singleInstanceHeartbeat);
    removeHeartbeat();

    const cleanup = async () => {
      // Disconnect cloud OAuth subscription
      oauthSubscription.disconnect();

      // Shutdown managed browser service (ends all managed profile sessions)
      await managedBrowserService.shutdown();

      // Flush any remaining sessions (e.g., CDP compatibility sessions)
      await sessionStateStack.lifecycleManager.endAllSessions();

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
    const SHUTDOWN_TIMEOUT_MS = DEFAULTS.desktop.shutdownTimeoutMs;
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
