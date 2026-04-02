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
import { OpenClawSchema } from "./generated/openclaw-schema.js";

describe("config-writer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rivonclaw-config-test-"));
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

    it("falls back to ~/.rivonclaw/openclaw when env var is empty", () => {
      const result = resolveOpenClawStateDir({ OPENCLAW_STATE_DIR: "" });
      expect(result).toContain(".rivonclaw");
    });

    it("falls back to ~/.rivonclaw/openclaw when env var is undefined", () => {
      const result = resolveOpenClawStateDir({});
      expect(result).toContain(".rivonclaw");
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
      expect(result).toContain(".rivonclaw");
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

    it("preserves existing recognised fields when merging", () => {
      const configPath = join(tmpDir, "openclaw.json");
      // Pre-populate with user config (using keys the schema recognises)
      writeFileSync(
        configPath,
        JSON.stringify({
          logging: { level: "debug" },
          gateway: { port: 1234, mode: "local" },
          ui: { seamColor: "#ff0000" },
        }),
      );

      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
        plugins: {},
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // RivonClaw-managed fields are updated
      expect(config.gateway.port).toBe(18789);
      // plugins gets extensions dir auto-added
      expect(config.plugins.load.paths.some((p: string) => p.endsWith("extensions"))).toBe(true);
      // Known user fields are preserved
      expect(config.logging).toEqual({ level: "debug" });
      expect(config.ui).toEqual({ seamColor: "#ff0000" });
      expect(config.gateway.mode).toBe("local");
    });

    it("preserves existing skills fields when adding extraDirs", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          skills: {
            allowBundled: ["web-search"],
            load: {
              watch: true,
            },
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        extraSkillDirs: ["/new/dir"],
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.skills.allowBundled).toEqual(["web-search"]);
      expect(config.skills.load.watch).toBe(true);
      expect(config.skills.load.extraDirs).toEqual(["/new/dir"]);
    });

    it("does not touch omitted fields", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          gateway: { port: 1234 },
          plugins: { load: { paths: ["/old-plugin"] } },
        }),
      );

      // Only update port, do not pass plugins
      writeGatewayConfig({
        configPath,
        gatewayPort: 5678,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(5678);
      // plugins was not passed, so existing load paths should be preserved
      expect(config.plugins.load.paths).toContain("/old-plugin");
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

    it("writes controlUi.root when controlUiRoot is provided", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
        controlUiRoot: "/vendor/openclaw/dist/control-ui",
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.controlUi.root).toBe("/vendor/openclaw/dist/control-ui");
      expect(config.gateway.controlUi.dangerouslyDisableDeviceAuth).toBe(true);
    });

    it("omits controlUi.root when controlUiRoot is not provided", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.controlUi.dangerouslyDisableDeviceAuth).toBe(true);
      expect(config.gateway.controlUi.root).toBeUndefined();
    });
  });

  describe("writeGatewayConfig - unknown key sanitisation", () => {
    it("strips unknown top-level keys from existing config", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          history: { entries: [1, 2, 3] },
          gateway: { port: 1234 },
          randomJunk: true,
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(18789);
      expect(config.history).toBeUndefined();
      expect(config.randomJunk).toBeUndefined();
    });

    it("preserves all known top-level keys", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          $schema: "https://example.com/schema.json",
          meta: { lastTouchedVersion: "1.0" },
          logging: { level: "debug" },
          ui: { seamColor: "#aabbcc" },
          memory: { backend: "builtin" },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.$schema).toBe("https://example.com/schema.json");
      expect(config.meta).toEqual({ lastTouchedVersion: "1.0" });
      expect(config.logging).toEqual({ level: "debug" });
      expect(config.ui).toEqual({ seamColor: "#aabbcc" });
      expect(config.memory).toEqual({ backend: "builtin" });
    });

    it("sanitisation is idempotent", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({ history: true, gateway: { port: 1234 } }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });
      const first = readFileSync(configPath, "utf-8");

      writeGatewayConfig({ configPath, gatewayPort: 18789 });
      const second = readFileSync(configPath, "utf-8");

      expect(first).toBe(second);
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

  describe("writeGatewayConfig - blockStreaming", () => {
    it("always writes blockStreamingDefault and blockStreamingBreak into agents.defaults", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.blockStreamingDefault).toBe("on");
      expect(config.agents.defaults.blockStreamingBreak).toBe("text_end");
    });

    it("preserves existing agents.defaults fields alongside block streaming", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        defaultModel: { provider: "openai", modelId: "gpt-4o" },
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.model.primary).toBe("openai/gpt-4o");
      expect(config.agents.defaults.blockStreamingDefault).toBe("on");
      expect(config.agents.defaults.blockStreamingBreak).toBe("text_end");
    });

    it("overwrites pre-existing block streaming values", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: {
            defaults: {
              blockStreamingDefault: "off",
              blockStreamingBreak: "message_end",
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agents.defaults.blockStreamingDefault).toBe("on");
      expect(config.agents.defaults.blockStreamingBreak).toBe("text_end");
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
        JSON.stringify({ commands: { native: true } }),
      );

      writeGatewayConfig({
        configPath,
        commandsRestart: true,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.commands.restart).toBe(true);
      expect(config.commands.native).toBe(true);
    });
  });

  describe("writeGatewayConfig - filePermissionsPluginPath override", () => {
    it("uses provided filePermissionsPluginPath instead of auto-resolving", () => {
      const configPath = join(tmpDir, "openclaw.json");
      // Create a real file so existsSync() passes
      const fpDir = join(tmpDir, "file-permissions-plugin");
      mkdirSync(fpDir);
      const customPath = join(fpDir, "rivonclaw-file-permissions.mjs");
      writeFileSync(customPath, "// plugin");

      writeGatewayConfig({
        configPath,
        enableFilePermissions: true,
        filePermissionsPluginPath: customPath,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.plugins.load.paths).toContain(customPath);
      expect(config.plugins.entries["rivonclaw-file-permissions"]).toEqual({ enabled: true });
    });

    it("falls back to auto-resolved path when filePermissionsPluginPath is omitted", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        enableFilePermissions: true,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // paths includes file-permissions plugin + extensions dir
      expect(config.plugins.load.paths.some((p: string) => p.includes("rivonclaw-file-permissions.mjs"))).toBe(true);
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

    it("filters permanently-removed plugin IDs from plugins.allow", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const extDir = join(tmpDir, "extensions");
      mkdirSync(extDir);

      // Pre-populate config with allow list containing removed plugin IDs
      writeFileSync(
        configPath,
        JSON.stringify({
          plugins: {
            allow: ["my-real-plugin", "wecom", "dingtalk", "telegram"],
          },
        }),
      );

      writeGatewayConfig({
        configPath,
        extensionsDir: extDir,
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const allow = config.plugins.allow as string[];
      // Non-removed plugins should be kept
      expect(allow).toContain("my-real-plugin");
      expect(allow).toContain("telegram");
      // Permanently-removed plugins should be filtered out
      expect(allow).not.toContain("wecom");
      expect(allow).not.toContain("dingtalk");
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
      const fpPath = join(tmpDir, "fp-plugin", "rivonclaw-file-permissions.mjs");
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
      expect(config.plugins.entries["rivonclaw-file-permissions"]).toEqual({ enabled: true });
    });
  });

  describe("ensureGatewayConfig", () => {
    it("creates default config when no file exists", () => {
      const configPath = join(tmpDir, "openclaw.json");
      const result = ensureGatewayConfig({ configPath, gatewayPort: 18789 });

      expect(result).toBe(configPath);
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.port).toBe(18789);
      // ensureGatewayConfig enables file permissions plugin by default
      expect(config.plugins.entries["rivonclaw-file-permissions"].enabled).toBe(true);
      expect(config.plugins.load.paths[0]).toContain("rivonclaw-file-permissions.mjs");
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
            auth: { mode: "token", token: "old", password: "keep" },
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
      expect(config.gateway.auth.password).toBe("keep");
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
    it("is 0 (OS-assigned at runtime)", () => {
      expect(DEFAULT_GATEWAY_PORT).toBe(0);
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

    it("defaults api to openai-completions unless provider declares otherwise", () => {
      const configs = buildExtraProviderConfigs();
      expect(configs.volcengine.api).toBe("openai-completions");
      expect(configs.zhipu.api).toBe("openai-completions");
      // moonshot-coding declares api: "anthropic-messages" in its subscription plan
      expect(configs["moonshot-coding"].api).toBe("anthropic-messages");
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
      const doubaoLite = configs.volcengine.models.find((m) => m.id === "doubao-seed-1-6-lite-251015");
      expect(doubaoLite?.input).toEqual(["text", "image"]);
      // qwen-coding vision models
      const qwen35plus = configs["qwen-coding"].models.find((m) => m.id === "qwen3.5-plus");
      expect(qwen35plus?.input).toEqual(["text", "image"]);
      const kimiK25Coding = configs["qwen-coding"].models.find((m) => m.id === "kimi-k2.5");
      expect(kimiK25Coding?.input).toEqual(["text", "image"]);
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

    it("does not override the built-in openai-codex provider", () => {
      const configs = buildExtraProviderConfigs();
      expect(configs["openai-codex"]).toBeUndefined();
    });
  });

  describe("writeGatewayConfig - nested unknown key sanitisation", () => {
    it("migrates single-account channel keys into accounts.default", () => {
      // Since vendor v2026.4.1, channel configs are validated via a schema
      // transform (not static object keys).  Unknown keys in a channel config
      // cause fixSemanticErrors to remove the entire channel entry.  This test
      // verifies the migration path for a channel with only valid keys.
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: {
              botToken: "123:ABC",
              dmPolicy: "open",
              allowFrom: ["*"],
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // botToken, dmPolicy, allowFrom are migrated into accounts.default
      expect(config.channels.telegram.accounts.default.botToken).toBe("123:ABC");
      expect(config.channels.telegram.accounts.default.dmPolicy).toBe("open");
    });

    it("strips deeply nested unrecognised keys", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          gateway: {
            port: 9999,
            auth: {
              mode: "token",
              bogusKey: true,
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.gateway.auth.mode).toBe("token");
      expect(config.gateway.auth.bogusKey).toBeUndefined();
    });

    it("strips unknown keys at both top-level and nested levels", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          topLevelJunk: true,
          gateway: {
            port: 9999,
            nestedJunk: "remove me",
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.topLevelJunk).toBeUndefined();
      expect(config.gateway.nestedJunk).toBeUndefined();
      expect(config.gateway.port).toBe(18789);
    });

    it("preserves valid nested keys", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: { botToken: "123:ABC", dmPolicy: "open", allowFrom: ["*"] },
            discord: { token: "discord-tok", dmPolicy: "open", allowFrom: ["*"] },
          },
          gateway: { port: 7777, auth: { mode: "none" } },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // Single-account format is migrated into accounts.default
      expect(config.channels.telegram.accounts.default.botToken).toBe("123:ABC");
      expect(config.channels.telegram.accounts.default.dmPolicy).toBe("open");
      expect(config.channels.discord.accounts.default.token).toBe("discord-tok");
      expect(config.gateway.auth.mode).toBe("none");
    });
  });

  describe("writeGatewayConfig - semantic validation fix", () => {
    it("preserves channel config even when it has semantic errors", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: { botToken: "123:ABC", dmPolicy: "allowlist" },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // Channel configs are protected — fixSemanticErrors must never delete
      // user channel data, even if it has validation issues.
      // Single-account format is migrated into accounts.default.
      expect(config.channels.telegram.accounts.default.botToken).toBe("123:ABC");
      expect(config.gateway.port).toBe(18789);
    });

    it("preserves all channel configs including ones with errors", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: { botToken: "123:ABC", dmPolicy: "allowlist" },
            discord: { token: "discord-tok" },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // Single-account format is migrated into accounts.default
      expect(config.channels.telegram.accounts.default.botToken).toBe("123:ABC");
      expect(config.channels.discord.accounts.default.token).toBe("discord-tok");
    });

    it("does not delete RivonClaw-managed keys on semantic errors", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // All managed keys should survive validation
      expect(config.gateway).toBeDefined();
      expect(config.gateway.port).toBe(18789);
    });

    it("keeps valid config when no semantic errors exist", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: { botToken: "123:ABC", dmPolicy: "open", allowFrom: ["*"] },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // Single-account format is migrated into accounts.default
      expect(config.channels.telegram.accounts.default.botToken).toBe("123:ABC");
      expect(config.channels.telegram.accounts.default.dmPolicy).toBe("open");
    });
  });

  describe("writeGatewayConfig - browserMode", () => {
    it("writes standalone browser config", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({ configPath, browserMode: "standalone" });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.browser.defaultProfile).toBe("openclaw");
      expect(config.browser.profiles.chrome.driver).toBe("clawd");
      expect(config.browser.profiles.chrome.cdpPort).toBe(DEFAULT_GATEWAY_PORT + 12);
    });

    it("writes CDP browser config with default port", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({ configPath, browserMode: "cdp" });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.browser.defaultProfile).toBe("openclaw");
      expect(config.browser.attachOnly).toBe(true);
      expect(config.browser.profiles.openclaw.cdpUrl).toBe("http://127.0.0.1:9222");
      expect(config.browser.profiles.openclaw.color).toBe("#4A90D9");
    });

    it("writes CDP browser config with custom port", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({ configPath, browserMode: "cdp", browserCdpPort: 9333 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.browser.profiles.openclaw.cdpUrl).toBe("http://127.0.0.1:9333");
      expect(config.browser.profiles.openclaw.color).toBe("#4A90D9");
    });

    it("backward compat: forceStandaloneBrowser maps to standalone", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({ configPath, forceStandaloneBrowser: true });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.browser.defaultProfile).toBe("openclaw");
      expect(config.browser.profiles.chrome.driver).toBe("clawd");
    });

    it("switching from CDP to standalone clears stale keys", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({ configPath, browserMode: "cdp" });

      // Verify CDP mode was written
      let config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.browser.attachOnly).toBe(true);
      expect(config.browser.profiles.openclaw.cdpUrl).toBeDefined();

      // Switch to standalone
      writeGatewayConfig({ configPath, browserMode: "standalone" });

      config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.browser.defaultProfile).toBe("openclaw");
      expect(config.browser.attachOnly).toBeUndefined();
      // CDP openclaw profile should be replaced by standalone chrome profile
      expect(config.browser.profiles.chrome.driver).toBe("clawd");
    });

    it("preserves existing browser fields when setting mode", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(configPath, JSON.stringify({
        browser: { remoteCdpTimeoutMs: 3000 },
      }));

      writeGatewayConfig({ configPath, browserMode: "standalone" });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.browser.remoteCdpTimeoutMs).toBe(3000);
      expect(config.browser.defaultProfile).toBe("openclaw");
    });
  });

  describe("fixSemanticErrors guard tests", () => {
    it("default config from ensureGatewayConfig passes OpenClaw schema validation", () => {
      // If this test fails, vendor (OpenClaw) schema changed and our default
      // config is no longer valid. Update writeGatewayConfig/ensureGatewayConfig
      // to produce config that satisfies the new schema.
      const configPath = join(tmpDir, "openclaw.json");
      ensureGatewayConfig({ configPath });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const result = OpenClawSchema.safeParse(config);
      if (!result.success) {
        const messages = result.error.issues.map(
          (i) => `  ${(i as any).path.join(".")}: ${(i as any).message}`,
        );
        expect.fail(
          `Default config fails OpenClaw schema validation:\n${messages.join("\n")}\n` +
          "The vendor schema likely changed. Update ensureGatewayConfig to match.",
        );
      }
    });

    it("full config from writeGatewayConfig passes OpenClaw schema validation", () => {
      // If this test fails, a config shape we produce is rejected by the
      // vendor schema. Fix writeGatewayConfig to produce valid config.
      const configPath = join(tmpDir, "openclaw.json");
      writeGatewayConfig({
        configPath,
        gatewayPort: 18789,
        gatewayToken: "abc123",
        enableChatCompletions: true,
        commandsRestart: true,
        plugins: { entries: {} },
        extraSkillDirs: ["/tmp/skills"],
        skipBootstrap: true,
        browserMode: "standalone",
      });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const result = OpenClawSchema.safeParse(config);
      if (!result.success) {
        const messages = result.error.issues
          .filter((i) => (i as any).code !== "unrecognized_keys")
          .map((i) => `  ${(i as any).path.join(".")}: ${(i as any).message}`);
        if (messages.length > 0) {
          expect.fail(
            `writeGatewayConfig output fails OpenClaw schema validation:\n${messages.join("\n")}\n` +
            "Fix writeGatewayConfig to produce valid config.",
          );
        }
      }
    });
  });

  describe("writeGatewayConfig - Telegram streaming normalization", () => {
    it("normalizes streaming: 'off' to 'block' on Telegram accounts", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: {
              accounts: {
                default: { botToken: "tok1", streaming: "off" },
              },
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.channels.telegram.accounts.default.streaming).toBe("block");
    });

    it("normalizes streaming: 'partial' to 'block' on Telegram accounts", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: {
              accounts: {
                mybot: { botToken: "tok2", streaming: "partial" },
              },
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.channels.telegram.accounts.mybot.streaming).toBe("block");
    });

    it("sets streaming to 'block' on Telegram accounts that lack it", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: {
              accounts: {
                default: { botToken: "tok3" },
              },
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.channels.telegram.accounts.default.streaming).toBe("block");
    });

    it("normalizes multiple Telegram accounts at once", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: {
              accounts: {
                bot1: { botToken: "t1", streaming: "off" },
                bot2: { botToken: "t2", streaming: "partial" },
                bot3: { botToken: "t3" },
              },
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.channels.telegram.accounts.bot1.streaming).toBe("block");
      expect(config.channels.telegram.accounts.bot2.streaming).toBe("block");
      expect(config.channels.telegram.accounts.bot3.streaming).toBe("block");
    });

    it("does not affect non-Telegram channel accounts", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            telegram: {
              accounts: {
                default: { botToken: "tg-tok", streaming: "off" },
              },
            },
            feishu: {
              accounts: {
                default: { appId: "fs-app", streaming: "off" },
              },
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      // Telegram gets normalized
      expect(config.channels.telegram.accounts.default.streaming).toBe("block");
      // Feishu is untouched
      expect(config.channels.feishu.accounts.default.streaming).toBe("off");
    });

    it("is a no-op when no telegram channel exists", () => {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          channels: {
            feishu: {
              accounts: {
                default: { appId: "fs-app", streaming: "off" },
              },
            },
          },
        }),
      );

      writeGatewayConfig({ configPath, gatewayPort: 18789 });

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.channels.feishu.accounts.default.streaming).toBe("off");
    });
  });
});
