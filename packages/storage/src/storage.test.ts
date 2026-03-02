import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage, type Storage } from "./index.js";

let storage: Storage;

beforeEach(() => {
  storage = createStorage(":memory:");
});

afterEach(() => {
  storage.close();
});

describe("RulesRepository", () => {
  it("should create and retrieve a rule", () => {
    const rule = storage.rules.create({
      id: "rule-1",
      text: "Do not access sensitive files",
    });

    expect(rule.id).toBe("rule-1");
    expect(rule.text).toBe("Do not access sensitive files");
    expect(rule.createdAt).toBeTruthy();
    expect(rule.updatedAt).toBeTruthy();

    const fetched = storage.rules.getById("rule-1");
    expect(fetched).toEqual(rule);
  });

  it("should return undefined for non-existent rule", () => {
    const result = storage.rules.getById("nonexistent");
    expect(result).toBeUndefined();
  });

  it("should get all rules", () => {
    storage.rules.create({ id: "rule-1", text: "Rule 1" });
    storage.rules.create({ id: "rule-2", text: "Rule 2" });

    const all = storage.rules.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe("rule-1");
    expect(all[1].id).toBe("rule-2");
  });

  it("should update a rule", () => {
    storage.rules.create({ id: "rule-1", text: "Original text" });

    const updated = storage.rules.update("rule-1", { text: "Updated text" });
    expect(updated).toBeDefined();
    expect(updated!.text).toBe("Updated text");
    expect(updated!.id).toBe("rule-1");

    const fetched = storage.rules.getById("rule-1");
    expect(fetched!.text).toBe("Updated text");
  });

  it("should return undefined when updating non-existent rule", () => {
    const result = storage.rules.update("nonexistent", { text: "test" });
    expect(result).toBeUndefined();
  });

  it("should delete a rule", () => {
    storage.rules.create({ id: "rule-1", text: "Rule 1" });

    const deleted = storage.rules.delete("rule-1");
    expect(deleted).toBe(true);

    const fetched = storage.rules.getById("rule-1");
    expect(fetched).toBeUndefined();
  });

  it("should return false when deleting non-existent rule", () => {
    const deleted = storage.rules.delete("nonexistent");
    expect(deleted).toBe(false);
  });
});

describe("ArtifactsRepository", () => {
  beforeEach(() => {
    storage.rules.create({ id: "rule-1", text: "Test rule" });
  });

  it("should create and retrieve artifacts by rule id", () => {
    const artifact = storage.artifacts.create({
      id: "artifact-1",
      ruleId: "rule-1",
      type: "policy-fragment",
      content: "policy content here",
      status: "ok",
      compiledAt: new Date().toISOString(),
    });

    expect(artifact.id).toBe("artifact-1");

    const fetched = storage.artifacts.getByRuleId("rule-1");
    expect(fetched).toHaveLength(1);
    expect(fetched[0].id).toBe("artifact-1");
    expect(fetched[0].type).toBe("policy-fragment");
    expect(fetched[0].outputPath).toBeUndefined();
  });

  it("should create artifact with outputPath", () => {
    storage.artifacts.create({
      id: "artifact-2",
      ruleId: "rule-1",
      type: "action-bundle",
      content: "skill content",
      outputPath: "/path/to/SKILL.md",
      status: "ok",
      compiledAt: new Date().toISOString(),
    });

    const fetched = storage.artifacts.getByRuleId("rule-1");
    expect(fetched[0].outputPath).toBe("/path/to/SKILL.md");
  });

  it("should get all artifacts", () => {
    storage.artifacts.create({
      id: "artifact-1",
      ruleId: "rule-1",
      type: "policy-fragment",
      content: "content 1",
      status: "ok",
      compiledAt: new Date().toISOString(),
    });
    storage.artifacts.create({
      id: "artifact-2",
      ruleId: "rule-1",
      type: "guard",
      content: "content 2",
      status: "pending",
      compiledAt: new Date().toISOString(),
    });

    const all = storage.artifacts.getAll();
    expect(all).toHaveLength(2);
  });

  it("should update an artifact", () => {
    storage.artifacts.create({
      id: "artifact-1",
      ruleId: "rule-1",
      type: "policy-fragment",
      content: "original",
      status: "pending",
      compiledAt: new Date().toISOString(),
    });

    const updated = storage.artifacts.update("artifact-1", {
      content: "updated content",
      status: "ok",
    });

    expect(updated).toBeDefined();
    expect(updated!.content).toBe("updated content");
    expect(updated!.status).toBe("ok");
  });

  it("should return undefined when updating non-existent artifact", () => {
    const result = storage.artifacts.update("nonexistent", { content: "test" });
    expect(result).toBeUndefined();
  });

  it("should delete artifacts by rule id", () => {
    storage.artifacts.create({
      id: "artifact-1",
      ruleId: "rule-1",
      type: "policy-fragment",
      content: "content",
      status: "ok",
      compiledAt: new Date().toISOString(),
    });
    storage.artifacts.create({
      id: "artifact-2",
      ruleId: "rule-1",
      type: "guard",
      content: "content 2",
      status: "ok",
      compiledAt: new Date().toISOString(),
    });

    const deleted = storage.artifacts.deleteByRuleId("rule-1");
    expect(deleted).toBe(2);

    const remaining = storage.artifacts.getByRuleId("rule-1");
    expect(remaining).toHaveLength(0);
  });

  it("should cascade delete artifacts when rule is deleted", () => {
    storage.artifacts.create({
      id: "artifact-1",
      ruleId: "rule-1",
      type: "policy-fragment",
      content: "content",
      status: "ok",
      compiledAt: new Date().toISOString(),
    });

    storage.rules.delete("rule-1");

    const remaining = storage.artifacts.getByRuleId("rule-1");
    expect(remaining).toHaveLength(0);
  });
});

describe("ChannelsRepository", () => {
  it("should create and retrieve a channel", () => {
    const channel = storage.channels.create({
      id: "ch-1",
      channelType: "wecom",
      enabled: true,
      accountId: "account-123",
      settings: { webhookUrl: "https://example.com/hook" },
    });

    expect(channel.id).toBe("ch-1");

    const fetched = storage.channels.getById("ch-1");
    expect(fetched).toBeDefined();
    expect(fetched!.channelType).toBe("wecom");
    expect(fetched!.enabled).toBe(true);
    expect(fetched!.settings).toEqual({ webhookUrl: "https://example.com/hook" });
  });

  it("should return undefined for non-existent channel", () => {
    const result = storage.channels.getById("nonexistent");
    expect(result).toBeUndefined();
  });

  it("should get all channels", () => {
    storage.channels.create({
      id: "ch-1",
      channelType: "wecom",
      enabled: true,
      accountId: "acc-1",
      settings: {},
    });
    storage.channels.create({
      id: "ch-2",
      channelType: "dingtalk",
      enabled: false,
      accountId: "acc-2",
      settings: {},
    });

    const all = storage.channels.getAll();
    expect(all).toHaveLength(2);
  });

  it("should update a channel", () => {
    storage.channels.create({
      id: "ch-1",
      channelType: "wecom",
      enabled: true,
      accountId: "acc-1",
      settings: {},
    });

    const updated = storage.channels.update("ch-1", {
      enabled: false,
      settings: { newSetting: "value" },
    });

    expect(updated).toBeDefined();
    expect(updated!.enabled).toBe(false);
    expect(updated!.settings).toEqual({ newSetting: "value" });
    expect(updated!.channelType).toBe("wecom"); // unchanged
  });

  it("should return undefined when updating non-existent channel", () => {
    const result = storage.channels.update("nonexistent", { enabled: false });
    expect(result).toBeUndefined();
  });

  it("should delete a channel", () => {
    storage.channels.create({
      id: "ch-1",
      channelType: "wecom",
      enabled: true,
      accountId: "acc-1",
      settings: {},
    });

    const deleted = storage.channels.delete("ch-1");
    expect(deleted).toBe(true);

    const fetched = storage.channels.getById("ch-1");
    expect(fetched).toBeUndefined();
  });

  it("should return false when deleting non-existent channel", () => {
    const deleted = storage.channels.delete("nonexistent");
    expect(deleted).toBe(false);
  });
});

describe("PermissionsRepository", () => {
  it("should return default empty permissions", () => {
    const perms = storage.permissions.get();
    expect(perms.readPaths).toEqual([]);
    expect(perms.writePaths).toEqual([]);
  });

  it("should update permissions", () => {
    const updated = storage.permissions.update({
      readPaths: ["/home/user/docs", "/tmp"],
      writePaths: ["/home/user/output"],
    });

    expect(updated.readPaths).toEqual(["/home/user/docs", "/tmp"]);
    expect(updated.writePaths).toEqual(["/home/user/output"]);

    const fetched = storage.permissions.get();
    expect(fetched.readPaths).toEqual(["/home/user/docs", "/tmp"]);
    expect(fetched.writePaths).toEqual(["/home/user/output"]);
  });

  it("should overwrite permissions completely", () => {
    storage.permissions.update({
      readPaths: ["/old/path"],
      writePaths: ["/old/write"],
    });

    storage.permissions.update({
      readPaths: ["/new/path"],
      writePaths: [],
    });

    const fetched = storage.permissions.get();
    expect(fetched.readPaths).toEqual(["/new/path"]);
    expect(fetched.writePaths).toEqual([]);
  });
});

describe("SettingsRepository", () => {
  it("should return undefined for non-existent setting", () => {
    const value = storage.settings.get("nonexistent");
    expect(value).toBeUndefined();
  });

  it("should set and get a setting", () => {
    storage.settings.set("region", "cn");

    const value = storage.settings.get("region");
    expect(value).toBe("cn");
  });

  it("should overwrite existing setting", () => {
    storage.settings.set("region", "cn");
    storage.settings.set("region", "us");

    const value = storage.settings.get("region");
    expect(value).toBe("us");
  });

  it("should get all settings", () => {
    storage.settings.set("region", "cn");
    storage.settings.set("language", "zh");
    storage.settings.set("theme", "dark");

    const all = storage.settings.getAll();
    expect(all).toEqual({
      "file-permissions-full-access": "true",
      language: "zh",
      region: "cn",
      theme: "dark",
    });
  });

  it("should delete a setting", () => {
    storage.settings.set("region", "cn");

    const deleted = storage.settings.delete("region");
    expect(deleted).toBe(true);

    const value = storage.settings.get("region");
    expect(value).toBeUndefined();
  });

  it("should return false when deleting non-existent setting", () => {
    const deleted = storage.settings.delete("nonexistent");
    expect(deleted).toBe(false);
  });
});

describe("ProviderKeysRepository", () => {
  it("should create and retrieve a provider key", () => {
    const key = storage.providerKeys.create({
      id: "key-1",
      provider: "openai",
      label: "Default",
      model: "gpt-4o",
      isDefault: true,
      createdAt: "",
      updatedAt: "",
    });

    expect(key.id).toBe("key-1");
    expect(key.provider).toBe("openai");
    expect(key.label).toBe("Default");
    expect(key.model).toBe("gpt-4o");
    expect(key.isDefault).toBe(true);
    expect(key.createdAt).toBeTruthy();

    const fetched = storage.providerKeys.getById("key-1");
    expect(fetched).toMatchObject(key);
  });

  it("should return undefined for non-existent key", () => {
    expect(storage.providerKeys.getById("nope")).toBeUndefined();
  });

  it("should get all keys", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });
    storage.providerKeys.create({ id: "k2", provider: "anthropic", label: "B", model: "claude-sonnet-4-5-20250929", isDefault: true, createdAt: "", updatedAt: "" });

    const all = storage.providerKeys.getAll();
    expect(all).toHaveLength(2);
  });

  it("should get keys by provider", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });
    storage.providerKeys.create({ id: "k2", provider: "openai", label: "B", model: "gpt-4o-mini", isDefault: false, createdAt: "", updatedAt: "" });
    storage.providerKeys.create({ id: "k3", provider: "anthropic", label: "C", model: "claude-sonnet-4-5-20250929", isDefault: true, createdAt: "", updatedAt: "" });

    const openaiKeys = storage.providerKeys.getByProvider("openai");
    expect(openaiKeys).toHaveLength(2);
    expect(openaiKeys[0].provider).toBe("openai");
  });

  it("should get default key for provider", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: false, createdAt: "", updatedAt: "" });
    storage.providerKeys.create({ id: "k2", provider: "openai", label: "B", model: "gpt-4o-mini", isDefault: true, createdAt: "", updatedAt: "" });

    const def = storage.providerKeys.getDefault("openai");
    expect(def?.id).toBe("k2");
  });

  it("should update a key", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "Old", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });

    const updated = storage.providerKeys.update("k1", { label: "New", model: "gpt-4o-mini" });
    expect(updated?.label).toBe("New");
    expect(updated?.model).toBe("gpt-4o-mini");
  });

  it("should set default and clear others within same provider", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });
    storage.providerKeys.create({ id: "k2", provider: "openai", label: "B", model: "gpt-4o-mini", isDefault: false, createdAt: "", updatedAt: "" });

    storage.providerKeys.setDefault("k2");

    expect(storage.providerKeys.getById("k1")?.isDefault).toBe(false);
    expect(storage.providerKeys.getById("k2")?.isDefault).toBe(true);
  });

  it("should set default and clear keys across ALL providers (global unique)", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });
    storage.providerKeys.create({ id: "k2", provider: "anthropic", label: "B", model: "claude-sonnet-4-5-20250929", isDefault: false, createdAt: "", updatedAt: "" });

    // Activate anthropic key — should clear openai's default
    storage.providerKeys.setDefault("k2");

    expect(storage.providerKeys.getById("k1")?.isDefault).toBe(false);
    expect(storage.providerKeys.getById("k2")?.isDefault).toBe(true);
    expect(storage.providerKeys.getActive()?.id).toBe("k2");
  });

  it("getActive() should return the single globally active key", () => {
    expect(storage.providerKeys.getActive()).toBeUndefined();

    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: false, createdAt: "", updatedAt: "" });
    expect(storage.providerKeys.getActive()).toBeUndefined();

    storage.providerKeys.create({ id: "k2", provider: "anthropic", label: "B", model: "claude-sonnet-4-5-20250929", isDefault: true, createdAt: "", updatedAt: "" });
    expect(storage.providerKeys.getActive()?.id).toBe("k2");
  });

  it("should delete a key", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });
    expect(storage.providerKeys.delete("k1")).toBe(true);
    expect(storage.providerKeys.getById("k1")).toBeUndefined();
  });

  it("should return false when deleting non-existent key", () => {
    expect(storage.providerKeys.delete("nope")).toBe(false);
  });

  it("should create and update a local provider key with baseUrl", () => {
    const key = storage.providerKeys.create({
      id: "local-1",
      provider: "ollama",
      label: "Ollama",
      model: "llama3.2",
      isDefault: true,
      authType: "local",
      baseUrl: "http://localhost:11434",
      createdAt: "",
      updatedAt: "",
    });

    expect(key.provider).toBe("ollama");
    expect(key.authType).toBe("local");
    expect(key.baseUrl).toBe("http://localhost:11434");

    const fetched = storage.providerKeys.getById("local-1");
    expect(fetched?.baseUrl).toBe("http://localhost:11434");
    expect(fetched?.authType).toBe("local");

    // Update baseUrl
    const updated = storage.providerKeys.update("local-1", { baseUrl: "http://192.168.1.100:11434" });
    expect(updated?.baseUrl).toBe("http://192.168.1.100:11434");

    // Verify persisted
    const refetched = storage.providerKeys.getById("local-1");
    expect(refetched?.baseUrl).toBe("http://192.168.1.100:11434");
  });
});

describe("UsageSnapshotsRepository", () => {
  it("should insert and getLatest", () => {
    storage.usageSnapshots.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      totalCostUsd: "0.05",
      snapshotTime: 1000000,
    });

    const latest = storage.usageSnapshots.getLatest("key-1", "gpt-4o");
    expect(latest).toBeDefined();
    expect(latest!.keyId).toBe("key-1");
    expect(latest!.provider).toBe("openai");
    expect(latest!.model).toBe("gpt-4o");
    expect(latest!.inputTokens).toBe(1000);
    expect(latest!.outputTokens).toBe(500);
    expect(latest!.cacheReadTokens).toBe(100);
    expect(latest!.cacheWriteTokens).toBe(50);
    expect(latest!.totalCostUsd).toBe("0.05");
    expect(latest!.snapshotTime).toBe(1000000);
  });

  it("should return undefined when no snapshots exist", () => {
    const latest = storage.usageSnapshots.getLatest("key-1", "gpt-4o");
    expect(latest).toBeUndefined();
  });

  it("should getRecent with limit", () => {
    storage.usageSnapshots.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalCostUsd: "0.01",
      snapshotTime: 1000000,
    });
    storage.usageSnapshots.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      totalCostUsd: "0.02",
      snapshotTime: 2000000,
    });
    storage.usageSnapshots.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 300,
      outputTokens: 150,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalCostUsd: "0.03",
      snapshotTime: 3000000,
    });

    const recent = storage.usageSnapshots.getRecent("key-1", "gpt-4o", 2);
    expect(recent).toHaveLength(2);
    // newest first
    expect(recent[0].snapshotTime).toBe(3000000);
    expect(recent[1].snapshotTime).toBe(2000000);
  });

  it("should pruneOld keeping only N newest", () => {
    for (let i = 1; i <= 6; i++) {
      storage.usageSnapshots.insert({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: i * 100,
        outputTokens: i * 50,
        cacheReadTokens: i * 10,
        cacheWriteTokens: i * 5,
        totalCostUsd: `${(i * 0.01).toFixed(2)}`,
        snapshotTime: i * 1000000,
      });
    }

    const deleted = storage.usageSnapshots.pruneOld("key-1", "gpt-4o", 5);
    expect(deleted).toBe(1);

    const remaining = storage.usageSnapshots.getRecent("key-1", "gpt-4o", 10);
    expect(remaining).toHaveLength(5);
    // oldest (snapshotTime=1000000) should be gone
    expect(remaining.every((s) => s.snapshotTime >= 2000000)).toBe(true);
  });

  it("should not interfere between different key/model pairs", () => {
    storage.usageSnapshots.insert({
      keyId: "keyA",
      provider: "openai",
      model: "modelX",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalCostUsd: "0.01",
      snapshotTime: 1000000,
    });
    storage.usageSnapshots.insert({
      keyId: "keyB",
      provider: "anthropic",
      model: "modelY",
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      totalCostUsd: "0.02",
      snapshotTime: 2000000,
    });

    const latestA = storage.usageSnapshots.getLatest("keyA", "modelX");
    expect(latestA).toBeDefined();
    expect(latestA!.keyId).toBe("keyA");
    expect(latestA!.inputTokens).toBe(100);

    const latestB = storage.usageSnapshots.getLatest("keyB", "modelY");
    expect(latestB).toBeDefined();
    expect(latestB!.keyId).toBe("keyB");
    expect(latestB!.inputTokens).toBe(200);

    // Cross-lookup returns undefined
    expect(storage.usageSnapshots.getLatest("keyA", "modelY")).toBeUndefined();
    expect(storage.usageSnapshots.getLatest("keyB", "modelX")).toBeUndefined();
  });
});

describe("KeyUsageHistoryRepository", () => {
  it("should insert and queryByWindow", () => {
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      totalCostUsd: "0.03",
    });

    const results = storage.keyUsageHistory.queryByWindow({
      windowStart: 1000000,
      windowEnd: 3000000,
    });
    expect(results).toHaveLength(1);
    expect(results[0].keyId).toBe("key-1");
    expect(results[0].provider).toBe("openai");
    expect(results[0].model).toBe("gpt-4o");
    expect(results[0].startTime).toBe(1000000);
    expect(results[0].endTime).toBe(2000000);
    expect(results[0].inputTokens).toBe(500);
    expect(results[0].outputTokens).toBe(200);
    expect(results[0].cacheReadTokens).toBe(50);
    expect(results[0].cacheWriteTokens).toBe(25);
    expect(results[0].totalCostUsd).toBe("0.03");
  });

  it("should return empty when no records match", () => {
    const results = storage.keyUsageHistory.queryByWindow({
      windowStart: 1000000,
      windowEnd: 3000000,
    });
    expect(results).toHaveLength(0);
  });

  it("should filter by keyId", () => {
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      totalCostUsd: "0.03",
    });
    storage.keyUsageHistory.insert({
      keyId: "key-2",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 300,
      outputTokens: 100,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalCostUsd: "0.02",
    });

    const results = storage.keyUsageHistory.queryByWindow({
      windowStart: 1000000,
      windowEnd: 3000000,
      keyId: "key-1",
    });
    expect(results).toHaveLength(1);
    expect(results[0].keyId).toBe("key-1");
  });

  it("should filter by provider", () => {
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      totalCostUsd: "0.03",
    });
    storage.keyUsageHistory.insert({
      keyId: "key-2",
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 400,
      outputTokens: 150,
      cacheReadTokens: 40,
      cacheWriteTokens: 20,
      totalCostUsd: "0.04",
    });

    const results = storage.keyUsageHistory.queryByWindow({
      windowStart: 1000000,
      windowEnd: 3000000,
      provider: "anthropic",
    });
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("anthropic");
  });

  it("should filter by model", () => {
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      totalCostUsd: "0.03",
    });
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o-mini",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 300,
      outputTokens: 100,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalCostUsd: "0.01",
    });

    const results = storage.keyUsageHistory.queryByWindow({
      windowStart: 1000000,
      windowEnd: 3000000,
      model: "gpt-4o-mini",
    });
    expect(results).toHaveLength(1);
    expect(results[0].model).toBe("gpt-4o-mini");
  });

  it("should exclude records outside the window", () => {
    // Record with end_time outside the window
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 5000000,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      totalCostUsd: "0.03",
    });
    // Record with end_time inside the window
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 300,
      outputTokens: 100,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalCostUsd: "0.02",
    });

    const results = storage.keyUsageHistory.queryByWindow({
      windowStart: 1000000,
      windowEnd: 3000000,
    });
    expect(results).toHaveLength(1);
    expect(results[0].endTime).toBe(2000000);
  });

  it("should return multiple records ordered by end_time DESC", () => {
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 1000000,
      endTime: 2000000,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalCostUsd: "0.01",
    });
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 2000000,
      endTime: 3000000,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      totalCostUsd: "0.02",
    });
    storage.keyUsageHistory.insert({
      keyId: "key-1",
      provider: "openai",
      model: "gpt-4o",
      startTime: 3000000,
      endTime: 4000000,
      inputTokens: 300,
      outputTokens: 150,
      cacheReadTokens: 30,
      cacheWriteTokens: 15,
      totalCostUsd: "0.03",
    });

    const results = storage.keyUsageHistory.queryByWindow({
      windowStart: 1000000,
      windowEnd: 5000000,
    });
    expect(results).toHaveLength(3);
    // Ordered by end_time DESC
    expect(results[0].endTime).toBe(4000000);
    expect(results[1].endTime).toBe(3000000);
    expect(results[2].endTime).toBe(2000000);
  });
});

describe("Database", () => {
  it("should create storage with in-memory database", () => {
    expect(storage.db).toBeDefined();
    expect(storage.rules).toBeDefined();
    expect(storage.artifacts).toBeDefined();
    expect(storage.channels).toBeDefined();
    expect(storage.permissions).toBeDefined();
    expect(storage.settings).toBeDefined();
    expect(storage.providerKeys).toBeDefined();
  });

  it("should track applied migrations", () => {
    const rows = storage.db
      .prepare("SELECT * FROM _migrations")
      .all() as Array<{ id: number; name: string; applied_at: string }>;

    expect(rows).toHaveLength(13);
    expect(rows[0].id).toBe(1);
    expect(rows[0].name).toBe("initial_schema");
    expect(rows[1].id).toBe(2);
    expect(rows[1].name).toBe("add_provider_keys_table");
    expect(rows[5].id).toBe(6);
    expect(rows[5].name).toBe("add_auth_type_to_provider_keys");
    expect(rows[6].id).toBe(7);
    expect(rows[6].name).toBe("add_budget_columns_to_provider_keys");
    expect(rows[7].id).toBe(8);
    expect(rows[7].name).toBe("add_usage_snapshots_and_history");
    expect(rows[8].id).toBe(9);
    expect(rows[8].name).toBe("add_base_url_to_provider_keys");
    expect(rows[9].id).toBe(10);
    expect(rows[9].name).toBe("add_custom_provider_columns");
    expect(rows[11].id).toBe(12);
    expect(rows[11].name).toBe("add_chat_sessions_table");
  });

  it("should not re-apply migrations on second open", () => {
    // Close and reopen - migrations should be idempotent
    storage.close();
    storage = createStorage(":memory:");

    const rows = storage.db
      .prepare("SELECT * FROM _migrations")
      .all() as Array<{ id: number; name: string }>;

    expect(rows).toHaveLength(13);
  });
});
