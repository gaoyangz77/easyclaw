import { join } from "node:path";
import type { LLMProvider } from "@easyclaw/core";
import { resolveModelConfig, LOCAL_PROVIDER_IDS, getProviderMeta } from "@easyclaw/core";
import { buildExtraProviderConfigs, DEFAULT_GATEWAY_PORT, writeGatewayConfig } from "@easyclaw/gateway";
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
      const activeKey = storage.providerKeys.getDefault(localProvider);
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

  function buildFullGatewayConfig(): Parameters<typeof writeGatewayConfig>[0] {
    const curProvider = storage.settings.get("llm-provider") as LLMProvider | undefined;
    const curRegion = storage.settings.get("region") ?? (locale === "zh" ? "cn" : "us");
    let curModelId: string | undefined;
    if (curProvider) {
      const activeKey = storage.providerKeys.getDefault(curProvider);
      if (activeKey?.model) curModelId = activeKey.model;
    }
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
      gatewayPort: DEFAULT_GATEWAY_PORT,
      enableChatCompletions: true,
      commandsRestart: true,
      enableFilePermissions: true,
      extensionsDir,
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
      extraProviders: buildExtraProviderConfigs(),
      localProviderOverrides: buildLocalProviderOverrides(),
      browserMode: curBrowserMode,
      browserCdpPort: curBrowserCdpPort,
      agentWorkspace: join(stateDir, "workspace"),
      extraSkillDirs: [join(stateDir, "skills")],
    };
  }

  return { isGeminiOAuthActive, resolveGeminiOAuthModel, buildLocalProviderOverrides, buildFullGatewayConfig };
}
