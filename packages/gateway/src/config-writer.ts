import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createLogger } from "@easyclaw/logger";
import { EXTRA_MODELS, PROVIDER_BASE_URLS, type LLMProvider } from "@easyclaw/core";
import { generateAudioConfig, mergeAudioConfig } from "./audio-config-writer.js";

const log = createLogger("gateway:config");

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
    return resolve(process.cwd(), "packages", "file-permissions-plugin", "dist", "easyclaw-file-permissions.mjs");
  }
  return resolve(monorepoRoot, "packages", "file-permissions-plugin", "dist", "easyclaw-file-permissions.mjs");
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

  for (const [provider, models] of Object.entries(EXTRA_MODELS)) {
    if (!models || models.length === 0) continue;
    const baseUrl = PROVIDER_BASE_URLS[provider as LLMProvider];
    if (!baseUrl) continue;

    result[provider] = {
      baseUrl,
      api: "openai-completions",
      models: models.map((m) => ({
        id: m.modelId,
        name: m.displayName,
        reasoning: false,
        input: ["text"] as Array<"text" | "image">,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
      tools?: {
        exec?: {
          host?: string;
          security?: string;
          ask?: string;
        };
        elevated?: {
          enabled?: boolean;
        };
      };
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
  };
  /** Enable file permissions plugin. */
  enableFilePermissions?: boolean;
  /** Override path to the file permissions plugin .mjs entry file.
   *  Used in packaged Electron apps where the monorepo root doesn't exist. */
  filePermissionsPluginPath?: string;
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
          primary: `${options.defaultModel.provider}/${options.defaultModel.modelId}`,
        },
      },
    };
  }

  // Plugins configuration
  if (options.plugins !== undefined || options.enableFilePermissions !== undefined) {
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
    const audioConfig = generateAudioConfig(options.stt.enabled, options.stt.provider);
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
