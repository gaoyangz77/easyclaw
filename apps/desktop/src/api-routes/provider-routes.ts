import { randomUUID } from "node:crypto";
import type { LLMProvider } from "@easyclaw/core";
import { getDefaultModelForProvider, parseProxyUrl, reconstructProxyUrl, formatError } from "@easyclaw/core";
import { readFullModelCatalog } from "@easyclaw/gateway";
import { createLogger } from "@easyclaw/logger";
import { validateProviderApiKey, syncActiveKey } from "../provider-validator.js";
import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody } from "./route-utils.js";

const log = createLogger("panel-server");

export const handleProviderRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  const { storage, secretStore, onProviderChange, onOAuthFlow, onOAuthAcquire, onOAuthSave, onOAuthManualComplete, onTelemetryTrack, vendorDir, snapshotEngine } = ctx;

  // --- Provider Keys ---
  if (pathname === "/api/provider-keys" && req.method === "GET") {
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
    return true;
  }

  if (pathname === "/api/provider-keys" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      provider?: string;
      label?: string;
      model?: string;
      apiKey?: string;
      proxyUrl?: string;
      authType?: "api_key" | "oauth" | "local";
      baseUrl?: string;
    };

    const isLocal = body.authType === "local";

    if (!body.provider) {
      sendJson(res, 400, { error: "Missing required field: provider" });
      return true;
    }
    if (!isLocal && !body.apiKey) {
      sendJson(res, 400, { error: "Missing required field: apiKey" });
      return true;
    }

    if (!isLocal) {
      const validation = await validateProviderApiKey(body.provider, body.apiKey!, body.proxyUrl || undefined, body.model || undefined);
      if (!validation.valid) {
        sendJson(res, 422, { error: validation.error || "Invalid API key" });
        return true;
      }
    }

    const id = randomUUID();
    const model = body.model || getDefaultModelForProvider(body.provider as LLMProvider)?.modelId || "";
    const label = body.label || "Default";

    let proxyBaseUrl: string | null = null;
    if (body.proxyUrl?.trim()) {
      try {
        const proxyConfig = parseProxyUrl(body.proxyUrl.trim());
        proxyBaseUrl = proxyConfig.baseUrl;
        if (proxyConfig.hasAuth && proxyConfig.credentials) {
          await secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
        }
      } catch (error) {
        sendJson(res, 400, { error: `Invalid proxy URL: ${formatError(error)}` });
        return true;
      }
    }

    const existingKeys = storage.providerKeys.getByProvider(body.provider);
    const isFirst = existingKeys.length === 0;

    const entry = storage.providerKeys.create({
      id,
      provider: body.provider,
      label,
      model,
      isDefault: isFirst,
      proxyBaseUrl,
      authType: body.authType ?? "api_key",
      baseUrl: isLocal ? (body.baseUrl || null) : null,
      createdAt: "",
      updatedAt: "",
    });

    if (body.apiKey) {
      await secretStore.set(`provider-key-${id}`, body.apiKey);
    }

    if (isFirst) {
      const currentProvider = storage.settings.get("llm-provider");
      if (!currentProvider) {
        storage.settings.set("llm-provider", body.provider);
      }
    }

    await syncActiveKey(body.provider, storage, secretStore);
    onProviderChange?.(isFirst ? { configOnly: true } : { keyOnly: true });
    onTelemetryTrack?.("provider.key_added", { provider: body.provider, isFirst });

    sendJson(res, 201, entry);
    return true;
  }

  // Provider key activate: POST /api/provider-keys/:id/activate
  if (pathname.startsWith("/api/provider-keys/") && pathname.endsWith("/activate") && req.method === "POST") {
    const id = pathname.slice("/api/provider-keys/".length, -"/activate".length);
    const entry = storage.providerKeys.getById(id);
    if (!entry) {
      sendJson(res, 404, { error: "Key not found" });
      return true;
    }

    const oldDefault = storage.providerKeys.getDefault(entry.provider);
    const modelChanged = oldDefault?.model !== entry.model;
    const activeProvider = storage.settings.get("llm-provider");

    if (oldDefault && snapshotEngine) {
      await snapshotEngine.recordDeactivation(oldDefault.id, oldDefault.provider, oldDefault.model);
    }
    if (snapshotEngine) {
      await snapshotEngine.recordActivation(entry.id, entry.provider, entry.model);
    }

    storage.providerKeys.setDefault(id);
    storage.settings.set("llm-provider", entry.provider);
    await syncActiveKey(entry.provider, storage, secretStore);

    const providerChanged = entry.provider !== activeProvider;
    if (providerChanged || modelChanged) {
      onProviderChange?.();
    } else {
      onProviderChange?.({ keyOnly: true });
    }

    onTelemetryTrack?.("provider.activated", { provider: entry.provider });

    sendJson(res, 200, { ok: true });
    return true;
  }

  // Provider key with ID: PUT /api/provider-keys/:id, DELETE /api/provider-keys/:id
  if (pathname.startsWith("/api/provider-keys/")) {
    const id = pathname.slice("/api/provider-keys/".length);
    if (!id.includes("/")) {
      if (req.method === "PUT") {
        const body = (await parseBody(req)) as { label?: string; model?: string; proxyUrl?: string; baseUrl?: string };
        const existing = storage.providerKeys.getById(id);
        if (!existing) {
          sendJson(res, 404, { error: "Key not found" });
          return true;
        }

        let proxyBaseUrl: string | null | undefined = undefined;
        if (body.proxyUrl !== undefined) {
          if (body.proxyUrl === "" || body.proxyUrl === null) {
            proxyBaseUrl = null;
            await secretStore.delete(`proxy-auth-${id}`);
          } else {
            try {
              const proxyConfig = parseProxyUrl(body.proxyUrl.trim());
              proxyBaseUrl = proxyConfig.baseUrl;
              if (proxyConfig.hasAuth && proxyConfig.credentials) {
                await secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
              } else {
                await secretStore.delete(`proxy-auth-${id}`);
              }
            } catch (error) {
              sendJson(res, 400, { error: `Invalid proxy URL: ${formatError(error)}` });
              return true;
            }
          }
        }

        const modelChanging = !!(body.model && body.model !== existing.model);
        if (modelChanging && existing.isDefault && snapshotEngine) {
          await snapshotEngine.recordDeactivation(existing.id, existing.provider, existing.model);
        }

        const updated = storage.providerKeys.update(id, {
          label: body.label,
          model: body.model,
          proxyBaseUrl,
          baseUrl: body.baseUrl,
        });

        if (modelChanging && existing.isDefault && snapshotEngine && body.model) {
          await snapshotEngine.recordActivation(existing.id, existing.provider, body.model);
        }

        const activeProvider = storage.settings.get("llm-provider");
        const modelChanged = modelChanging;
        const proxyChanged = proxyBaseUrl !== undefined && proxyBaseUrl !== existing.proxyBaseUrl;
        if (existing.isDefault && existing.provider === activeProvider && (modelChanged || proxyChanged)) {
          onProviderChange?.();
        }

        sendJson(res, 200, updated);
        return true;
      }

      if (req.method === "DELETE") {
        const existing = storage.providerKeys.getById(id);
        if (!existing) {
          sendJson(res, 404, { error: "Key not found" });
          return true;
        }

        storage.providerKeys.delete(id);
        await secretStore.delete(`provider-key-${id}`);
        await secretStore.delete(`proxy-auth-${id}`);

        let promotedModel: string | undefined;
        if (existing.isDefault) {
          const remaining = storage.providerKeys.getByProvider(existing.provider);
          if (remaining.length > 0) {
            storage.providerKeys.setDefault(remaining[0].id);
            promotedModel = remaining[0].model;
          }
        }

        await syncActiveKey(existing.provider, storage, secretStore);

        const activeProvider = storage.settings.get("llm-provider");
        const modelChanged = existing.isDefault && existing.provider === activeProvider
          && promotedModel !== existing.model;
        onProviderChange?.(modelChanged ? { configOnly: true } : { keyOnly: true });

        sendJson(res, 200, { ok: true });
        return true;
      }
    }
  }

  // --- Local Models ---
  if (pathname === "/api/local-models/detect" && req.method === "GET") {
    const { detectLocalServers } = await import("../local-model-detector.js");
    const servers = await detectLocalServers();
    sendJson(res, 200, { servers });
    return true;
  }

  if (pathname === "/api/local-models/models" && req.method === "GET") {
    const baseUrl = url.searchParams.get("baseUrl");
    if (!baseUrl) {
      sendJson(res, 400, { error: "Missing required parameter: baseUrl" });
      return true;
    }
    const { fetchOllamaModels } = await import("../local-model-fetcher.js");
    const models = await fetchOllamaModels(baseUrl);
    sendJson(res, 200, { models });
    return true;
  }

  if (pathname === "/api/local-models/health" && req.method === "POST") {
    const body = (await parseBody(req)) as { baseUrl?: string };
    if (!body.baseUrl) {
      sendJson(res, 400, { error: "Missing required field: baseUrl" });
      return true;
    }
    const { checkHealth } = await import("../local-model-fetcher.js");
    const result = await checkHealth(body.baseUrl);
    sendJson(res, 200, result);
    return true;
  }

  // --- Model Catalog ---
  if (pathname === "/api/models" && req.method === "GET") {
    const catalog = await readFullModelCatalog(undefined, vendorDir);
    sendJson(res, 200, { models: catalog });
    return true;
  }

  // --- OAuth Flow ---
  if (pathname === "/api/oauth/start" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string };
    if (!body.provider) {
      sendJson(res, 400, { error: "Missing required field: provider" });
      return true;
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
      return true;
    }
    if (!onOAuthFlow) {
      sendJson(res, 501, { error: "OAuth flow not available" });
      return true;
    }
    try {
      const result = await onOAuthFlow(body.provider);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      log.error("OAuth flow failed:", err);
      const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
      sendJson(res, 500, { error: formatError(err), detail });
    }
    return true;
  }

  if (pathname === "/api/oauth/save" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string; proxyUrl?: string; label?: string; model?: string };
    if (!body.provider) {
      sendJson(res, 400, { error: "Missing required field: provider" });
      return true;
    }
    if (!onOAuthSave) {
      sendJson(res, 501, { error: "OAuth save not available" });
      return true;
    }
    try {
      const result = await onOAuthSave(body.provider, {
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
    return true;
  }

  if (pathname === "/api/oauth/manual-complete" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string; callbackUrl?: string };
    if (!body.provider || !body.callbackUrl) {
      sendJson(res, 400, { error: "Missing required fields: provider, callbackUrl" });
      return true;
    }
    if (!onOAuthManualComplete) {
      sendJson(res, 501, { error: "Manual OAuth complete not available" });
      return true;
    }
    try {
      const result = await onOAuthManualComplete(body.provider, body.callbackUrl);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      log.error("OAuth manual complete failed:", err);
      const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
      sendJson(res, 500, { error: formatError(err), detail });
    }
    return true;
  }

  return false;
};
