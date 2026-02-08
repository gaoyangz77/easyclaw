import type { SecretStore } from "@easyclaw/secrets";
import type { Storage } from "@easyclaw/storage";
import { ALL_PROVIDERS, PROVIDER_ENV_VARS, providerSecretKey } from "@easyclaw/core";
import { createLogger } from "@easyclaw/logger";

const log = createLogger("gateway:secret-injector");

/**
 * Static mapping for non-LLM secrets (channel tokens, STT keys, etc.).
 */
const STATIC_SECRET_ENV_MAP: Record<string, string> = {
  "wecom-corp-secret": "WECOM_CORP_SECRET",
  "wecom-token": "WECOM_TOKEN",
  "wecom-encoding-aes-key": "WECOM_ENCODING_AES_KEY",
  "stt-api-key": "STT_API_KEY", // Legacy
  "stt-groq-apikey": "GROQ_API_KEY",
  "stt-volcengine-appkey": "VOLCENGINE_APP_KEY",
  "stt-volcengine-accesskey": "VOLCENGINE_ACCESS_KEY",
};

/**
 * Resolve all known secrets into an env-var record suitable for passing
 * to the gateway child process.
 *
 * For LLM providers, each provider has its own secret key
 * (e.g. "openai-api-key" -> OPENAI_API_KEY, "anthropic-api-key" -> ANTHROPIC_API_KEY).
 * All configured provider keys are injected simultaneously so the gateway
 * can use any of them.
 *
 * Secrets that are not set (null) are silently skipped -- the gateway
 * will function with whatever subset of keys is available.
 *
 * Secret values are NEVER logged.
 */
export async function resolveSecretEnv(
  store: SecretStore,
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  // Inject all configured LLM provider API keys
  for (const provider of ALL_PROVIDERS) {
    const secretKey = providerSecretKey(provider);
    const value = await store.get(secretKey);
    if (value !== null) {
      // For Anthropic: detect OAuth/setup tokens (sk-ant-oat01-...) and inject
      // as ANTHROPIC_OAUTH_TOKEN instead of ANTHROPIC_API_KEY. OpenClaw checks
      // ANTHROPIC_OAUTH_TOKEN first, so this ensures the right auth flow is used.
      if (provider === "anthropic" && value.startsWith("sk-ant-oat01-")) {
        env["ANTHROPIC_OAUTH_TOKEN"] = value;
        log.debug("Injecting secret: " + secretKey + " -> ANTHROPIC_OAUTH_TOKEN (OAuth token detected)");
      } else {
        const envVar = PROVIDER_ENV_VARS[provider];
        env[envVar] = value;
        log.debug("Injecting secret: " + secretKey + " -> " + envVar);
      }
    }
  }

  // Also check legacy "llm-api-key" for backwards compatibility
  // (maps to OPENAI_API_KEY if no openai-specific key is set)
  if (!env["OPENAI_API_KEY"]) {
    const legacyKey = await store.get("llm-api-key");
    if (legacyKey !== null) {
      env["OPENAI_API_KEY"] = legacyKey;
      log.debug("Injecting legacy secret: llm-api-key -> OPENAI_API_KEY");
    }
  }

  // Inject non-LLM secrets
  for (const [secretKey, envVar] of Object.entries(STATIC_SECRET_ENV_MAP)) {
    const value = await store.get(secretKey);
    if (value !== null) {
      env[envVar] = value;
      log.debug("Injecting secret: " + secretKey + " -> " + envVar);
    }
  }

  log.info("Resolved " + Object.keys(env).length + " secret(s) for gateway env");
  return env;
}

/**
 * File permissions object for environment injection.
 */
export interface FilePermissions {
  workspacePath: string;
  readPaths: string[];
  writePaths: string[];
}

/**
 * Build file permissions environment variable for the gateway.
 *
 * Reads permissions from storage and constructs the EASYCLAW_FILE_PERMISSIONS
 * environment variable as a JSON string containing workspace path and access rules.
 *
 * @param storage - Storage instance to read permissions from
 * @param workspacePath - Path to the workspace directory (default cwd)
 * @returns JSON string to inject as EASYCLAW_FILE_PERMISSIONS, or null if no storage
 */
export function buildFilePermissionsEnv(
  storage: Storage | null,
  workspacePath?: string,
): string | null {
  if (!storage) {
    return null;
  }

  const permissions = storage.permissions.get();
  const filePermissions: FilePermissions = {
    workspacePath: workspacePath ?? process.cwd(),
    readPaths: permissions.readPaths,
    writePaths: permissions.writePaths,
  };

  const json = JSON.stringify(filePermissions);
  log.debug(`File permissions env built: ${json.length} chars, ${permissions.readPaths.length} read paths, ${permissions.writePaths.length} write paths`);
  return json;
}

/**
 * Build the complete environment for the gateway process.
 *
 * Merges the current process.env, any user-provided env overrides, and
 * resolved secrets. Secrets take highest precedence so they cannot be
 * accidentally overridden by config files.
 *
 * @param store - Secret store for API keys and credentials
 * @param extraEnv - Additional environment variables to merge
 * @param storage - Optional storage instance for file permissions
 * @param workspacePath - Optional workspace path (defaults to process.cwd())
 */
export async function buildGatewayEnv(
  store: SecretStore,
  extraEnv?: Record<string, string>,
  storage?: Storage | null,
  workspacePath?: string,
): Promise<Record<string, string>> {
  const secretEnv = await resolveSecretEnv(store);

  const merged: Record<string, string> = {};

  // Base environment (process.env minus undefined values)
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }

  // User-provided overrides
  if (extraEnv) {
    Object.assign(merged, extraEnv);
  }

  // Secrets take highest priority
  Object.assign(merged, secretEnv);

  // File permissions injection
  if (storage) {
    const filePermissionsJson = buildFilePermissionsEnv(storage, workspacePath);
    if (filePermissionsJson) {
      merged.EASYCLAW_FILE_PERMISSIONS = filePermissionsJson;
    }
  }

  return merged;
}
