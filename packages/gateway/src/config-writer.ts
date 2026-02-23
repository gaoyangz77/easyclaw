import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createLogger } from "@easyclaw/logger";
import { ALL_PROVIDERS, getProviderMeta, resolveGatewayProvider, type LLMProvider } from "@easyclaw/core";
import { generateAudioConfig, mergeAudioConfig } from "./audio-config-writer.js";

const log = createLogger("gateway:config");

/**
 * Top-level keys recognised by the OpenClaw config schema (zod-schema.ts).
 * Any key NOT in this set will be stripped before we write the config file,
 * preventing third-party plugins or stale migrations from injecting unknown
 * fields that cause "Config invalid – Unrecognized key" on gateway startup.
 *
 * Keep in sync with vendor/openclaw/src/config/zod-schema.ts when updating
 * the vendor (the update-vendor skill should flag schema changes).
 */
export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "meta",
  "env",
  "wizard",
  "diagnostics",
  "logging",
  "update",
  "browser",
  "ui",
  "auth",
  "models",
  "nodeHost",
  "agents",
  "tools",
  "bindings",
  "broadcast",
  "audio",
  "media",
  "messages",
  "commands",
  "approvals",
  "session",
  "cron",
  "hooks",
  "web",
  "channels",
  "discovery",
  "canvasHost",
  "talk",
  "gateway",
  "memory",
  "skills",
  "plugins",
]);

/**
 * Remove top-level keys that the OpenClaw schema does not recognise.
 * Returns the list of removed keys (for logging).
 */
function stripUnknownTopLevelKeys(
  config: Record<string, unknown>,
): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(config)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      delete config[key];
      removed.push(key);
    }
  }
  return removed;
}

/**
 * Find the monorepo root by looking for pnpm-workspace.yaml
 */
function findMonorepoRoot(startDir: string = process.cwd()): string | null {
  let currentDir = resolve(startDir);
  const root = resolve("/");

  while (currentDir !== root) {
    const workspaceFile = join(currentDir, "pnpm-workspace.yaml");
    if (existsSync(workspaceFile)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return null;
}

/**
 * Resolve the absolute path to the file permissions plugin.
 * This plugin is built as part of the EasyClaw monorepo.
 *
 * Note: The desktop app bundles all dependencies into a single file,
 * so we cannot rely on import.meta.url. Instead, we find the monorepo root.
 */
function resolveFilePermissionsPluginPath(): string {
  const monorepoRoot = findMonorepoRoot();
  if (!monorepoRoot) {
    // Fallback: assume we're in the monorepo root
    return resolve(process.cwd(), "extensions", "file-permissions", "dist", "easyclaw-file-permissions.mjs");
  }
  return resolve(monorepoRoot, "extensions", "file-permissions", "dist", "easyclaw-file-permissions.mjs");
}

/**
 * Resolve the absolute path to the EasyClaw extensions/ directory.
 * Each subdirectory with openclaw.plugin.json is auto-discovered by OpenClaw.
 */
function resolveExtensionsDir(): string {
  const monorepoRoot = findMonorepoRoot();
  if (!monorepoRoot) {
    return resolve(process.cwd(), "extensions");
  }
  return resolve(monorepoRoot, "extensions");
}

/** Generate a random hex token for gateway auth. */
export function generateGatewayToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Build OpenClaw-compatible provider configs from EXTRA_MODELS.
 *
 * EXTRA_MODELS contains providers not natively supported by OpenClaw
 * (e.g. zhipu, volcengine). This function generates the `models.providers`
 * config entries so OpenClaw registers them as custom providers.
 *
 * All EXTRA_MODELS providers use OpenAI-compatible APIs.
 */
export function buildExtraProviderConfigs(): Record<string, {
  baseUrl: string;
  api: string;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    input: Array<"text" | "image">;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }>;
}> {
  const result: Record<string, {
    baseUrl: string;
    api: string;
    models: Array<{
      id: string;
      name: string;
      reasoning: boolean;
      input: Array<"text" | "image">;
      cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
      contextWindow: number;
      maxTokens: number;
    }>;
  }> = {};

  for (const provider of ALL_PROVIDERS) {
    const meta = getProviderMeta(provider);
    const models = meta?.extraModels;
    if (!models || models.length === 0) continue;

    result[provider] = {
      baseUrl: meta!.baseUrl,
      api: meta!.api ?? "openai-completions",
      models: models.map((m) => ({
        id: m.modelId,
        name: m.displayName,
        reasoning: false,
        input: (m.supportsVision ? ["text", "image"] : ["text"]) as Array<"text" | "image">,
        cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      })),
    };
  }

  return result;
}

/** Minimal OpenClaw config structure that EasyClaw manages. */
export interface OpenClawGatewayConfig {
  gateway?: {
    port?: number;
    auth?: {
      mode?: "token";
      token?: string;
    };
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
      };
    };
  };
  tools?: {
    exec?: {
      host?: string;
      security?: string;
      ask?: string;
    };
  };
  plugins?: {
    load?: {
      paths?: string[];
    };
    entries?: Record<string, unknown>;
  };
  skills?: {
    load?: {
      extraDirs?: string[];
    };
  };
}

/** Default OpenClaw gateway port (28789 to avoid collision with standalone OpenClaw on 18789). */
export const DEFAULT_GATEWAY_PORT = 28789;

/** Resolve the OpenClaw state directory, respecting OPENCLAW_STATE_DIR env var. */
export function resolveOpenClawStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".easyclaw", "openclaw");
}

/** Resolve the OpenClaw config path, respecting OPENCLAW_CONFIG_PATH env var. */
export function resolveOpenClawConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.OPENCLAW_CONFIG_PATH?.trim() ||
    join(resolveOpenClawStateDir(env), "openclaw.json")
  );
}

/**
 * Read existing OpenClaw config from disk.
 * Returns an empty object if the file does not exist or cannot be parsed.
 */
export function readExistingConfig(
  configPath: string,
): Record<string, unknown> {
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8")) as Record<
        string,
        unknown
      >;
    }
  } catch {
    log.warn(
      `Failed to read existing config at ${configPath}, starting fresh`,
    );
  }
  return {};
}

export interface WriteGatewayConfigOptions {
  /** Absolute path where the config should be written. Defaults to resolveOpenClawConfigPath(). */
  configPath?: string;
  /** The gateway HTTP port. */
  gatewayPort?: number;
  /** Auth token for the gateway. Auto-generated if not provided in ensureGatewayConfig. */
  gatewayToken?: string;
  /** Default model configuration (provider + model ID). */
  defaultModel?: { provider: string; modelId: string };
  /** Plugin configuration object for OpenClaw. */
  plugins?: {
    load?: {
      paths?: string[];
    };
    entries?: Record<string, unknown>;
  };
  /** Array of extra skill directories for OpenClaw to load. */
  extraSkillDirs?: string[];
  /** Enable the OpenAI-compatible /v1/chat/completions endpoint (disabled by default in OpenClaw). */
  enableChatCompletions?: boolean;
  /** Enable commands.restart so SIGUSR1 graceful reload is authorized. */
  commandsRestart?: boolean;
  /** STT (Speech-to-Text) configuration. */
  stt?: {
    enabled: boolean;
    provider: "groq" | "volcengine";
    /** Absolute path to the Node.js binary (for CLI-based STT providers like volcengine). */
    nodeBin?: string;
    /** Absolute path to the Volcengine STT CLI script. */
    sttCliPath?: string;
  };
  /** Enable file permissions plugin. */
  enableFilePermissions?: boolean;
  /** Override path to the file permissions plugin .mjs entry file.
   *  Used in packaged Electron apps where the monorepo root doesn't exist. */
  filePermissionsPluginPath?: string;
  /** Absolute path to the EasyClaw extensions/ directory.
   *  When provided, added to plugins.load.paths for auto-discovery of all
   *  extensions with openclaw.plugin.json manifests.
   *  In packaged Electron apps: set to process.resourcesPath + "extensions".
   *  In dev: auto-resolved from monorepo root if not provided. */
  extensionsDir?: string;
  /** Enable the google-gemini-cli-auth plugin (bundled in OpenClaw extensions). */
  enableGeminiCliAuth?: boolean;
  /** Skip OpenClaw bootstrap (prevents creating template files like AGENTS.md on first startup). */
  skipBootstrap?: boolean;
  /** Agent workspace directory. Written as agents.defaults.workspace so OpenClaw stores
   *  SOUL.md, USER.md, memory/ etc. under the EasyClaw-managed state dir instead of ~/.openclaw/workspace. */
  agentWorkspace?: string;
  /** @deprecated Use browserMode instead. */
  forceStandaloneBrowser?: boolean;
  /**
   * Browser launch mode.
   * - "standalone" (default): OpenClaw launches its own isolated Chrome with the "clawd" driver.
   * - "cdp": Connect to the user's existing Chrome via CDP remote debugging port.
   */
  browserMode?: "standalone" | "cdp";
  /** CDP remote debugging port (default 9222). Only used when browserMode is "cdp". */
  browserCdpPort?: number;
  /**
   * Extra LLM providers to register in OpenClaw's models.providers config.
   * Used for providers not natively supported by OpenClaw (e.g. zhipu, volcengine).
   */
  extraProviders?: Record<string, {
    baseUrl: string;
    api?: string;
    models: Array<{
      id: string;
      name: string;
      reasoning?: boolean;
      input?: Array<"text" | "image">;
      cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
      contextWindow?: number;
      maxTokens?: number;
    }>;
  }>;
  /** Override base URLs and models for local providers (e.g. Ollama with user-configured endpoint). */
  localProviderOverrides?: Record<string, {
    baseUrl: string;
    models: Array<{ id: string; name: string }>;
  }>;
}


/**
 * Write the OpenClaw gateway config file.
 *
 * Merges EasyClaw-managed fields into any existing config so that
 * user-added fields are preserved. Only fields explicitly provided
 * in options are written; omitted fields are left untouched.
 *
 * Returns the absolute path of the written config file.
 */
export function writeGatewayConfig(options: WriteGatewayConfigOptions): string {
  const configPath = options.configPath ?? resolveOpenClawConfigPath();

  // Ensure the parent directory exists
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });

  // Read existing config to preserve user settings
  const existing = readExistingConfig(configPath);

  // Shallow-clone the top level
  const config: Record<string, unknown> = { ...existing };

  // Gateway section
  if (options.gatewayPort !== undefined || options.gatewayToken !== undefined) {
    const existingGateway =
      typeof config.gateway === "object" && config.gateway !== null
        ? (config.gateway as Record<string, unknown>)
        : {};

    const merged: Record<string, unknown> = { ...existingGateway };

    if (options.gatewayPort !== undefined) {
      merged.port = options.gatewayPort;
      merged.mode = existingGateway.mode ?? "local";
    }

    if (options.gatewayToken !== undefined) {
      const existingAuth =
        typeof existingGateway.auth === "object" && existingGateway.auth !== null
          ? (existingGateway.auth as Record<string, unknown>)
          : {};
      merged.auth = {
        ...existingAuth,
        mode: "token",
        token: options.gatewayToken,
      };
    }

    // Allow the panel (control-ui) to connect without device identity while
    // preserving self-declared scopes. Without this flag the vendor clears
    // scopes to [] for non-device connections.
    merged.controlUi = { dangerouslyDisableDeviceAuth: true };

    config.gateway = merged;
  }

  // Enable /v1/chat/completions endpoint (used by rule compilation pipeline)
  if (options.enableChatCompletions !== undefined) {
    const existingGateway =
      typeof config.gateway === "object" && config.gateway !== null
        ? (config.gateway as Record<string, unknown>)
        : {};
    const existingHttp =
      typeof existingGateway.http === "object" && existingGateway.http !== null
        ? (existingGateway.http as Record<string, unknown>)
        : {};
    const existingEndpoints =
      typeof existingHttp.endpoints === "object" && existingHttp.endpoints !== null
        ? (existingHttp.endpoints as Record<string, unknown>)
        : {};
    config.gateway = {
      ...existingGateway,
      http: {
        ...existingHttp,
        endpoints: {
          ...existingEndpoints,
          chatCompletions: { enabled: options.enableChatCompletions },
        },
      },
    };
  }

  // Enable commands.restart for SIGUSR1 graceful reload
  if (options.commandsRestart !== undefined) {
    const existingCommands =
      typeof config.commands === "object" && config.commands !== null
        ? (config.commands as Record<string, unknown>)
        : {};
    config.commands = {
      ...existingCommands,
      restart: options.commandsRestart,
    };
  }

  // Default model selection → agents.defaults.model.primary
  if (options.defaultModel !== undefined) {
    const existingAgents =
      typeof config.agents === "object" && config.agents !== null
        ? (config.agents as Record<string, unknown>)
        : {};
    const existingDefaults =
      typeof existingAgents.defaults === "object" && existingAgents.defaults !== null
        ? (existingAgents.defaults as Record<string, unknown>)
        : {};
    const existingModel =
      typeof existingDefaults.model === "object" && existingDefaults.model !== null
        ? (existingDefaults.model as Record<string, unknown>)
        : {};
    config.agents = {
      ...existingAgents,
      defaults: {
        ...existingDefaults,
        model: {
          ...existingModel,
          primary: `${resolveGatewayProvider(options.defaultModel.provider as LLMProvider)}/${options.defaultModel.modelId}`,
        },
      },
    };
  }

  // Skip bootstrap (prevents OpenClaw from creating template files on first startup)
  // Agent workspace directory (agents.defaults.workspace)
  if (options.skipBootstrap !== undefined || options.agentWorkspace !== undefined) {
    const existingAgents =
      typeof config.agents === "object" && config.agents !== null
        ? (config.agents as Record<string, unknown>)
        : {};
    const existingDefaults =
      typeof existingAgents.defaults === "object" && existingAgents.defaults !== null
        ? (existingAgents.defaults as Record<string, unknown>)
        : {};
    const patch: Record<string, unknown> = {};
    if (options.skipBootstrap !== undefined) {
      patch.skipBootstrap = options.skipBootstrap;
    }
    if (options.agentWorkspace !== undefined) {
      patch.workspace = options.agentWorkspace;
    }
    config.agents = {
      ...existingAgents,
      defaults: {
        ...existingDefaults,
        ...patch,
      },
    };
  }

  // Exec host — EasyClaw is a desktop app, agent runs locally.
  // Allow exec on the gateway host (not sandboxed).
  {
    const existingTools =
      typeof config.tools === "object" && config.tools !== null
        ? (config.tools as Record<string, unknown>)
        : {};
    const existingExec =
      typeof existingTools.exec === "object" && existingTools.exec !== null
        ? (existingTools.exec as Record<string, unknown>)
        : {};
    config.tools = {
      ...existingTools,
      exec: { ...existingExec, host: "gateway", security: "full", ask: "off" },
    };
  }

  // Clean up stale agents.defaults.tools (was incorrectly written there in an earlier version).
  {
    const agents = config.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    if (defaults && "tools" in defaults) {
      delete defaults.tools;
    }
  }

  // Plugins configuration
  if (options.plugins !== undefined || options.enableFilePermissions !== undefined || options.extensionsDir !== undefined || options.enableGeminiCliAuth !== undefined) {
    const existingPlugins =
      typeof config.plugins === "object" && config.plugins !== null
        ? (config.plugins as Record<string, unknown>)
        : {};

    const merged: Record<string, unknown> = { ...existingPlugins };

    // Merge plugin load paths
    if (options.plugins?.load?.paths !== undefined) {
      const existingLoad =
        typeof existingPlugins.load === "object" && existingPlugins.load !== null
          ? (existingPlugins.load as Record<string, unknown>)
          : {};
      merged.load = {
        ...existingLoad,
        paths: options.plugins.load.paths,
      };
    }

    // Merge plugin entries
    if (options.plugins?.entries !== undefined) {
      merged.entries = options.plugins.entries;
    }

    // Add file permissions plugin if enabled
    if (options.enableFilePermissions !== undefined) {
      const pluginPath = options.filePermissionsPluginPath ?? resolveFilePermissionsPluginPath();

      if (existsSync(pluginPath)) {
        const existingLoad =
          typeof merged.load === "object" && merged.load !== null
            ? (merged.load as Record<string, unknown>)
            : {};
        const existingPaths = Array.isArray(existingLoad.paths) ? existingLoad.paths : [];

        // Replace any stale file-permissions plugin paths with the current resolved one
        const filteredPaths = existingPaths.filter(
          (p: unknown) => typeof p !== "string" || !p.includes("easyclaw-file-permissions"),
        );
        merged.load = {
          ...existingLoad,
          paths: [...filteredPaths, pluginPath],
        };

        // Enable the plugin in entries
        const existingEntries =
          typeof merged.entries === "object" && merged.entries !== null
            ? (merged.entries as Record<string, unknown>)
            : {};
        merged.entries = {
          ...existingEntries,
          "easyclaw-file-permissions": { enabled: options.enableFilePermissions },
        };
      } else {
        log.warn(`file-permissions plugin not found at ${pluginPath}, skipping`);
      }
    }

    // Add EasyClaw extensions directory to plugin load paths.
    // OpenClaw's discoverInDirectory() auto-discovers all subdirectories
    // with openclaw.plugin.json manifests.
    {
      const extDir = options.extensionsDir ?? resolveExtensionsDir();

      if (existsSync(extDir)) {
        const existingLoad =
          typeof merged.load === "object" && merged.load !== null
            ? (merged.load as Record<string, unknown>)
            : {};
        const existingPaths = Array.isArray(existingLoad.paths) ? existingLoad.paths : [];

        // Remove stale per-extension paths from previous config versions,
        // old extensionsDir paths from different install locations (e.g.
        // /Volumes/EasyClaw/... vs /Applications/EasyClaw.app/...),
        // and avoid duplicating the extensions dir itself.
        // Use sep-agnostic checks so this works on both macOS (/) and Windows (\).
        const isStaleExtPath = (p: string): boolean => {
          const normalized = p.replace(/\\/g, "/");
          return (
            normalized.includes("search-browser-fallback") ||
            normalized.includes("extensions/wecom") ||
            normalized.includes("extensions/dingtalk") ||
            normalized.endsWith("/extensions") ||
            p === extDir
          );
        };
        const filteredPaths = existingPaths.filter(
          (p: unknown) => typeof p !== "string" || !isStaleExtPath(p),
        );
        merged.load = {
          ...existingLoad,
          paths: [...filteredPaths, extDir],
        };
      } else {
        log.warn(`Extensions directory not found at ${extDir}, skipping`);
      }
    }

    // Clean up stale plugin entries that are now auto-discovered via extensionsDir.
    // Having them in both entries and load.paths causes "duplicate plugin id" warnings.
    {
      const existingEntries =
        typeof merged.entries === "object" && merged.entries !== null
          ? (merged.entries as Record<string, unknown>)
          : {};
      delete existingEntries["search-browser-fallback"];
      if (Object.keys(existingEntries).length > 0) {
        merged.entries = existingEntries;
      }
    }

    // Enable google-gemini-cli-auth plugin (bundled in OpenClaw extensions/)
    if (options.enableGeminiCliAuth !== undefined) {
      const existingEntries =
        typeof merged.entries === "object" && merged.entries !== null
          ? (merged.entries as Record<string, unknown>)
          : {};
      merged.entries = {
        ...existingEntries,
        "google-gemini-cli-auth": { enabled: options.enableGeminiCliAuth },
      };
    }

    config.plugins = merged;
  }

  // Skills extra dirs
  if (options.extraSkillDirs !== undefined) {
    const existingSkills =
      typeof config.skills === "object" && config.skills !== null
        ? (config.skills as Record<string, unknown>)
        : {};
    const existingLoad =
      typeof existingSkills.load === "object" && existingSkills.load !== null
        ? (existingSkills.load as Record<string, unknown>)
        : {};
    config.skills = {
      ...existingSkills,
      load: {
        ...existingLoad,
        extraDirs: options.extraSkillDirs,
      },
    };
  }

  // STT configuration via OpenClaw's tools.media.audio
  if (options.stt !== undefined) {
    // Generate OpenClaw tools.media.audio configuration
    const audioConfig = generateAudioConfig(options.stt.enabled, options.stt.provider, {
      nodeBin: options.stt.nodeBin,
      sttCliPath: options.stt.sttCliPath,
    });
    mergeAudioConfig(config, audioConfig);
    // Note: STT API keys are passed via environment variables (GROQ_API_KEY, etc.)
    // OpenClaw's audio providers automatically read from env vars.
  }

  // Extra providers → models.providers (for providers not built into OpenClaw)
  if (options.extraProviders !== undefined && Object.keys(options.extraProviders).length > 0) {
    const existingModels =
      typeof config.models === "object" && config.models !== null
        ? (config.models as Record<string, unknown>)
        : {};
    const existingProviders =
      typeof existingModels.providers === "object" && existingModels.providers !== null
        ? (existingModels.providers as Record<string, unknown>)
        : {};
    config.models = {
      ...existingModels,
      mode: existingModels.mode ?? "merge",
      providers: {
        ...existingProviders,
        ...options.extraProviders,
      },
    };
  }

  // Local provider overrides → models.providers (e.g. Ollama with dynamic models)
  if (options.localProviderOverrides !== undefined && Object.keys(options.localProviderOverrides).length > 0) {
    const existingModels =
      typeof config.models === "object" && config.models !== null
        ? (config.models as Record<string, unknown>)
        : {};
    const existingProviders =
      typeof existingModels.providers === "object" && existingModels.providers !== null
        ? (existingModels.providers as Record<string, unknown>)
        : {};

    const localEntries: Record<string, unknown> = {};
    for (const [provider, override] of Object.entries(options.localProviderOverrides)) {
      localEntries[provider] = {
        baseUrl: override.baseUrl,
        api: "openai-completions",
        models: override.models.map((m) => ({
          id: m.id,
          name: m.name,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        })),
      };
    }

    config.models = {
      ...existingModels,
      mode: existingModels.mode ?? "merge",
      providers: {
        ...existingProviders,
        ...localEntries,
      },
    };
  }

  // Browser mode configuration.
  // Backward compat: treat forceStandaloneBrowser as browserMode: "standalone".
  const browserMode = options.browserMode ?? (options.forceStandaloneBrowser ? "standalone" : undefined);
  if (browserMode !== undefined) {
    const existingBrowser =
      typeof config.browser === "object" && config.browser !== null
        ? (config.browser as Record<string, unknown>)
        : {};
    const existingProfiles =
      typeof existingBrowser.profiles === "object" && existingBrowser.profiles !== null
        ? (existingBrowser.profiles as Record<string, unknown>)
        : {};

    if (browserMode === "cdp") {
      // CDP mode: connect to user's existing Chrome via remote debugging port.
      // Profile MUST be named "openclaw" — the LLM tool description hardcodes
      // `profile="openclaw"` for the isolated browser, so naming it anything
      // else causes the auto-injected fallback profile to be used instead.
      const cdpPort = options.browserCdpPort ?? 9222;
      const { attachOnly: _, ...cleanBrowser } = existingBrowser as Record<string, unknown> & { attachOnly?: unknown };
      // Clean up stale "user-chrome" profile from old configs
      const { "user-chrome": __, ...cleanProfiles } = existingProfiles as Record<string, unknown>;
      config.browser = {
        ...cleanBrowser,
        defaultProfile: "openclaw",
        attachOnly: true,
        profiles: {
          ...cleanProfiles,
          openclaw: { cdpUrl: `http://127.0.0.1:${cdpPort}`, color: "#4A90D9" },
        },
      };
    } else {
      // Standalone mode (default): launch isolated Chrome with "clawd" driver.
      // Clean up stale CDP-mode keys and profiles.
      // Remove "user-chrome" (old CDP profile name) and "openclaw" (current CDP profile name)
      // so ensureDefaultProfile() auto-creates a fresh "openclaw" with correct cdpPort.
      const { attachOnly: _, ...cleanBrowser } = existingBrowser as Record<string, unknown> & { attachOnly?: unknown };
      const { "user-chrome": _uc, openclaw: _oc, ...cleanProfiles } = existingProfiles as Record<string, unknown>;
      config.browser = {
        ...cleanBrowser,
        defaultProfile: "openclaw",
        profiles: {
          ...cleanProfiles,
          chrome: { driver: "clawd", cdpPort: (options.gatewayPort ?? DEFAULT_GATEWAY_PORT) + 12, color: "#00AA00" },
        },
      };
    }
  }

  // Strip unknown top-level keys before writing so that stale entries
  // injected by third-party plugins or manual edits don't cause
  // "Config invalid – Unrecognized key" on gateway startup.
  const removedKeys = stripUnknownTopLevelKeys(config);
  if (removedKeys.length > 0) {
    log.warn(`Stripped unknown config keys: ${removedKeys.join(", ")}`);
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  log.info(`Gateway config written to ${configPath}`);

  return configPath;
}

/**
 * Ensure a minimal gateway config exists on disk.
 *
 * If a config file already exists, returns its path without modification.
 * Otherwise, writes a default config with empty plugins and skill dirs.
 *
 * Returns the absolute path of the config file.
 */
export function ensureGatewayConfig(options?: {
  configPath?: string;
  gatewayPort?: number;
  enableFilePermissions?: boolean;
}): string {
  const configPath = options?.configPath ?? resolveOpenClawConfigPath();

  if (!existsSync(configPath)) {
    return writeGatewayConfig({
      configPath,
      gatewayPort: options?.gatewayPort ?? DEFAULT_GATEWAY_PORT,
      gatewayToken: generateGatewayToken(),
      enableChatCompletions: true,
      commandsRestart: true,
      plugins: {
        entries: {},
      },
      extraSkillDirs: [],
      enableFilePermissions: options?.enableFilePermissions ?? true, // Enable by default
    });
  }

  return configPath;
}
