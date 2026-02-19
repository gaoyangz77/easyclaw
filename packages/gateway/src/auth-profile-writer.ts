import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createLogger } from "@easyclaw/logger";
import { resolveGatewayProvider, type LLMProvider } from "@easyclaw/core";

const log = createLogger("gateway:auth-profile");

const AUTH_PROFILE_FILENAME = "auth-profiles.json";
const DEFAULT_AGENT_ID = "main";

type ApiKeyProfile = { type: "api_key"; provider: string; key: string };
type OAuthProfile = {
  type: "oauth";
  provider: string;
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  projectId?: string;
};
type AuthProfileCredential = ApiKeyProfile | OAuthProfile;

/**
 * Minimal auth-profile store structure — matches OpenClaw's AuthProfileStore.
 * Supports both api_key and oauth credential types.
 */
interface AuthProfileStore {
  version: number;
  profiles: Record<string, AuthProfileCredential>;
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

  // Use the gateway provider name so OpenClaw can match it to the model config.
  // e.g. "claude" → "anthropic", "gemini" → "google"
  const gwProvider = resolveGatewayProvider(provider as LLMProvider);
  const profileId = `${gwProvider}:active`;
  store.profiles[profileId] = { type: "api_key", provider: gwProvider, key: apiKey };
  store.order = store.order ?? {};
  store.order[gwProvider] = [profileId];

  writeStore(filePath, store);
  log.info(`Synced auth profile for ${provider} (gateway: ${gwProvider})`);
}

/**
 * Remove a provider's profile from auth-profiles.json.
 */
export function removeAuthProfile(stateDir: string, provider: string): void {
  const filePath = resolveAuthProfilePath(stateDir);
  const store = readStore(filePath);

  const gwProvider = resolveGatewayProvider(provider as LLMProvider);
  const profileId = `${gwProvider}:active`;
  delete store.profiles[profileId];
  if (store.order) {
    delete store.order[gwProvider];
  }

  writeStore(filePath, store);
  log.info(`Removed auth profile for ${provider} (gateway: ${gwProvider})`);
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
      getAll(): Array<{
        id: string;
        provider: string;
        isDefault: boolean;
        authType?: string;
      }>;
    };
  },
  secretStore: { get(key: string): Promise<string | null> },
): Promise<void> {
  const filePath = resolveAuthProfilePath(stateDir);
  const store: AuthProfileStore = { version: 1, profiles: {}, order: {} };

  const allKeys = storage.providerKeys.getAll();
  const activeKeys = allKeys.filter((k) => k.isDefault);

  for (const key of activeKeys) {
    // Use the gateway provider name so OpenClaw can match it to the model config.
    const gwProvider = resolveGatewayProvider(key.provider as LLMProvider);

    if (key.authType === "oauth") {
      // OAuth entry: read credential JSON from Keychain
      const credJson = await secretStore.get(`oauth-cred-${key.id}`);
      if (credJson) {
        try {
          const cred = JSON.parse(credJson) as {
            access: string;
            refresh: string;
            expires: number;
            email?: string;
            projectId?: string;
          };
          const profileId = `${gwProvider}:${cred.email ?? "default"}`;
          store.profiles[profileId] = {
            type: "oauth",
            provider: gwProvider,
            access: cred.access,
            refresh: cred.refresh,
            expires: cred.expires,
            email: cred.email,
            projectId: cred.projectId,
          };
          store.order![gwProvider] = [profileId];
        } catch {
          log.warn(`Failed to parse OAuth credential for ${key.provider} (key ${key.id})`);
        }
      }
    } else {
      // API key entry: existing behavior
      const apiKey = await secretStore.get(`provider-key-${key.id}`);
      if (apiKey) {
        const profileId = `${gwProvider}:active`;
        store.profiles[profileId] = {
          type: "api_key",
          provider: gwProvider,
          key: apiKey,
        };
        store.order![gwProvider] = [profileId];
      }
    }
  }

  writeStore(filePath, store);
  log.info(`Synced ${Object.keys(store.profiles).length} auth profile(s)`);
}

/**
 * Sync back OAuth credentials from auth-profiles.json to Keychain.
 *
 * OpenClaw may refresh OAuth access tokens during runtime. Before shutdown,
 * we read the (possibly refreshed) tokens from auth-profiles.json and write
 * them back to Keychain so the latest tokens survive across restarts.
 *
 * Call this BEFORE clearAllAuthProfiles().
 */
export async function syncBackOAuthCredentials(
  stateDir: string,
  storage: {
    providerKeys: {
      getAll(): Array<{
        id: string;
        provider: string;
        isDefault: boolean;
        authType?: string;
      }>;
    };
  },
  secretStore: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  },
): Promise<void> {
  const filePath = resolveAuthProfilePath(stateDir);
  const store = readStore(filePath);

  const oauthKeys = storage.providerKeys
    .getAll()
    .filter((k) => k.authType === "oauth" && k.isDefault);

  let synced = 0;
  for (const key of oauthKeys) {
    // Find the matching profile in auth-profiles.json using the gateway provider name
    const gwProvider = resolveGatewayProvider(key.provider as LLMProvider);
    const matchingProfile = Object.values(store.profiles).find(
      (p) => p.type === "oauth" && p.provider === gwProvider,
    ) as OAuthProfile | undefined;

    if (!matchingProfile) continue;

    // Read current credential from Keychain
    const currentJson = await secretStore.get(`oauth-cred-${key.id}`);
    const updated = JSON.stringify({
      access: matchingProfile.access,
      refresh: matchingProfile.refresh,
      expires: matchingProfile.expires,
      email: matchingProfile.email,
      projectId: matchingProfile.projectId,
    });

    // Only write back if different (avoids unnecessary Keychain writes)
    if (currentJson !== updated) {
      await secretStore.set(`oauth-cred-${key.id}`, updated);
      synced++;
    }
  }

  if (synced > 0) {
    log.info(`Synced back ${synced} refreshed OAuth credential(s) to Keychain`);
  }
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
