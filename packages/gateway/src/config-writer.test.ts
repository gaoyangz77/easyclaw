import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOpenClawStateDir,
  resolveOpenClawConfigPath,
  readExistingConfig,
  writeGatewayConfig,
  ensureGatewayConfig,
  generateGatewayToken,
  buildExtraProviderConfigs,
  DEFAULT_GATEWAY_PORT,
} from "./config-writer.js";

describe("config-writer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "easyclaw-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveOpenClawStateDir", () => {
    it("returns OPENCLAW_STATE_DIR when set", () => {
      const result = resolveOpenClawStateDir({ OPENCLAW_STATE_DIR: "/custom/dir" });
      expect(result).toBe("/custom/dir");
    });

    it("trims whitespace from OPENCLAW_STATE_DIR", () => {
      const result = resolveOpenClawStateDir({ OPENCLAW_STATE_DIR: "  /custom/dir  " });
      expect(result).toBe("/custom/dir");
    });

    it("falls back to ~/.easyclaw/openclaw when env var is empty", () => {
      const result = resolveOpenClawStateDir({ OPENCLAW_STATE_DIR: "" });
      expect(result).toContain(".easyclaw");
    });

    it("falls back to ~/.easyclaw/openclaw when env var is undefined", () => {
      const result = resolveOpenClawStateDir({});
      expect(result).toContain(".easyclaw");
    });
  });

  describe("resolveOpenClawConfigPath", () => {
    it("returns OPENCLAW_CONFIG_PATH when set", () => {
      const result = resolveOpenClawConfigPath({
        OPENCLAW_CONFIG_PATH: "/custom/config.json",
      });
      expect(result).toBe("/custom/config.json");
    });

    it("trims whitespace from OPENCLAW_CONFIG_PATH", () => {
      const result = resolveOpenClawConfigPath({
        OPENCLAW_CONFIG_PATH: "  /custom/config.json  ",
      });
      expect(result).toBe("/custom/config.json");
    });

    it("falls back to stateDir/openclaw.json when config path is not set", () => {
      const result = resolveOpenClawConfigPath({
        OPENCLAW_STATE_DIR: "/my/state",
      });
      expect(result).toBe(join("/my/state", "openclaw.json"));
    });

    it("uses default state dir when neither env var is set", () => {
      const result = resolveOpenClawConfigPath({});
      expect(result).toContain(".easyclaw");
      expect(result.endsWith("openclaw.json")).toBe(true);
    });
  });

  describe("readExistingConfig", () => {
    it("returns parsed JSON when file exists", () => {
      const configPath = join(tmpDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ foo: "bar" }));
      const result = readExistingConfig(configPath);
      expect(result).toEqual({ foo: "bar" });
    });

    it("returns empty object when file does not exist", () => {
      const result = readExistingConfig(join(tmpDir, "nonexistent.json"));
      expect(result).toEqual({});
    });

    it("returns empty object when file contains invalid JSON", () => {
      const configPath = join(tmpDir, "bad.json");
      writeFileSync(configPath, "not json {{{");
      const result = readExistingConfig(configPath);
      expect(result).toEqual({});
    });
  });

  describe("writeGatewayConfig", () => {
    it("creates config file with gateway port", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const result = writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      expect(result).toBe(configPath);
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(18789);
    });

    it("creates config file with plugins object (extensions dir auto-added)", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        plugins: {},
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // The extensions dir is always auto-added when the plugins block is entered
      expect(config.plugins.load.paths).toBeDefined();
      expect(config.plugins.load.paths.length).toBeGreaterThanOrEqual(1);
      expect(config.plugins.load.paths.some((p: string) => p.endsWith("extensions"))).toBe(true);
    });

    it("creates config file with plugin entries", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        plugins: { entries: { "my-plugin": { enabled: true } } },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.plugins.entries).toEqual({ "my-plugin": { enabled: true } });
    });

    it("creates config file with extra skill dirs", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        extraSkillDirs: ["/skills/dir1"],
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.skills.load.extraDirs).toEqual(["/skills/dir1"]);
    });

    it("writes all fields together", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 9999,
        plugins: { entries: { p1: {} } },
        extraSkillDirs: ["/s1"],
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(9999);
      expect(config.plugins.entries).toEqual({ p1: {} });
      expect(config.skills.load.extraDirs).toEqual(["/s1"]);
    });

    it("creates parent directories if they do not exist", () => {
      const configPath = join(tmpDir, "nested", "deep", "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      expect(existsSync(configPath)).toBe(true);
    });

    it("preserves existing user fields when merging", () => {
      const configPath = join(tmpDir, "openclaw.json");
      // Pre-populate with user config
      writeFileSync(
        configPath,
        JSON.stringify({
          userSetting: "keep-me",
          gateway: { port: 1234, customField: "also-keep" },
          otherSection: { data: true },
        }),
      );

      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
        plugins: {},
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // EasyClaw-managed fields are updated
      expect(config.gateway.port).toBe(18789);
      // plugins gets extensions dir auto-added
      expect(config.plugins.load.paths.some((p: string) => p.endsWith("extensions"))).toBe(true);
      // User fields are preserved
      expect(config.userSetting).toBe("keep-me");
      expect(config.otherSection).toEqual({ data: true });
      expect(config.gateway.customField).toBe("also-keep");
    });

    it("preserves existing skills fields when adding extraDirs", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          skills: {
            someOtherProp: "keep",
            load: {
              existingProp: "also-keep",
            },
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        extraSkillDirs: ["/new/dir"],
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.skills.someOtherProp).toBe("keep");
      expect(config.skills.load.existingProp).toBe("also-keep");
      expect(config.skills.load.extraDirs).toEqual(["/new/dir"]);
    });

    it("does not touch omitted fields", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          gateway: { port: 1234 },
          plugins: ["/old-plugin"],
        }),
      );

      // Only update port, do not pass plugins
      writeGatewayConfig({
        configPath,
        gatewayPort: 5678,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(5678);
      // plugins was not passed, so it should remain as-is
      expect(config.plugins).toEqual(["/old-plugin"]);
    });

    it("is idempotent - calling twice produces same result", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const opts = {
        configPath,
        gatewayPort: 18789,
        plugins: {} as Record<string, unknown>,
        extraSkillDirs: [] as string[],
      };

      writeGatewayConfig(opts);
      const first = readFileSync(configPath, "utf-8");

      writeGatewayConfig(opts);
      const second = readFileSync(configPath, "utf-8");

      expect(first).toBe(second);
    });

    it("writes valid JSON with trailing newline", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      const raw = readFileSync(configPath, "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe("writeGatewayConfig - defaultModel", () => {
    it("writes agents.defaults.model.primary with provider/modelId", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        defaultModel: { provider: "deepseek", modelId: "deepseek-chat" },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.model.primary).toBe("deepseek/deepseek-chat");
    });

    it("preserves existing agents fields when updating default model", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: { defaults: { model: { primary: "openai/gpt-4o", fallbacks: ["deepseek/deepseek-chat"] } } },
        }),
      );

      writeGatewayConfig({
        configPath,
        defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.model.primary).toBe("anthropic/claude-sonnet-4-20250514");
      expect(config.agents.defaults.model.fallbacks).toEqual(["deepseek/deepseek-chat"]);
    });

    it("writes defaultModel alongside other fields", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 9999,
        defaultModel: { provider: "openai", modelId: "gpt-4o" },
        plugins: { entries: { p1: {} } },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(9999);
      expect(config.agents.defaults.model.primary).toBe("openai/gpt-4o");
      expect(config.plugins.entries).toEqual({ p1: {} });
    });

    it("does not touch agents when defaultModel is omitted", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: { defaults: { model: { primary: "openai/gpt-4o" } } },
        }),
      );

      writeGatewayConfig({
        configPath,
        gatewayPort: 5678,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.model.primary).toBe("openai/gpt-4o");
    });
  });

  describe("writeGatewayConfig - commandsRestart", () => {
    it("writes commands.restart when enabled", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        commandsRestart: true,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.commands.restart).toBe(true);
    });

    it("preserves existing commands fields", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({ commands: { other: "value" } }),
      );

      writeGatewayConfig({
        configPath,
        commandsRestart: true,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.commands.restart).toBe(true);
      expect(config.commands.other).toBe("value");
    });
  });

  describe("writeGatewayConfig - filePermissionsPluginPath override", () => {
    it("uses provided filePermissionsPluginPath instead of auto-resolving", () => {
      const configPath = join(tmpDir, "openclaw.json");
      // Create a real file so existsSync() passes
      const fpDir = join(tmpDir, "file-permissions-plugin");
      mkdirSync(fpDir);
      const customPath = join(fpDir, "easyclaw-file-permissions.mjs");
      writeFileSync(customPath, "// plugin");

      writeGatewayConfig({
        configPath,
        enableFilePermissions: true,
        filePermissionsPluginPath: customPath,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.plugins.load.paths).toContain(customPath);
      expect(config.plugins.entries["easyclaw-file-permissions"]).toEqual({ enabled: true });
    });

    it("falls back to auto-resolved path when filePermissionsPluginPath is omitted", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        enableFilePermissions: true,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // paths includes file-permissions plugin + extensions dir
      expect(config.plugins.load.paths.some((p: string) => p.includes("easyclaw-file-permissions.mjs"))).toBe(true);
      expect(config.plugins.load.paths.some((p: string) => p.endsWith("extensions"))).toBe(true);
    });
  });

  describe("writeGatewayConfig - extensionsDir", () => {
    it("uses provided extensionsDir in plugins.load.paths", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const extDir = join(tmpDir, "my-extensions");
      mkdirSync(extDir);
      writeGatewayConfig({
        configPath,
        extensionsDir: extDir,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.plugins.load.paths).toContain(extDir);
    });

    it("skips extensionsDir when directory does not exist", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const extDir = join(tmpDir, "nonexistent-extensions");
      writeGatewayConfig({
        configPath,
        extensionsDir: extDir,
        plugins: { entries: { p1: {} } },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // extensions dir should not be in paths (it doesn't exist)
      const paths = config.plugins.load?.paths ?? [];
      expect(paths).not.toContain(extDir);
    });

    it("cleans up stale per-extension paths", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const extDir = join(tmpDir, "extensions");
      mkdirSync(extDir);

      // Pre-populate with old per-extension paths
      writeFileSync(
        configPath,
        JSON.stringify({
          plugins: {
            load: {
              paths: [
                "/old/path/extensions/search-browser-fallback",
                "/old/path/extensions/wecom",
                "/old/path/extensions/dingtalk",
                "/some/other/plugin",
              ],
            },
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        extensionsDir: extDir,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const paths = config.plugins.load.paths as string[];
      // Stale per-extension paths should be removed
      expect(paths.some((p: string) => p.includes("search-browser-fallback"))).toBe(false);
      expect(paths.some((p: string) => p.includes("extensions/wecom"))).toBe(false);
      expect(paths.some((p: string) => p.includes("extensions/dingtalk"))).toBe(false);
      // Other plugin paths preserved
      expect(paths).toContain("/some/other/plugin");
      // New unified extensions dir added
      expect(paths).toContain(extDir);
    });

    it("does not duplicate extensionsDir on idempotent calls", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const extDir = join(tmpDir, "extensions");
      mkdirSync(extDir);

      writeGatewayConfig({ configPath, extensionsDir: extDir });
      writeGatewayConfig({ configPath, extensionsDir: extDir });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const paths = config.plugins.load.paths as string[];
      const extDirCount = paths.filter((p: string) => p === extDir).length;
      expect(extDirCount).toBe(1);
    });

    it("works alongside filePermissionsPluginPath", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const extDir = join(tmpDir, "extensions");
      mkdirSync(extDir);
      const fpPath = join(tmpDir, "fp-plugin", "easyclaw-file-permissions.mjs");
      mkdirSync(join(tmpDir, "fp-plugin"));
      writeFileSync(fpPath, "// plugin");

      writeGatewayConfig({
        configPath,
        enableFilePermissions: true,
        filePermissionsPluginPath: fpPath,
        extensionsDir: extDir,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const paths = config.plugins.load.paths as string[];
      expect(paths).toContain(fpPath);
      expect(paths).toContain(extDir);
      expect(config.plugins.entries["easyclaw-file-permissions"]).toEqual({ enabled: true });
    });
  });

  describe("ensureGatewayConfig", () => {
    it("creates default config when no file exists", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const result = ensureGatewayConfig({ configPath });

      expect(result).toBe(configPath);
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(DEFAULT_GATEWAY_PORT);
      // ensureGatewayConfig enables file permissions plugin by default
      expect(config.plugins.entries["easyclaw-file-permissions"].enabled).toBe(true);
      expect(config.plugins.load.paths[0]).toContain("easyclaw-file-permissions.mjs");
      expect(config.skills.load.extraDirs).toEqual([]);
    });

    it("uses custom port when provided", () => {
      const configPath = join(tmpDir, "openclaw.json");
      ensureGatewayConfig({ configPath, gatewayPort: 9999 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(9999);
    });

    it("does not overwrite existing config", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({ gateway: { port: 1234 }, custom: true }),
      );

      ensureGatewayConfig({ configPath });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // Should NOT have been overwritten
      expect(config.gateway.port).toBe(1234);
      expect(config.custom).toBe(true);
    });

    it("returns config path even when file already exists", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(configPath, "{}");

      const result = ensureGatewayConfig({ configPath });
      expect(result).toBe(configPath);
    });
  });

  describe("writeGatewayConfig - auth token", () => {
    it("writes gateway auth token", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayToken: "my-secret-token",
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.auth).toEqual({
        mode: "token",
        token: "my-secret-token",
      });
    });

    it("writes port and token together", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 9999,
        gatewayToken: "tok123",
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(9999);
      expect(config.gateway.mode).toBe("local");
      expect(config.gateway.auth.token).toBe("tok123");
    });

    it("preserves existing auth fields when updating token", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          gateway: {
            port: 1234,
            auth: { mode: "token", token: "old", customField: "keep" },
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        gatewayToken: "new-token",
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(1234);
      expect(config.gateway.auth.token).toBe("new-token");
      expect(config.gateway.auth.customField).toBe("keep");
    });
  });

  describe("generateGatewayToken", () => {
    it("returns a 64-character hex string", () => {
      const token = generateGatewayToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates unique tokens", () => {
      const t1 = generateGatewayToken();
      const t2 = generateGatewayToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe("ensureGatewayConfig - auto token", () => {
    it("generates auth token in default config", () => {
      const configPath = join(tmpDir, "openclaw.json");
      ensureGatewayConfig({ configPath });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.auth.mode).toBe("token");
      expect(config.gateway.auth.token).toMatch(/^[0-9a-f]{64}$/);
    });

  });

  describe("DEFAULT_GATEWAY_PORT", () => {
    it("is 28789", () => {
      expect(DEFAULT_GATEWAY_PORT).toBe(28789);
    });
  });

  describe("writeGatewayConfig - extraProviders", () => {
    it("writes models.providers section with extra providers", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        extraProviders: {
          zhipu: {
            baseUrl: "https://open.bigmodel.cn/api/paas/v4",
            api: "openai-completions",
            models: [
              {
                id: "glm-4.7-flash",
                name: "GLM-4.7-Flash",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192,
              },
            ],
          },
        },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.models.providers.zhipu).toBeDefined();
      expect(config.models.providers.zhipu.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
      expect(config.models.providers.zhipu.api).toBe("openai-completions");
      expect(config.models.providers.zhipu.models).toHaveLength(1);
      expect(config.models.providers.zhipu.models[0].id).toBe("glm-4.7-flash");
    });

    it("sets mode to merge by default", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        extraProviders: {
          test: { baseUrl: "http://test", models: [] },
        },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.models.mode).toBe("merge");
    });

    it("preserves existing models.providers when adding extra", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          models: {
            mode: "merge",
            providers: {
              existing: { baseUrl: "http://existing", models: [] },
            },
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        extraProviders: {
          zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: [] },
        },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.models.providers.existing).toBeDefined();
      expect(config.models.providers.zhipu).toBeDefined();
    });

    it("does not write models section when extraProviders is empty", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        extraProviders: {},
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.models).toBeUndefined();
    });

    it("does not write models section when extraProviders is omitted", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.models).toBeUndefined();
    });
  });

  describe("buildExtraProviderConfigs", () => {
    it("returns configs for all EXTRA_MODELS providers", () => {
      const configs = buildExtraProviderConfigs();
      expect(configs.volcengine).toBeDefined();
      expect(configs.zhipu).toBeDefined();
    });

    it("sets api to openai-completions for all providers", () => {
      const configs = buildExtraProviderConfigs();
      for (const config of Object.values(configs)) {
        expect(config.api).toBe("openai-completions");
      }
    });

    it("uses correct base URLs from PROVIDER_BASE_URLS", () => {
      const configs = buildExtraProviderConfigs();
      expect(configs.volcengine.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
      expect(configs.zhipu.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    });

    it("includes all models from EXTRA_MODELS", () => {
      const configs = buildExtraProviderConfigs();
      expect(configs.volcengine.models.length).toBeGreaterThan(0);
      expect(configs.zhipu.models.length).toBeGreaterThan(0);
      expect(configs.zhipu.models.some((m) => m.id === "glm-4.7")).toBe(true);
      expect(configs.volcengine.models.some((m) => m.id === "doubao-seed-1-8-251228")).toBe(true);
    });

    it("sets input to include image for vision-capable models", () => {
      const configs = buildExtraProviderConfigs();
      // Vision models should have ["text", "image"]
      const glm46v = configs.zhipu.models.find((m) => m.id === "glm-4.6v");
      expect(glm46v?.input).toEqual(["text", "image"]);
      const glm45v = configs.zhipu.models.find((m) => m.id === "glm-4.5v");
      expect(glm45v?.input).toEqual(["text", "image"]);
      const doubao18 = configs.volcengine.models.find((m) => m.id === "doubao-seed-1-8-251228");
      expect(doubao18?.input).toEqual(["text", "image"]);
    });

    it("sets input to text-only for non-vision models", () => {
      const configs = buildExtraProviderConfigs();
      const glm5code = configs.zhipu.models.find((m) => m.id === "glm-5-code");
      expect(glm5code?.input).toEqual(["text"]);
      // GLM text models without V suffix should be text-only
      const glm5 = configs.zhipu.models.find((m) => m.id === "glm-5");
      expect(glm5?.input).toEqual(["text"]);
      const glm47 = configs.zhipu.models.find((m) => m.id === "glm-4.7");
      expect(glm47?.input).toEqual(["text"]);
      const glm45 = configs.zhipu.models.find((m) => m.id === "glm-4.5");
      expect(glm45?.input).toEqual(["text"]);
    });
  });
});
