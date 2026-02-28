import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveAuthProfilePath,
  syncAuthProfile,
  removeAuthProfile,
  syncAllAuthProfiles,
  clearAllAuthProfiles,
} from "./auth-profile-writer.js";

/**
 * Vendor source paths — used to verify our auth-profile format
 * matches what the vendor code actually accepts.
 */
const VENDOR_ROOT = resolve(import.meta.dirname, "../../../vendor/openclaw");

function createTempDir(): string {
  const dir = join(tmpdir(), `auth-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("resolveAuthProfilePath", () => {
  it("returns the correct path structure", () => {
    const result = resolveAuthProfilePath("/home/user/.easyclaw/openclaw");
    expect(result).toBe(join("/home/user/.easyclaw/openclaw", "agents", "main", "agent", "auth-profiles.json"));
  });
});

describe("syncAuthProfile", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = createTempDir();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("creates auth-profiles.json with a single provider key", () => {
    syncAuthProfile(stateDir, "qwen", "sk-test-key-123");

    const filePath = resolveAuthProfilePath(stateDir);
    expect(existsSync(filePath)).toBe(true);

    const store = readJsonFile(filePath) as Record<string, unknown>;
    expect(store).toEqual({
      version: 1,
      profiles: {
        "qwen:active": {
          type: "api_key",
          provider: "qwen",
          key: "sk-test-key-123",
        },
      },
      order: {
        qwen: ["qwen:active"],
      },
    });
  });

  it("overwrites existing profile for the same provider", () => {
    syncAuthProfile(stateDir, "qwen", "sk-old-key");
    syncAuthProfile(stateDir, "qwen", "sk-new-key");

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, Record<string, string>>;
    expect(profiles["qwen:active"].key).toBe("sk-new-key");
  });

  it("preserves other providers when syncing one", () => {
    syncAuthProfile(stateDir, "openai", "sk-openai-key");
    syncAuthProfile(stateDir, "qwen", "sk-qwen-key");

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, Record<string, string>>;
    expect(profiles["openai:active"].key).toBe("sk-openai-key");
    expect(profiles["qwen:active"].key).toBe("sk-qwen-key");
  });

  it("maps subscription plan names to gateway provider names", () => {
    syncAuthProfile(stateDir, "claude", "sk-claude-token");

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, Record<string, string>>;
    const order = store.order as Record<string, string[]>;

    // "claude" should be stored under "anthropic" (the gateway provider name)
    expect(profiles["anthropic:active"]).toBeDefined();
    expect(profiles["anthropic:active"].provider).toBe("anthropic");
    expect(profiles["anthropic:active"].key).toBe("sk-claude-token");
    expect(order["anthropic"]).toEqual(["anthropic:active"]);
    // No "claude" key should exist
    expect(profiles["claude:active"]).toBeUndefined();
    expect(order["claude"]).toBeUndefined();
  });
});

describe("removeAuthProfile", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = createTempDir();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("removes a provider's profile and order", () => {
    syncAuthProfile(stateDir, "openai", "sk-openai-key");
    syncAuthProfile(stateDir, "qwen", "sk-qwen-key");

    removeAuthProfile(stateDir, "qwen");

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, unknown>;
    const order = store.order as Record<string, string[]>;

    expect(profiles["qwen:active"]).toBeUndefined();
    expect(order["qwen"]).toBeUndefined();
    // OpenAI should still be there
    expect(profiles["openai:active"]).toBeDefined();
    expect(order["openai"]).toEqual(["openai:active"]);
  });

  it("handles removing from empty store", () => {
    removeAuthProfile(stateDir, "qwen");

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    expect(store).toEqual({ version: 1, profiles: {}, order: {} });
  });
});

describe("syncAllAuthProfiles", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = createTempDir();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("syncs all active keys from storage", async () => {
    const mockStorage = {
      providerKeys: {
        getAll: () => [
          { id: "key-1", provider: "openai", isDefault: true },
          { id: "key-2", provider: "openai", isDefault: false },
          { id: "key-3", provider: "qwen", isDefault: false },
        ],
      },
    };
    const mockSecretStore = {
      get: async (key: string) => {
        const secrets: Record<string, string> = {
          "provider-key-key-1": "sk-openai-active",
          "provider-key-key-2": "sk-openai-inactive",
          "provider-key-key-3": "sk-qwen-active",
        };
        return secrets[key] ?? null;
      },
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;

    expect(store).toEqual({
      version: 1,
      profiles: {
        "openai:active": {
          type: "api_key",
          provider: "openai",
          key: "sk-openai-active",
        },
      },
      order: {
        openai: ["openai:active"],
      },
    });
  });

  it("skips keys not found in secret store", async () => {
    const mockStorage = {
      providerKeys: {
        getAll: () => [
          { id: "key-1", provider: "openai", isDefault: true },
          { id: "key-2", provider: "qwen", isDefault: false },
        ],
      },
    };
    const mockSecretStore = {
      get: async () => null,
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, unknown>;

    // Active key exists but its secret is missing — skipped
    expect(profiles["openai:active"]).toBeUndefined();
  });

  it("writes empty store when no keys configured", async () => {
    const mockStorage = {
      providerKeys: {
        getAll: () => [],
      },
    };
    const mockSecretStore = {
      get: async () => null,
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    expect(store).toEqual({ version: 1, profiles: {}, order: {} });
  });

  it("maps subscription plan names to gateway provider names", async () => {
    const mockStorage = {
      providerKeys: {
        getAll: () => [
          { id: "key-1", provider: "claude", isDefault: true },
        ],
      },
    };
    const mockSecretStore = {
      get: async (key: string) => {
        if (key === "provider-key-key-1") return "sk-claude-token";
        return null;
      },
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, Record<string, string>>;
    const order = store.order as Record<string, string[]>;

    // "claude" key should be stored under "anthropic" gateway name
    expect(profiles["anthropic:active"]).toBeDefined();
    expect(profiles["anthropic:active"].provider).toBe("anthropic");
    expect(order["anthropic"]).toEqual(["anthropic:active"]);
  });

  it("replaces previous profiles entirely", async () => {
    // First sync with 2 providers
    syncAuthProfile(stateDir, "deepseek", "sk-old-deepseek");

    const mockStorage = {
      providerKeys: {
        getAll: () => [
          { id: "key-1", provider: "qwen", isDefault: true },
        ],
      },
    };
    const mockSecretStore = {
      get: async (key: string) => {
        if (key === "provider-key-key-1") return "sk-qwen-new";
        return null;
      },
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, unknown>;

    // deepseek should be gone (syncAll replaces the entire file)
    expect(profiles["deepseek:active"]).toBeUndefined();
    expect(profiles["qwen:active"]).toBeDefined();
  });
});

describe("clearAllAuthProfiles", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = createTempDir();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("clears all profiles and creates empty store", () => {
    // First, add some profiles
    syncAuthProfile(stateDir, "openai", "sk-openai-key");
    syncAuthProfile(stateDir, "qwen", "sk-qwen-key");
    syncAuthProfile(stateDir, "anthropic", "sk-anthropic-key");

    // Verify they exist
    const filePath = resolveAuthProfilePath(stateDir);
    let store = readJsonFile(filePath) as Record<string, unknown>;
    let profiles = store.profiles as Record<string, unknown>;
    expect(Object.keys(profiles).length).toBe(3);

    // Clear all profiles
    clearAllAuthProfiles(stateDir);

    // Verify store is now empty
    store = readJsonFile(filePath) as Record<string, unknown>;
    expect(store).toEqual({ version: 1, profiles: {}, order: {} });
  });

  it("handles clearing when file doesn't exist", () => {
    // Should create empty store without throwing
    expect(() => clearAllAuthProfiles(stateDir)).not.toThrow();

    const filePath = resolveAuthProfilePath(stateDir);
    expect(existsSync(filePath)).toBe(true);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    expect(store).toEqual({ version: 1, profiles: {}, order: {} });
  });

  it("handles clearing already empty store", () => {
    // Create empty store first
    clearAllAuthProfiles(stateDir);

    // Clear again
    clearAllAuthProfiles(stateDir);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    expect(store).toEqual({ version: 1, profiles: {}, order: {} });
  });
});

/**
 * Contract tests: verify our auth-profile format matches what the vendor accepts.
 *
 * These tests read the vendor source code directly to extract expected values.
 * If the vendor changes its format, these tests fail BEFORE we ship a broken build.
 */
describe("vendor contract: auth profile format", () => {
  it("vendor's buildOAuthApiKey wraps google-gemini-cli credentials as JSON", () => {
    // Our auth profiles use provider="google-gemini-cli" for Google OAuth.
    // The vendor's buildOAuthApiKey must wrap this as JSON {token, projectId}
    // for the google-gemini-cli streaming function to parse.
    const oauthSrc = readFileSync(
      join(VENDOR_ROOT, "src/agents/auth-profiles/oauth.ts"),
      "utf-8",
    );
    // Vendor checks for "google-gemini-cli" to decide JSON wrapping
    expect(oauthSrc).toContain('"google-gemini-cli"');
    expect(oauthSrc).toContain("credentials.access");
    expect(oauthSrc).toContain("credentials.projectId");
  });

  it("vendor's normalizeProviderId preserves google-gemini-cli", () => {
    // Profile lookup uses normalizeProviderId(cred.provider) === normalizeProviderId(model.provider).
    // Both sides must resolve to the same string for google-gemini-cli.
    const selectionSrc = readFileSync(
      join(VENDOR_ROOT, "src/agents/model-selection.ts"),
      "utf-8",
    );
    // normalizeProviderId should NOT alias "google-gemini-cli" to something else.
    // Verify it's a simple toLowerCase passthrough (no special mapping for this ID).
    expect(selectionSrc).toContain("export function normalizeProviderId");
    // The function should not contain a mapping that changes "google-gemini-cli"
    expect(selectionSrc).not.toContain('"google-gemini-cli"');
  });

  it("OAuth credential fields match vendor's OAuthCredential type", () => {
    const typesSrc = readFileSync(
      join(VENDOR_ROOT, "src/agents/auth-profiles/types.ts"),
      "utf-8",
    );
    expect(typesSrc).toContain('type: "oauth"');
    expect(typesSrc).toContain("provider: string");
    expect(typesSrc).toContain("email?: string");
  });

  it("API key credential fields match vendor's ApiKeyCredential type", () => {
    const typesSrc = readFileSync(
      join(VENDOR_ROOT, "src/agents/auth-profiles/types.ts"),
      "utf-8",
    );
    expect(typesSrc).toContain('type: "api_key"');
    expect(typesSrc).toContain("provider: string");
    expect(typesSrc).toContain("key?: string");
  });

  it("OAuth base fields match pi-ai's OAuthCredentials type", () => {
    const piaiTypesSrc = readFileSync(
      join(VENDOR_ROOT, "node_modules/@mariozechner/pi-ai/dist/utils/oauth/types.d.ts"),
      "utf-8",
    );
    expect(piaiTypesSrc).toContain("refresh: string");
    expect(piaiTypesSrc).toContain("access: string");
    expect(piaiTypesSrc).toContain("expires: number");
    expect(piaiTypesSrc).toContain("[key: string]: unknown");
  });

  it("google-gemini-cli models exist in vendor's model catalog", () => {
    const modelsSrc = readFileSync(
      join(VENDOR_ROOT, "node_modules/@mariozechner/pi-ai/dist/models.generated.js"),
      "utf-8",
    );
    // Verify google-gemini-cli models are registered with correct API type
    expect(modelsSrc).toContain('provider: "google-gemini-cli"');
    expect(modelsSrc).toContain('api: "google-gemini-cli"');
  });
});

describe("syncAllAuthProfiles: OAuth entries", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = createTempDir();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("writes Google OAuth with provider google-gemini-cli for Bearer auth path", async () => {
    const mockStorage = {
      providerKeys: {
        getAll: () => [
          { id: "oauth-key-1", provider: "gemini", isDefault: true, authType: "oauth" },
        ],
      },
    };
    const mockSecretStore = {
      get: async (key: string) => {
        if (key === "oauth-cred-oauth-key-1") {
          return JSON.stringify({
            access: "ya29.test-access-token",
            refresh: "1//test-refresh-token",
            expires: Date.now() + 3600_000,
            email: "user@gmail.com",
            projectId: "test-project-id",
          });
        }
        return null;
      },
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as {
      profiles: Record<string, Record<string, unknown>>;
      order: Record<string, string[]>;
    };

    // Google OAuth uses "google-gemini-cli" provider to match vendor's
    // Cloud Code Assist API (Bearer auth), not "google" (x-goog-api-key).
    const profile = store.profiles["google-gemini-cli:user@gmail.com"];
    expect(profile).toBeDefined();
    expect(profile.type).toBe("oauth");
    expect(profile.provider).toBe("google-gemini-cli");
    expect(profile.access).toBe("ya29.test-access-token");
    expect(profile.refresh).toBe("1//test-refresh-token");
    expect(profile.email).toBe("user@gmail.com");
    expect(profile.projectId).toBe("test-project-id");

    // Order key must use "google-gemini-cli" to match model routing
    expect(store.order["google-gemini-cli"]).toEqual(["google-gemini-cli:user@gmail.com"]);
  });

  it("writes non-Google OAuth as oauth type normally", async () => {
    const mockStorage = {
      providerKeys: {
        getAll: () => [
          { id: "oauth-key-2", provider: "openai", isDefault: true, authType: "oauth" },
        ],
      },
    };
    const mockSecretStore = {
      get: async (key: string) => {
        if (key === "oauth-cred-oauth-key-2") {
          return JSON.stringify({
            access: "test-access-token",
            refresh: "test-refresh-token",
            expires: Date.now() + 3600_000,
            email: "user@example.com",
          });
        }
        return null;
      },
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as {
      profiles: Record<string, Record<string, unknown>>;
      order: Record<string, string[]>;
    };

    const profile = store.profiles["openai:user@example.com"];
    expect(profile).toBeDefined();
    expect(profile.type).toBe("oauth");
    expect(profile.provider).toBe("openai");
    expect(profile.access).toBe("test-access-token");
  });
});
