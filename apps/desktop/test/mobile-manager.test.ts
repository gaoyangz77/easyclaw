import { describe, it, expect, vi, beforeEach } from "vitest";
import { types, applySnapshot } from "mobx-state-tree";
import { MobilePairingModel } from "@rivonclaw/core/models";
import { MobileManagerModel } from "../src/store/mobile-manager.js";

/**
 * Build a minimal MST tree that mirrors the desktop store structure
 * enough to test MobileManager actions.
 */
function createTestStore() {
  const TestRootModel = types
    .model("TestRoot", {
      mobilePairings: types.optional(types.array(MobilePairingModel), []),
      mobileManager: types.optional(MobileManagerModel, {}),
    })
    .actions((self) => ({
      loadMobilePairings(pairings: any[]) {
        applySnapshot(self.mobilePairings, pairings);
      },
      upsertMobilePairing(pairing: any) {
        const idx = self.mobilePairings.findIndex((p) => p.id === pairing.id);
        if (idx >= 0) {
          applySnapshot(self.mobilePairings[idx], pairing);
        } else {
          self.mobilePairings.push(pairing);
        }
      },
      removeMobilePairing(id: string) {
        const idx = self.mobilePairings.findIndex((p) => p.id === id);
        if (idx >= 0) self.mobilePairings.splice(idx, 1);
      },
    }));

  return TestRootModel.create({});
}

describe("MobileManagerModel", () => {
  let mockStorage: any;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    mockStorage = {
      mobilePairings: {
        getActivePairing: vi.fn(),
        getAllPairings: vi.fn().mockReturnValue([]),
        clearPairing: vi.fn(),
        removePairingById: vi.fn(),
        setPairing: vi.fn().mockImplementation((data) => ({
          id: "test-id",
          createdAt: new Date().toISOString(),
          ...data,
        })),
        markPairingStale: vi.fn(),
      },
      channelRecipients: {
        delete: vi.fn(),
        ensureExists: vi.fn(),
        hasAnyOwner: vi.fn().mockReturnValue(false),
      },
    };

    store = createTestStore();
    store.mobileManager.setEnv({
      storage: mockStorage,
      controlPlaneUrl: "http://mock-cp",
      stateDir: "",
      getRpcClient: () => null,
    });
  });

  it("should generate and cache a desktop device ID", () => {
    const id1 = store.mobileManager.getDesktopDeviceId();
    const id2 = store.mobileManager.getDesktopDeviceId();

    expect(id1).toBeDefined();
    expect(typeof id1).toBe("string");
    expect(id1).toBe(id2); // Should return the cached instance
  });

  it("should initialize with pairings from storage", () => {
    mockStorage.mobilePairings.getAllPairings.mockReturnValue([
      {
        id: "p1",
        pairingId: "relay-1",
        deviceId: "d1",
        accessToken: "tok1",
        relayUrl: "ws://relay",
        createdAt: "2025-01-01T00:00:00Z",
        status: "active",
      },
    ]);

    store.mobileManager.init();

    expect(store.mobileManager.initialized).toBe(true);
    expect(store.mobilePairings.length).toBe(1);
    expect(store.mobilePairings[0].id).toBe("p1");
  });

  it("should return null for activeCode when none is set", () => {
    expect(store.mobileManager.getActiveCode()).toBeNull();
  });

  it("should clear active code", () => {
    store.mobileManager.clearActiveCode();
    expect(store.mobileManager.getActiveCode()).toBeNull();
  });

  it("should add a pairing to MST and storage", () => {
    store.mobileManager.init();

    const result = store.mobileManager.addPairing({
      deviceId: "d1",
      accessToken: "tok1",
      relayUrl: "ws://relay",
    });

    expect(result.id).toBe("test-id");
    expect(mockStorage.mobilePairings.setPairing).toHaveBeenCalled();
    expect(store.mobilePairings.length).toBe(1);
  });

  it("should remove a pairing from MST and storage", () => {
    mockStorage.mobilePairings.getAllPairings.mockReturnValue([
      {
        id: "p1",
        pairingId: "relay-1",
        deviceId: "d1",
        accessToken: "tok1",
        relayUrl: "ws://relay",
        createdAt: "2025-01-01T00:00:00Z",
        status: "active",
      },
    ]);
    store.mobileManager.init();
    expect(store.mobilePairings.length).toBe(1);

    store.mobileManager.removePairing("p1");

    expect(mockStorage.mobilePairings.removePairingById).toHaveBeenCalledWith("p1");
    expect(store.mobilePairings.length).toBe(0);
  });

  it("should disconnect all pairings", () => {
    mockStorage.mobilePairings.getAllPairings.mockReturnValue([
      {
        id: "p1",
        pairingId: null,
        deviceId: "d1",
        accessToken: "tok1",
        relayUrl: "ws://relay",
        createdAt: "2025-01-01T00:00:00Z",
        status: "active",
      },
    ]);
    store.mobileManager.init();

    store.mobileManager.disconnectAll();

    expect(mockStorage.mobilePairings.clearPairing).toHaveBeenCalled();
    expect(store.mobilePairings.length).toBe(0);
    expect(store.mobileManager.getActiveCode()).toBeNull();
  });

  it("should mark a pairing as stale", () => {
    mockStorage.mobilePairings.getAllPairings.mockReturnValue([
      {
        id: "p1",
        pairingId: "relay-1",
        deviceId: "d1",
        accessToken: "tok1",
        relayUrl: "ws://relay",
        createdAt: "2025-01-01T00:00:00Z",
        status: "active",
      },
    ]);
    store.mobileManager.init();

    store.mobileManager.markStale("p1");

    expect(mockStorage.mobilePairings.markPairingStale).toHaveBeenCalledWith("p1");
    expect(store.mobilePairings[0].status).toBe("stale");
  });
});
