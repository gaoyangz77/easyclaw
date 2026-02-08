import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveAuthProfilePath,
  syncAuthProfile,
  removeAuthProfile,
  syncAllAuthProfiles,
  clearAllAuthProfiles,
} from "./auth-profile-writer.js";

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
    expect(result).toBe("/home/user/.easyclaw/openclaw/agents/main/agent/auth-profiles.json");
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
          { id: "key-3", provider: "qwen", isDefault: true },
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
        "qwen:active": {
          type: "api_key",
          provider: "qwen",
          key: "sk-qwen-active",
        },
      },
      order: {
        openai: ["openai:active"],
        qwen: ["qwen:active"],
      },
    });
  });

  it("skips keys not found in secret store", async () => {
    const mockStorage = {
      providerKeys: {
        getAll: () => [
          { id: "key-1", provider: "openai", isDefault: true },
          { id: "key-2", provider: "qwen", isDefault: true },
        ],
      },
    };
    const mockSecretStore = {
      get: async (key: string) => {
        // Only openai key exists in secret store
        if (key === "provider-key-key-1") return "sk-openai-key";
        return null;
      },
    };

    await syncAllAuthProfiles(stateDir, mockStorage, mockSecretStore);

    const filePath = resolveAuthProfilePath(stateDir);
    const store = readJsonFile(filePath) as Record<string, unknown>;
    const profiles = store.profiles as Record<string, unknown>;

    expect(profiles["openai:active"]).toBeDefined();
    expect(profiles["qwen:active"]).toBeUndefined();
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
