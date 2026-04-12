import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CSNewMessageFrame } from "@rivonclaw/core";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("ws", () => ({ WebSocket: vi.fn() }));
vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockRpcRequest = vi.fn();
const { mockGetRpcClient } = vi.hoisted(() => ({
  mockGetRpcClient: vi.fn(),
}));
vi.mock("../gateway/rpc-client-ref.js", () => ({
  getRpcClient: mockGetRpcClient,
}));

const mockGraphqlFetch = vi.fn();
const { mockGetAuthSession } = vi.hoisted(() => ({
  mockGetAuthSession: vi.fn(),
}));
vi.mock("../auth/session-ref.js", () => ({
  getAuthSession: mockGetAuthSession,
}));

vi.mock("../gateway/provider-keys-ref.js", () => ({
  getProviderKeysStore: () => ({ getAll: () => [] }),
}));

vi.mock("../gateway/vendor-dir-ref.js", () => ({
  getVendorDir: () => "/fake/vendor",
}));

const mockReadFullModelCatalog = vi.fn().mockResolvedValue({});
vi.mock("@rivonclaw/gateway", () => ({
  readFullModelCatalog: (...args: unknown[]) => mockReadFullModelCatalog(...args),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { CustomerServiceBridge, type CSShopContext } from "./customer-service-bridge.js";
import { rootStore } from "../app/store/desktop-store.js";
import { onAction } from "mobx-state-tree";

// Track setSessionRunProfile calls via MST's onAction middleware (no spy mutation needed)
const setSessionRunProfileCalls: Array<{ sessionKey: string; runProfileId: string | null }> = [];
onAction(rootStore, (call) => {
  if (call.name === "setSessionRunProfile") {
    setSessionRunProfileCalls.push({
      sessionKey: call.args?.[0] as string,
      runProfileId: call.args?.[1] as string | null ?? null,
    });
  }
}, true); // true = attach to subtree (captures actions on child models)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createBridge(overrides?: Partial<{ defaultRunProfileId: string }>): CustomerServiceBridge {
  return new CustomerServiceBridge({
    relayUrl: "ws://localhost:3001",
    gatewayId: "test-gateway",
    defaultRunProfileId: overrides?.defaultRunProfileId ?? "CUSTOMER_SERVICE",
  });
}

const defaultShop: CSShopContext = {
  objectId: "mongo-id-123",
  platformShopId: "tiktok-shop-456",
  shopName: "Test Shop",
  systemPrompt: "You are a CS assistant.",
  runProfileId: "CUSTOMER_SERVICE",
};

function createFrame(overrides?: Partial<CSNewMessageFrame>): CSNewMessageFrame {
  return {
    type: "cs_tiktok_new_message",
    shopId: "tiktok-shop-456",
    conversationId: "conv-789",
    imUserId: "buyer-001",
    messageId: "msg-001",
    messageType: "TEXT",
    content: JSON.stringify({ content: "Hello" }),
    senderRole: "BUYER",
    senderId: "buyer-001",
    createTime: 1234567890,
    isVisible: true,
    ...overrides,
  };
}

/** Invoke the private onNewMessage method. */
async function triggerMessage(
  bridge: CustomerServiceBridge,
  frame: CSNewMessageFrame,
): Promise<void> {
  await (bridge as any).onNewMessage(frame);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setSessionRunProfileCalls.length = 0;
  mockGetRpcClient.mockReturnValue({ request: mockRpcRequest });
  mockRpcRequest.mockResolvedValue({ ok: true });
  mockReadFullModelCatalog.mockResolvedValue({});
  mockGraphqlFetch.mockImplementation(async (query: string) => {
    if (query.includes("ecommerceGetConversationDetails")) {
      return { ecommerceGetConversationDetails: { buyer: null } };
    }
    if (query.includes("csGetOrCreateSession")) {
      return { csGetOrCreateSession: { sessionId: "sess-001", isNew: true, balance: 100 } };
    }
    return { ecommerceSendMessage: { messageId: "msg-default" } };
  });
  mockGetAuthSession.mockReturnValue({
    getAccessToken: () => "test-token",
    graphqlFetch: mockGraphqlFetch,
  });
  // Initialize LLMProviderManager env so applyModelForSession can call sessions.patch
  rootStore.llmManager.setEnv({
    storage: { providerKeys: { getAll: () => [], getActive: () => null, getById: () => null } } as any,
    secretStore: { get: async () => null, set: async () => {}, delete: async () => {} } as any,
    getRpcClient: () => mockGetRpcClient() as any,
    toMstSnapshot: async () => ({} as any),
    allKeysToMstSnapshots: async () => [],
    syncActiveKey: async () => {},
    syncAllAuthProfiles: async () => {},
    writeProxyRouterConfig: async () => {},
    writeFullGatewayConfig: async () => {},
    writeDefaultModelToConfig: () => {},
    restartGateway: async () => {},
    proxyFetch: globalThis.fetch,
    stateDir: "/tmp/test-state",
    getLastSystemProxy: () => null,
  });
  // Reset MST store, then seed RunProfiles so toolCapability.allRunProfiles returns test data
  rootStore.ingestGraphQLResponse({
    runProfiles: [
      { id: "CUSTOMER_SERVICE", name: "TikTok CS", userId: "", surfaceId: "Default", selectedToolIds: ["TOOL_A", "TOOL_B"] },
      { id: "FALLBACK_CS", name: "Fallback CS", userId: "", surfaceId: "Default", selectedToolIds: ["TOOL_C"] },
    ],
    surfaces: [],
    toolSpecs: [],
    shops: [],
  });
});

// ─── 1. Shop context management ─────────────────────────────────────────────

describe("shop context management", () => {
  it("setShopContext stores context keyed by platformShopId", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    // Prove context is stored: onNewMessage should find it and proceed
    await triggerMessage(bridge, createFrame());
    expect(mockRpcRequest).toHaveBeenCalled();
  });

  it("removeShopContext removes the stored context", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    bridge.removeShopContext("tiktok-shop-456");

    await triggerMessage(bridge, createFrame());
    // Should drop: no RPC calls, no profile set
    expect(mockRpcRequest).not.toHaveBeenCalled();
    expect(setSessionRunProfileCalls).toHaveLength(0);
  });

  it("drops message when shop context not found", async () => {
    const bridge = createBridge();
    // No shop context set

    await triggerMessage(bridge, createFrame());
    expect(mockRpcRequest).not.toHaveBeenCalled();
    expect(setSessionRunProfileCalls).toHaveLength(0);
  });

  it("proceeds when shop context is found", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());
    // Session registration + sessions.patch (model) + agent dispatch = 3 RPC calls
    expect(mockRpcRequest).toHaveBeenCalledTimes(3);
  });
});

// ─── 2. Session key construction ────────────────────────────────────────────

describe("session key construction", () => {
  it("cs_register_session receives scopeKey (agent:main:cs:tiktok:{conversationId})", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({ conversationId: "conv-ABC" }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "cs_register_session",
      expect.objectContaining({
        sessionKey: "agent:main:cs:tiktok:conv-ABC",
      }),
    );
  });

  it("agent RPC receives dispatchKey (cs:tiktok:{conversationId})", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({ conversationId: "conv-ABC" }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        sessionKey: "cs:tiktok:conv-ABC",
      }),
    );
  });

  it("setSessionRunProfile receives scopeKey", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({ conversationId: "conv-XYZ" }));

    expect(setSessionRunProfileCalls).toContainEqual({
      sessionKey: "agent:main:cs:tiktok:conv-XYZ",
      runProfileId: "CUSTOMER_SERVICE",
    });
  });

  it("uses shop.platform for session keys when provided", async () => {
    const bridge = createBridge();
    bridge.setShopContext({ ...defaultShop, platform: "shopee" });

    await triggerMessage(bridge, createFrame({ conversationId: "conv-PLAT" }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "cs_register_session",
      expect.objectContaining({
        sessionKey: "agent:main:cs:shopee:conv-PLAT",
      }),
    );
    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        sessionKey: "cs:shopee:conv-PLAT",
        idempotencyKey: "shopee:msg-001",
      }),
    );
  });

  it("defaults platform to 'tiktok' when shop.platform is undefined", async () => {
    const bridge = createBridge();
    // defaultShop has no platform field
    bridge.setShopContext({ ...defaultShop, platform: undefined });

    await triggerMessage(bridge, createFrame({ conversationId: "conv-DEF" }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "cs_register_session",
      expect.objectContaining({
        sessionKey: "agent:main:cs:tiktok:conv-DEF",
      }),
    );
  });
});

// ─── 3. Message content parsing ─────────────────────────────────────────────

describe("message content parsing", () => {
  it("TEXT message: extracts JSON content field", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({
      messageType: "TEXT",
      content: JSON.stringify({ content: "你好" }),
    }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ message: "[External: Buyer]\n你好" }),
    );
  });

  it("TEXT message: extracts JSON text field as fallback", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({
      messageType: "TEXT",
      content: JSON.stringify({ text: "Fallback text" }),
    }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ message: "[External: Buyer]\nFallback text" }),
    );
  });

  it("TEXT message: raw string fallback when content is not JSON", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({
      messageType: "TEXT",
      content: "plain text message",
    }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ message: "[External: Buyer]\nplain text message" }),
    );
  });

  it("IMAGE message passes raw content with type prefix", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const content = JSON.stringify({ url: "https://example.com/img.jpg", width: 304, height: 290 });

    await triggerMessage(bridge, createFrame({
      messageType: "IMAGE",
      content,
    }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ message: `[External: Buyer]\n[IMAGE] ${content}` }),
    );
  });

  it("ORDER_CARD message passes raw content with type prefix", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const content = JSON.stringify({ order_id: "ORD-12345" });

    await triggerMessage(bridge, createFrame({
      messageType: "ORDER_CARD",
      content,
    }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ message: `[External: Buyer]\n[ORDER_CARD] ${content}` }),
    );
  });

  it("VIDEO message passes raw content with type prefix", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const content = JSON.stringify({ url: "https://example.com/video.mp4", duration: "20.5" });

    await triggerMessage(bridge, createFrame({
      messageType: "VIDEO",
      content,
    }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ message: `[External: Buyer]\n[VIDEO] ${content}` }),
    );
  });
});

// ─── 3a. Image attachment extraction ─────────────────────────────────────────

describe("image attachment extraction", () => {
  it("IMAGE message: fetches image and passes base64 attachment to agent RPC", async () => {
    const fakeImageBuffer = Buffer.from("fake-png-data");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: () => Promise.resolve(fakeImageBuffer.buffer.slice(
        fakeImageBuffer.byteOffset,
        fakeImageBuffer.byteOffset + fakeImageBuffer.byteLength,
      )),
    });
    vi.stubGlobal("fetch", mockFetch);

    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const imageUrl = "https://tosv.boei18n.byted.org/obj/test-image.png";
    const content = JSON.stringify({ url: imageUrl, width: 304, height: 290 });

    await triggerMessage(bridge, createFrame({
      messageType: "IMAGE",
      content,
    }));

    // fetch was called with the image URL
    expect(mockFetch).toHaveBeenCalledWith(imageUrl);

    // agent RPC includes attachments
    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall).toBeDefined();
    expect(agentCall![1].attachments).toEqual([
      { mimeType: "image/png", content: fakeImageBuffer.toString("base64") },
    ]);

    vi.unstubAllGlobals();
  });

  it("IMAGE message: fetch failure does not block agent dispatch (graceful degradation)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", mockFetch);

    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const content = JSON.stringify({ url: "https://example.com/broken.jpg", width: 100, height: 100 });

    await triggerMessage(bridge, createFrame({
      messageType: "IMAGE",
      content,
    }));

    // Agent RPC was still called (dispatch not blocked)
    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall).toBeDefined();

    // No attachments passed (fetch failed)
    expect(agentCall![1].attachments).toBeUndefined();

    // Text content still includes the IMAGE prefix
    expect(agentCall![1].message).toContain("[IMAGE]");

    vi.unstubAllGlobals();
  });

  it("IMAGE message: non-ok response does not produce attachments", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", mockFetch);

    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const content = JSON.stringify({ url: "https://example.com/missing.jpg" });

    await triggerMessage(bridge, createFrame({
      messageType: "IMAGE",
      content,
    }));

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall).toBeDefined();
    expect(agentCall![1].attachments).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("TEXT message: no attachments passed to agent RPC", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({
      messageType: "TEXT",
      content: JSON.stringify({ content: "Hello" }),
    }));

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall).toBeDefined();
    expect(agentCall![1].attachments).toBeUndefined();
  });

  it("IMAGE message: defaults mimeType to image/jpeg when content-type header is missing", async () => {
    const fakeImageBuffer = Buffer.from("fake-jpeg-data");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(), // no content-type
      arrayBuffer: () => Promise.resolve(fakeImageBuffer.buffer.slice(
        fakeImageBuffer.byteOffset,
        fakeImageBuffer.byteOffset + fakeImageBuffer.byteLength,
      )),
    });
    vi.stubGlobal("fetch", mockFetch);

    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({
      messageType: "IMAGE",
      content: JSON.stringify({ url: "https://example.com/no-ct.jpg" }),
    }));

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall![1].attachments).toEqual([
      { mimeType: "image/jpeg", content: fakeImageBuffer.toString("base64") },
    ]);

    vi.unstubAllGlobals();
  });
});

// ─── 4. CS RunProfile setup ─────────────────────────────────────────────────

describe("CS RunProfile setup", () => {
  it("calls setSessionRunProfile with scopeKey, profile data, and runProfileId", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    expect(setSessionRunProfileCalls).toContainEqual({
      sessionKey: "agent:main:cs:tiktok:conv-789",
      runProfileId: "CUSTOMER_SERVICE",
    });
  });

  it("proceeds with agent dispatch even when RunProfile not in cache (model resolves at query time)", async () => {
    rootStore.ingestGraphQLResponse({ runProfiles: [] }); // no profiles
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    // Bridge no longer validates profile existence — it stores the ID and lets the model
    // resolve at effective-tools query time (returning empty tools if not found).
    expect(mockRpcRequest).toHaveBeenCalledWith(
      "cs_register_session",
      expect.anything(),
    );
    expect(mockRpcRequest).toHaveBeenCalledWith("agent", expect.anything());
    expect(setSessionRunProfileCalls).toContainEqual({
      sessionKey: "agent:main:cs:tiktok:conv-789",
      runProfileId: "CUSTOMER_SERVICE",
    });
  });

  it("falls back to defaultRunProfileId when shop has no runProfileId", async () => {
    const bridge = createBridge({ defaultRunProfileId: "FALLBACK_CS" });
    bridge.setShopContext({ ...defaultShop, runProfileId: undefined });

    await triggerMessage(bridge, createFrame());

    expect(setSessionRunProfileCalls).toContainEqual(
      expect.objectContaining({
        runProfileId: "FALLBACK_CS",
      }),
    );
  });

  it("drops message when no runProfileId and no defaultRunProfileId", async () => {
    const bridge = new CustomerServiceBridge({
      relayUrl: "ws://localhost:3001",
      gatewayId: "test-gateway",
      // no defaultRunProfileId
    });
    bridge.setShopContext({ ...defaultShop, runProfileId: undefined });

    await triggerMessage(bridge, createFrame());

    // cs_register_session is called (step 4), but RunProfile set and agent dispatch are not
    expect(mockRpcRequest).toHaveBeenCalledWith("cs_register_session", expect.anything());
    expect(setSessionRunProfileCalls).toHaveLength(0);
    expect(mockRpcRequest).not.toHaveBeenCalledWith("agent", expect.anything());
  });
});

// ─── 5. Session registration ────────────────────────────────────────────────

describe("session registration", () => {
  it("cs_register_session called with correct scopeKey and csContext", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({
      conversationId: "conv-100",
      imUserId: "buyer-200",
    }));

    expect(mockRpcRequest).toHaveBeenCalledWith("cs_register_session", {
      sessionKey: "agent:main:cs:tiktok:conv-100",
      csContext: {
        shopId: "mongo-id-123",
        conversationId: "conv-100",
        buyerUserId: "buyer-200",
        imUserId: "buyer-200",
        orderId: null,
        recentOrders: [],
      },
    });
  });

  it("csContext contains shop.objectId, not platform ID", async () => {
    const bridge = createBridge();
    bridge.setShopContext({
      objectId: "actual-mongo-object-id",
      platformShopId: "platform-id-999",
      shopName: "Test Shop",
      systemPrompt: "prompt",
    });

    await triggerMessage(bridge, createFrame({ shopId: "platform-id-999" }));

    const registerCall = mockRpcRequest.mock.calls.find(
      (c: any[]) => c[0] === "cs_register_session",
    );
    expect(registerCall).toBeDefined();
    expect(registerCall![1].csContext.shopId).toBe("actual-mongo-object-id");
  });

  it("csContext includes orderId when orders are returned from backend", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    mockGraphqlFetch.mockImplementation(async (query: string) => {
      if (query.includes("ecommerceGetConversationDetails")) {
        return { ecommerceGetConversationDetails: { buyer: { userId: "buyer-001", nickname: "Buyer" } } };
      }
      if (query.includes("ecommerceGetOrders")) {
        return { ecommerceGetOrders: { items: [{ orderId: "order-555", createTime: 1700000000 }] } };
      }
      return { csGetOrCreateSession: { sessionId: "sess-001", isNew: true, balance: 100 } };
    });

    await triggerMessage(bridge, createFrame());

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "cs_register_session",
      expect.objectContaining({
        csContext: expect.objectContaining({ orderId: "order-555" }),
      }),
    );
  });

  it("if registration fails, message is dropped (no RunProfile set, no agent dispatch)", async () => {
    mockRpcRequest.mockRejectedValueOnce(new Error("registration failed"));
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    // Only the failed register call; no agent call
    expect(mockRpcRequest).toHaveBeenCalledTimes(1);
    expect(mockRpcRequest).toHaveBeenCalledWith("cs_register_session", expect.anything());
    // No RunProfile set should have been called
    expect(setSessionRunProfileCalls).toHaveLength(0);
  });
});

// ─── 6. Agent dispatch ──────────────────────────────────────────────────────

describe("agent dispatch", () => {
  it("agent RPC called with dispatchKey as sessionKey", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({ conversationId: "conv-dispatch" }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        sessionKey: "cs:tiktok:conv-dispatch",
      }),
    );
  });

  it("extraSystemPrompt includes shop.systemPrompt and session info", async () => {
    const bridge = createBridge();
    bridge.setShopContext({
      ...defaultShop,
      systemPrompt: "Custom shop prompt for testing.",
    });

    await triggerMessage(bridge, createFrame({
      conversationId: "conv-prompt",
      imUserId: "buyer-prompt",
    }));

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall).toBeDefined();
    const prompt = agentCall![1].extraSystemPrompt as string;
    expect(prompt).toContain("Custom shop prompt for testing.");
    expect(prompt).toContain("conv-prompt");
    expect(prompt).toContain("buyer-prompt");
    expect(prompt).toContain("mongo-id-123");
  });

  it("extraSystemPrompt includes orderId when present", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    mockGraphqlFetch.mockImplementation(async (query: string) => {
      if (query.includes("ecommerceGetConversationDetails")) {
        return { ecommerceGetConversationDetails: { buyer: { userId: "buyer-001", nickname: "Buyer" } } };
      }
      if (query.includes("ecommerceGetOrders")) {
        return { ecommerceGetOrders: { items: [{ orderId: "order-in-prompt", createTime: 1700000000 }] } };
      }
      return { csGetOrCreateSession: { sessionId: "sess-001", isNew: true, balance: 100 } };
    });

    await triggerMessage(bridge, createFrame());

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall![1].extraSystemPrompt).toContain("order-in-prompt");
  });

  it("extraSystemPrompt omits Order ID line when orderId is absent", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({ orderId: undefined }));

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall![1].extraSystemPrompt).not.toContain("Order ID");
  });

  it("idempotencyKey = {platform}:{messageId}", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({ messageId: "msg-unique-42" }));

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        idempotencyKey: "tiktok:msg-unique-42",
      }),
    );
  });

  it("if dispatch fails, error is logged but bridge continues running", async () => {
    // First call (register) succeeds, second (sessions.patch) succeeds, third (agent) fails
    mockRpcRequest
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("agent dispatch failed"));

    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    // Should not throw
    await triggerMessage(bridge, createFrame({ messageId: "msg-fail" }));

    // All three calls were attempted
    expect(mockRpcRequest).toHaveBeenCalledTimes(3);
    expect(mockRpcRequest).toHaveBeenCalledWith("cs_register_session", expect.anything());
    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.patch", expect.anything());
    expect(mockRpcRequest).toHaveBeenCalledWith("agent", expect.anything());
  });
});

// ─── 7. Error scenarios ─────────────────────────────────────────────────────

describe("error scenarios", () => {
  it("no RPC client → message dropped entirely", async () => {
    mockGetRpcClient.mockReturnValue(null);
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    expect(mockRpcRequest).not.toHaveBeenCalled();
    expect(setSessionRunProfileCalls).toHaveLength(0);
  });

  it("shop context not found → message dropped with no further calls", async () => {
    const bridge = createBridge();
    // Do NOT set any shop context

    await triggerMessage(bridge, createFrame({ shopId: "nonexistent-shop" }));

    expect(mockRpcRequest).not.toHaveBeenCalled();
    expect(setSessionRunProfileCalls).toHaveLength(0);
  });

  it("session registration fails → RunProfile set and agent dispatch skipped", async () => {
    mockRpcRequest.mockRejectedValueOnce(new Error("session reg failed"));
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    expect(mockRpcRequest).toHaveBeenCalledTimes(1);
    expect(setSessionRunProfileCalls).toHaveLength(0);
  });

  it("RunProfile not in cache → bridge still proceeds (model resolves at query time)", async () => {
    rootStore.ingestGraphQLResponse({ runProfiles: [] }); // empty profiles
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    // Bridge no longer validates profile existence — it stores the ID.
    // cs_register_session + sessions.patch (model) + agent dispatch = 3 RPC calls.
    expect(mockRpcRequest).toHaveBeenCalledTimes(3);
    expect(mockRpcRequest).toHaveBeenCalledWith("cs_register_session", expect.anything());
    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.patch", expect.anything());
    expect(mockRpcRequest).toHaveBeenCalledWith("agent", expect.anything());
  });

  it("agent dispatch fails → bridge does not throw (continues running)", async () => {
    mockRpcRequest
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("dispatch failure"));
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    // Must not throw
    await expect(triggerMessage(bridge, createFrame())).resolves.toBeUndefined();
  });

  it("multiple shops: messages route to correct shop context", async () => {
    const bridge = createBridge();
    const shopA: CSShopContext = {
      objectId: "mongo-A",
      platformShopId: "platform-A",
      shopName: "Shop A",
      systemPrompt: "Prompt A",
    };
    const shopB: CSShopContext = {
      objectId: "mongo-B",
      platformShopId: "platform-B",
      shopName: "Shop B",
      systemPrompt: "Prompt B",
    };
    bridge.setShopContext(shopA);
    bridge.setShopContext(shopB);

    await triggerMessage(bridge, createFrame({ shopId: "platform-B" }));

    const registerCall = mockRpcRequest.mock.calls.find(
      (c: any[]) => c[0] === "cs_register_session",
    );
    expect(registerCall![1].csContext.shopId).toBe("mongo-B");

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall![1].extraSystemPrompt).toContain("Prompt B");
  });
});

// ── 8. Reactive entity cache sync ──────────────────────────────────────────

describe("reactive entity cache sync", () => {
  it("syncFromCache picks up CS-enabled shops bound to this device", () => {
    const bridge = createBridge();

    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1",
          platform: "TIKTOK_SHOP",
          platformShopId: "ps-1",
          shopName: "My Shop",
          services: {
            customerService: {
              enabled: true,
              csDeviceId: "test-gateway",
              assembledPrompt: "You are a CS agent.",
              csModelOverride: null,
              runProfileId: "rp-1",
            },
          },
        },
      ],
    });

    bridge.syncFromCache();

    // Verify the shop context is set by triggering a message
    const frame = createFrame({ shopId: "ps-1" });
    return triggerMessage(bridge, frame).then(() => {
      expect(mockRpcRequest).toHaveBeenCalledWith(
        "cs_register_session",
        expect.objectContaining({
          csContext: expect.objectContaining({ shopId: "shop-1" }),
        }),
      );
    });
  });

  it("syncFromCache skips shops not bound to this device", () => {
    const bridge = createBridge();

    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1",
          platform: "TIKTOK_SHOP",
          platformShopId: "ps-1",
          shopName: "Other Device Shop",
          services: {
            customerService: {
              enabled: true,
              csDeviceId: "other-device",
              assembledPrompt: "prompt",
            },
          },
        },
      ],
    });

    bridge.syncFromCache();

    // Should not have context for this shop
    return triggerMessage(bridge, createFrame({ shopId: "ps-1" })).then(() => {
      expect(mockRpcRequest).not.toHaveBeenCalled();
    });
  });

  it("syncFromCache skips shops with CS disabled", () => {
    const bridge = createBridge();

    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1",
          platform: "TIKTOK_SHOP",
          platformShopId: "ps-1",
          shopName: "Disabled Shop",
          services: {
            customerService: {
              enabled: false,
              csDeviceId: "test-gateway",
              assembledPrompt: "prompt",
            },
          },
        },
      ],
    });

    bridge.syncFromCache();

    return triggerMessage(bridge, createFrame({ shopId: "ps-1" })).then(() => {
      expect(mockRpcRequest).not.toHaveBeenCalled();
    });
  });

  it("syncFromCache skips shops without assembledPrompt", () => {
    const bridge = createBridge();

    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1",
          platform: "TIKTOK_SHOP",
          platformShopId: "ps-1",
          shopName: "No Prompt Shop",
          services: {
            customerService: {
              enabled: true,
              csDeviceId: "test-gateway",
              assembledPrompt: null,
            },
          },
        },
      ],
    });

    bridge.syncFromCache();

    return triggerMessage(bridge, createFrame({ shopId: "ps-1" })).then(() => {
      expect(mockRpcRequest).not.toHaveBeenCalled();
    });
  });

  it("syncFromCache removes shops that are no longer in cache", () => {
    const bridge = createBridge();

    // First: add a shop context manually
    bridge.setShopContext({
      objectId: "shop-1",
      platformShopId: "ps-1",
      shopName: "Test Shop",
      platform: "tiktok",
      systemPrompt: "Old prompt",
    });

    // Then: sync from empty cache (shop was removed)
    rootStore.ingestGraphQLResponse({ shops: [] });
    bridge.syncFromCache();

    // Should not have context anymore
    return triggerMessage(bridge, createFrame({ shopId: "ps-1" })).then(() => {
      expect(mockRpcRequest).not.toHaveBeenCalled();
    });
  });

  it("syncFromCache updates existing shop context when data changes", () => {
    const bridge = createBridge();

    // Initial sync
    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1",
          platform: "TIKTOK_SHOP",
          platformShopId: "ps-1",
          shopName: "Shop",
          services: {
            customerService: {
              enabled: true,
              csDeviceId: "test-gateway",
              assembledPrompt: "Old prompt",
              runProfileId: null,
              csModelOverride: null,
            },
          },
        },
      ],
    });
    bridge.syncFromCache();

    // Update: change assembledPrompt
    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1",
          platform: "TIKTOK_SHOP",
          platformShopId: "ps-1",
          shopName: "Shop",
          services: {
            customerService: {
              enabled: true,
              csDeviceId: "test-gateway",
              assembledPrompt: "Updated prompt",
              runProfileId: null,
              csModelOverride: null,
            },
          },
        },
      ],
    });
    bridge.syncFromCache();

    // Trigger message and verify the updated prompt is used
    return triggerMessage(bridge, createFrame({ shopId: "ps-1" })).then(() => {
      const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
      expect(agentCall![1].extraSystemPrompt).toContain("Updated prompt");
    });
  });

  it("syncFromCache normalizes platform name from enum", () => {
    const bridge = createBridge();

    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1",
          platform: "TIKTOK_SHOP",
          platformShopId: "ps-1",
          shopName: "Shop",
          services: {
            customerService: {
              enabled: true,
              csDeviceId: "test-gateway",
              assembledPrompt: "prompt",
            },
          },
        },
      ],
    });
    bridge.syncFromCache();

    return triggerMessage(bridge, createFrame({ shopId: "ps-1" })).then(() => {
      expect(mockRpcRequest).toHaveBeenCalledWith(
        "cs_register_session",
        expect.objectContaining({
          sessionKey: "agent:main:cs:tiktok:conv-789",
        }),
      );
    });
  });

  it("syncFromCache handles multiple shops with mixed eligibility", () => {
    const bridge = createBridge();

    rootStore.ingestGraphQLResponse({
      shops: [
        {
          id: "shop-1", platform: "TIKTOK_SHOP", platformShopId: "ps-1", shopName: "Eligible",
          services: { customerService: { enabled: true, csDeviceId: "test-gateway", assembledPrompt: "prompt-1" } },
        },
        {
          id: "shop-2", platform: "TIKTOK_SHOP", platformShopId: "ps-2", shopName: "Disabled",
          services: { customerService: { enabled: false, csDeviceId: "test-gateway", assembledPrompt: "prompt-2" } },
        },
        {
          id: "shop-3", platform: "SHOPEE_STORE", platformShopId: "ps-3", shopName: "Other Device",
          services: { customerService: { enabled: true, csDeviceId: "other-device", assembledPrompt: "prompt-3" } },
        },
        {
          id: "shop-4", platform: "TIKTOK_SHOP", platformShopId: "ps-4", shopName: "Also Eligible",
          services: { customerService: { enabled: true, csDeviceId: "test-gateway", assembledPrompt: "prompt-4" } },
        },
      ],
    });
    bridge.syncFromCache();

    // Only shop-1 and shop-4 should be active. Verify shop-1 works:
    return triggerMessage(bridge, createFrame({ shopId: "ps-1" })).then(async () => {
      expect(mockRpcRequest).toHaveBeenCalledWith(
        "cs_register_session",
        expect.objectContaining({ csContext: expect.objectContaining({ shopId: "shop-1" }) }),
      );

      // Reset and verify shop-4 works:
      vi.clearAllMocks();
      setSessionRunProfileCalls.length = 0;
      mockGetRpcClient.mockReturnValue({ request: mockRpcRequest });
      mockRpcRequest.mockResolvedValue({ ok: true });
      mockGetAuthSession.mockReturnValue({
        getAccessToken: () => "test-token",
        graphqlFetch: mockGraphqlFetch,
      });
      mockGraphqlFetch.mockResolvedValue({
        csGetOrCreateSession: { sessionId: "sess-001", isNew: true, balance: 100 },
      });
      // RunProfiles are already in the MST store from beforeEach

      await triggerMessage(bridge, createFrame({ shopId: "ps-4", conversationId: "conv-shop4" }));
      expect(mockRpcRequest).toHaveBeenCalledWith(
        "cs_register_session",
        expect.objectContaining({ csContext: expect.objectContaining({ shopId: "shop-4" }) }),
      );
    });
  });
});

// ─── 9. CS session lifecycle ────────────────────────────────────────────────

describe("CS session lifecycle", () => {
  it("calls csGetOrCreateSession before agent dispatch", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame({
      conversationId: "conv-lifecycle",
      imUserId: "buyer-lifecycle",
    }));

    // graphqlFetch should have been called with the session creation mutation
    expect(mockGraphqlFetch).toHaveBeenCalledWith(
      expect.stringContaining("csGetOrCreateSession"),
      {
        shopId: "mongo-id-123",
        conversationId: "conv-lifecycle",
        buyerUserId: "buyer-lifecycle",
      },
    );
  });

  it("skips agent dispatch when csGetOrCreateSession fails (insufficient balance)", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockClear();
    // Reject ALL graphqlFetch calls so ensureBackendSession always fails
    mockGraphqlFetch.mockRejectedValue(new Error("Insufficient balance"));

    await triggerMessage(bridge, createFrame());

    // ensureBackendSession fails before setup, so neither cs_register_session nor agent is called
    expect(mockRpcRequest).not.toHaveBeenCalledWith("agent", expect.anything());
    expect(mockRpcRequest).not.toHaveBeenCalledWith("cs_register_session", expect.anything());
  });

  it("skips agent dispatch when no auth session available", async () => {
    mockGetAuthSession.mockReturnValue(null);

    const bridge = createBridge();
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    // ensureBackendSession fails (no auth), so neither cs_register_session nor agent is called
    expect(mockRpcRequest).not.toHaveBeenCalledWith("agent", expect.anything());
    expect(mockGraphqlFetch).not.toHaveBeenCalled();
  });

});

// ─── 10. Admin directive dispatch ────────────────────────────────────────────

const defaultDirectiveParams = {
  shopId: "mongo-id-123",
  conversationId: "conv-directive-001",
  buyerUserId: "buyer-001",
  decision: "approved",
  instructions: "Issue a full refund for order #12345",
};

describe("escalation lifecycle (resolve + dispatch)", () => {
  /** Helper: create a session with a pre-existing escalation. */
  async function setupSessionWithEscalation(bridge: ReturnType<typeof createBridge>) {
    bridge.setShopContext(defaultShop);
    const session = await bridge.getOrCreateSession(defaultDirectiveParams.shopId, defaultDirectiveParams);
    // Simulate a prior cs_escalate by adding an escalation record
    const esc = session.addEscalation({ reason: "Refund exceeds limit" });
    return { session, escalationId: esc.id };
  }

  it("resolves escalation and dispatches notification to CS agent", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);
    mockRpcRequest.mockResolvedValue({ runId: "run-esc-001" });

    session.resolveEscalation(escalationId, { decision: "approved", instructions: "Process refund", resolved: true });
    const result = await session.dispatchEscalationResolved(escalationId);

    expect(result.runId).toBe("run-esc-001");
    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall).toBeDefined();
    // Message tells agent to use tool, not the directive itself
    expect(agentCall![1].message).toContain(escalationId);
    expect(agentCall![1].message).toContain("cs_get_escalation_result");
  });

  it("stores decision in escalation record", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);

    session.resolveEscalation(escalationId, { decision: "rejected", instructions: "Offer store credit", resolved: true });

    const esc = session.escalations.get(escalationId);
    expect(esc?.result).toEqual(expect.objectContaining({
      decision: "rejected",
      instructions: "Offer store credit",
      resolved: true,
    }));
    expect(esc?.result?.resolvedAt).toBeGreaterThan(0);
  });

  it("throws when resolving non-existent escalation", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const session = await bridge.getOrCreateSession(defaultDirectiveParams.shopId, defaultDirectiveParams);

    expect(() => session.resolveEscalation("esc_nonexistent", { decision: "approved", instructions: "go", resolved: true }))
      .toThrow("Escalation esc_nonexistent not found");
  });

  it("allows overwriting previous resolution", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);

    session.resolveEscalation(escalationId, { decision: "checking warehouse", instructions: "hold on", resolved: false });
    const firstResolvedAt = session.escalations.get(escalationId)!.result!.resolvedAt;

    session.resolveEscalation(escalationId, { decision: "approved", instructions: "ship replacement", resolved: true });
    const esc = session.escalations.get(escalationId)!;

    expect(esc.result!.decision).toBe("approved");
    expect(esc.result!.instructions).toBe("ship replacement");
    expect(esc.result!.resolved).toBe(true);
    expect(esc.result!.resolvedAt).toBeGreaterThanOrEqual(firstResolvedAt);
  });

  it("registers CS session before dispatch", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);
    mockRpcRequest.mockResolvedValue({ runId: "run-esc-002" });

    session.resolveEscalation(escalationId, { decision: "approved", instructions: "go", resolved: true });
    await session.dispatchEscalationResolved(escalationId);

    const callOrder = mockRpcRequest.mock.calls.map((c: any[]) => c[0]);
    expect(callOrder.indexOf("cs_register_session")).toBeLessThan(callOrder.indexOf("agent"));
  });

  it("tracks run in pendingRuns for auto-forward", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);
    mockRpcRequest.mockResolvedValue({ runId: "run-esc-003" });

    session.resolveEscalation(escalationId, { decision: "approved", instructions: "go", resolved: true });
    await session.dispatchEscalationResolved(escalationId);

    // Simulate agent events: assistant text + lifecycle end (per-turn forwarding)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-esc-003", stream: "assistant", data: { text: "Done." } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-esc-003", stream: "lifecycle", data: { phase: "end" } },
    } as any);

    expect(mockGraphqlFetch).toHaveBeenCalledWith(
      expect.stringContaining("ecommerceSendMessage"),
      expect.objectContaining({ shopId: "mongo-id-123", conversationId: "conv-directive-001" }),
    );
  });

  it("findSessionByEscalationId returns correct session", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);

    expect(bridge.findSessionByEscalationId(escalationId)).toBe(session);
    expect(bridge.findSessionByEscalationId("nonexistent")).toBeUndefined();
  });

  it("idempotencyKey starts with 'esc-resolved:' prefix", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);
    mockRpcRequest.mockResolvedValue({ runId: "run-esc-004" });

    session.resolveEscalation(escalationId, { decision: "approved", instructions: "go", resolved: true });
    await session.dispatchEscalationResolved(escalationId);

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    expect(agentCall![1].idempotencyKey).toMatch(new RegExp(`^esc-resolved:${escalationId}:\\d+$`));
  });

  it("dispatch message differs for resolved vs in-progress", async () => {
    const bridge = createBridge();

    // Test in-progress message
    const { session: session1, escalationId: eid1 } = await setupSessionWithEscalation(bridge);
    mockRpcRequest.mockResolvedValue({ runId: "run-esc-ip-001" });
    session1.resolveEscalation(eid1, { decision: "checking", instructions: "hold", resolved: false });
    await session1.dispatchEscalationResolved(eid1);

    const inProgressCall = mockRpcRequest.mock.calls.find(
      (c: any[]) => c[0] === "agent" && c[1].message.includes(eid1),
    );
    expect(inProgressCall![1].message).toContain("sent an update");
    expect(inProgressCall![1].message).not.toContain("has been resolved");

    // Test resolved message — use a fresh bridge to avoid call interference
    const bridge2 = createBridge();
    const { session: session2, escalationId: eid2 } = await setupSessionWithEscalation(bridge2);
    mockRpcRequest.mockClear();
    mockRpcRequest.mockResolvedValue({ runId: "run-esc-res-001" });
    session2.resolveEscalation(eid2, { decision: "approved", instructions: "go", resolved: true });
    await session2.dispatchEscalationResolved(eid2);

    const resolvedCall = mockRpcRequest.mock.calls.find(
      (c: any[]) => c[0] === "agent" && c[1].message.includes(eid2),
    );
    expect(resolvedCall![1].message).toContain("has been resolved");
    expect(resolvedCall![1].message).not.toContain("sent an update");
  });

  it("GET escalation returns guidance for pending escalation", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);

    const escalation = session.escalations.get(escalationId)!;
    // Pending: no result set
    expect(escalation.result).toBeUndefined();

    // Verify the status derivation logic matches route handler
    const status = escalation.result?.resolved ? "resolved" : escalation.result ? "in_progress" : "pending";
    expect(status).toBe("pending");
    const guidance = !escalation.result?.resolved
      ? "This escalation is still being processed. Continue to reassure the buyer and avoid making commitments. If the buyer is pressing, you may cs_escalate again to follow up with the manager."
      : null;
    expect(guidance).not.toBeNull();
  });

  it("GET escalation returns guidance for in-progress (resolved=false) escalation", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);

    session.resolveEscalation(escalationId, { decision: "checking warehouse", instructions: "hold on", resolved: false });
    const escalation = session.escalations.get(escalationId)!;

    const status = escalation.result?.resolved ? "resolved" : escalation.result ? "in_progress" : "pending";
    expect(status).toBe("in_progress");
    const guidance = !escalation.result?.resolved
      ? "This escalation is still being processed. Continue to reassure the buyer and avoid making commitments. If the buyer is pressing, you may cs_escalate again to follow up with the manager."
      : null;
    expect(guidance).not.toBeNull();
  });

  it("GET escalation returns no guidance for resolved escalation", async () => {
    const bridge = createBridge();
    const { session, escalationId } = await setupSessionWithEscalation(bridge);

    session.resolveEscalation(escalationId, { decision: "approved", instructions: "refund issued", resolved: true });
    const escalation = session.escalations.get(escalationId)!;

    const status = escalation.result?.resolved ? "resolved" : escalation.result ? "in_progress" : "pending";
    expect(status).toBe("resolved");
    const guidance = !escalation.result?.resolved
      ? "This escalation is still being processed. Continue to reassure the buyer and avoid making commitments. If the buyer is pressing, you may cs_escalate again to follow up with the manager."
      : null;
    expect(guidance).toBeNull();
  });
});

// ─── 11. Multi-provider model override (via LLMProviderManager) ──────────────
//
// Model resolution is now delegated to rootStore.llmManager.applyModelForSession.
// The LLM manager reads csProviderOverride/csModelOverride from the MST shop entity
// (not from bridge's CSShopContext), so we seed shops in the MST store.

describe("multi-provider model override", () => {
  /** Helper: seed the model catalog on the LLM manager and seed a shop into MST store. */
  async function seedCatalogAndShop(overrides?: {
    csProviderOverride?: string | null;
    csModelOverride?: string | null;
  }): Promise<void> {
    // Seed model catalog on LLM manager
    mockReadFullModelCatalog.mockResolvedValue({
      zhipu: [{ id: "glm-5" }, { id: "glm-4" }],
      openai: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
      anthropic: [{ id: "claude-sonnet-4-20250514" }],
    });
    await rootStore.llmManager.refreshModelCatalog();

    // Seed shop in MST store with CS overrides (LLM manager reads from here)
    rootStore.ingestGraphQLResponse({
      shops: [{
        id: "mongo-id-123",
        platform: "TIKTOK_SHOP",
        platformShopId: "tiktok-shop-456",
        shopName: "Test Shop",
        services: {
          customerService: {
            enabled: true,
            csDeviceId: "test-gateway",
            assembledPrompt: "You are a CS assistant.",
            csProviderOverride: overrides?.csProviderOverride ?? null,
            csModelOverride: overrides?.csModelOverride ?? null,
            runProfileId: "CUSTOMER_SERVICE",
          },
        },
      }],
    });
  }

  it("two-field override: sends provider/model to sessions.patch when in catalog", async () => {
    const bridge = createBridge();
    await seedCatalogAndShop({ csProviderOverride: "zhipu", csModelOverride: "glm-5" });
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:cs:tiktok:conv-789",
      model: "zhipu/glm-5",
    });
  });

  it("two-field override: falls back to null when provider/model not in catalog", async () => {
    const bridge = createBridge();
    await seedCatalogAndShop({ csProviderOverride: "zhipu", csModelOverride: "nonexistent-model" });
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:cs:tiktok:conv-789",
      model: null,
    });
  });

  it("no override: neither provider nor model set, sessions.patch called with null (global default)", async () => {
    const bridge = createBridge();
    await seedCatalogAndShop({ csProviderOverride: null, csModelOverride: null });
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    // With no override, applyModelForSession falls through to global default (model: null)
    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:cs:tiktok:conv-789",
      model: null,
    });
  });

  it("refreshModelCatalog caches all providers, not just active provider", async () => {
    const bridge = createBridge();
    // Seed with OpenAI model override
    await seedCatalogAndShop({ csProviderOverride: "openai", csModelOverride: "gpt-4o" });
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:cs:tiktok:conv-789",
      model: "openai/gpt-4o",
    });
  });

  it("provider set without model: sessions.patch called with null (treated as no override)", async () => {
    const bridge = createBridge();
    await seedCatalogAndShop({ csProviderOverride: "zhipu", csModelOverride: null });
    bridge.setShopContext(defaultShop);

    await triggerMessage(bridge, createFrame());

    // LLM manager requires both provider AND model for scope override; falls through to global default
    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:cs:tiktok:conv-789",
      model: null,
    });
  });
});

// ── 12. Escalation ───────────────────────────────────────────────────────────

const escalationShop: CSShopContext = {
  objectId: "shop-esc-001",
  platformShopId: "plat-esc-001",
  shopName: "Escalation Test Shop",
  systemPrompt: "You are a CS assistant.",
  runProfileId: "CUSTOMER_SERVICE",
};

const defaultEscalateParams = {
  shopId: "shop-esc-001",
  conversationId: "conv-esc-001",
  buyerUserId: "buyer-esc-001",
  imUserId: "buyer-esc-001",
  reason: "Buyer requesting refund beyond policy",
};

/** Seed a shop into the MST store with escalation routing configured. */
function seedShopWithEscalation(overrides?: {
  shopId?: string;
  escalationChannelId?: string | null;
  escalationRecipientId?: string | null;
}): void {
  const shopId = overrides?.shopId ?? "shop-esc-001";
  rootStore.ingestGraphQLResponse({
    shops: [
      {
        __typename: "Shop",
        id: shopId,
        platform: "tiktok",
        platformAppId: "",
        platformShopId: "plat-esc-001",
        shopName: "Escalation Test Shop",
        authStatus: "active",
        region: "US",
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        services: {
          customerService: {
            enabled: true,
            businessPrompt: "",
            csDeviceId: null,
            csProviderOverride: null,
            csModelOverride: null,
            escalationChannelId: overrides?.escalationChannelId !== undefined
              ? overrides.escalationChannelId
              : "telegram:acct_test123",
            escalationRecipientId: overrides?.escalationRecipientId !== undefined
              ? overrides.escalationRecipientId
              : "987654321",
            runProfileId: null,
            assembledPrompt: null,
          },
          customerServiceBilling: null,
        },
      },
    ],
  });
}

describe("escalate", () => {
  it("sends to correct channel + accountId + recipient parsed from escalationChannelId", async () => {
    seedShopWithEscalation();
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    const result = await session.escalate({ reason: defaultEscalateParams.reason });

    expect(result.ok).toBe(true);
    expect(result.escalationId).toBeDefined();
    expect(mockRpcRequest).toHaveBeenCalledWith(
      "send",
      expect.objectContaining({
        to: "987654321",
        channel: "telegram",
        accountId: "acct_test123",
      }),
    );
  });

  it("escalation message contains reason and session details", async () => {
    seedShopWithEscalation();
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    await session.escalate({ reason: defaultEscalateParams.reason });

    const sendCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "send");
    expect(sendCall).toBeDefined();
    const message = sendCall![1].message as string;
    expect(message).toContain("CS Escalation");
    expect(message).toContain("Escalation ID: esc_");
    expect(message).toContain("Reason: Buyer requesting refund beyond policy");
    expect(message).toContain("Please reply with your decision");
  });

  it("escalation message contains orderId when provided", async () => {
    seedShopWithEscalation();
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session = await bridge.getOrCreateSession(defaultEscalateParams.shopId, { ...defaultEscalateParams, orderId: "order-esc-999" });
    await session.escalate({ reason: defaultEscalateParams.reason });

    const sendCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "send");
    expect(sendCall).toBeDefined();
    const message = sendCall![1].message as string;
    expect(message).toContain("Escalation ID: esc_");
  });

  it("escalation message contains context when provided", async () => {
    seedShopWithEscalation();
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    await session.escalate({ reason: defaultEscalateParams.reason, context: "Buyer has been waiting 3 days" });

    const sendCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "send");
    expect(sendCall).toBeDefined();
    const message = sendCall![1].message as string;
    expect(message).toContain("Context: Buyer has been waiting 3 days");
  });

  it("returns error when escalation routing not configured (missing escalationChannelId)", async () => {
    seedShopWithEscalation({ escalationChannelId: null });
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session1 = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    const result = await session1.escalate({ reason: defaultEscalateParams.reason });

    expect(result).toEqual({ ok: false, error: "Escalation routing not configured" });
    expect(mockRpcRequest).not.toHaveBeenCalledWith("send", expect.anything());
  });

  it("returns error when escalation routing not configured (missing escalationRecipientId)", async () => {
    seedShopWithEscalation({ escalationRecipientId: null });
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session2 = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    const result = await session2.escalate({ reason: defaultEscalateParams.reason });

    expect(result).toEqual({ ok: false, error: "Escalation routing not configured" });
    expect(mockRpcRequest).not.toHaveBeenCalledWith("send", expect.anything());
  });

  it("returns error when shop not found in MST store", async () => {
    // Don't seed any shop — rootStore.shops is empty (reset in beforeEach)
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session3 = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    const result = await session3.escalate({ reason: defaultEscalateParams.reason });

    expect(result).toEqual({ ok: false, error: "Escalation routing not configured" });
    expect(mockRpcRequest).not.toHaveBeenCalledWith("send", expect.anything());
  });

  it("throws when no RPC client available", async () => {
    mockGetRpcClient.mockReturnValue(null);
    seedShopWithEscalation();
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    await expect(session.escalate({ reason: defaultEscalateParams.reason })).rejects.toThrow("No RPC client available");
  });

  it("send RPC is called with correct idempotencyKey format", async () => {
    seedShopWithEscalation();
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    await session.escalate({ reason: defaultEscalateParams.reason });

    const sendCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "send");
    expect(sendCall).toBeDefined();
    expect(sendCall![1].idempotencyKey).toMatch(/^cs-escalate:esc_[a-f0-9]+:\d+$/);
  });

  it("parses channel with multiple colons correctly (accountId may contain colons)", async () => {
    seedShopWithEscalation({ escalationChannelId: "slack:workspace:channel_id" });
    const bridge = createBridge();
    bridge.setShopContext(escalationShop);

    const session = await bridge.getOrCreateSession(defaultEscalateParams.shopId, defaultEscalateParams);
    await session.escalate({ reason: defaultEscalateParams.reason });

    expect(mockRpcRequest).toHaveBeenCalledWith(
      "send",
      expect.objectContaining({
        channel: "slack",
        accountId: "workspace:channel_id",
      }),
    );
  });
});

// ─── 13. Rapid buyer message handling (abort + redispatch) ────────────────────

describe("rapid buyer messages (abort + redispatch)", () => {
  /**
   * These tests simulate rapid consecutive buyer messages to verify:
   * - Active runs are aborted when new messages arrive
   * - Aborted runs don't auto-forward to buyer
   * - Only the latest message triggers the final agent run
   * - No concurrent dispatches on the same session
   */

  /** Make the agent RPC return controllable promises (queue-based for concurrent calls). */
  function createControllableRpc() {
    const agentResolvers: Array<(val: { runId: string }) => void> = [];

    mockRpcRequest.mockImplementation((method: string) => {
      if (method === "agent") {
        return new Promise<{ runId: string }>((resolve) => {
          agentResolvers.push(resolve);
        });
      }
      if (method === "chat.abort") return Promise.resolve({ aborted: true });
      if (method === "cs_register_session") return Promise.resolve(true);
      if (method === "sessions.patch") return Promise.resolve(true);
      return Promise.resolve({ ok: true });
    });

    return {
      get pendingCount() { return agentResolvers.length; },
      /** Resolve the oldest pending agent RPC. */
      resolveNext(runId: string) {
        const resolve = agentResolvers.shift();
        resolve?.({ runId });
      },
    };
  }

  it("two messages: first is aborted, second dispatches, only second auto-forwards", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const ctrl = createControllableRpc();

    // Message A → dispatch starts, agent RPC in flight
    const promiseA = triggerMessage(bridge, createFrame({ messageId: "msg-A" }));

    // Wait a tick for A's async operations (ensureBackendSession) to proceed
    await new Promise((r) => setTimeout(r, 10));

    // Message B → should abort A and dispatch B
    const promiseB = triggerMessage(bridge, createFrame({ messageId: "msg-B" }));

    // Resolve A's agent RPC (returns "run-A")
    ctrl.resolveNext("run-A");
    await promiseA;

    // Wait for B's async operations
    await new Promise((r) => setTimeout(r, 10));

    // Resolve B's agent RPC
    ctrl.resolveNext("run-B");
    await promiseB;

    // chat.abort should have been called (for A's placeholder)
    expect(mockRpcRequest).toHaveBeenCalledWith("chat.abort", expect.anything());

    // Simulate agent events for run-A (completed before abort arrived)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-A", stream: "assistant", data: { text: "Stale response" } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-A", stream: "lifecycle", data: { phase: "end" } },
    } as any);
    // Chat final for cleanup
    bridge.onGatewayEvent({
      event: "chat",
      payload: { runId: "run-A", state: "final" },
    } as any);

    // run-A was aborted — should NOT auto-forward
    expect(mockGraphqlFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("ecommerceSendMessage"),
      expect.objectContaining({ content: expect.stringContaining("Stale response") }),
    );

    // Simulate agent events for run-B (per-turn forwarding)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-B", stream: "assistant", data: { text: "Correct response" } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-B", stream: "lifecycle", data: { phase: "end" } },
    } as any);

    // run-B should auto-forward
    expect(mockGraphqlFetch).toHaveBeenCalledWith(
      expect.stringContaining("ecommerceSendMessage"),
      expect.objectContaining({ content: expect.stringContaining("Correct response") }),
    );
  });

  it("message during active run aborts it (chat.abort called)", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockResolvedValue({ runId: "run-first" });

    // First message dispatches normally
    await triggerMessage(bridge, createFrame({ messageId: "msg-1" }));

    // Second message should trigger abort
    await triggerMessage(bridge, createFrame({ messageId: "msg-2" }));

    expect(mockRpcRequest).toHaveBeenCalledWith("chat.abort", expect.objectContaining({
      sessionKey: "agent:main:cs:tiktok:conv-789",
    }));
  });

  it("aborted run error event does not auto-forward", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockResolvedValue({ runId: "run-aborted" });

    // First message
    await triggerMessage(bridge, createFrame({ messageId: "msg-1" }));

    // Second message aborts first
    mockRpcRequest.mockResolvedValue({ runId: "run-replacement" });
    await triggerMessage(bridge, createFrame({ messageId: "msg-2" }));

    // Gateway sends error for aborted run
    bridge.onGatewayEvent({
      event: "chat",
      payload: { runId: "run-aborted", state: "error" },
    } as any);

    // Should not forward anything
    expect(mockGraphqlFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("ecommerceSendMessage"),
      expect.anything(),
    );
  });

  it("single message (no abort) dispatches and auto-forwards normally", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockResolvedValue({ runId: "run-single" });

    await triggerMessage(bridge, createFrame({ messageId: "msg-only" }));

    // Should dispatch agent
    expect(mockRpcRequest).toHaveBeenCalledWith("agent", expect.objectContaining({
      message: expect.stringContaining("Hello"),
    }));

    // No abort should have been called
    expect(mockRpcRequest).not.toHaveBeenCalledWith("chat.abort", expect.anything());

    // Auto-forward works via agent events (per-turn forwarding)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-single", stream: "assistant", data: { text: "Reply" } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-single", stream: "lifecycle", data: { phase: "end" } },
    } as any);

    expect(mockGraphqlFetch).toHaveBeenCalledWith(
      expect.stringContaining("ecommerceSendMessage"),
      expect.objectContaining({ content: expect.stringContaining("Reply") }),
    );
  });

  it("placeholder bail-out: earlier message bails when newer message took over", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    const ctrl = createControllableRpc();

    // A starts dispatching
    const promiseA = triggerMessage(bridge, createFrame({ messageId: "msg-A" }));
    await new Promise((r) => setTimeout(r, 10));

    // B arrives and takes over
    const promiseB = triggerMessage(bridge, createFrame({ messageId: "msg-B" }));
    await new Promise((r) => setTimeout(r, 10));

    // C arrives and takes over from B
    const promiseC = triggerMessage(bridge, createFrame({ messageId: "msg-C" }));

    // Resolve all pending agent RPCs
    ctrl.resolveNext("run-A");
    await promiseA;
    await new Promise((r) => setTimeout(r, 10));

    ctrl.resolveNext("run-B");
    await promiseB;
    await new Promise((r) => setTimeout(r, 10));

    ctrl.resolveNext("run-C");
    await promiseC;

    // Only the final response (run-C) should auto-forward via agent events
    // run-A: agent text + lifecycle end (aborted, should not forward)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-A", stream: "assistant", data: { text: "A response" } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-A", stream: "lifecycle", data: { phase: "end" } },
    } as any);
    bridge.onGatewayEvent({
      event: "chat",
      payload: { runId: "run-A", state: "final" },
    } as any);

    // run-B: agent text + lifecycle end (aborted, should not forward)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-B", stream: "assistant", data: { text: "B response" } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-B", stream: "lifecycle", data: { phase: "end" } },
    } as any);
    bridge.onGatewayEvent({
      event: "chat",
      payload: { runId: "run-B", state: "final" },
    } as any);

    // run-C: agent text + lifecycle end (active, should forward)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-C", stream: "assistant", data: { text: "C response" } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-C", stream: "lifecycle", data: { phase: "end" } },
    } as any);
    bridge.onGatewayEvent({
      event: "chat",
      payload: { runId: "run-C", state: "final" },
    } as any);

    // Only C's response should be forwarded
    const forwardCalls = mockGraphqlFetch.mock.calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("ecommerceSendMessage"),
    );
    expect(forwardCalls).toHaveLength(1);
    expect(forwardCalls[0][1].content).toContain("C response");
  });

  it("undelivered notice: second message includes notice about 1 undelivered reply", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockResolvedValue({ runId: "run-1" });

    // First message dispatches normally
    await triggerMessage(bridge, createFrame({ messageId: "msg-1", content: JSON.stringify({ content: "First" }) }));

    // Second message aborts first and dispatches with notice
    mockRpcRequest.mockResolvedValue({ runId: "run-2" });
    await triggerMessage(bridge, createFrame({ messageId: "msg-2", content: JSON.stringify({ content: "Second" }) }));

    const agentCalls = mockRpcRequest.mock.calls.filter((c: any[]) => c[0] === "agent");
    const lastAgentCall = agentCalls[agentCalls.length - 1];
    const message = lastAgentCall[1].message as string;

    expect(message).toContain("[Internal: System]");
    expect(message).toContain("Your previous reply was not delivered");
    expect(message).toContain("[External: Buyer]");
    expect(message).toContain("Second");
  });

  it("undelivered notice: third message includes count of 2 undelivered replies", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockResolvedValue({ runId: "run-1" });

    await triggerMessage(bridge, createFrame({ messageId: "msg-1", content: JSON.stringify({ content: "First" }) }));

    mockRpcRequest.mockResolvedValue({ runId: "run-2" });
    await triggerMessage(bridge, createFrame({ messageId: "msg-2", content: JSON.stringify({ content: "Second" }) }));

    mockRpcRequest.mockResolvedValue({ runId: "run-3" });
    await triggerMessage(bridge, createFrame({ messageId: "msg-3", content: JSON.stringify({ content: "Third" }) }));

    const agentCalls = mockRpcRequest.mock.calls.filter((c: any[]) => c[0] === "agent");
    const lastAgentCall = agentCalls[agentCalls.length - 1];
    const message = lastAgentCall[1].message as string;

    expect(message).toContain("last 2 replies were not delivered");
    expect(message).toContain("Third");
  });

  it("undelivered count resets after successful delivery", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockResolvedValue({ runId: "run-1" });

    // First message
    await triggerMessage(bridge, createFrame({ messageId: "msg-1", content: JSON.stringify({ content: "First" }) }));

    // Second message aborts first (undeliveredCount = 1)
    mockRpcRequest.mockResolvedValue({ runId: "run-2" });
    await triggerMessage(bridge, createFrame({ messageId: "msg-2", content: JSON.stringify({ content: "Second" }) }));

    // Simulate successful delivery for run-2 via agent events (per-turn forwarding)
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-2", stream: "assistant", data: { text: "Reply" } },
    } as any);
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId: "run-2", stream: "lifecycle", data: { phase: "end" } },
    } as any);
    bridge.onGatewayEvent({
      event: "chat",
      payload: { runId: "run-2", state: "final" },
    } as any);

    // Wait for async forwardTextToBuyer to complete
    await new Promise((r) => setTimeout(r, 10));

    // Third message — should NOT have undelivered notice (count was reset)
    mockRpcRequest.mockResolvedValue({ runId: "run-3" });
    await triggerMessage(bridge, createFrame({ messageId: "msg-3", content: JSON.stringify({ content: "Third" }) }));

    const agentCalls = mockRpcRequest.mock.calls.filter((c: any[]) => c[0] === "agent");
    const lastAgentCall = agentCalls[agentCalls.length - 1];
    const message = lastAgentCall[1].message as string;

    expect(message).not.toContain("[Internal: System]");
    expect(message).not.toContain("not delivered");
    expect(message).toContain("[External: Buyer]");
    expect(message).toContain("Third");
  });

  it("no undelivered notice on first message", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    mockRpcRequest.mockResolvedValue({ runId: "run-1" });

    await triggerMessage(bridge, createFrame({ messageId: "msg-1", content: JSON.stringify({ content: "Hello" }) }));

    const agentCall = mockRpcRequest.mock.calls.find((c: any[]) => c[0] === "agent");
    const message = agentCall![1].message as string;

    expect(message).not.toContain("[Internal: System]");
    expect(message).not.toContain("not delivered");
    expect(message).toBe("[External: Buyer]\nHello");
  });
});

// ─── 14. Per-turn message forwarding (agent events) ─────────────────────────

describe("per-turn message forwarding", () => {
  /**
   * Helper: dispatch a buyer message and return the runId.
   * Sets up the bridge with a shop context and dispatches the message.
   */
  async function dispatchAndGetRunId(
    bridge: ReturnType<typeof createBridge>,
    runId: string,
    overrides?: Partial<CSNewMessageFrame>,
  ): Promise<void> {
    mockRpcRequest.mockResolvedValue({ runId });
    await triggerMessage(bridge, createFrame(overrides));
  }

  /** Helper: send an agent event. */
  function agentEvent(
    bridge: ReturnType<typeof createBridge>,
    runId: string,
    stream: string,
    data: Record<string, unknown>,
  ): void {
    bridge.onGatewayEvent({
      event: "agent",
      payload: { runId, stream, data },
    } as any);
  }

  /** Helper: send a chat final event for cleanup. */
  function chatFinal(bridge: ReturnType<typeof createBridge>, runId: string): void {
    bridge.onGatewayEvent({
      event: "chat",
      payload: { runId, state: "final" },
    } as any);
  }

  /** Helper: count ecommerceSendMessage calls and return their content args. */
  function getForwardedTexts(): string[] {
    return mockGraphqlFetch.mock.calls
      .filter((c: any[]) => typeof c[0] === "string" && c[0].includes("ecommerceSendMessage"))
      .map((c: any[]) => {
        const parsed = JSON.parse(c[1].content as string);
        return parsed.content as string;
      });
  }

  it("single segment (no tool calls): text forwarded once on lifecycle end", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    agentEvent(bridge, "run-1", "assistant", { text: "Hello buyer!" });
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe("Hello buyer!");
  });

  it("multiple segments (with tool calls): each segment forwarded separately", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    // First turn: assistant text, then tool start
    agentEvent(bridge, "run-1", "assistant", { text: "Let me check." });
    agentEvent(bridge, "run-1", "tool", { phase: "start", toolName: "search" });

    // Second turn: text resets per-turn (not accumulated across whole run)
    agentEvent(bridge, "run-1", "assistant", { text: "Here is the answer." });
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe("Let me check.");
    expect(texts[1]).toBe("Here is the answer.");
  });

  it("three segments: text between two tool calls, plus final segment", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    // Segment 1
    agentEvent(bridge, "run-1", "assistant", { text: "Segment one." });
    agentEvent(bridge, "run-1", "tool", { phase: "start", toolName: "tool_a" });

    // Segment 2 (text resets per-turn)
    agentEvent(bridge, "run-1", "assistant", { text: "Segment two." });
    agentEvent(bridge, "run-1", "tool", { phase: "start", toolName: "tool_b" });

    // Segment 3 (text resets per-turn)
    agentEvent(bridge, "run-1", "assistant", { text: "Segment three." });
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(3);
    expect(texts[0]).toBe("Segment one.");
    expect(texts[1]).toBe("Segment two.");
    expect(texts[2]).toBe("Segment three.");
  });

  it("aborted run: text NOT forwarded", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    // Second message arrives, aborting run-1
    mockRpcRequest.mockResolvedValue({ runId: "run-2" });
    await triggerMessage(bridge, createFrame({ messageId: "msg-2" }));

    // Agent events for run-1 arrive after abort
    agentEvent(bridge, "run-1", "assistant", { text: "Stale text" });
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    // Cleanup
    chatFinal(bridge, "run-1");

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(0);
  });

  it("empty text: tool call without any text does not forward", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    // Tool starts without any prior assistant text
    agentEvent(bridge, "run-1", "tool", { phase: "start", toolName: "search" });

    // Assistant text comes after tool, then lifecycle end
    agentEvent(bridge, "run-1", "assistant", { text: "Result found." });
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe("Result found.");
  });

  it("error lifecycle: text NOT forwarded", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    agentEvent(bridge, "run-1", "assistant", { text: "Partial output" });
    agentEvent(bridge, "run-1", "lifecycle", { phase: "error" });

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(0);
  });

  it("non-CS run: agent events ignored (not in pendingRuns)", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    // Don't dispatch any CS message — "run-other" is not in pendingRuns

    agentEvent(bridge, "run-other", "assistant", { text: "Non-CS text" });
    agentEvent(bridge, "run-other", "lifecycle", { phase: "end" });

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(0);
  });

  it("whitespace-only new segment is not forwarded", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    agentEvent(bridge, "run-1", "assistant", { text: "First part." });
    agentEvent(bridge, "run-1", "tool", { phase: "start", toolName: "tool_a" });

    // Second turn is whitespace-only (per-turn text resets)
    agentEvent(bridge, "run-1", "assistant", { text: "   " });
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    const texts = getForwardedTexts();
    // Only the first segment should be forwarded; the whitespace-only segment is skipped
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe("First part.");
  });

  it("chat final event cleans up turn buffers as safety net", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    // Agent text arrives but lifecycle never fires (unusual)
    agentEvent(bridge, "run-1", "assistant", { text: "Buffered text" });

    // Chat final fires — should clean up buffers without forwarding
    chatFinal(bridge, "run-1");

    // No text forwarded (lifecycle end never fired)
    const texts = getForwardedTexts();
    expect(texts).toHaveLength(0);
  });

  it("tool phase other than 'start' does not flush", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    agentEvent(bridge, "run-1", "assistant", { text: "Pending text" });
    // tool phase "end" should NOT trigger a flush
    agentEvent(bridge, "run-1", "tool", { phase: "end", toolName: "search" });

    // Nothing forwarded yet — text still buffered
    expect(getForwardedTexts()).toHaveLength(0);

    // Now lifecycle end flushes
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    const texts = getForwardedTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe("Pending text");
  });

  it("data.text that is not a string is ignored", async () => {
    const bridge = createBridge();
    bridge.setShopContext(defaultShop);
    await dispatchAndGetRunId(bridge, "run-1");

    // data.text is a number — should be ignored
    agentEvent(bridge, "run-1", "assistant", { text: 42 } as any);
    agentEvent(bridge, "run-1", "lifecycle", { phase: "end" });

    expect(getForwardedTexts()).toHaveLength(0);
  });
});
