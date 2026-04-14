import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LLMProvider } from "@rivonclaw/core";
import { resolveModelConfig, LOCAL_PROVIDER_IDS, getProviderMeta, getOllamaOpenAiBaseUrl } from "@rivonclaw/core";
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
  /** Absolute path to the vendored OpenClaw directory (e.g. vendor/openclaw).
   *  Used to resolve the Control UI assets path for gateway.controlUi.root. */
  vendorDir?: string;
  /** Returns plugin entries for channels with at least one account (from ChannelManager). */
  channelPluginEntries: () => Record<string, { enabled: boolean }>;
  /** Returns channel account configs for gateway config write-back (from ChannelManager). */
  channelConfigAccounts: () => Array<{ channelId: string; accountId: string; config: Record<string, unknown> }>;
}

/**
 * Create gateway config builder functions bound to the given dependencies.
 * Returns closures that can be called without passing deps each time.
 */
export function createGatewayConfigBuilder(deps: GatewayConfigDeps) {
  const { storage, secretStore, locale, configPath, stateDir, extensionsDir, sttCliPath, filePermissionsPluginPath, vendorDir } = deps;

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

  /** Only include extra providers that the user has configured (has a provider key in DB).
   *  Unconfigured providers have no API key, causing Pi SDK's validateConfig to reject
   *  the entire models.json — which silently drops ALL custom models from the catalog. */
  function filterConfiguredExtraProviders<T>(providers: Record<string, T>): Record<string, T> {
    const configuredProviders = new Set(storage.providerKeys.getAll().map((k) => k.provider));
    const filtered: Record<string, T> = {};
    for (const [provider, config] of Object.entries(providers)) {
      if (configuredProviders.has(provider)) {
        filtered[provider] = config;
      }
    }
    return filtered;
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
      let rawModels: Array<string | { id: string; input_modalities?: string[] }>;
      try { rawModels = JSON.parse(key.customModelsJson); } catch { continue; }
      const api = key.customProtocol === "anthropic" ? "anthropic-messages" : "openai-completions";
      const keyLevelInput = (key.inputModalities ?? ["text"]) as Array<"text" | "image">;
      overrides[key.provider] = {
        baseUrl: key.baseUrl,
        api,
        models: rawModels.map((m) => {
          if (typeof m === "string") return { id: m, name: m, input: keyLevelInput };
          return { id: m.id, name: m.id, input: (m.input_modalities ?? ["text"]) as Array<"text" | "image"> };
        }),
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

  /** Build plugin config for rivonclaw-policy from compiled artifacts in storage. */
  function buildPolicyPluginConfig(): { compiledPolicy: string; guards: Array<{ id: string; ruleId: string; content: string }> } {
    const allArtifacts = storage.artifacts.getAll();
    const policyFragments = allArtifacts
      .filter((a) => a.type === "policy-fragment" && a.status === "ok")
      .map((a) => a.content);
    const guards = allArtifacts
      .filter((a) => a.type === "guard" && a.status === "ok")
      .map((a) => ({ id: a.id, ruleId: a.ruleId, content: a.content }));
    return { compiledPolicy: policyFragments.join("\n"), guards };
  }

  async function buildFullGatewayConfig(gatewayPort: number, overrides?: { toolAllowlist?: string[] }): Promise<Parameters<typeof writeGatewayConfig>[0]> {
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

    // Build the full set of extra providers (all built-in non-OpenClaw providers).
    // filterConfiguredExtraProviders narrows to those with API keys;
    // managedProviderKeys tells config-writer which stale entries to clean from old configs.
    const allExtraProviders = buildExtraProviderConfigs();

    // Only reference apiKey env var if key exists in keychain
    const wsKeyExists = curWebSearchEnabled
      ? !!(await secretStore.get(`websearch-${curWebSearchProvider}-apikey`))
      : false;
    const embKeyExists = curEmbeddingEnabled && curEmbeddingProvider !== "ollama"
      ? !!(await secretStore.get(`embedding-${curEmbeddingProvider}-apikey`))
      : false;

    // Resolve Control UI assets from vendor dist. When the index.html exists,
    // pass the directory as controlUiRoot so the gateway skips its expensive
    // auto-resolution + potential auto-build check during startup.
    let controlUiRoot: string | undefined;
    if (vendorDir) {
      const controlUiDir = join(vendorDir, "dist", "control-ui");
      if (existsSync(join(controlUiDir, "index.html"))) {
        controlUiRoot = controlUiDir;
      }
    }

    return {
      configPath,
      gatewayPort,
      enableChatCompletions: true,
      commandsRestart: true,
      enableFilePermissions: true,
      ownerAllowFrom: buildOwnerAllowFrom(storage),
      controlUiRoot,
      extensionsDir,
      plugins: {
        allow: [
          ...OUR_PLUGIN_IDS,
          // Vendor-bundled plugins that are not in extensions/ but need to be allowed
          "memory-core",
          // Groq audio transcription provider — moved from core to bundled plugin
          // in vendor v2026.3.28 (commit 3dcc802fe5). Without allow, the gateway's
          // plugin loader blocks it ("not in allowlist") and STT stops working.
          "groq",
        ],
        entries: {
          // Groq audio transcription — must be explicitly enabled because bundled
          // plugins without enabledByDefault in their manifest are disabled.
          // Vendor moved groq from core to plugin in v2026.3.28 (3dcc802fe5).
          ...(curSttEnabled && curSttProvider === "groq" ? { groq: { enabled: true } } : {}),
          "rivonclaw-tools": {
            config: {
              browserMode: curBrowserMode,
            },
          },
          "rivonclaw-policy": {
            config: buildPolicyPluginConfig(),
          },
          // Channel plugin entries from ChannelManager -- each channel with at
          // least one account gets enabled so the vendor's two-phase plugin
          // loader includes it. ChannelManager is the single owner.
          ...deps.channelPluginEntries(),
        },
      },
      // Channel accounts from ChannelManager for config write-back.
      // ChannelManager owns the SQLite source of truth and handles migration.
      channelAccounts: deps.channelConfigAccounts(),
      // Disable mDNS/Bonjour discovery — desktop app manages its own device
      // pairing. Bonjour's mDNS probing blocks the event loop for 14-16s on
      // Windows (name conflict resolution + re-advertise watchdog), delaying
      // RPC handshake and chat.history responses.
      discovery: { mdns: { mode: "off" as const } },
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
      extraProviders: { ...filterConfiguredExtraProviders(allExtraProviders), ...buildCustomProviderOverrides() },
      managedProviderKeys: Object.keys(allExtraProviders),
      localProviderOverrides: buildLocalProviderOverrides(),
      browserMode: curBrowserMode,
      browserCdpPort: curBrowserCdpPort,
      agentWorkspace: join(stateDir, "workspace"),
      extraSkillDirs: [resolveUserSkillsDir()],
      // ADR-031: allow all core + plugin tools by default (visibility controlled at runtime by capability-manager).
      // "group:openclaw" covers most core tools (25/32). Section groups "fs" and "runtime" add the
      // remaining tools (read, write, edit, apply_patch, exec, process) not in the openclaw group.
      // "group:plugins" covers all optional plugin tools.
      // All non-plugin groups are needed because v2026.4.11+ treats a plugin-only allowlist as excluding core tools.
      toolAllowlist: overrides?.toolAllowlist ?? [
        "group:openclaw", "group:fs", "group:runtime",
        "group:plugins",
      ],
    };
  }

  return { isGeminiOAuthActive, resolveGeminiOAuthModel, buildLocalProviderOverrides, buildFullGatewayConfig };
}
