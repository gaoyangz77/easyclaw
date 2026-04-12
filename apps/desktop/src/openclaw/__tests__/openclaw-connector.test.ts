import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ─── Hoisted Mocks (vi.mock factories are hoisted, so refs must be too) ────

const {
  mockRuntimeStatusStore,
  mockRpcClientInstance,
  MockGatewayRpcClient,
} = vi.hoisted(() => {
  const mockRuntimeStatusStore = {
    openClawConnector: {
      processState: "stopped" as string,
      rpcConnected: false,
      sidecarState: "unknown" as string,
      restartAttempt: 0,
      lastError: "",
    },
    setConnectorProcessState: vi.fn(),
    setConnectorRpcConnected: vi.fn(),
    setConnectorSidecarState: vi.fn(),
    setConnectorRestartAttempt: vi.fn(),
    setConnectorLastError: vi.fn(),
  };

  const mockRpcClientInstance = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    request: vi.fn().mockResolvedValue(undefined),
    _opts: null as Record<string, unknown> | null,
  };

  // Use function syntax so `new MockGatewayRpcClient(...)` works as a constructor
  const MockGatewayRpcClient = vi.fn(function (this: unknown, opts: Record<string, unknown>) {
    mockRpcClientInstance._opts = opts;
    return mockRpcClientInstance;
  });

  return { mockRuntimeStatusStore, mockRpcClientInstance, MockGatewayRpcClient };
});

// ─── Module Mocks ──────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../app/store/runtime-status-store.js", () => ({
  runtimeStatusStore: mockRuntimeStatusStore,
}));

vi.mock("@rivonclaw/gateway", () => ({
  GatewayRpcClient: MockGatewayRpcClient,
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { OpenClawConnector } from "../openclaw-connector.js";
import type { OpenClawConnectorDeps, RpcConnectionDeps } from "../openclaw-connector.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

type MockLauncher = {
  start: Mock;
  stop: Mock;
  reload: Mock;
  setEnv: Mock;
  on: Mock;
  _handlers: Record<string, ((...args: unknown[]) => void)[]>;
  emit: (event: string, ...args: unknown[]) => void;
};

function createMockLauncher(): MockLauncher {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const launcher: MockLauncher = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    setEnv: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    _handlers: handlers,
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) {
        h(...args);
      }
    },
  };
  return launcher;
}

function createMockDeps(): OpenClawConnectorDeps {
  return {
    writeConfig: vi.fn().mockReturnValue("/tmp/config.json"),
    buildConfig: vi.fn().mockResolvedValue({}),
    buildEnv: vi.fn().mockResolvedValue({}),
    eventDispatcher: vi.fn(),
  };
}

function createRpcDeps(): RpcConnectionDeps {
  return {
    url: "ws://127.0.0.1:3212",
    token: "test-token",
    deviceIdentityPath: "/tmp/device.json",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("OpenClawConnector", () => {
  let connector: OpenClawConnector;
  let launcher: MockLauncher;
  let deps: OpenClawConnectorDeps;
  let rpcDeps: RpcConnectionDeps;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock runtimeStatusStore state
    mockRuntimeStatusStore.openClawConnector.processState = "stopped";
    mockRuntimeStatusStore.openClawConnector.rpcConnected = false;
    mockRuntimeStatusStore.openClawConnector.sidecarState = "unknown";
    mockRuntimeStatusStore.openClawConnector.restartAttempt = 0;
    mockRuntimeStatusStore.openClawConnector.lastError = "";

    // Wire up the spy implementations so state tracks calls
    mockRuntimeStatusStore.setConnectorProcessState.mockImplementation((state: string) => {
      mockRuntimeStatusStore.openClawConnector.processState = state;
    });
    mockRuntimeStatusStore.setConnectorRpcConnected.mockImplementation((connected: boolean) => {
      mockRuntimeStatusStore.openClawConnector.rpcConnected = connected;
    });
    mockRuntimeStatusStore.setConnectorSidecarState.mockImplementation((state: string) => {
      mockRuntimeStatusStore.openClawConnector.sidecarState = state;
    });
    mockRuntimeStatusStore.setConnectorRestartAttempt.mockImplementation((attempt: number) => {
      mockRuntimeStatusStore.openClawConnector.restartAttempt = attempt;
    });
    mockRuntimeStatusStore.setConnectorLastError.mockImplementation((error: string) => {
      mockRuntimeStatusStore.openClawConnector.lastError = error;
    });

    // Reset mock RPC client
    mockRpcClientInstance.isConnected.mockReturnValue(true);
    mockRpcClientInstance.request.mockResolvedValue(undefined);
    mockRpcClientInstance._opts = null;

    connector = new OpenClawConnector();
    launcher = createMockLauncher();
    deps = createMockDeps();
    rpcDeps = createRpcDeps();
  });

  // ── Initialization ─────────────────────────────────────────────────────

  describe("initLauncher", () => {
    it("registers event handlers on the launcher", () => {
      connector.initLauncher(launcher as any);

      expect(launcher.on).toHaveBeenCalledWith("started", expect.any(Function));
      expect(launcher.on).toHaveBeenCalledWith("ready", expect.any(Function));
      expect(launcher.on).toHaveBeenCalledWith("stopped", expect.any(Function));
      expect(launcher.on).toHaveBeenCalledWith("restarting", expect.any(Function));
      expect(launcher.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("sets processState to 'running' on 'started' event", () => {
      connector.initLauncher(launcher as any);
      launcher.emit("started", 12345);

      expect(mockRuntimeStatusStore.setConnectorProcessState).toHaveBeenCalledWith("running");
    });

    it("sets processState to 'stopped' and disconnects RPC on 'stopped' event", () => {
      connector.initLauncher(launcher as any);
      launcher.emit("stopped");

      expect(mockRuntimeStatusStore.setConnectorProcessState).toHaveBeenCalledWith("stopped");
      // disconnectRpc sets rpcConnected=false and sidecarState="unknown"
      expect(mockRuntimeStatusStore.setConnectorRpcConnected).toHaveBeenCalledWith(false);
      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("unknown");
    });

    it("sets processState to 'starting' and increments restartAttempt on 'restarting' event", () => {
      connector.initLauncher(launcher as any);
      launcher.emit("restarting", 3);

      expect(mockRuntimeStatusStore.setConnectorProcessState).toHaveBeenCalledWith("starting");
      expect(mockRuntimeStatusStore.setConnectorRestartAttempt).toHaveBeenCalledWith(3);
    });

    it("sets lastError on 'error' event", () => {
      connector.initLauncher(launcher as any);
      launcher.emit("error", new Error("spawn failed"));

      expect(mockRuntimeStatusStore.setConnectorLastError).toHaveBeenCalledWith("spawn failed");
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────

  describe("start", () => {
    it("throws if launcher not initialized", async () => {
      await expect(connector.start()).rejects.toThrow("launcher not initialized");
    });

    it("sets processState to 'starting' and calls launcher.start()", async () => {
      connector.initLauncher(launcher as any);
      await connector.start();

      expect(mockRuntimeStatusStore.setConnectorProcessState).toHaveBeenCalledWith("starting");
      expect(launcher.start).toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("throws if launcher not initialized", async () => {
      await expect(connector.stop()).rejects.toThrow("launcher not initialized");
    });

    it("sets processState to 'stopping', disconnects RPC, and calls launcher.stop()", async () => {
      connector.initLauncher(launcher as any);
      await connector.stop();

      expect(mockRuntimeStatusStore.setConnectorProcessState).toHaveBeenCalledWith("stopping");
      expect(mockRuntimeStatusStore.setConnectorRpcConnected).toHaveBeenCalledWith(false);
      expect(launcher.stop).toHaveBeenCalled();
    });
  });

  describe("restart", () => {
    it("calls stop then start", async () => {
      connector.initLauncher(launcher as any);

      const callOrder: string[] = [];
      launcher.stop.mockImplementation(() => { callOrder.push("stop"); return Promise.resolve(); });
      launcher.start.mockImplementation(() => { callOrder.push("start"); return Promise.resolve(); });

      await connector.restart("test reason");

      expect(callOrder).toEqual(["stop", "start"]);
    });
  });

  // ── RPC Connection ─────────────────────────────────────────────────────

  describe("connectRpc", () => {
    it("creates GatewayRpcClient with correct options and starts it", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      expect(MockGatewayRpcClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "ws://127.0.0.1:3212",
          token: "test-token",
          deviceIdentityPath: "/tmp/device.json",
        }),
      );
      expect(mockRpcClientInstance.start).toHaveBeenCalled();
    });

    it("sets rpcConnected=true on onConnect callback", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      // Simulate the onConnect callback
      const opts = mockRpcClientInstance._opts!;
      const onConnect = opts.onConnect as () => void;
      onConnect();

      expect(mockRuntimeStatusStore.setConnectorRpcConnected).toHaveBeenCalledWith(true);
    });

    it("fires registered onRpcConnected callbacks on connect", async () => {
      connector.initDeps(deps);

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      connector.onRpcConnected(cb1);
      connector.onRpcConnected(cb2);

      await connector.connectRpc(rpcDeps);

      // Simulate onConnect
      const onConnect = mockRpcClientInstance._opts!.onConnect as () => void;
      onConnect();

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it("sets rpcConnected=false and sidecarState='unknown' on onClose", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      const onClose = mockRpcClientInstance._opts!.onClose as () => void;
      onClose();

      expect(mockRuntimeStatusStore.setConnectorRpcConnected).toHaveBeenCalledWith(false);
      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("unknown");
    });

    it("fires registered onRpcDisconnected callbacks on onClose", async () => {
      connector.initDeps(deps);

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      connector.onRpcDisconnected(cb1);
      connector.onRpcDisconnected(cb2);

      await connector.connectRpc(rpcDeps);

      const onClose = mockRpcClientInstance._opts!.onClose as () => void;
      onClose();

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it("dispatches events via eventDispatcher on onEvent", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      const evt = { type: "event" as const, event: "test.event", payload: { data: 1 } };
      const onEvent = mockRpcClientInstance._opts!.onEvent as (e: unknown) => void;
      onEvent(evt);

      expect(deps.eventDispatcher).toHaveBeenCalledWith(evt);
    });

    it("stops existing client before creating a new one", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      const firstStop = mockRpcClientInstance.stop;
      firstStop.mockClear();

      await connector.connectRpc(rpcDeps);

      expect(firstStop).toHaveBeenCalled();
    });
  });

  describe("disconnectRpc", () => {
    it("stops the client and resets state", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      connector.disconnectRpc();

      expect(mockRpcClientInstance.stop).toHaveBeenCalled();
      expect(mockRuntimeStatusStore.setConnectorRpcConnected).toHaveBeenCalledWith(false);
      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("unknown");
    });

    it("is safe to call when no client exists", () => {
      expect(() => connector.disconnectRpc()).not.toThrow();
    });

    it("fires onRpcDisconnected callbacks when client existed", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      const cb = vi.fn();
      connector.onRpcDisconnected(cb);

      connector.disconnectRpc();

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("does not fire onRpcDisconnected callbacks when no client existed", () => {
      const cb = vi.fn();
      connector.onRpcDisconnected(cb);

      connector.disconnectRpc();

      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Sidecar Readiness ──────────────────────────────────────────────────

  describe("probeSidecarReady", () => {
    it("sets sidecarState to 'ready' on successful probe", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);
      mockRpcClientInstance.request.mockResolvedValue({ sessions: [] });

      await connector.probeSidecarReady();

      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("probing");
      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("ready");
    });

    it("retries on UNAVAILABLE and succeeds on later attempt", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      const unavailableError = Object.assign(new Error("Service unavailable"), { code: "UNAVAILABLE" });
      mockRpcClientInstance.request
        .mockRejectedValueOnce(unavailableError)
        .mockRejectedValueOnce(unavailableError)
        .mockResolvedValueOnce({ sessions: [] });

      await connector.probeSidecarReady();

      expect(mockRpcClientInstance.request).toHaveBeenCalledTimes(3);
      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("ready");
    });

    it("sets sidecarState to 'failed' after max attempts", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      const unavailableError = Object.assign(new Error("Service unavailable"), { code: "UNAVAILABLE" });
      mockRpcClientInstance.request.mockRejectedValue(unavailableError);

      await connector.probeSidecarReady();

      expect(mockRpcClientInstance.request).toHaveBeenCalledTimes(10);
      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("failed");
    });

    it("sets sidecarState to 'failed' immediately on non-retryable error", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);

      mockRpcClientInstance.request.mockRejectedValue(new Error("Unknown error"));

      await connector.probeSidecarReady();

      expect(mockRpcClientInstance.request).toHaveBeenCalledTimes(1);
      expect(mockRuntimeStatusStore.setConnectorSidecarState).toHaveBeenCalledWith("failed");
    });
  });

  // ── Unified RPC Facade ─────────────────────────────────────────────────

  describe("ensureRpcReady", () => {
    it("returns the rpcClient when connected", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);
      mockRpcClientInstance.isConnected.mockReturnValue(true);

      const client = connector.ensureRpcReady();
      expect(client).toBe(mockRpcClientInstance);
    });

    it("throws when not connected", () => {
      expect(() => connector.ensureRpcReady()).toThrow("RPC client not connected");
    });

    it("throws when client exists but is disconnected", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);
      mockRpcClientInstance.isConnected.mockReturnValue(false);

      expect(() => connector.ensureRpcReady()).toThrow("RPC client not connected");
    });
  });

  describe("request", () => {
    it("delegates to rpcClient.request()", async () => {
      connector.initDeps(deps);
      await connector.connectRpc(rpcDeps);
      mockRpcClientInstance.request.mockResolvedValue({ result: "ok" });

      const result = await connector.request("channels.status", { limit: 10 });

      expect(mockRpcClientInstance.request).toHaveBeenCalledWith("channels.status", { limit: 10 });
      expect(result).toEqual({ result: "ok" });
    });

    it("throws if not connected", async () => {
      await expect(connector.request("test.method")).rejects.toThrow("RPC client not connected");
    });
  });

  // ── isReady ────────────────────────────────────────────────────────────

  describe("isReady", () => {
    it("returns true when all conditions met", () => {
      mockRuntimeStatusStore.openClawConnector.processState = "running";
      mockRuntimeStatusStore.openClawConnector.rpcConnected = true;
      mockRuntimeStatusStore.openClawConnector.sidecarState = "ready";

      expect(connector.isReady).toBe(true);
    });

    it("returns false when process not running", () => {
      mockRuntimeStatusStore.openClawConnector.processState = "stopped";
      mockRuntimeStatusStore.openClawConnector.rpcConnected = true;
      mockRuntimeStatusStore.openClawConnector.sidecarState = "ready";

      expect(connector.isReady).toBe(false);
    });

    it("returns false when RPC not connected", () => {
      mockRuntimeStatusStore.openClawConnector.processState = "running";
      mockRuntimeStatusStore.openClawConnector.rpcConnected = false;
      mockRuntimeStatusStore.openClawConnector.sidecarState = "ready";

      expect(connector.isReady).toBe(false);
    });

    it("returns false when sidecar not ready", () => {
      mockRuntimeStatusStore.openClawConnector.processState = "running";
      mockRuntimeStatusStore.openClawConnector.rpcConnected = true;
      mockRuntimeStatusStore.openClawConnector.sidecarState = "probing";

      expect(connector.isReady).toBe(false);
    });
  });

  // ── Config Mutation ────────────────────────────────────────────────────

  describe("applyConfigMutation", () => {
    it("with policy 'none': runs mutator, does nothing else", async () => {
      connector.initLauncher(launcher as any);
      connector.initDeps(deps);

      const mutator = vi.fn();
      await connector.applyConfigMutation(mutator, "none");

      expect(mutator).toHaveBeenCalled();
      expect(launcher.reload).not.toHaveBeenCalled();
      expect(launcher.stop).not.toHaveBeenCalled();
      expect(launcher.start).not.toHaveBeenCalled();
    });

    it("with policy 'reload_config': runs mutator then launcher.reload()", async () => {
      connector.initLauncher(launcher as any);
      connector.initDeps(deps);

      const mutator = vi.fn();
      await connector.applyConfigMutation(mutator, "reload_config");

      expect(mutator).toHaveBeenCalled();
      expect(launcher.reload).toHaveBeenCalled();
      expect(launcher.stop).not.toHaveBeenCalled();
    });

    it("with policy 'reconnect_rpc': runs mutator then reconnects RPC", async () => {
      connector.initLauncher(launcher as any);
      connector.initDeps(deps);
      connector.setRpcConnectionDeps(rpcDeps);

      // First connect so there's a client to disconnect
      await connector.connectRpc(rpcDeps);
      vi.clearAllMocks();

      // Re-wire mock implementations after clearAllMocks
      mockRuntimeStatusStore.setConnectorRpcConnected.mockImplementation((connected: boolean) => {
        mockRuntimeStatusStore.openClawConnector.rpcConnected = connected;
      });

      const mutator = vi.fn();
      await connector.applyConfigMutation(mutator, "reconnect_rpc");

      expect(mutator).toHaveBeenCalled();
      // disconnectRpc resets state
      expect(mockRuntimeStatusStore.setConnectorRpcConnected).toHaveBeenCalledWith(false);
      // connectRpc creates a new client
      expect(MockGatewayRpcClient).toHaveBeenCalled();
      expect(mockRpcClientInstance.start).toHaveBeenCalled();
    });

    it("with policy 'restart_process': runs mutator then stop+start", async () => {
      connector.initLauncher(launcher as any);
      connector.initDeps(deps);

      const callOrder: string[] = [];
      const mutator = vi.fn(() => { callOrder.push("mutator"); });
      launcher.stop.mockImplementation(() => { callOrder.push("stop"); return Promise.resolve(); });
      launcher.start.mockImplementation(() => { callOrder.push("start"); return Promise.resolve(); });

      await connector.applyConfigMutation(mutator, "restart_process");

      expect(callOrder).toEqual(["mutator", "stop", "start"]);
    });

    it("with policy 'reload_config' throws if launcher not initialized", async () => {
      const mutator = vi.fn();
      await expect(
        connector.applyConfigMutation(mutator, "reload_config"),
      ).rejects.toThrow("launcher not initialized");
      // Mutator should still have been called before the policy action
      expect(mutator).toHaveBeenCalled();
    });

    it("supports async mutators", async () => {
      connector.initLauncher(launcher as any);
      connector.initDeps(deps);

      let mutatorCompleted = false;
      const mutator = async () => {
        await new Promise((r) => setTimeout(r, 10));
        mutatorCompleted = true;
      };

      await connector.applyConfigMutation(mutator, "reload_config");

      expect(mutatorCompleted).toBe(true);
      expect(launcher.reload).toHaveBeenCalled();
    });
  });

  // ── Launcher "ready" event auto-connects RPC ──────────────────────────

  describe("launcher 'ready' event", () => {
    it("auto-connects RPC when rpcConnectionDeps are set", async () => {
      connector.initLauncher(launcher as any);
      connector.initDeps(deps);
      connector.setRpcConnectionDeps(rpcDeps);

      // Simulate launcher emitting "ready"
      launcher.emit("ready");

      // Give the async connectRpc a tick to fire
      await new Promise((r) => setTimeout(r, 0));

      expect(MockGatewayRpcClient).toHaveBeenCalledWith(
        expect.objectContaining({ url: "ws://127.0.0.1:3212" }),
      );
      expect(mockRpcClientInstance.start).toHaveBeenCalled();
    });

    it("does not crash when rpcConnectionDeps are not set", () => {
      connector.initLauncher(launcher as any);

      // Should not throw
      expect(() => launcher.emit("ready")).not.toThrow();
    });
  });
});
