import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGatewayConfigHandlers, type GatewayConfigHandlerDeps } from "../config-handlers.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockBuildGatewayEnv = vi.fn<() => Promise<Record<string, string>>>();
vi.mock("@rivonclaw/gateway", () => ({
  buildGatewayEnv: (...args: unknown[]) => mockBuildGatewayEnv(...(args as [])),
}));

const mockApplyConfigMutation = vi.fn();
vi.mock("../../openclaw/index.js", () => ({
  openClawConnector: {
    applyConfigMutation: (...args: unknown[]) => mockApplyConfigMutation(...args),
  },
}));

// ─── Test Helpers ─────���───────────────────────────────���─────────────────────

function createDeps() {
  const deps: GatewayConfigHandlerDeps = {
    storage: {} as any,
    secretStore: {} as any,
    launcher: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      setEnv: vi.fn(),
      reload: vi.fn().mockResolvedValue(undefined),
    } as any,
    stateDir: "/tmp/state",
    workspacePath: "/tmp/workspace",
    buildFullGatewayConfig: vi.fn().mockResolvedValue({ configKey: "configValue" }),
    writeGatewayConfig: vi.fn().mockReturnValue("/tmp/config.json"),
    buildFullProxyEnv: vi.fn().mockReturnValue({ PROXY_KEY: "proxy-val" }),
    sttManager: { initialize: vi.fn().mockResolvedValue(undefined) },
    syncAllAuthProfiles: vi.fn().mockResolvedValue(undefined),
    writeProxyRouterConfig: vi.fn().mockResolvedValue(undefined),
    getLastSystemProxy: vi.fn().mockReturnValue(null),
  };
  return deps;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createGatewayConfigHandlers", () => {
  let deps: ReturnType<typeof createDeps>;
  let handlers: ReturnType<typeof createGatewayConfigHandlers>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    mockBuildGatewayEnv.mockResolvedValue({ SECRET_KEY: "secret-val" });
    // applyConfigMutation: execute the mutator, then record the policy
    mockApplyConfigMutation.mockImplementation(async (mutator: () => Promise<void> | void, _policy: string) => {
      await mutator();
    });
    handlers = createGatewayConfigHandlers(deps);
  });

  // ── handleSttChange ─────────────────────────────────────────────────────

  describe("handleSttChange", () => {
    it("calls writeGatewayConfig, buildGatewayEnv, launcher.setEnv, sttManager.initialize via applyConfigMutation(restart_process)", async () => {
      await handlers.handleSttChange();

      expect(mockApplyConfigMutation).toHaveBeenCalledWith(expect.any(Function), "restart_process");
      expect(deps.buildFullGatewayConfig).toHaveBeenCalled();
      expect(deps.writeGatewayConfig).toHaveBeenCalledWith({ configKey: "configValue" });
      expect(mockBuildGatewayEnv).toHaveBeenCalledWith(
        deps.secretStore,
        { ELECTRON_RUN_AS_NODE: "1" },
        deps.storage,
        deps.workspacePath,
      );
      expect(deps.launcher.setEnv).toHaveBeenCalledWith({
        SECRET_KEY: "secret-val",
        PROXY_KEY: "proxy-val",
      });
      expect(deps.sttManager.initialize).toHaveBeenCalled();
    });
  });

  // ── handleExtrasChange ──────────────────────────────────────────────────

  describe("handleExtrasChange", () => {
    it("calls writeGatewayConfig, buildGatewayEnv, launcher.setEnv via applyConfigMutation(restart_process) (no sttManager)", async () => {
      await handlers.handleExtrasChange();

      expect(mockApplyConfigMutation).toHaveBeenCalledWith(expect.any(Function), "restart_process");
      expect(deps.buildFullGatewayConfig).toHaveBeenCalled();
      expect(deps.writeGatewayConfig).toHaveBeenCalledWith({ configKey: "configValue" });
      expect(mockBuildGatewayEnv).toHaveBeenCalled();
      expect(deps.launcher.setEnv).toHaveBeenCalledWith({
        SECRET_KEY: "secret-val",
        PROXY_KEY: "proxy-val",
      });
      expect(deps.sttManager.initialize).not.toHaveBeenCalled();
    });
  });

  // ── handlePermissionsChange ─────────────────────────────────────────────

  describe("handlePermissionsChange", () => {
    it("calls buildGatewayEnv, launcher.setEnv via applyConfigMutation(restart_process) (no writeGatewayConfig)", async () => {
      await handlers.handlePermissionsChange();

      expect(mockApplyConfigMutation).toHaveBeenCalledWith(expect.any(Function), "restart_process");
      expect(deps.writeGatewayConfig).not.toHaveBeenCalled();
      expect(mockBuildGatewayEnv).toHaveBeenCalled();
      expect(deps.launcher.setEnv).toHaveBeenCalledWith({
        SECRET_KEY: "secret-val",
        PROXY_KEY: "proxy-val",
      });
    });
  });

  // ── handleProviderChange ────────────────────────────────────────────────

  describe("handleProviderChange", () => {
    it("with no hint: calls syncAllAuthProfiles, writeProxyRouterConfig, writeGatewayConfig via applyConfigMutation(restart_process)", async () => {
      await handlers.handleProviderChange();

      expect(deps.syncAllAuthProfiles).toHaveBeenCalledWith(
        deps.stateDir,
        deps.storage,
        deps.secretStore,
      );
      expect(deps.writeProxyRouterConfig).toHaveBeenCalledWith(
        deps.storage,
        deps.secretStore,
        null,
      );
      expect(deps.writeGatewayConfig).toHaveBeenCalledWith({ configKey: "configValue" });
      expect(mockApplyConfigMutation).toHaveBeenCalledWith(expect.any(Function), "restart_process");
    });

    it("with keyOnly: true — calls syncAllAuthProfiles, writeProxyRouterConfig, does NOT call applyConfigMutation", async () => {
      await handlers.handleProviderChange({ keyOnly: true });

      expect(deps.syncAllAuthProfiles).toHaveBeenCalledWith(
        deps.stateDir,
        deps.storage,
        deps.secretStore,
      );
      expect(deps.writeProxyRouterConfig).toHaveBeenCalledWith(
        deps.storage,
        deps.secretStore,
        null,
      );
      expect(mockApplyConfigMutation).not.toHaveBeenCalled();
    });

    it("with configOnly: true — calls syncAllAuthProfiles, writeProxyRouterConfig via applyConfigMutation(reload_config)", async () => {
      await handlers.handleProviderChange({ configOnly: true });

      expect(deps.syncAllAuthProfiles).toHaveBeenCalledWith(
        deps.stateDir,
        deps.storage,
        deps.secretStore,
      );
      expect(deps.writeProxyRouterConfig).toHaveBeenCalledWith(
        deps.storage,
        deps.secretStore,
        null,
      );
      expect(mockApplyConfigMutation).toHaveBeenCalledWith(expect.any(Function), "reload_config");
    });
  });
});
