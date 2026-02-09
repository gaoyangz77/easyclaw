import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOpenClawStateDir,
  resolveOpenClawConfigPath,
  readExistingConfig,
  writeGatewayConfig,
  ensureGatewayConfig,
  generateGatewayToken,
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
      expect(result).toBe("/my/state/openclaw.json");
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

    it("creates config file with empty plugins object", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        plugins: {},
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.plugins).toEqual({});
    });

    it("creates config file with plugin entries", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        plugins: { "my-plugin": { enabled: true } },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.plugins).toEqual({ "my-plugin": { enabled: true } });
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
        plugins: { p1: {} },
        extraSkillDirs: ["/s1"],
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(9999);
      expect(config.plugins).toEqual({ p1: {} });
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
      expect(config.plugins).toEqual({});
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
        plugins: { p1: {} },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(9999);
      expect(config.agents.defaults.model.primary).toBe("openai/gpt-4o");
      expect(config.plugins).toEqual({ p1: {} });
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
      const customPath = "/app/Resources/file-permissions-plugin/easyclaw-file-permissions.mjs";
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
      expect(config.plugins.load.paths).toHaveLength(1);
      expect(config.plugins.load.paths[0]).toContain("easyclaw-file-permissions.mjs");
    });
  });

  describe("ensureGatewayConfig", () => {
    it("creates default config when no file exists", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const result = ensureGatewayConfig({ configPath });

      expect(result).toBe(configPath);
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(DEFAULT_GATEWAY_PORT);
      expect(config.plugins).toEqual({});
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

    it("includes default tool restrictions in generated config", () => {
      const configPath = join(tmpDir, "openclaw.json");
      ensureGatewayConfig({ configPath });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.tools).toEqual({
        exec: {
          host: "gateway",
          security: "allowlist",
          ask: "on-miss",
        },
        elevated: {
          enabled: false,
        },
      });
    });
  });

  describe("DEFAULT_GATEWAY_PORT", () => {
    it("is 28789", () => {
      expect(DEFAULT_GATEWAY_PORT).toBe(28789);
    });
  });

  describe("writeGatewayConfig - default tool restrictions", () => {
    it("applies default tool restrictions to fresh config", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.tools).toEqual({
        exec: {
          host: "gateway",
          security: "allowlist",
          ask: "on-miss",
        },
        elevated: {
          enabled: false,
        },
      });
    });

    it("preserves user-configured tool settings", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: {
            defaults: {
              tools: {
                exec: {
                  host: "docker",
                  security: "sandbox",
                },
                custom: "user-value",
              },
            },
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // User tools config should be preserved
      expect(config.agents.defaults.tools.exec.host).toBe("docker");
      expect(config.agents.defaults.tools.exec.security).toBe("sandbox");
      expect(config.agents.defaults.tools.custom).toBe("user-value");
      // Should NOT overwrite with defaults
      expect(config.agents.defaults.tools.elevated).toBeUndefined();
    });

    it("applies tool restrictions alongside other agents.defaults fields", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        defaultModel: { provider: "openai", modelId: "gpt-4o" },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.model.primary).toBe("openai/gpt-4o");
      expect(config.agents.defaults.tools.exec.host).toBe("gateway");
      expect(config.agents.defaults.tools.exec.security).toBe("allowlist");
    });

    it("preserves existing model config when applying tool restrictions", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: {
            defaults: {
              model: { primary: "anthropic/claude-sonnet-4-20250514" },
            },
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.model.primary).toBe("anthropic/claude-sonnet-4-20250514");
      expect(config.agents.defaults.tools.exec.host).toBe("gateway");
    });

    it("does not apply restrictions on subsequent writes", () => {
      const configPath = join(tmpDir, "openclaw.json");
      // First write: creates defaults
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      // User manually edits config
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.agents.defaults.tools.exec.security = "open";
      writeFileSync(configPath, JSON.stringify(config));

      // Second write: should preserve user changes
      writeGatewayConfig({
        configPath,
        gatewayPort: 18790,
      });

      const finalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(finalConfig.agents.defaults.tools.exec.security).toBe("open");
    });
  });
});
