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

  it("should set default and clear others", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });
    storage.providerKeys.create({ id: "k2", provider: "openai", label: "B", model: "gpt-4o-mini", isDefault: false, createdAt: "", updatedAt: "" });

    storage.providerKeys.setDefault("k2");

    expect(storage.providerKeys.getById("k1")?.isDefault).toBe(false);
    expect(storage.providerKeys.getById("k2")?.isDefault).toBe(true);
  });

  it("should delete a key", () => {
    storage.providerKeys.create({ id: "k1", provider: "openai", label: "A", model: "gpt-4o", isDefault: true, createdAt: "", updatedAt: "" });
    expect(storage.providerKeys.delete("k1")).toBe(true);
    expect(storage.providerKeys.getById("k1")).toBeUndefined();
  });

  it("should return false when deleting non-existent key", () => {
    expect(storage.providerKeys.delete("nope")).toBe(false);
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

    expect(rows).toHaveLength(6);
    expect(rows[0].id).toBe(1);
    expect(rows[0].name).toBe("initial_schema");
    expect(rows[1].id).toBe(2);
    expect(rows[1].name).toBe("add_provider_keys_table");
    expect(rows[5].id).toBe(6);
    expect(rows[5].name).toBe("add_auth_type_to_provider_keys");
  });

  it("should not re-apply migrations on second open", () => {
    // Close and reopen - migrations should be idempotent
    storage.close();
    storage = createStorage(":memory:");

    const rows = storage.db
      .prepare("SELECT * FROM _migrations")
      .all() as Array<{ id: number; name: string }>;

    expect(rows).toHaveLength(6);
  });
});
