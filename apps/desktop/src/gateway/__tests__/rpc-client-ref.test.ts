import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRpcClient } from "../rpc-client-ref.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockEnsureRpcReady = vi.fn<() => any>();

vi.mock("../../openclaw/index.js", () => ({
  openClawConnector: {
    ensureRpcReady: () => mockEnsureRpcReady(),
  },
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("rpc-client-ref", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when connector throws (not connected)", () => {
    mockEnsureRpcReady.mockImplementation(() => {
      throw new Error("RPC not connected");
    });
    expect(getRpcClient()).toBeNull();
  });

  it("returns the rpc client from the connector when connected", () => {
    const mockClient = { request: () => {}, isConnected: () => true };
    mockEnsureRpcReady.mockReturnValue(mockClient);
    expect(getRpcClient()).toBe(mockClient);
  });
});
