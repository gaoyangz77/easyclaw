import { writeFileSync, existsSync } from "node:fs";
import { createLogger } from "@rivonclaw/logger";
import { getApiBaseUrl } from "@rivonclaw/core";
import { resolveOpenClawStateDir as resolveDefaultStateDir } from "@rivonclaw/core/node";
import { resolveOpenClawConfigPath, readExistingConfig, resolveOpenClawStateDir, syncPermissions } from "@rivonclaw/gateway";
import { API } from "@rivonclaw/core/api-contract";
import type { RouteRegistry, EndpointHandler } from "../infra/api/route-registry.js";
import type { ApiContext } from "../app/api-context.js";
import { sendJson, parseBody } from "../infra/api/route-utils.js";
import { runtimeStatusStore } from "../app/store/runtime-status-store.js";

const log = createLogger("settings-routes");

// ── GET /api/status ──

const appStatus: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const ruleCount = ctx.storage.rules.getAll().length;
  const artifactCount = ctx.storage.artifacts.getAll().length;
  sendJson(res, 200, { status: "ok", ruleCount, artifactCount, deviceId: ctx.deviceId ?? null });
};

// ── GET /api/app/api-base-url ──

const apiBaseUrl: EndpointHandler = async (_req, res, _url, _params, _ctx) => {
  sendJson(res, 200, { apiBaseUrl: getApiBaseUrl("en") });
};

// ── GET /api/app/update ──

const appUpdate: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const result = ctx.getUpdateResult?.();
  sendJson(res, 200, {
    updateAvailable: result?.updateAvailable ?? false,
    currentVersion: result?.currentVersion ?? null,
    latestVersion: result?.latestVersion ?? null,
    downloadUrl: result?.downloadUrl ?? null,
  });
};

// ── GET /api/app/gateway-info ──

const gatewayInfo: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const info = ctx.getGatewayInfo?.();
  sendJson(res, 200, info ?? { wsUrl: `ws://127.0.0.1:${ctx.gatewayPort}` });
};

// ── GET /api/settings ──

const getAll: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const { storage, secretStore } = ctx;
  const settings = storage.settings.getAll();
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    masked[key] = value;
  }

  const provider = settings["llm-provider"];
  if (provider) {
    const secretKey = `${provider}-api-key`;
    const legacyKey = await secretStore.get(secretKey);
    const hasLegacyKey = legacyKey !== null && legacyKey !== "";
    const hasProviderKey = storage.providerKeys.getAll()
      .some((k) => k.provider === provider);
    if (hasLegacyKey || hasProviderKey) {
      masked[secretKey] = "configured";
    }
  }

  sendJson(res, 200, { settings: masked });
};

// ── PUT /api/settings ──

const updateSettings: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const { storage, secretStore, onProviderChange, onSttChange, onPermissionsChange, onBrowserChange } = ctx;
  const body = (await parseBody(req)) as Record<string, string>;
  let legacyKeyChanged = false;
  let sttChanged = false;
  let permissionsChanged = false;
  let browserChanged = false;
  for (const [key, value] of Object.entries(body)) {
    if (typeof key === "string" && typeof value === "string") {
      if (key.endsWith("-api-key")) {
        if (value) {
          await secretStore.set(key, value);
        } else {
          await secretStore.delete(key);
        }
        legacyKeyChanged = true;
      } else {
        storage.settings.set(key, value);
        // Note: "llm-provider" setting changes no longer trigger onProviderChange here.
        // Provider activation is now handled by llmManager.activateProvider() which
        // does sessions.patch + auth-profiles + config write directly.
        if (key === "stt.enabled" || key === "stt.provider") {
          sttChanged = true;
        }
        if (key === "file-permissions-full-access") {
          permissionsChanged = true;
        }
        if (key === "browser-mode") {
          browserChanged = true;
        }
      }
    }
  }
  runtimeStatusStore.updateAppSettings(body);
  sendJson(res, 200, { ok: true });
  // Legacy API key changes still need provider change handler for env var sync
  if (legacyKeyChanged) onProviderChange?.();
  if (sttChanged) onSttChange?.();
  if (permissionsChanged) onPermissionsChange?.();
  if (browserChanged) onBrowserChange?.();
};

// ── POST /api/settings/validate-key ──

const validateKey: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const { validateProviderApiKey } = await import("../providers/provider-validator.js");
  const body = (await parseBody(req)) as { provider?: string; apiKey?: string; proxyUrl?: string; model?: string };
  if (!body.provider || !body.apiKey) {
    sendJson(res, 400, { valid: false, error: "Missing provider or apiKey" });
    return;
  }
  const result = await validateProviderApiKey(body.provider, body.apiKey, ctx.proxyRouterPort, body.proxyUrl || undefined, body.model || undefined);
  sendJson(res, 200, result);
};

// ── POST /api/settings/validate-custom-key ──

const validateCustomKey: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const { validateCustomProviderApiKey } = await import("../providers/provider-validator.js");
  const body = (await parseBody(req)) as { baseUrl?: string; apiKey?: string; protocol?: string; model?: string };
  if (!body.baseUrl || !body.apiKey || !body.protocol || !body.model) {
    sendJson(res, 400, { valid: false, error: "Missing required fields" });
    return;
  }
  const result = await validateCustomProviderApiKey(
    body.baseUrl, body.apiKey, body.protocol as "openai" | "anthropic", body.model, ctx.proxyRouterPort,
  );
  sendJson(res, 200, result);
};

// ── GET /api/settings/telemetry ──

const getTelemetry: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const enabledStr = ctx.storage.settings.get("telemetry_enabled");
  const enabled = enabledStr !== "false";
  sendJson(res, 200, { enabled });
};

// ── PUT /api/settings/telemetry ──

const setTelemetry: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    sendJson(res, 400, { error: "Missing required field: enabled (boolean)" });
    return;
  }
  ctx.storage.settings.set("telemetry_enabled", body.enabled ? "true" : "false");
  runtimeStatusStore.updateAppSetting("telemetry_enabled", body.enabled ? "true" : "false");
  sendJson(res, 200, { ok: true });
};

// ── GET /api/settings/auto-launch ──

const getAutoLaunch: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const enabled = ctx.storage.settings.get("auto_launch_enabled") === "true";
  sendJson(res, 200, { enabled });
};

// ── PUT /api/settings/auto-launch ──

const setAutoLaunch: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    sendJson(res, 400, { error: "Missing required field: enabled (boolean)" });
    return;
  }
  ctx.storage.settings.set("auto_launch_enabled", body.enabled ? "true" : "false");
  runtimeStatusStore.updateAppSetting("auto_launch_enabled", body.enabled ? "true" : "false");
  ctx.onAutoLaunchChange?.(body.enabled);
  sendJson(res, 200, { ok: true });
};

// ── POST /api/telemetry/track ──

const telemetryTrack: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const PANEL_EVENT_ALLOWLIST = new Set([
    "onboarding.started",
    "onboarding.provider_saved",
    "onboarding.completed",
    "panel.page_viewed",
    "chat.message_sent",
    "chat.response_received",
    "chat.generation_stopped",
    "chat.session_created",
    "chat.session_switched",
    "chat.session_archived",
    "chat.session_restored",
    "chat.model_switched",
    "rule.preset_used",
    "rule.deleted",
    "rule.edited",
    "channel.account_added",
    "channel.account_deleted",
    "provider.key_added",
    "provider.key_deleted",
    "provider.key_activated",
    "settings.dm_scope_changed",
    "settings.auto_launch_toggled",
    "settings.browser_mode_changed",
    "settings.privacy_mode_toggled",
    "settings.accent_color_changed",
    "settings.session_state_cdp_toggled",
    "settings.state_dir_reset",
    "cron.created",
    "cron.deleted",
    "cron.toggled",
    "cron.run_now",
    "permission.path_added",
    "permission.path_removed",
    "permission.full_access_toggled",
    "stt.provider_saved",
    // Extras Events
    "extras.stt.saved",
    "extras.webSearch.saved",
    "extras.embedding.saved",
    "ui.theme_changed",
    "ui.language_changed",
    "cs.configured",
    "cs.toggled",
    "skills.install",
    "skills.delete",
    "telemetry.toggled",
    // Browser Profiles Events
    "browser_profile.created",
    "browser_profile.updated",
    "browser_profile.deleted",
    "browser_profile.archived",
    "browser_profile.proxy_tested",
    "browser_profile.data_cleaned",
    // Auth Events
    "auth.login",
    "auth.register",
    "auth.logout",
  ]);
  const body = (await parseBody(req)) as { eventType?: string; metadata?: Record<string, unknown> };
  if (!body.eventType || !PANEL_EVENT_ALLOWLIST.has(body.eventType)) {
    res.writeHead(204);
    res.end();
    return;
  }
  ctx.onTelemetryTrack?.(body.eventType, body.metadata);
  res.writeHead(204);
  res.end();
};

// ── POST /api/telemetry/cs-track ──
//
// Relays CS business-event emits from the gateway-side merchant plugins to
// Desktop's CS telemetry client (which then ships to the CS BI ClickHouse
// stream). Plugins run out-of-process — they cannot hold a reference to
// the Desktop `RemoteTelemetryClient` directly, so they POST here through
// the existing extension→panel-server HTTP path.
//
// The route applies a small, deliberate allowlist: only the three BI event
// types we ingest into dedicated CH tables (`cs.message`, `cs.token_snapshot`,
// `cs.tool_call`) are accepted. Anything else is a silent 204 drop. This
// prevents a misconfigured plugin from flooding the CS stream with noise.
const CS_EVENT_ALLOWLIST = new Set(["cs.message", "cs.token_snapshot", "cs.tool_call"]);

const telemetryCsTrack: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as { eventType?: string; metadata?: Record<string, unknown> };
  if (!body.eventType || !CS_EVENT_ALLOWLIST.has(body.eventType)) {
    res.writeHead(204);
    res.end();
    return;
  }
  ctx.onCsTelemetryTrack?.(body.eventType, body.metadata);
  res.writeHead(204);
  res.end();
};

// ── GET /api/agent-settings ──

const getAgentSettings: EndpointHandler = async (_req, res, _url, _params, _ctx) => {
  try {
    const configPath = resolveOpenClawConfigPath();
    const fullConfig = readExistingConfig(configPath);
    const sessionCfg = typeof fullConfig.session === "object" && fullConfig.session !== null
      ? (fullConfig.session as Record<string, unknown>)
      : {};
    sendJson(res, 200, {
      dmScope: (sessionCfg.dmScope as string) ?? "main",
    });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
};

// ── PUT /api/agent-settings ──

const setAgentSettings: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const configPath = resolveOpenClawConfigPath();
    const fullConfig = readExistingConfig(configPath);
    const existingSession = typeof fullConfig.session === "object" && fullConfig.session !== null
      ? (fullConfig.session as Record<string, unknown>)
      : {};

    if (body.dmScope !== undefined) {
      existingSession.dmScope = body.dmScope;
    }

    fullConfig.session = existingSession;
    writeFileSync(configPath, JSON.stringify(fullConfig, null, 2) + "\n", "utf-8");

    ctx.onProviderChange?.({ configOnly: true });

    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
};

// ── GET /api/extras/credentials ──

const getExtrasCredentials: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  try {
    const webSearchKeys: Record<string, boolean> = {};
    for (const p of ["brave", "perplexity", "grok", "gemini", "kimi"]) {
      webSearchKeys[p] = !!(await ctx.secretStore.get(`websearch-${p}-apikey`));
    }

    const embeddingKeys: Record<string, boolean> = {};
    for (const p of ["openai", "gemini", "voyage", "mistral"]) {
      embeddingKeys[p] = !!(await ctx.secretStore.get(`embedding-${p}-apikey`));
    }

    sendJson(res, 200, {
      webSearch: webSearchKeys,
      embedding: embeddingKeys,
    });
  } catch (err) {
    log.error("Failed to check extras credentials", err);
    sendJson(res, 500, { error: "Failed to check credentials" });
  }
};

// ── PUT /api/extras/credentials ──

const setExtrasCredentials: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as {
    type?: string;
    provider?: string;
    apiKey?: string;
  };

  if (!body.type || !body.provider || !body.apiKey) {
    sendJson(res, 400, { error: "Missing type, provider, or apiKey" });
    return;
  }

  try {
    const validWebSearchProviders = ["brave", "perplexity", "grok", "gemini", "kimi"];
    const validEmbeddingProviders = ["openai", "gemini", "voyage", "mistral"];

    let secretKey: string;
    if (body.type === "webSearch") {
      if (!validWebSearchProviders.includes(body.provider)) {
        sendJson(res, 400, { error: "Unknown web search provider" });
        return;
      }
      secretKey = `websearch-${body.provider}-apikey`;
    } else if (body.type === "embedding") {
      if (!validEmbeddingProviders.includes(body.provider)) {
        sendJson(res, 400, { error: "Unknown embedding provider" });
        return;
      }
      secretKey = `embedding-${body.provider}-apikey`;
    } else {
      sendJson(res, 400, { error: "Unknown type" });
      return;
    }

    await ctx.secretStore.set(secretKey, body.apiKey);
    sendJson(res, 200, { ok: true });
    ctx.onExtrasChange?.();
    ctx.onTelemetryTrack?.("extras.configured", { type: body.type, provider: body.provider });
  } catch (err) {
    log.error("Failed to save extras credentials", err);
    sendJson(res, 500, { error: "Failed to save credentials" });
  }
};

// ── GET /api/stt/credentials ──

const getSttCredentials: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  try {
    const hasGroqKey = !!(await ctx.secretStore.get("stt-groq-apikey"));
    const hasVolcengineAppKey = !!(await ctx.secretStore.get("stt-volcengine-appkey"));
    const hasVolcengineAccessKey = !!(await ctx.secretStore.get("stt-volcengine-accesskey"));

    sendJson(res, 200, {
      groq: hasGroqKey,
      volcengine: hasVolcengineAppKey && hasVolcengineAccessKey,
    });
  } catch (err) {
    log.error("Failed to check STT credentials", err);
    sendJson(res, 500, { error: "Failed to check credentials" });
  }
};

// ── PUT /api/stt/credentials ──

const setSttCredentials: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
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
      await ctx.secretStore.set("stt-groq-apikey", body.apiKey);
    } else if (body.provider === "volcengine") {
      if (!body.appKey || !body.accessKey) {
        sendJson(res, 400, { error: "Missing appKey or accessKey for Volcengine provider" });
        return;
      }
      await ctx.secretStore.set("stt-volcengine-appkey", body.appKey);
      await ctx.secretStore.set("stt-volcengine-accesskey", body.accessKey);
    } else {
      sendJson(res, 400, { error: "Unknown provider" });
      return;
    }

    sendJson(res, 200, { ok: true });
    ctx.onSttChange?.();
    ctx.onTelemetryTrack?.("stt.configured", { provider: body.provider });
  } catch (err) {
    log.error("Failed to save STT credentials", err);
    sendJson(res, 500, { error: "Failed to save credentials" });
  }
};

// ── POST /api/stt/transcribe ──

const sttTranscribe: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  if (!ctx.sttManager || !ctx.sttManager.isEnabled()) {
    sendJson(res, 503, { error: "STT service not enabled or not configured" });
    return;
  }

  const body = (await parseBody(req)) as {
    audio?: string;
    format?: string;
  };

  if (!body.audio || !body.format) {
    sendJson(res, 400, { error: "Missing audio or format" });
    return;
  }

  try {
    const audioBuffer = Buffer.from(body.audio, "base64");
    const text = await ctx.sttManager.transcribe(audioBuffer, body.format);

    if (text === null) {
      sendJson(res, 500, { error: "Transcription failed" });
      return;
    }

    sendJson(res, 200, {
      text,
      provider: ctx.sttManager.getProvider(),
    });
  } catch (err) {
    log.error("STT transcription error", err);
    sendJson(res, 500, { error: "Transcription failed: " + String(err) });
  }
};

// ── GET /api/stt/status ──

const sttStatus: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const enabled = ctx.sttManager?.isEnabled() ?? false;
  const provider = ctx.sttManager?.getProvider() ?? null;
  sendJson(res, 200, { enabled, provider });
};

// ── GET /api/permissions ──

const getPermissions: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const permissions = ctx.storage.permissions.get();
  sendJson(res, 200, { permissions });
};

// ── PUT /api/permissions ──

const updatePermissions: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as { readPaths?: string[]; writePaths?: string[] };
  const permissions = ctx.storage.permissions.update({
    readPaths: body.readPaths ?? [],
    writePaths: body.writePaths ?? [],
  });

  try {
    syncPermissions(permissions);
    log.info("Synced filesystem permissions to OpenClaw config");

    ctx.onPermissionsChange?.();
    ctx.onTelemetryTrack?.("permissions.updated", {
      readCount: (body.readPaths ?? []).length,
      writeCount: (body.writePaths ?? []).length,
    });
  } catch (err) {
    log.error("Failed to sync permissions to OpenClaw:", err);
  }

  sendJson(res, 200, { permissions });
};

// ── GET /api/settings/openclaw-state-dir ──

const getOpenclawStateDir: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const override = ctx.storage.settings.get("openclaw_state_dir_override") || null;
  const effective = resolveOpenClawStateDir();
  const defaultDir = resolveDefaultStateDir({});
  sendJson(res, 200, { override, effective, default: defaultDir });
};

// ── PUT /api/settings/openclaw-state-dir ──

const setOpenclawStateDir: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as { path?: string };
  if (!body.path || typeof body.path !== "string") {
    sendJson(res, 400, { error: "Missing required field: path (string)" });
    return;
  }
  const dir = body.path.trim();
  if (!existsSync(dir)) {
    sendJson(res, 400, { error: "Directory does not exist" });
    return;
  }
  ctx.storage.settings.set("openclaw_state_dir_override", dir);
  log.info(`OpenClaw state dir override set to: ${dir} (restart required)`);
  sendJson(res, 200, { ok: true, restartRequired: true });
};

// ── DELETE /api/settings/openclaw-state-dir ──

const deleteOpenclawStateDir: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  ctx.storage.settings.delete("openclaw_state_dir_override");
  ctx.storage.settings.delete("openclaw_import_checked");
  log.info("OpenClaw state dir override cleared (restart required)");
  sendJson(res, 200, { ok: true, restartRequired: true });
};

// ── GET /api/workspace ──

const getWorkspace: EndpointHandler = async (_req, res, _url, _params, _ctx) => {
  const workspacePath = resolveOpenClawStateDir();
  sendJson(res, 200, { workspacePath });
};

// ── POST /api/file-dialog ──

const openFileDialog: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  if (!ctx.onOpenFileDialog) {
    sendJson(res, 501, { error: "File dialog not available" });
    return;
  }
  const selected = await ctx.onOpenFileDialog();
  sendJson(res, 200, { path: selected });
};

// ── Registration ──

export function registerSettingsHandlers(registry: RouteRegistry): void {
  // App / Status
  registry.register(API["app.status"], appStatus);
  registry.register(API["app.apiBaseUrl"], apiBaseUrl);
  registry.register(API["app.update"], appUpdate);
  registry.register(API["app.gatewayInfo"], gatewayInfo);

  // Settings
  registry.register(API["settings.getAll"], getAll);
  registry.register(API["settings.update"], updateSettings);
  registry.register(API["settings.validateKey"], validateKey);
  registry.register(API["settings.validateCustomKey"], validateCustomKey);

  // Telemetry settings
  registry.register(API["settings.telemetry.get"], getTelemetry);
  registry.register(API["settings.telemetry.set"], setTelemetry);

  // Auto-launch settings
  registry.register(API["settings.autoLaunch.get"], getAutoLaunch);
  registry.register(API["settings.autoLaunch.set"], setAutoLaunch);

  // Telemetry tracking
  registry.register(API["telemetry.track"], telemetryTrack);
  registry.register(API["telemetry.cs.track"], telemetryCsTrack);

  // Agent settings
  registry.register(API["agentSettings.get"], getAgentSettings);
  registry.register(API["agentSettings.set"], setAgentSettings);

  // Extras credentials
  registry.register(API["extras.credentials.get"], getExtrasCredentials);
  registry.register(API["extras.credentials.set"], setExtrasCredentials);

  // STT
  registry.register(API["stt.credentials.get"], getSttCredentials);
  registry.register(API["stt.credentials.set"], setSttCredentials);
  registry.register(API["stt.transcribe"], sttTranscribe);
  registry.register(API["stt.status"], sttStatus);

  // Permissions
  registry.register(API["permissions.get"], getPermissions);
  registry.register(API["permissions.update"], updatePermissions);

  // OpenClaw state dir
  registry.register(API["settings.openclawStateDir.get"], getOpenclawStateDir);
  registry.register(API["settings.openclawStateDir.set"], setOpenclawStateDir);
  registry.register(API["settings.openclawStateDir.delete"], deleteOpenclawStateDir);

  // Workspace & file dialog
  registry.register(API["workspace.get"], getWorkspace);
  registry.register(API["fileDialog.open"], openFileDialog);
}
