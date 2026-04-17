import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

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

function makeSession(opts?: { getSeatId?: () => string | null }): CustomerServiceSession {
  return new CustomerServiceSession(defaultShop, makeContext(), {
    defaultRunProfileId: "CUSTOMER_SERVICE",
    getSeatId: opts?.getSeatId ?? (() => "seat-abc"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthSession.mockReturnValue({
    getAccessToken: () => "test-token",
    graphqlFetch: mockGraphqlFetch,
  });
  // forwardTextToBuyer makes two GraphQL calls: the cs_send mutation and a
  // fire-and-forget cs_sessions.messageCount increment. Both return a value.
  mockGraphqlFetch.mockImplementation(async (query: string) => {
    if (query.includes("csIncrementMessageCount")) {
      return { csIncrementMessageCount: true };
    }
    return { ecommerceSendMessage: { messageId: "m-1" } };
  });
});

/** Helper: find the ecommerceSendMessage call out of the two GraphQL calls. */
function findSendCall(): { variables: Record<string, unknown> } {
  const call = mockGraphqlFetch.mock.calls.find((c) =>
    typeof c[0] === "string" && (c[0] as string).includes("ecommerceSendMessage"),
  );
  if (!call) throw new Error("ecommerceSendMessage call not found");
  return { variables: call[1] as Record<string, unknown> };
}

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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CustomerServiceSession.forwardTextToBuyer — usage piggyback", () => {
  it("reads cumulative token totals from the JSONL transcript and piggybacks them verbatim", async () => {
    const session = makeSession();
    const sessionFile = primeScopeResolution();
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

    await session.forwardTextToBuyer("hello");

    const { variables } = findSendCall();
    expect(variables.usage).toEqual({
      inputTokens: 1234,
      outputTokens: 567,
      provider: "anthropic",
      model: "claude-sonnet-4.6",
      seatId: "seat-abc",
    });
    // Path-resolution RPC was hit; JSONL summary was read with no time window.
    expect(mockRpcRequest).toHaveBeenCalledWith("sessions.list", { agentId: "main" });
    expect(mockLoadSessionCostSummary).toHaveBeenCalledWith({ sessionFile });
  });

  it("omits usage when getSeatId returns null (seat not resolved yet)", async () => {
    const session = makeSession({ getSeatId: () => null });

    await session.forwardTextToBuyer("hello");

    const { variables } = findSendCall();
    expect(variables.usage).toBeUndefined();
    // No RPC call at all on the no-seat path (early return keeps it cheap).
    expect(mockRpcRequest).not.toHaveBeenCalled();
    expect(mockLoadSessionCostSummary).not.toHaveBeenCalled();
  });

  it("omits usage when scopeKey resolution finds no matching session row", async () => {
    const session = makeSession();
    mockRpcRequest.mockResolvedValueOnce({
      sessions: [{ key: "agent:main:cs:tiktok:other", sessionId: "session-other" }],
    });

    await session.forwardTextToBuyer("hello");

    const { variables } = findSendCall();
    expect(variables.usage).toBeUndefined();
    // Path resolution failed → never read JSONL.
    expect(mockLoadSessionCostSummary).not.toHaveBeenCalled();
  });

  it("omits usage when loadSessionCostSummary returns null (file missing / no entries)", async () => {
    // Legitimate pre-first-LLM-call state: session is registered but no
    // assistant message has produced usage yet. We omit the snapshot rather
    // than fabricating zeros — backend $max will simply not get a report
    // this turn.
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce(null);

    await session.forwardTextToBuyer("hi");

    const { variables } = findSendCall();
    expect(variables.usage).toBeUndefined();
  });

  it("does not block the send when sessions.list RPC throws", async () => {
    const session = makeSession();
    mockRpcRequest.mockRejectedValueOnce(new Error("RPC down"));

    await session.forwardTextToBuyer("hello");

    // Core send still happens, without a usage field.
    const { variables } = findSendCall();
    expect(variables.usage).toBeUndefined();
  });

  it("does not block the send when loadSessionCostSummary throws", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockRejectedValueOnce(new Error("disk gone"));

    await session.forwardTextToBuyer("hello");

    const { variables } = findSendCall();
    expect(variables.usage).toBeUndefined();
  });

  it("floors fractional token values and clamps negatives to 0 (defense-in-depth)", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce({
      input: 100.9,
      output: -5,
      modelUsage: [{ provider: "p", model: "m", count: 1, totals: {} as never }],
    });

    await session.forwardTextToBuyer("hi");

    const { variables } = findSendCall();
    expect(variables.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 0,
      provider: "p",
      model: "m",
    });
  });

  it("leaves provider/model undefined when modelUsage is empty (does not stomp backend state)", async () => {
    // No modelUsage entries means we cannot identify a dominant model. Omit
    // the fields rather than sending empty strings — passing "" would make
    // the backend $set path overwrite a previously-recorded provider/model.
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce({
      input: 10,
      output: 5,
      modelUsage: [],
    });

    await session.forwardTextToBuyer("hi");

    const { variables } = findSendCall();
    expect(variables.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      provider: undefined,
      model: undefined,
    });
  });

  it("leaves provider/model undefined when the dominant modelUsage entry has empty strings", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce({
      input: 10,
      output: 5,
      modelUsage: [{ provider: "", model: "", count: 1, totals: {} as never }],
    });

    await session.forwardTextToBuyer("hi");

    const { variables } = findSendCall();
    expect(variables.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      provider: undefined,
      model: undefined,
    });
  });

  it("picks the most-used model from modelUsage; ties resolve to first-seen", async () => {
    const session = makeSession();
    primeScopeResolution();
    mockLoadSessionCostSummary.mockResolvedValueOnce({
      input: 100,
      output: 50,
      modelUsage: [
        // First entry — count 2.
        { provider: "anthropic", model: "claude-sonnet-4.6", count: 2, totals: {} as never },
        // Second entry — count 5 (the most used; should win).
        { provider: "openai", model: "gpt-5.4", count: 5, totals: {} as never },
        // Third entry — count 5 (tie; should NOT displace the openai entry).
        { provider: "google", model: "gemini-2.5", count: 5, totals: {} as never },
      ],
    });

    await session.forwardTextToBuyer("hi");

    const { variables } = findSendCall();
    expect(variables.usage).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
    });
  });
});
