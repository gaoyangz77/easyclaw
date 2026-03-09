import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createLogger } from "@easyclaw/logger";
import {
  ALL_PROVIDERS, getProviderMeta, resolveGatewayProvider,
  DEFAULT_GATEWAY_PORT, CDP_PORT_OFFSET,
  type LLMProvider,
} from "@easyclaw/core";
import {
  resolveOpenClawStateDir as _resolveOpenClawStateDir,
  resolveOpenClawConfigPath as _resolveOpenClawConfigPath,
} from "@easyclaw/core/node";
import { generateAudioConfig, mergeAudioConfig } from "./audio-config-writer.js";
import { sanitizeWindowsBinds } from "./windows-bind-sanitizer.js";
import { OpenClawSchema } from "../../../vendor/openclaw/src/config/zod-schema.js";

const log = createLogger("gateway:config");

/**
 * Strip keys that the OpenClaw Zod schema does not recognise at any nesting
 * level.  Uses `OpenClawSchema.safeParse()` to detect `unrecognized_keys`
 * issues, navigates to the parent object via the issue path, and deletes the
 * offending keys.  Returns dot-joined paths of all removed keys for logging.
 */
function stripUnknownKeys(config: Record<string, unknown>): string[] {
  const allRemoved: string[] = [];

  for (let pass = 0; pass < 10; pass++) {
    const result = OpenClawSchema.safeParse(config);
    if (result.success) break;

    let found = false;
    for (const issue of result.error.issues) {
      if (issue.code !== "unrecognized_keys") continue;

      // Walk the path to reach the object containing the bad keys.
      let target: unknown = config;
      for (const segment of issue.path) {
        if (target == null || typeof target !== "object") {
          target = null;
          break;
        }
        target = (target as Record<PropertyKey, unknown>)[segment];
      }

      if (target != null && typeof target === "object" && !Array.isArray(target)) {
        for (const key of issue.keys) {
          delete (target as Record<string, unknown>)[key];
          allRemoved.push([...issue.path, key].join("."));
          found = true;
        }
      }
    }

    if (!found) break;
  }

  return allRemoved;
}

/**
 * Fix semantic validation errors by progressively deleting the offending
 * config path.  When the leaf key doesn't exist (e.g. a "required" field
 * that is missing), walks upward and deletes the nearest existing ancestor.
 *
 * EasyClaw-managed top-level keys are protected — if the schema rejects
 * something we wrote ourselves, that's a bug we should surface, not hide.
 */
function fixSemanticErrors(config: Record<string, unknown>): string[] {
  const allRemoved: string[] = [];

  for (let pass = 0; pass < 20; pass++) {
    const result = OpenClawSchema.safeParse(config);
    if (result.success) break;

    const issues = result.error.issues.filter(
      (i) => i.code !== "unrecognized_keys",
    );
    if (issues.length === 0) break;

    let progress = false;
    for (const issue of issues) {
      const path = [...issue.path];
      // Need at least depth 2: never delete a top-level key, only leaves.
      if (path.length <= 1) continue;

      // Only attempt to delete the exact leaf the error points to.
      // If the leaf doesn't exist in the config (e.g. a required-but-
      // missing field), give up — never escalate upward.
      const keyToDelete = String(path[path.length - 1]);
      const parentPath = path.slice(0, -1);

      let parent: unknown = config;
      for (const seg of parentPath) {
        if (parent == null || typeof parent !== "object") {
          parent = null;
          break;
        }
        parent = (parent as Record<PropertyKey, unknown>)[seg];
      }

      if (
        parent != null &&
        typeof parent === "object" &&
        !Array.isArray(parent) &&
        keyToDelete in (parent as Record<string, unknown>)
      ) {
        delete (parent as Record<string, unknown>)[keyToDelete];
        allRemoved.push(path.join("."));
        progress = true;
      }

      // Re-parse after each deletion to avoid cascading mis-deletions.
      if (progress) break;
    }

    if (!progress) break;
  }

  return allRemoved;
}

/** Plugin IDs that have been permanently removed from the project. */
const REMOVED_PLUGIN_IDS = new Set(["wecom", "dingtalk"]);

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
    allow?: string[];
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

// Re-export from @easyclaw/core for backward compatibility.
export { DEFAULT_GATEWAY_PORT } from "@easyclaw/core";
export { resolveOpenClawStateDir, resolveOpenClawConfigPath } from "@easyclaw/core/node";

// Use the core implementations internally.
const resolveOpenClawStateDir = _resolveOpenClawStateDir;
const resolveOpenClawConfigPath = _resolveOpenClawConfigPath;

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
    allow?: string[];
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
  /** Explicit owner allowlist for commands.ownerAllowFrom.
   *  If provided, replaces the default ["openclaw-control-ui"]. */
  ownerAllowFrom?: string[];
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
    models: Array<{ id: string; name: string; inputModalities?: string[] }>;
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

  // ownerAllowFrom controls which senders get owner-only tools (gateway, cron).
  // Always includes "openclaw-control-ui" (the panel webchat client ID).
  // Channel recipients marked as owners are passed via options.ownerAllowFrom.
  {
    const existingCommands =
      typeof config.commands === "object" && config.commands !== null
        ? (config.commands as Record<string, unknown>)
        : {};
    config.commands = {
      ...existingCommands,
      ownerAllowFrom: options.ownerAllowFrom ?? ["openclaw-control-ui"],
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

  // Tools profile — EasyClaw is a desktop app with full agent capabilities.
  // OpenClaw v2026.3.2 defaults new installs to "messaging" (no file/exec tools).
  // EasyClaw needs "full" so file permissions, rules, and exec all work.
  //
  // Exec host — agent runs locally on the gateway host (not sandboxed).
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
      profile: "full",
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

    // Merge plugin allowlist — keep entries added by the gateway doctor
    // (e.g. auto-enabled channel plugins) while ensuring our required
    // plugins are always present.
    if (options.plugins?.allow !== undefined) {
      const existingAllow = Array.isArray(merged.allow) ? (merged.allow as string[]) : [];
      merged.allow = [...new Set([...existingAllow, ...options.plugins.allow])];
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
      for (const id of REMOVED_PLUGIN_IDS) delete existingEntries[id];
      if (Object.keys(existingEntries).length > 0) {
        merged.entries = existingEntries;
      }

      // Remove permanently-removed plugin IDs from the allowlist to prevent
      // gateway startup failures (e.g. wecom was removed in v2026.3).
      if (Array.isArray(merged.allow)) {
        const before = merged.allow as string[];
        const after = before.filter((id) => !REMOVED_PLUGIN_IDS.has(id));
        const removed = before.filter((id) => REMOVED_PLUGIN_IDS.has(id));
        if (removed.length > 0) {
          log.warn(`Removed stale plugin IDs from plugins.allow: ${removed.join(", ")}`);
        }
        merged.allow = after;
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
          input: (m.inputModalities ?? ["text"]) as Array<"text" | "image">,
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
          chrome: { driver: "clawd", cdpPort: (options.gatewayPort ?? DEFAULT_GATEWAY_PORT) + CDP_PORT_OFFSET, color: "#00AA00" },
        },
      };
    }
  }

  // Session reset policy — EasyClaw is a desktop app; users expect chat
  // history to persist across days.  Override OpenClaw's default "daily"
  // reset (which clears context at 04:00 local time) with a long idle
  // timeout so sessions only reset after extended inactivity.
  {
    const existingSession =
      typeof config.session === "object" && config.session !== null
        ? (config.session as Record<string, unknown>)
        : {};
    config.session = {
      ...existingSession,
      reset: { mode: "idle", idleMinutes: 43200 },
    };
  }

  // Sanitize Windows-style paths in Docker bind mounts.
  // OpenClaw's Zod schema uses naive indexOf(":") which splits on the
  // drive-letter colon (e.g. "E:\OpenClaw" → source "E").
  // Convert to POSIX format before validation.
  {
    const agents = config.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    const sandbox = defaults?.sandbox as Record<string, unknown> | undefined;
    const docker = sandbox?.docker as Record<string, unknown> | undefined;
    if (docker?.binds) {
      const sanitized = sanitizeWindowsBinds(docker.binds);
      if (sanitized) {
        docker.binds = sanitized;
      }
    }
  }

  // Strip keys unrecognised by the OpenClaw schema (at any nesting level)
  // so that stale entries injected by third-party plugins, manual edits, or
  // old migrations don't cause "Config invalid – Unrecognized key" on
  // gateway startup.
  const removedKeys = stripUnknownKeys(config);
  if (removedKeys.length > 0) {
    log.warn(`Stripped unknown config keys: ${removedKeys.join(", ")}`);
  }

  // Fix semantic validation errors (e.g. dmPolicy="allowlist" without allowFrom)
  // by deleting the offending paths, escalating upward when the leaf key
  // doesn't exist (required-but-missing).  Protects EasyClaw-managed keys.
  const fixedPaths = fixSemanticErrors(config);
  if (fixedPaths.length > 0) {
    log.warn(`Fixed config validation errors by removing: ${fixedPaths.join(", ")}`);
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
