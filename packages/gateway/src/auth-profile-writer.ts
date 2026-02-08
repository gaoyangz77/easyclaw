import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createLogger } from "@easyclaw/logger";

const log = createLogger("gateway:auth-profile");

const AUTH_PROFILE_FILENAME = "auth-profiles.json";
const DEFAULT_AGENT_ID = "main";

/**
 * Minimal auth-profile store structure — matches OpenClaw's AuthProfileStore.
 * We only use the `api_key` credential type.
 */
interface AuthProfileStore {
  version: number;
  profiles: Record<string, { type: "api_key"; provider: string; key: string }>;
  order?: Record<string, string[]>;
}

/**
 * Resolve the auth-profiles.json path from an OpenClaw state directory.
 * Path: {stateDir}/agents/main/agent/auth-profiles.json
 */
export function resolveAuthProfilePath(stateDir: string): string {
  return join(stateDir, "agents", DEFAULT_AGENT_ID, "agent", AUTH_PROFILE_FILENAME);
}

/**
 * Read the current auth-profiles.json from disk.
 * Returns an empty store if the file doesn't exist or can't be parsed.
 */
function readStore(filePath: string): AuthProfileStore {
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      if (data && typeof data === "object" && data.version === 1) {
        return data as AuthProfileStore;
      }
    }
  } catch {
    log.warn(`Failed to read auth profiles at ${filePath}, starting fresh`);
  }
  return { version: 1, profiles: {}, order: {} };
}

/**
 * Write the auth profile store to disk with restricted permissions (0o600).
 * Matches OpenClaw's convention: directory 0o700, file 0o600.
 */
function writeStore(filePath: string, store: AuthProfileStore): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(filePath, JSON.stringify(store, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Sync a single provider's active API key into auth-profiles.json.
 *
 * Uses the profile ID `{provider}:active` and sets the order for that
 * provider so OpenClaw picks it up on the next LLM turn — no restart needed.
 */
export function syncAuthProfile(
  stateDir: string,
  provider: string,
  apiKey: string,
): void {
  const filePath = resolveAuthProfilePath(stateDir);
  const store = readStore(filePath);

  const profileId = `${provider}:active`;
  store.profiles[profileId] = { type: "api_key", provider, key: apiKey };
  store.order = store.order ?? {};
  store.order[provider] = [profileId];

  writeStore(filePath, store);
  log.info(`Synced auth profile for ${provider}`);
}

/**
 * Remove a provider's profile from auth-profiles.json.
 */
export function removeAuthProfile(stateDir: string, provider: string): void {
  const filePath = resolveAuthProfilePath(stateDir);
  const store = readStore(filePath);

  const profileId = `${provider}:active`;
  delete store.profiles[profileId];
  if (store.order) {
    delete store.order[provider];
  }

  writeStore(filePath, store);
  log.info(`Removed auth profile for ${provider}`);
}

/**
 * Sync ALL active provider keys to auth-profiles.json.
 *
 * Reads every default key from storage, fetches the secret value
 * from the secret store, and writes them all to auth-profiles.json.
 *
 * Intended to be called once at startup so the gateway has all
 * active keys available from the first turn.
 */
export async function syncAllAuthProfiles(
  stateDir: string,
  storage: {
    providerKeys: {
      getAll(): Array<{ id: string; provider: string; isDefault: boolean }>;
    };
  },
  secretStore: { get(key: string): Promise<string | null> },
): Promise<void> {
  const filePath = resolveAuthProfilePath(stateDir);
  const store: AuthProfileStore = { version: 1, profiles: {}, order: {} };

  const allKeys = storage.providerKeys.getAll();
  const activeKeys = allKeys.filter((k) => k.isDefault);

  for (const key of activeKeys) {
    const apiKey = await secretStore.get(`provider-key-${key.id}`);
    if (apiKey) {
      const profileId = `${key.provider}:active`;
      store.profiles[profileId] = {
        type: "api_key",
        provider: key.provider,
        key: apiKey,
      };
      store.order![key.provider] = [profileId];
    }
  }

  writeStore(filePath, store);
  log.info(`Synced ${Object.keys(store.profiles).length} auth profile(s)`);
}

/**
 * Clear all auth profiles from auth-profiles.json.
 * Called on app shutdown to remove sensitive API keys from disk.
 */
export function clearAllAuthProfiles(stateDir: string): void {
  const filePath = resolveAuthProfilePath(stateDir);
  const emptyStore: AuthProfileStore = { version: 1, profiles: {}, order: {} };
  writeStore(filePath, emptyStore);
  log.info("Cleared all auth profiles");
}
