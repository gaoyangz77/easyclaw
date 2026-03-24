import { join } from "node:path";
import type { LLMProvider } from "@rivonclaw/core";
import { resolveModelConfig, LOCAL_PROVIDER_IDS, getProviderMeta, resolveGatewayPort, getOllamaOpenAiBaseUrl } from "@rivonclaw/core";
import { resolveUserSkillsDir } from "@rivonclaw/core/node";
import { buildExtraProviderConfigs, writeGatewayConfig } from "@rivonclaw/gateway";
import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import { buildOwnerAllowFrom } from "../auth/owner-sync.js";
import { OUR_PLUGIN_IDS } from "../generated/our-plugin-ids.js";
export interface GatewayConfigDeps {
  storage: Storage;
  secretStore: SecretStore;
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
  const { storage, secretStore, locale, configPath, stateDir, extensionsDir, sttCliPath, filePermissionsPluginPath } = deps;

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

  function buildLocalProviderOverrides(): Record<string, { baseUrl: string; models: Array<{ id: string; name: string; inputModalities?: string[] }> }> {
    const overrides: Record<string, { baseUrl: string; models: Array<{ id: string; name: string; inputModalities?: string[] }> }> = {};
    for (const localProvider of LOCAL_PROVIDER_IDS) {
      const activeKey = storage.providerKeys.getByProvider(localProvider)[0];
      if (!activeKey) continue;
      const meta = getProviderMeta(localProvider);
      let baseUrl = activeKey.baseUrl || meta?.baseUrl || getOllamaOpenAiBaseUrl();
      if (!baseUrl.match(/\/v\d\/?$/)) {
        baseUrl = baseUrl.replace(/\/+$/, "") + "/v1";
      }
      const modelId = activeKey.model;
      if (modelId) {
        overrides[localProvider] = {
          baseUrl,
          models: [{ id: modelId, name: modelId, inputModalities: activeKey.inputModalities ?? undefined }],
        };
      }
    }
    return overrides;
  }

  function buildCustomProviderOverrides(): Record<string, { baseUrl: string; api: string; models: Array<{ id: string; name: string; input?: Array<"text" | "image"> }> }> {
    const overrides: Record<string, { baseUrl: string; api: string; models: Array<{ id: string; name: string; input?: Array<"text" | "image"> }> }> = {};
    const allKeys = storage.providerKeys.getAll();
    const customKeys = allKeys.filter((k) => k.authType === "custom");

    for (const key of customKeys) {
      if (!key.baseUrl || !key.customModelsJson || !key.customProtocol) continue;
      let models: string[];
      try { models = JSON.parse(key.customModelsJson); } catch { continue; }
      const api = key.customProtocol === "anthropic" ? "anthropic-messages" : "openai-completions";
      const input = (key.inputModalities ?? ["text"]) as Array<"text" | "image">;
      overrides[key.provider] = {
        baseUrl: key.baseUrl,
        api,
        models: models.map((m) => ({ id: m, name: m, input })),
      };
    }
    return overrides;
  }

  const WS_ENV_MAP: Record<string, string> = {
    brave: "RIVONCLAW_WS_BRAVE_APIKEY",
    perplexity: "RIVONCLAW_WS_PERPLEXITY_APIKEY",
    grok: "RIVONCLAW_WS_GROK_APIKEY",
    gemini: "RIVONCLAW_WS_GEMINI_APIKEY",
    kimi: "RIVONCLAW_WS_KIMI_APIKEY",
  };
  const EMB_ENV_MAP: Record<string, string> = {
    openai: "RIVONCLAW_EMB_OPENAI_APIKEY",
    gemini: "RIVONCLAW_EMB_GEMINI_APIKEY",
    voyage: "RIVONCLAW_EMB_VOYAGE_APIKEY",
    mistral: "RIVONCLAW_EMB_MISTRAL_APIKEY",
  };

  async function buildFullGatewayConfig(overrides?: { toolAllowlist?: string[] }): Promise<Parameters<typeof writeGatewayConfig>[0]> {
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

    const curWebSearchEnabled = storage.settings.get("webSearch.enabled") === "true";
    const curWebSearchProvider = (storage.settings.get("webSearch.provider") || "brave") as "brave" | "perplexity" | "grok" | "gemini" | "kimi";

    const curEmbeddingEnabled = storage.settings.get("embedding.enabled") === "true";
    const curEmbeddingProvider = (storage.settings.get("embedding.provider") || "openai") as "openai" | "gemini" | "voyage" | "mistral" | "ollama";

    const curBrowserMode = (storage.settings.get("browser-mode") || "standalone") as "standalone" | "cdp";
    const curBrowserCdpPort = parseInt(storage.settings.get("browser-cdp-port") || "9222", 10);

    // Only reference apiKey env var if key exists in keychain
    const wsKeyExists = curWebSearchEnabled
      ? !!(await secretStore.get(`websearch-${curWebSearchProvider}-apikey`))
      : false;
    const embKeyExists = curEmbeddingEnabled && curEmbeddingProvider !== "ollama"
      ? !!(await secretStore.get(`embedding-${curEmbeddingProvider}-apikey`))
      : false;

    return {
      configPath,
      gatewayPort: resolveGatewayPort(),
      enableChatCompletions: true,
      commandsRestart: true,
      enableFilePermissions: true,
      ownerAllowFrom: buildOwnerAllowFrom(storage),
      extensionsDir,
      plugins: {
        allow: [
          ...OUR_PLUGIN_IDS,
          // Vendor-bundled plugins that are not in extensions/ but need to be allowed
          "google-gemini-cli-auth",
          "memory-core",
        ],
        entries: {
          "rivonclaw-tools": {
            config: {
              browserMode: curBrowserMode,
            },
          },
        },
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
      webSearch: {
        enabled: curWebSearchEnabled,
        provider: curWebSearchProvider,
        apiKeyEnvVar: wsKeyExists ? WS_ENV_MAP[curWebSearchProvider] : undefined,
      },
      embedding: {
        enabled: curEmbeddingEnabled,
        provider: curEmbeddingProvider,
        apiKeyEnvVar: embKeyExists ? EMB_ENV_MAP[curEmbeddingProvider] : undefined,
      },
      extraProviders: { ...buildExtraProviderConfigs(), ...buildCustomProviderOverrides() },
      localProviderOverrides: buildLocalProviderOverrides(),
      browserMode: curBrowserMode,
      browserCdpPort: curBrowserCdpPort,
      agentWorkspace: join(stateDir, "workspace"),
      extraSkillDirs: [resolveUserSkillsDir()],
      // ADR-031: allow all plugin tools by default (visibility controlled at runtime by capability-manager).
      // "group:plugins" is an OpenClaw allowlist keyword that permits all optional plugin tools.
      toolAllowlist: overrides?.toolAllowlist ?? ["group:plugins"],
    };
  }

  return { isGeminiOAuthActive, resolveGeminiOAuthModel, buildLocalProviderOverrides, buildFullGatewayConfig };
}
