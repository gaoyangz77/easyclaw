import { join } from "node:path";
import type { LLMProvider } from "@easyclaw/core";
import { resolveModelConfig, LOCAL_PROVIDER_IDS, getProviderMeta, resolveGatewayPort } from "@easyclaw/core";
import { buildExtraProviderConfigs, writeGatewayConfig } from "@easyclaw/gateway";
import type { Storage } from "@easyclaw/storage";

export interface GatewayConfigDeps {
  storage: Storage;
  locale: string;
  configPath: string;
  stateDir: string;
  extensionsDir: string;
  sttCliPath: string;
  filePermissionsPluginPath?: string;
}

/**
 * Create gateway config builder functions bound to the given dependencies.
 * Returns closures that can be called without passing deps each time.
 */
export function createGatewayConfigBuilder(deps: GatewayConfigDeps) {
  const { storage, locale, configPath, stateDir, extensionsDir, sttCliPath, filePermissionsPluginPath } = deps;

  function isGeminiOAuthActive(): boolean {
    return storage.providerKeys.getAll()
      .some((k) => k.provider === "gemini" && k.authType === "oauth" && k.isDefault);
  }

  function resolveGeminiOAuthModel(provider: string, modelId: string): { provider: string; modelId: string } {
    if (!isGeminiOAuthActive() || provider !== "gemini") {
      return { provider, modelId };
    }
    return { provider: "google-gemini-cli", modelId };
  }

  function buildLocalProviderOverrides(): Record<string, { baseUrl: string; models: Array<{ id: string; name: string }> }> {
    const overrides: Record<string, { baseUrl: string; models: Array<{ id: string; name: string }> }> = {};
    for (const localProvider of LOCAL_PROVIDER_IDS) {
      const activeKey = storage.providerKeys.getByProvider(localProvider)[0];
      if (!activeKey) continue;
      const meta = getProviderMeta(localProvider);
      let baseUrl = activeKey.baseUrl || meta?.baseUrl || "http://localhost:11434/v1";
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

  function buildCustomProviderOverrides(): Record<string, { baseUrl: string; api: string; models: Array<{ id: string; name: string }> }> {
    const overrides: Record<string, { baseUrl: string; api: string; models: Array<{ id: string; name: string }> }> = {};
    const allKeys = storage.providerKeys.getAll();
    const customKeys = allKeys.filter((k) => k.authType === "custom");

    for (const key of customKeys) {
      if (!key.baseUrl || !key.customModelsJson || !key.customProtocol) continue;
      let models: string[];
      try { models = JSON.parse(key.customModelsJson); } catch { continue; }
      const api = key.customProtocol === "anthropic" ? "anthropic-messages" : "openai-completions";
      overrides[key.provider] = {
        baseUrl: key.baseUrl,
        api,
        models: models.map((m) => ({ id: m, name: m })),
      };
    }
    return overrides;
  }

  function buildFullGatewayConfig(): Parameters<typeof writeGatewayConfig>[0] {
    const activeKey = storage.providerKeys.getActive();
    const curProvider = activeKey?.provider as LLMProvider | undefined;
    const curRegion = storage.settings.get("region") ?? (locale === "zh" ? "cn" : "us");
    const curModelId = activeKey?.model;
    const curModel = resolveModelConfig({
      region: curRegion,
      userProvider: curProvider,
      userModelId: curModelId,
    });

    const curSttEnabled = storage.settings.get("stt.enabled") === "true";
    const curSttProvider = (storage.settings.get("stt.provider") || "groq") as "groq" | "volcengine";

    const curBrowserMode = (storage.settings.get("browser-mode") || "standalone") as "standalone" | "cdp";
    const curBrowserCdpPort = parseInt(storage.settings.get("browser-cdp-port") || "9222", 10);

    return {
      configPath,
      gatewayPort: resolveGatewayPort(),
      enableChatCompletions: true,
      commandsRestart: true,
      enableFilePermissions: true,
      extensionsDir,
      plugins: {
        allow: [
          "easyclaw-tools",
          "easyclaw-file-permissions",
          "search-browser-fallback",
          "wecom",
          "google-gemini-cli-auth",
        ],
      },
      enableGeminiCliAuth: isGeminiOAuthActive(),
      skipBootstrap: false,
      filePermissionsPluginPath,
      defaultModel: resolveGeminiOAuthModel(curModel.provider, curModel.modelId),
      stt: {
        enabled: curSttEnabled,
        provider: curSttProvider,
        nodeBin: process.execPath,
        sttCliPath,
      },
      extraProviders: { ...buildExtraProviderConfigs(), ...buildCustomProviderOverrides() },
      localProviderOverrides: buildLocalProviderOverrides(),
      browserMode: curBrowserMode,
      browserCdpPort: curBrowserCdpPort,
      agentWorkspace: join(stateDir, "workspace"),
      extraSkillDirs: [join(stateDir, "skills")],
    };
  }

  return { isGeminiOAuthActive, resolveGeminiOAuthModel, buildLocalProviderOverrides, buildFullGatewayConfig };
}
