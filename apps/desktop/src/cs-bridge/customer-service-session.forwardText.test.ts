import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => {
  const stubLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return {
    createLogger: stubLogger,
    createQuietLogger: stubLogger,
    DEBUG_FLAGS: { PROXY: "DEBUG_PROXY", SECRETS: "DEBUG_SECRETS" },
    isDebugFlagEnabled: () => false,
  };
});

const mockRpcRequest = vi.fn();
vi.mock("../openclaw/index.js", () => ({
  openClawConnector: {
    request: (...args: unknown[]) => mockRpcRequest(...args),
    ensureRpcReady: () => ({ request: mockRpcRequest, isConnected: () => true }),
  },
}));

const mockGraphqlFetch = vi.fn();
const { mockGetAuthSession } = vi.hoisted(() => ({ mockGetAuthSession: vi.fn() }));
vi.mock("../auth/session-ref.js", () => ({
  getAuthSession: mockGetAuthSession,
}));

vi.mock("../app/storage-ref.js", () => ({
  getStorageRef: () => null,
}));

vi.mock("@rivonclaw/core/endpoints", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@rivonclaw/core/endpoints");
  return { ...actual, isStagingDevMode: () => false };
});

// `@rivonclaw/core/node` resolves the agent sessions directory at runtime.
// We don't care about the actual path in the test — `loadSessionCostSummary`
// is mocked, so the path is just an opaque string fed into the mock.
vi.mock("@rivonclaw/core/node", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@rivonclaw/core/node");
  return { ...actual, resolveAgentSessionsDir: () => "/tmp/agents/main/sessions" };
});

const mockLoadSessionCostSummary = vi.fn();
vi.mock("../usage/session-usage.js", () => ({
  loadSessionCostSummary: (...args: unknown[]) => mockLoadSessionCostSummary(...args),
}));

const mockEmitCsTelemetry = vi.fn();
const mockEmitCsError = vi.fn();
vi.mock("../telemetry/cs-telemetry-ref.js", () => ({
  emitCsTelemetry: (...args: unknown[]) => mockEmitCsTelemetry(...args),
  emitCsError: (...args: unknown[]) => mockEmitCsError(...args),
  CS_ERROR_STAGE: {
    DELIVER: "deliver",
    SANITIZE: "sanitize",
    RUN_ERROR: "run_error",
    DISPATCH: "dispatch",
    BACKEND_SESSION: "backend_session",
    SETUP: "setup",
    CONTEXT_RESOLUTION: "context_resolution",
    IMAGE_INGEST: "image_ingest",
    ESCALATE_UNCONFIGURED: "escalate_unconfigured",
    RELAY_CONNECT: "relay_connect",
    SHOP_BIND_REJECTED: "shop_bind_rejected",
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { CustomerServiceSession, type CSShopContext, type CSContext } from "./customer-service-session.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const defaultShop: CSShopContext = {
  objectId: "shop-obj-1",
  platformShopId: "tiktok-shop-1",
  shopName: "Test Shop",
  systemPrompt: "You are CS.",
  platform: "tiktok",
};

function makeContext(overrides?: Partial<CSContext>): CSContext {
  return {
    shopId: "shop-obj-1",
    conversationId: "conv-xyz",
    buyerUserId: "buyer-1",
    ...overrides,
  };
}

function makeSession(): CustomerServiceSession {
  return new CustomerServiceSession(defaultShop, makeContext(), {
    defaultRunProfileId: "CUSTOMER_SERVICE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthSession.mockReturnValue({
    getAccessToken: () => "test-token",
    graphqlFetch: mockGraphqlFetch,
  });
  // The simplified SEND_MESSAGE_MUTATION no longer carries a usage payload —
  // the only GraphQL call is the send itself.
  mockGraphqlFetch.mockResolvedValue({ ecommerceSendMessage: { messageId: "m-1" } });
});

/**
 * Helper: prime the scopeKey → sessionId resolution path. Returns the
 * `sessionFile` path that `loadSessionCostSummary` will be called with.
 */
function primeScopeResolution(sessionId = "session-conv-xyz"): string {
  mockRpcRequest.mockResolvedValueOnce({
    sessions: [
      { key: "agent:main:cs:tiktok:other", sessionId: "session-other" },
      { key: "agent:main:cs:tiktok:conv-xyz", sessionId },
    ],
  });
  return `/tmp/agents/main/sessions/${sessionId}.jsonl`;
}

/**
 * Flush microtasks so fire-and-forget `void collectAndEmitTokenSnapshot()`
 * can complete before the test inspects its emits.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CustomerServiceSession.forwardTextToBuyer — sends message and emits CS telemetry", () => {
  it("sends the GraphQL mutation with no usage piggyback (BI moved to telemetry stream)", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValue(null);

    await session.forwardTextToBuyer("hello");

    expect(mockGraphqlFetch).toHaveBeenCalledTimes(1);
    const [_query, variables] = mockGraphqlFetch.mock.calls[0];
    expect(variables).not.toHaveProperty("usage");
    expect(variables).toMatchObject({
      shopId: "shop-obj-1",
      conversationId: "conv-xyz",
      content: JSON.stringify({ content: "hello" }),
    });
  });

  it("emits an outbound cs.message event with contentLength after the send", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValue(null);

    await session.forwardTextToBuyer("hello world");
    await flushMicrotasks();

    const messageEvent = mockEmitCsTelemetry.mock.calls.find(
      ([type]) => type === "cs.message",
    );
    expect(messageEvent).toBeDefined();
    expect(messageEvent![1]).toMatchObject({
      shopId: "shop-obj-1",
      platformShopId: "tiktok-shop-1",
      conversationId: "conv-xyz",
      direction: "outbound",
      contentLength: "hello world".length,
    });
  });

  it("emits a cs.token_snapshot event carrying cumulative JSONL totals", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce({
      input: 1234,
      output: 567,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1801,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
      modelUsage: [
        {
          provider: "anthropic",
          model: "claude-sonnet-4.6",
          count: 3,
          totals: { input: 1234, output: 567 } as never,
        },
      ],
    });

    await session.forwardTextToBuyer("hi");
    await flushMicrotasks();

    const snapshot = mockEmitCsTelemetry.mock.calls.find(
      ([type]) => type === "cs.token_snapshot",
    );
    expect(snapshot).toBeDefined();
    expect(snapshot![1]).toMatchObject({
      shopId: "shop-obj-1",
      conversationId: "conv-xyz",
      inputTokens: 1234,
      outputTokens: 567,
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
  });

  it("skips cs.token_snapshot when scopeKey resolution finds no matching session row (but still sends)", async () => {
    const session = makeSession();
    mockRpcRequest.mockResolvedValueOnce({
      sessions: [{ key: "agent:main:cs:tiktok:other", sessionId: "session-other" }],
    });

    await session.forwardTextToBuyer("hi");
    await flushMicrotasks();

    // cs.message still emitted, but no token_snapshot.
    expect(mockEmitCsTelemetry.mock.calls.some(([t]) => t === "cs.message")).toBe(true);
    expect(mockEmitCsTelemetry.mock.calls.some(([t]) => t === "cs.token_snapshot")).toBe(false);
    // Path resolution failed → never read JSONL.
    expect(mockLoadSessionCostSummary).not.toHaveBeenCalled();
    // Core send still happens.
    expect(mockGraphqlFetch).toHaveBeenCalledTimes(1);
  });

  it("skips cs.token_snapshot when loadSessionCostSummary returns null (file missing / no usage yet)", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce(null);

    await session.forwardTextToBuyer("hi");
    await flushMicrotasks();

    expect(mockEmitCsTelemetry.mock.calls.some(([t]) => t === "cs.token_snapshot")).toBe(false);
    expect(mockEmitCsTelemetry.mock.calls.some(([t]) => t === "cs.message")).toBe(true);
  });

  it("does not block the send when sessions.list RPC throws (telemetry failure is system-boundary)", async () => {
    const session = makeSession();
    mockRpcRequest.mockRejectedValueOnce(new Error("RPC down"));

    await expect(session.forwardTextToBuyer("hello")).resolves.toBeUndefined();
    await flushMicrotasks();

    // Send completed fine; no token_snapshot emitted.
    expect(mockGraphqlFetch).toHaveBeenCalledTimes(1);
    expect(mockEmitCsTelemetry.mock.calls.some(([t]) => t === "cs.token_snapshot")).toBe(false);
  });

  it("does not block the send when loadSessionCostSummary throws", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockRejectedValueOnce(new Error("disk gone"));

    await expect(session.forwardTextToBuyer("hello")).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(mockGraphqlFetch).toHaveBeenCalledTimes(1);
    expect(mockEmitCsTelemetry.mock.calls.some(([t]) => t === "cs.token_snapshot")).toBe(false);
  });

  it("floors fractional token values and clamps negatives to 0 in the snapshot event", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce({
      input: 100.9,
      output: -5,
      modelUsage: [{ provider: "p", model: "m", count: 1, totals: {} as never }],
    });

    await session.forwardTextToBuyer("hi");
    await flushMicrotasks();

    const snapshot = mockEmitCsTelemetry.mock.calls.find(([t]) => t === "cs.token_snapshot");
    expect(snapshot![1]).toMatchObject({ inputTokens: 100, outputTokens: 0 });
  });

  it("picks the most-used model from modelUsage; ties resolve to first-seen", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce({
      input: 100,
      output: 50,
      modelUsage: [
        { provider: "anthropic", model: "claude-sonnet-4.6", count: 2, totals: {} as never },
        { provider: "openai", model: "gpt-5.4", count: 5, totals: {} as never },
        { provider: "google", model: "gemini-2.5", count: 5, totals: {} as never },
      ],
    });

    await session.forwardTextToBuyer("hi");
    await flushMicrotasks();

    const snapshot = mockEmitCsTelemetry.mock.calls.find(([t]) => t === "cs.token_snapshot");
    expect(snapshot![1]).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
    });
  });
});
