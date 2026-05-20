// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ChatGatewayController run profile selection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a pending runProfile write before dispatching chat.send", async () => {
    let resolveRunProfile!: () => void;
    const setRunProfileForScope = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRunProfile = resolve;
      }),
    );
    const trackEvent = vi.fn();

    vi.doMock("../../src/api/tool-registry.js", () => ({
      setRunProfileForScope,
    }));
    vi.doMock("../../src/api/index.js", () => ({
      fetchGatewayInfo: vi.fn(),
      trackEvent,
    }));

    const [{ ChatGatewayController }, { createChatStore }] = await Promise.all([
      import("../../src/pages/chat/controllers/ChatGatewayController.js"),
      import("../../src/pages/chat/store/chat-store.js"),
    ]);

    const store = createChatStore();
    store.setConnectionState("connected");
    const controller = new ChatGatewayController(store);
    const request = vi.fn().mockResolvedValue({});
    (controller as any).client = { request };

    const sessionKey = store.activeSessionKey;
    void controller.pushRunProfileToScope("profile-alt", sessionKey, [{ id: "profile-alt" }]);
    controller.sendMessage("hello", "", { providerKeys: [{ id: "key-1" }] });

    await Promise.resolve();
    expect(setRunProfileForScope).toHaveBeenCalledWith(sessionKey, "profile-alt");
    expect(request).not.toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ sessionKey }),
      300_000,
    );

    resolveRunProfile();

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "chat.send",
        expect.objectContaining({ sessionKey, message: "hello" }),
        300_000,
      );
    });
  });

  it("keeps an in-flight local run alive when chat.send hits a transport timeout", async () => {
    vi.doMock("../../src/api/index.js", () => ({
      fetchGatewayInfo: vi.fn(),
      trackEvent: vi.fn(),
    }));
    vi.doMock("../../src/api/tool-registry.js", () => ({
      setRunProfileForScope: vi.fn(),
    }));

    const [{ ChatGatewayController }, { createChatStore }] = await Promise.all([
      import("../../src/pages/chat/controllers/ChatGatewayController.js"),
      import("../../src/pages/chat/store/chat-store.js"),
    ]);

    const store = createChatStore();
    store.setConnectionState("connected");
    const controller = new ChatGatewayController(store);
    const request = vi.fn().mockRejectedValue(new Error("RPC timeout after 300000ms: chat.send"));
    (controller as any).client = { request };

    controller.sendMessage("hello", "", { providerKeys: [{ id: "key-1" }] });
    await Promise.resolve();
    await Promise.resolve();

    const session = store.activeSession!;
    const runId = session.runState.localRunId!;
    expect(session.messages.map((msg) => msg.text)).toEqual(["hello"]);
    expect(session.runState.isActive).toBe(true);

    (controller as any).handleEvent({
      event: "chat",
      payload: {
        runId,
        sessionKey: store.activeSessionKey,
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "reply after reconnect" }],
          timestamp: Date.now(),
        },
      },
    });

    expect(session.messages.map((msg) => msg.text)).toEqual(["hello", "reply after reconnect"]);
    expect(session.runState.isActive).toBe(false);
  });

  it("refreshes token metadata after a run final even when session metadata was just hydrated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T12:00:00Z"));
    vi.doMock("../../src/api/index.js", () => ({
      fetchGatewayInfo: vi.fn(),
      trackEvent: vi.fn(),
    }));
    vi.doMock("../../src/api/tool-registry.js", () => ({
      setRunProfileForScope: vi.fn(),
    }));

    const [{ ChatGatewayController }, { createChatStore }] = await Promise.all([
      import("../../src/pages/chat/controllers/ChatGatewayController.js"),
      import("../../src/pages/chat/store/chat-store.js"),
    ]);

    const store = createChatStore();
    store.setConnectionState("connected");
    const controller = new ChatGatewayController(store);
    const session = store.activeSession!;
    session.beginMetadataHydration({ now: Date.now() });
    session.completeMetadataHydration({ totalTokens: 0, now: Date.now() });

    const request = vi.fn().mockImplementation((method: string) => {
      if (method === "sessions.describe") {
        return Promise.resolve({
          session: {
            key: store.activeSessionKey,
            totalTokens: 42_000,
            totalTokensFresh: true,
            contextTokens: 200_000,
          },
        });
      }
      return Promise.resolve({});
    });
    (controller as any).client = { request };

    session.runState.beginLocalRun("run-with-usage", store.activeSessionKey);
    (controller as any).handleEvent({
      event: "chat",
      payload: {
        runId: "run-with-usage",
        sessionKey: store.activeSessionKey,
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          timestamp: Date.now(),
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(request).toHaveBeenCalledWith("sessions.describe", {
      key: store.activeSessionKey,
      includeDerivedTitles: false,
      includeLastMessage: false,
    });
    expect(session.totalTokens).toBe(42_000);
    expect(session.contextTokens).toBe(200_000);
  });
});
