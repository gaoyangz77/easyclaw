import type { LLMProvider } from "@rivonclaw/core";
import { getDefaultModelForProvider, reconstructProxyUrl, formatError, isReauthSupportedProvider } from "@rivonclaw/core";
import { applyCatalogContextMetadata, readFullModelCatalog } from "@rivonclaw/gateway";
import { API } from "@rivonclaw/core/api-contract";
import { createLogger } from "@rivonclaw/logger";
import { validateProviderApiKey, validateCustomProviderApiKey, fetchCustomProviderModels } from "./provider-validator.js";
import { rootStore } from "../app/store/desktop-store.js";
import type { RouteRegistry, EndpointHandler } from "../infra/api/route-registry.js";
import type { ApiContext } from "../app/api-context.js";
import { sendJson, parseBody } from "../infra/api/route-utils.js";

const log = createLogger("provider-routes");

// ── GET /api/provider-keys ──

const listKeys: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const { storage, secretStore } = ctx;
  const keys = storage.providerKeys.getAll();

  const keysWithProxy = await Promise.all(
    keys.map(async (key) => {
      if (!key.proxyBaseUrl) {
        return key;
      }
      const credentials = await secretStore.get(`proxy-auth-${key.id}`);
      const proxyUrl = credentials ? reconstructProxyUrl(key.proxyBaseUrl, credentials) : key.proxyBaseUrl;
      return { ...key, proxyUrl };
    })
  );

  sendJson(res, 200, { keys: keysWithProxy });
};

// ── POST /api/provider-keys ──

const createKey: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const { storage, onTelemetryTrack } = ctx;
  const body = (await parseBody(req)) as {
    provider?: string;
    label?: string;
    model?: string;
    apiKey?: string;
    proxyUrl?: string;
    authType?: "api_key" | "oauth" | "local" | "custom";
    baseUrl?: string;
    customProtocol?: "openai" | "anthropic";
    customModelsJson?: string;
    inputModalities?: string[];
  };

  const isLocal = body.authType === "local";
  const isCustom = body.authType === "custom";

  if (!body.provider) {
    sendJson(res, 400, { error: "Missing required field: provider" });
    return;
  }
  if (!isLocal && !body.apiKey) {
    sendJson(res, 400, { error: "Missing required field: apiKey" });
    return;
  }

  if (isCustom) {
    // Custom provider validation
    if (!body.baseUrl || !body.customProtocol || !body.customModelsJson) {
      sendJson(res, 400, { error: "Custom providers require baseUrl, customProtocol, and customModelsJson" });
      return;
    }
    let rawModels: Array<string | { id: string }>;
    try {
      rawModels = JSON.parse(body.customModelsJson);
      if (!Array.isArray(rawModels) || rawModels.length === 0) throw new Error("empty");
    } catch {
      sendJson(res, 400, { error: "customModelsJson must be a non-empty JSON array of model IDs" });
      return;
    }
    const firstModelId = typeof rawModels[0] === "string" ? rawModels[0] : rawModels[0].id;
    const validation = await validateCustomProviderApiKey(
      body.baseUrl, body.apiKey!, body.customProtocol, firstModelId, ctx.proxyRouterPort, body.proxyUrl || undefined,
    );
    if (!validation.valid) {
      sendJson(res, 422, { error: validation.error || "Invalid API key" });
      return;
    }
  } else if (!isLocal) {
    const validation = await validateProviderApiKey(body.provider, body.apiKey!, ctx.proxyRouterPort, body.proxyUrl || undefined, body.model || undefined);
    if (!validation.valid) {
      sendJson(res, 422, { error: validation.error || "Invalid API key" });
      return;
    }
  }

  const model = body.model || (isCustom ? "" : getDefaultModelForProvider(body.provider as LLMProvider)?.modelId) || "";
  const label = body.label || "Default";

  // Proxy URL validation (fail fast before MST action)
  if (body.proxyUrl?.trim()) {
    try {
      const { parseProxyUrl } = await import("@rivonclaw/core");
      parseProxyUrl(body.proxyUrl.trim());
    } catch (error) {
      sendJson(res, 400, { error: `Invalid proxy URL: ${formatError(error)}` });
      return;
    }
  }

  // LLM Manager action: full create transaction (SQLite + Keychain + syncActiveKey + MST state + auth-profiles + sessions.patch + config)
  const { entry, shouldActivate } = await rootStore.llmManager.createKey({
    provider: body.provider,
    label,
    model,
    apiKey: body.apiKey,
    proxyUrl: body.proxyUrl,
    authType: body.authType,
    baseUrl: body.baseUrl,
    customProtocol: body.customProtocol,
    customModelsJson: body.customModelsJson,
    inputModalities: body.inputModalities,
  });

  onTelemetryTrack?.("provider.key_added", { provider: body.provider, isFirst: shouldActivate });

  sendJson(res, 201, entry);
};

// ── POST /api/provider-keys/:id/activate ──

const activateKey: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const { storage, onTelemetryTrack, snapshotEngine } = ctx;
  const id = params.id!;
  const entry = storage.providerKeys.getById(id);
  if (!entry) {
    sendJson(res, 404, { error: "Key not found" });
    return;
  }

  // Usage tracking (stays in route handler — API-layer concern)
  const oldActive = storage.providerKeys.getActive();
  if (oldActive && snapshotEngine) {
    await snapshotEngine.recordDeactivation(oldActive.id, oldActive.provider, oldActive.model);
  }
  if (snapshotEngine) {
    await snapshotEngine.recordActivation(entry.id, entry.provider, entry.model);
  }

  // LLM Manager action: full activate transaction (sessions.patch + auth-profiles + config)
  await rootStore.llmManager.activateProvider(id);

  onTelemetryTrack?.("provider.activated", { provider: entry.provider });

  sendJson(res, 200, { ok: true });
};

// ── POST /api/provider-keys/:id/usage/fetch ──

const fetchKeyUsage: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const { storage } = ctx;
  const id = params.id!;
  const entry = storage.providerKeys.getById(id);
  if (!entry) {
    sendJson(res, 404, { error: "Key not found" });
    return;
  }

  try {
    // LLM Manager action: fetches the provider quota, writes the result into
    // MST on the matching key entry. The snapshot reaches Panel via SSE patch —
    // this endpoint's only job is to return 200 on a successful trigger.
    await rootStore.llmManager.fetchKeyUsage(id);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    // Configuration errors (unsupported provider, key not found) — surface as 400
    // so the Panel can log/toast. Network/HTTP errors are captured into MST.usage.error
    // by fetchKeyUsage itself and do NOT reach this catch.
    const message = formatError(err);
    log.warn(`fetchKeyUsage failed for ${id}: ${message}`);
    sendJson(res, 400, { error: message });
  }
};

// ── POST /api/provider-keys/:id/refresh-models ──

const refreshModels: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const { storage, secretStore } = ctx;
  const id = params.id!;
  const entry = storage.providerKeys.getById(id);
  if (!entry) {
    sendJson(res, 404, { error: "Key not found" });
    return;
  }
  if (entry.authType !== "custom" || entry.customProtocol !== "openai") {
    sendJson(res, 400, { error: "Refresh models is only supported for custom OpenAI-compatible providers" });
    return;
  }
  if (!entry.baseUrl) {
    sendJson(res, 400, { error: "Custom provider is missing baseUrl" });
    return;
  }
  const apiKey = await secretStore.get(`provider-key-${id}`);
  if (!apiKey) {
    sendJson(res, 400, { error: "No API key found for this provider" });
    return;
  }

  let proxyUrl: string | undefined;
  if (entry.proxyBaseUrl) {
    const credentials = await secretStore.get(`proxy-auth-${id}`);
    proxyUrl = credentials ? reconstructProxyUrl(entry.proxyBaseUrl, credentials) : entry.proxyBaseUrl;
  }

  const result = await fetchCustomProviderModels(entry.baseUrl, apiKey, ctx.proxyRouterPort, proxyUrl);
  if (result.error) {
    sendJson(res, 422, { error: result.error });
    return;
  }

  // LLM Manager action: refresh models transaction (includes auth-profiles sync for active keys)
  const updated = await rootStore.llmManager.refreshModels(id, result.models!);

  sendJson(res, 200, updated);
};

// ── PUT /api/provider-keys/:id ──

const updateKey: EndpointHandler = async (req, res, _url, params, ctx: ApiContext) => {
  const { storage, snapshotEngine } = ctx;
  const id = params.id!;
  const body = (await parseBody(req)) as { label?: string; model?: string; proxyUrl?: string; baseUrl?: string; inputModalities?: string[]; customModelsJson?: string; apiKey?: string };
  const existing = storage.providerKeys.getById(id);
  if (!existing) {
    sendJson(res, 404, { error: "Key not found" });
    return;
  }

  // Proxy URL validation (fail fast before MST action)
  if (body.proxyUrl !== undefined && body.proxyUrl !== "" && body.proxyUrl !== null) {
    try {
      const { parseProxyUrl } = await import("@rivonclaw/core");
      parseProxyUrl(body.proxyUrl.trim());
    } catch (error) {
      sendJson(res, 400, { error: `Invalid proxy URL: ${formatError(error)}` });
      return;
    }
  }

  // Usage tracking (stays in route handler — API-layer concern)
  const modelChanging = !!(body.model && body.model !== existing.model);
  if (modelChanging && existing.isDefault && snapshotEngine) {
    await snapshotEngine.recordDeactivation(existing.id, existing.provider, existing.model);
  }

  // LLM Manager action: full update transaction (sessions.patch + auth-profiles + config)
  const { updated } = await rootStore.llmManager.updateKey(id, {
    label: body.label,
    model: body.model,
    apiKey: body.apiKey,
    proxyUrl: body.proxyUrl,
    baseUrl: body.baseUrl,
    inputModalities: body.inputModalities,
    customModelsJson: body.customModelsJson,
  });

  if (modelChanging && existing.isDefault && snapshotEngine && body.model) {
    await snapshotEngine.recordActivation(existing.id, existing.provider, body.model);
  }

  sendJson(res, 200, updated);
};

// ── DELETE /api/provider-keys/:id ──

const deleteKey: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const { storage } = ctx;
  const id = params.id!;
  const existing = storage.providerKeys.getById(id);
  if (!existing) {
    sendJson(res, 404, { error: "Key not found" });
    return;
  }

  // LLM Manager action: full delete transaction (SQLite + Keychain + promotion + syncActiveKey + MST state + auth-profiles + sessions.patch + config)
  await rootStore.llmManager.deleteKey(id);

  sendJson(res, 200, { ok: true });
};

// ── POST /api/provider-keys/:id/reauth ──

const reauthKey: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const { storage } = ctx;
  const id = params.id!;
  const entry = storage.providerKeys.getById(id);
  if (!entry) {
    sendJson(res, 404, { error: "Key not found" });
    return;
  }
  if (entry.authType !== "oauth" || !isReauthSupportedProvider(entry.provider as LLMProvider)) {
    sendJson(res, 400, { error: "Re-authenticate is only supported for OAuth subscription keys (Codex / Gemini)" });
    return;
  }
  if (!ctx.onOAuthReauth) {
    sendJson(res, 501, { error: "OAuth re-auth not available" });
    return;
  }
  try {
    const result = await ctx.onOAuthReauth(id);
    // The updated row (refreshed oauthExpiresAt + updatedAt) flows back via
    // SSE. We still echo `idTokenCaptureFailed` here so the Panel can warn
    // the user about the narrow OAuth-rotation race window.
    sendJson(res, 200, { ok: true, idTokenCaptureFailed: result.idTokenCaptureFailed });
  } catch (err) {
    log.error("OAuth re-auth failed:", err);
    const message = formatError(err);
    const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
    // "No pending OAuth" is a user-fixable 400 (they need to sign in first).
    // Anything else is a genuine 500 from credential rotation.
    const status = message.includes("No pending OAuth") ? 400 : 500;
    sendJson(res, status, { error: message, detail });
  }
};

// ── GET /api/session-model ──

const getSessionModel: EndpointHandler = async (_req, res, url, _params, _ctx) => {
  const sessionKey = url.searchParams.get("sessionKey");
  if (!sessionKey) {
    sendJson(res, 400, { error: "Missing sessionKey query param" });
    return;
  }
  rootStore.llmManager.trackSessionActivity(sessionKey);
  const info = rootStore.llmManager.getSessionModelInfo(sessionKey);
  sendJson(res, 200, info);
};

// ── PUT /api/session-model ──

const setSessionModel: EndpointHandler = async (req, res, _url, _params, _ctx) => {
  const body = (await parseBody(req)) as { sessionKey?: string; provider?: string; model?: string };
  if (!body.sessionKey) {
    sendJson(res, 400, { error: "Missing required field: sessionKey" });
    return;
  }
  try {
    if (!body.provider || !body.model) {
      // Reset to global default
      await rootStore.llmManager.resetSessionModel(body.sessionKey);
      sendJson(res, 200, { ok: true, sessionKey: body.sessionKey, provider: null, model: null });
    } else {
      await rootStore.llmManager.switchModelForSession(body.sessionKey, body.provider, body.model);
      sendJson(res, 200, { ok: true, sessionKey: body.sessionKey, provider: body.provider, model: body.model });
    }
  } catch (err) {
    sendJson(res, 500, { error: formatError(err) || "Failed to switch session model" });
  }
};

// ── POST /api/custom-provider/fetch-models ──

const fetchCustomModels: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as {
    baseUrl?: string;
    apiKey?: string;
    protocol?: string;
    proxyUrl?: string;
  };
  if (!body.baseUrl || !body.apiKey) {
    sendJson(res, 400, { error: "Missing required fields: baseUrl, apiKey" });
    return;
  }
  if (body.protocol !== "openai") {
    sendJson(res, 400, { error: "Model fetching is only supported for OpenAI-compatible providers" });
    return;
  }
  const result = await fetchCustomProviderModels(body.baseUrl, body.apiKey, ctx.proxyRouterPort, body.proxyUrl || undefined);
  if (result.error) {
    sendJson(res, 422, { error: result.error });
    return;
  }
  sendJson(res, 200, { models: result.models });
};

// ── GET /api/local-models/detect ──

const detectLocalModels: EndpointHandler = async (_req, res, _url, _params, _ctx) => {
  const { detectLocalServers } = await import("./local-model-detector.js");
  const servers = await detectLocalServers();
  sendJson(res, 200, { servers });
};

// ── GET /api/local-models/models ──

const listLocalModels: EndpointHandler = async (_req, res, url, _params, _ctx) => {
  const baseUrl = url.searchParams.get("baseUrl");
  if (!baseUrl) {
    sendJson(res, 400, { error: "Missing required parameter: baseUrl" });
    return;
  }
  const { fetchOllamaModels } = await import("./local-model-fetcher.js");
  const models = await fetchOllamaModels(baseUrl);
  sendJson(res, 200, { models });
};

// ── POST /api/local-models/health ──

const localModelsHealth: EndpointHandler = async (req, res, _url, _params, _ctx) => {
  const body = (await parseBody(req)) as { baseUrl?: string };
  if (!body.baseUrl) {
    sendJson(res, 400, { error: "Missing required field: baseUrl" });
    return;
  }
  const { checkHealth } = await import("./local-model-fetcher.js");
  const result = await checkHealth(body.baseUrl);
  sendJson(res, 200, result);
};

// ── GET /api/models ──

const modelCatalog: EndpointHandler = async (_req, res, _url, _params, ctx: ApiContext) => {
  const { storage, vendorDir } = ctx;
  const catalog = await readFullModelCatalog(undefined, vendorDir);

  // Custom providers store their model list in customModelsJson but
  // readFullModelCatalog only covers built-in providers.  The gateway's
  // models.json is updated asynchronously after restart, so right after
  // a custom provider is created the catalog won't include its models yet.
  // Inject them from storage to close this race window.
  const allKeys = storage.providerKeys.getAll();
  for (const key of allKeys) {
    if (key.customModelsJson) {
      try {
        const rawModels: Array<string | { id: string }> = JSON.parse(key.customModelsJson);
        const existing = catalog[key.provider] ?? [];
        const existingIds = new Set(existing.map((e) => e.id));
        const extras = rawModels
          .map((m) => typeof m === "string" ? m : m.id)
          .filter((id) => !existingIds.has(id))
          .map((id) => applyCatalogContextMetadata(key.provider, { id, name: id }));
        if (extras.length > 0) {
          catalog[key.provider] = [...existing, ...extras];
        }
      } catch {
        // Invalid JSON in customModelsJson — skip
      }
    }
  }

  sendJson(res, 200, { models: catalog });
};

// ── POST /api/oauth/start ──

const oauthStart: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const { onOAuthAcquire, onOAuthFlow } = ctx;
  const body = (await parseBody(req)) as { provider?: string };
  if (!body.provider) {
    sendJson(res, 400, { error: "Missing required field: provider" });
    return;
  }
  if (onOAuthAcquire) {
    try {
      const result = await onOAuthAcquire(body.provider);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      log.error("OAuth acquire failed:", err);
      const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
      sendJson(res, 500, { error: formatError(err), detail });
    }
    return;
  }
  if (!onOAuthFlow) {
    sendJson(res, 501, { error: "OAuth flow not available" });
    return;
  }
  try {
    const result = await onOAuthFlow(body.provider);
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    log.error("OAuth flow failed:", err);
    const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
    sendJson(res, 500, { error: formatError(err), detail });
  }
};

// ── POST /api/oauth/save ──

const oauthSave: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as { provider?: string; proxyUrl?: string; label?: string; model?: string };
  if (!body.provider) {
    sendJson(res, 400, { error: "Missing required field: provider" });
    return;
  }
  if (!ctx.onOAuthSave) {
    sendJson(res, 501, { error: "OAuth save not available" });
    return;
  }
  try {
    const result = await ctx.onOAuthSave(body.provider, {
      proxyUrl: body.proxyUrl,
      label: body.label,
      model: body.model,
    });
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    log.error("OAuth save failed:", err);
    const message = formatError(err);
    const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
    const status = message.includes("Invalid") || message.includes("expired") || message.includes("validation") ? 422 : 500;
    sendJson(res, status, { error: message, detail });
  }
};

// ── POST /api/oauth/manual-complete ──

const oauthManualComplete: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const body = (await parseBody(req)) as { provider?: string; callbackUrl?: string };
  if (!body.provider || !body.callbackUrl) {
    sendJson(res, 400, { error: "Missing required fields: provider, callbackUrl" });
    return;
  }
  if (!ctx.onOAuthManualComplete) {
    sendJson(res, 501, { error: "Manual OAuth complete not available" });
    return;
  }
  try {
    const result = await ctx.onOAuthManualComplete(body.provider, body.callbackUrl);
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    log.error("OAuth manual complete failed:", err);
    const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
    sendJson(res, 500, { error: formatError(err), detail });
  }
};

// ── GET /api/oauth/status ──

const oauthStatus: EndpointHandler = async (_req, res, url, _params, ctx: ApiContext) => {
  const flowId = url.searchParams.get("flowId");
  if (!flowId) {
    sendJson(res, 400, { ok: false, error: "Missing flowId parameter" });
    return;
  }
  if (!ctx.onOAuthPoll) {
    sendJson(res, 501, { ok: false, error: "OAuth polling not supported" });
    return;
  }
  const status = ctx.onOAuthPoll(flowId);
  sendJson(res, 200, { ok: true, ...status });
};

// ── Registration ──

export function registerProviderHandlers(registry: RouteRegistry): void {
  // Provider keys CRUD
  registry.register(API["providerKeys.list"], listKeys);
  registry.register(API["providerKeys.create"], createKey);
  registry.register(API["providerKeys.update"], updateKey);
  registry.register(API["providerKeys.delete"], deleteKey);
  registry.register(API["providerKeys.activate"], activateKey);
  registry.register(API["providerKeys.refreshModels"], refreshModels);
  registry.register(API["providerKeys.fetchUsage"], fetchKeyUsage);
  registry.register(API["providerKeys.reauth"], reauthKey);

  // Session model
  registry.register(API["sessionModel.get"], getSessionModel);
  registry.register(API["sessionModel.set"], setSessionModel);

  // Model catalog
  registry.register(API["models.catalog"], modelCatalog);
  registry.register(API["models.fetchCustom"], fetchCustomModels);

  // Local models
  registry.register(API["localModels.detect"], detectLocalModels);
  registry.register(API["localModels.models"], listLocalModels);
  registry.register(API["localModels.health"], localModelsHealth);

  // OAuth
  registry.register(API["oauth.start"], oauthStart);
  registry.register(API["oauth.save"], oauthSave);
  registry.register(API["oauth.manualComplete"], oauthManualComplete);
  registry.register(API["oauth.status"], oauthStatus);
}
