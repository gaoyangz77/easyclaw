import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted Mocks ──────────────────────────────────────────────────────────

const {
  mockCsBridgeInstance,
  MockCustomerServiceBridge,
  mockOpenClawConnector,
  mockRootStore,
  mockAuthSession,
} = vi.hoisted(() => {
  const mockCsBridgeInstance = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };

  // Use function syntax so `new MockCustomerServiceBridge(...)` works as a constructor
  const MockCustomerServiceBridge = vi.fn(function (this: unknown) {
    return mockCsBridgeInstance;
  });

  const mockOpenClawConnector = {
    ensureRpcReady: vi.fn(),
  };

  const mockRootStore = {
    llmManager: { refreshModelCatalog: vi.fn().mockResolvedValue(undefined) },
  };

  const mockAuthSession = {
    getCachedUser: vi.fn().mockReturnValue(null),
    onUserChanged: vi.fn(),
  };

  return {
    mockCsBridgeInstance,
    MockCustomerServiceBridge,
    mockOpenClawConnector,
    mockRootStore,
    mockAuthSession,
  };
});

// ─── Module Mocks ────────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@rivonclaw/core", () => ({
  getCsRelayWsUrl: () => "wss://relay.test",
}));

vi.mock("../../openclaw/index.js", () => ({
  openClawConnector: mockOpenClawConnector,
}));

vi.mock("../../cs-bridge/customer-service-bridge.js", () => ({
  CustomerServiceBridge: MockCustomerServiceBridge,
}));

vi.mock("../../app/store/desktop-store.js", () => ({
  rootStore: mockRootStore,
}));

vi.mock("../../auth/session-ref.js", () => ({
  getAuthSession: () => mockAuthSession,
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { getCsBridge, tryStartCsBridge, stopCsBridge } from "../connection.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("connection.ts CS Bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset module-level state by stopping any existing bridge
    stopCsBridge();

    // Default: RPC connected + user has ecommerce
    mockOpenClawConnector.ensureRpcReady.mockReturnValue({});
    mockAuthSession.getCachedUser.mockReturnValue({
      enrolledModules: ["GLOBAL_ECOMMERCE_SELLER"],
    });
  });

  describe("stopCsBridge", () => {
    it("stops and nulls the bridge when one exists", () => {
      // Create a bridge first
      tryStartCsBridge("device-1");
      expect(getCsBridge()).not.toBeNull();

      stopCsBridge();

      expect(mockCsBridgeInstance.stop).toHaveBeenCalled();
      expect(getCsBridge()).toBeNull();
    });

    it("is safe to call when no bridge exists", () => {
      expect(getCsBridge()).toBeNull();
      expect(() => stopCsBridge()).not.toThrow();
    });
  });

  describe("tryStartCsBridge after stopCsBridge", () => {
    it("can recreate the bridge after stop", () => {
      tryStartCsBridge("device-1");
      expect(getCsBridge()).not.toBeNull();

      stopCsBridge();
      expect(getCsBridge()).toBeNull();

      // Should be able to create a new one
      MockCustomerServiceBridge.mockClear();
      tryStartCsBridge("device-1");

      expect(MockCustomerServiceBridge).toHaveBeenCalledTimes(1);
      expect(getCsBridge()).not.toBeNull();
    });
  });

  describe("tryStartCsBridge", () => {
    it("does not create duplicate when bridge already exists", () => {
      tryStartCsBridge("device-1");
      const firstBridge = getCsBridge();
      expect(firstBridge).not.toBeNull();

      MockCustomerServiceBridge.mockClear();
      tryStartCsBridge("device-1");

      // Constructor should NOT have been called again
      expect(MockCustomerServiceBridge).not.toHaveBeenCalled();
      expect(getCsBridge()).toBe(firstBridge);
    });

    it("does not create bridge when RPC is not ready", () => {
      mockOpenClawConnector.ensureRpcReady.mockImplementation(() => {
        throw new Error("not connected");
      });

      tryStartCsBridge("device-1");

      expect(getCsBridge()).toBeNull();
      expect(MockCustomerServiceBridge).not.toHaveBeenCalled();
    });

    it("does not create bridge when user lacks ecommerce module", () => {
      mockAuthSession.getCachedUser.mockReturnValue({
        enrolledModules: ["OTHER_MODULE"],
      });

      tryStartCsBridge("device-1");

      expect(getCsBridge()).toBeNull();
      expect(MockCustomerServiceBridge).not.toHaveBeenCalled();
    });
  });
});
