import { writeFileSync } from "node:fs";
import { createLogger } from "@easyclaw/logger";
import { resolveGatewayPort } from "@easyclaw/core";
import { resolveOpenClawConfigPath, readExistingConfig, resolveOpenClawStateDir, syncPermissions } from "@easyclaw/gateway";
import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody } from "./route-utils.js";

const log = createLogger("panel-server");

export const handleSettingsRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  const { storage, secretStore, onProviderChange, onSttChange, onPermissionsChange, onBrowserChange, onAutoLaunchChange, onTelemetryTrack, sttManager, onOpenFileDialog, getUpdateResult, getGatewayInfo, deviceId } = ctx;

  // --- Status ---
  if (pathname === "/api/status" && req.method === "GET") {
    const ruleCount = storage.rules.getAll().length;
    const artifactCount = storage.artifacts.getAll().length;
    sendJson(res, 200, { status: "ok", ruleCount, artifactCount, deviceId: deviceId ?? null });
    return true;
  }

  // --- App Update ---
  if (pathname === "/api/app/update" && req.method === "GET") {
    const result = getUpdateResult?.();
    sendJson(res, 200, {
      updateAvailable: result?.updateAvailable ?? false,
      currentVersion: result?.currentVersion ?? null,
      latestVersion: result?.latestVersion ?? null,
      downloadUrl: result?.download?.url ?? null,
      releaseNotes: result?.releaseNotes ?? null,
    });
    return true;
  }

  // --- Gateway Info ---
  if (pathname === "/api/app/gateway-info" && req.method === "GET") {
    const info = getGatewayInfo?.();
    sendJson(res, 200, info ?? { wsUrl: `ws://127.0.0.1:${resolveGatewayPort()}` });
    return true;
  }

  // --- Settings ---
  if (pathname === "/api/settings" && req.method === "GET") {
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
    return true;
  }

  if (pathname === "/api/settings/validate-key" && req.method === "POST") {
    const { validateProviderApiKey } = await import("../provider-validator.js");
    const body = (await parseBody(req)) as { provider?: string; apiKey?: string; proxyUrl?: string; model?: string };
    if (!body.provider || !body.apiKey) {
      sendJson(res, 400, { valid: false, error: "Missing provider or apiKey" });
      return true;
    }
    const result = await validateProviderApiKey(body.provider, body.apiKey, body.proxyUrl || undefined, body.model || undefined);
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === "/api/settings/validate-custom-key" && req.method === "POST") {
    const { validateCustomProviderApiKey } = await import("../provider-validator.js");
    const body = (await parseBody(req)) as { baseUrl?: string; apiKey?: string; protocol?: string; model?: string };
    if (!body.baseUrl || !body.apiKey || !body.protocol || !body.model) {
      sendJson(res, 400, { valid: false, error: "Missing required fields" });
      return true;
    }
    const result = await validateCustomProviderApiKey(
      body.baseUrl, body.apiKey, body.protocol as "openai" | "anthropic", body.model,
    );
    sendJson(res, 200, result);
    return true;
  }

  // --- Telemetry Settings ---
  if (pathname === "/api/settings/telemetry" && req.method === "GET") {
    const enabledStr = storage.settings.get("telemetry_enabled");
    const enabled = enabledStr !== "false";
    sendJson(res, 200, { enabled });
    return true;
  }

  if (pathname === "/api/settings/telemetry" && req.method === "PUT") {
    const body = (await parseBody(req)) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      sendJson(res, 400, { error: "Missing required field: enabled (boolean)" });
      return true;
    }
    storage.settings.set("telemetry_enabled", body.enabled ? "true" : "false");
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Auto-Launch Settings ---
  if (pathname === "/api/settings/auto-launch" && req.method === "GET") {
    const enabled = storage.settings.get("auto_launch_enabled") === "true";
    sendJson(res, 200, { enabled });
    return true;
  }

  if (pathname === "/api/settings/auto-launch" && req.method === "PUT") {
    const body = (await parseBody(req)) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      sendJson(res, 400, { error: "Missing required field: enabled (boolean)" });
      return true;
    }
    storage.settings.set("auto_launch_enabled", body.enabled ? "true" : "false");
    onAutoLaunchChange?.(body.enabled);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Telemetry Event Tracking ---
  if (pathname === "/api/telemetry/track" && req.method === "POST") {
    const PANEL_EVENT_ALLOWLIST = new Set([
      "onboarding.started",
      "onboarding.provider_saved",
      "onboarding.completed",
      "panel.page_viewed",
      "chat.message_sent",
      "chat.response_received",
      "chat.generation_stopped",
      "rule.preset_used",
      "telemetry.toggled",
    ]);
    const body = (await parseBody(req)) as { eventType?: string; metadata?: Record<string, unknown> };
    if (!body.eventType || !PANEL_EVENT_ALLOWLIST.has(body.eventType)) {
      res.writeHead(204);
      res.end();
      return true;
    }
    onTelemetryTrack?.(body.eventType, body.metadata);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === "/api/settings" && req.method === "PUT") {
    const body = (await parseBody(req)) as Record<string, string>;
    let providerChanged = false;
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
          providerChanged = true;
        } else {
          storage.settings.set(key, value);
          if (key === "llm-provider") {
            providerChanged = true;
          }
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
    sendJson(res, 200, { ok: true });
    if (providerChanged) onProviderChange?.();
    if (sttChanged) onSttChange?.();
    if (permissionsChanged) onPermissionsChange?.();
    if (browserChanged) onBrowserChange?.();
    return true;
  }

  // --- Agent Settings ---
  if (pathname === "/api/agent-settings" && req.method === "GET") {
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
    return true;
  }

  if (pathname === "/api/agent-settings" && req.method === "PUT") {
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

      onProviderChange?.({ configOnly: true });

      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // --- STT Credentials Status ---
  if (pathname === "/api/stt/credentials" && req.method === "GET") {
    try {
      const hasGroqKey = !!(await secretStore.get("stt-groq-apikey"));
      const hasVolcengineAppKey = !!(await secretStore.get("stt-volcengine-appkey"));
      const hasVolcengineAccessKey = !!(await secretStore.get("stt-volcengine-accesskey"));

      sendJson(res, 200, {
        groq: hasGroqKey,
        volcengine: hasVolcengineAppKey && hasVolcengineAccessKey,
      });
      return true;
    } catch (err) {
      log.error("Failed to check STT credentials", err);
      sendJson(res, 500, { error: "Failed to check credentials" });
      return true;
    }
  }

  // --- STT Credentials ---
  if (pathname === "/api/stt/credentials" && req.method === "PUT") {
    const body = (await parseBody(req)) as {
      provider?: string;
      apiKey?: string;
      appKey?: string;
      accessKey?: string;
    };

    if (!body.provider) {
      sendJson(res, 400, { error: "Missing provider" });
      return true;
    }

    try {
      if (body.provider === "groq") {
        if (!body.apiKey) {
          sendJson(res, 400, { error: "Missing apiKey for Groq provider" });
          return true;
        }
        await secretStore.set("stt-groq-apikey", body.apiKey);
      } else if (body.provider === "volcengine") {
        if (!body.appKey || !body.accessKey) {
          sendJson(res, 400, { error: "Missing appKey or accessKey for Volcengine provider" });
          return true;
        }
        await secretStore.set("stt-volcengine-appkey", body.appKey);
        await secretStore.set("stt-volcengine-accesskey", body.accessKey);
      } else {
        sendJson(res, 400, { error: "Unknown provider" });
        return true;
      }

      sendJson(res, 200, { ok: true });
      onSttChange?.();
      onTelemetryTrack?.("stt.configured", { provider: body.provider });
      return true;
    } catch (err) {
      log.error("Failed to save STT credentials", err);
      sendJson(res, 500, { error: "Failed to save credentials" });
      return true;
    }
  }

  // --- STT Transcribe ---
  if (pathname === "/api/stt/transcribe" && req.method === "POST") {
    if (!sttManager || !sttManager.isEnabled()) {
      sendJson(res, 503, { error: "STT service not enabled or not configured" });
      return true;
    }

    const body = (await parseBody(req)) as {
      audio?: string;
      format?: string;
    };

    if (!body.audio || !body.format) {
      sendJson(res, 400, { error: "Missing audio or format" });
      return true;
    }

    try {
      const audioBuffer = Buffer.from(body.audio, "base64");
      const text = await sttManager.transcribe(audioBuffer, body.format);

      if (text === null) {
        sendJson(res, 500, { error: "Transcription failed" });
        return true;
      }

      sendJson(res, 200, {
        text,
        provider: sttManager.getProvider(),
      });
      return true;
    } catch (err) {
      log.error("STT transcription error", err);
      sendJson(res, 500, { error: "Transcription failed: " + String(err) });
      return true;
    }
  }

  // --- STT Status ---
  if (pathname === "/api/stt/status" && req.method === "GET") {
    const enabled = sttManager?.isEnabled() ?? false;
    const provider = sttManager?.getProvider() ?? null;
    sendJson(res, 200, { enabled, provider });
    return true;
  }

  // --- Permissions ---
  if (pathname === "/api/permissions" && req.method === "GET") {
    const permissions = storage.permissions.get();
    sendJson(res, 200, { permissions });
    return true;
  }

  if (pathname === "/api/permissions" && req.method === "PUT") {
    const body = (await parseBody(req)) as { readPaths?: string[]; writePaths?: string[] };
    const permissions = storage.permissions.update({
      readPaths: body.readPaths ?? [],
      writePaths: body.writePaths ?? [],
    });

    try {
      syncPermissions(permissions);
      log.info("Synced filesystem permissions to OpenClaw config");

      onPermissionsChange?.();
      onTelemetryTrack?.("permissions.updated", {
        readCount: (body.readPaths ?? []).length,
        writeCount: (body.writePaths ?? []).length,
      });
    } catch (err) {
      log.error("Failed to sync permissions to OpenClaw:", err);
    }

    sendJson(res, 200, { permissions });
    return true;
  }

  // --- Workspace Path ---
  if (pathname === "/api/workspace" && req.method === "GET") {
    const workspacePath = resolveOpenClawStateDir();
    sendJson(res, 200, { workspacePath });
    return true;
  }

  // --- File Dialog ---
  if (pathname === "/api/file-dialog" && req.method === "POST") {
    if (!onOpenFileDialog) {
      sendJson(res, 501, { error: "File dialog not available" });
      return true;
    }
    const selected = await onOpenFileDialog();
    sendJson(res, 200, { path: selected });
    return true;
  }

  return false;
};
