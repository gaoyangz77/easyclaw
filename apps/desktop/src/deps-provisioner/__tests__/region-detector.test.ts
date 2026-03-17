import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { mockRequestHandlers, mockRequest } = vi.hoisted(() => {
  const handlers: { onResponse?: () => void; onError?: () => void } = {};
  const request = {
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "response") handlers.onResponse = handler;
      if (event === "error") handlers.onError = handler;
      return request;
    }),
    end: vi.fn(),
  };
  return { mockRequestHandlers: handlers, mockRequest: request };
});

vi.mock("electron", () => ({
  net: {
    request: vi.fn(() => {
      // Reset handlers for each new request
      mockRequestHandlers.onResponse = undefined;
      mockRequestHandlers.onError = undefined;
      mockRequest.on.mockImplementation(
        (event: string, handler: () => void) => {
          if (event === "response") mockRequestHandlers.onResponse = handler;
          if (event === "error") mockRequestHandlers.onError = handler;
          return mockRequest;
        },
      );
      return mockRequest;
    }),
  },
}));

import { detectRegion } from "../region-detector.js";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("detectRegion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestHandlers.onResponse = undefined;
    mockRequestHandlers.onError = undefined;
  });

  it('returns "global" when Google is reachable', async () => {
    const promise = detectRegion();

    // Simulate immediate successful response
    await vi.waitFor(() => {
      expect(mockRequestHandlers.onResponse).toBeDefined();
    });
    mockRequestHandlers.onResponse!();

    const result = await promise;
    expect(result).toBe("global");
  });

  it('returns "cn" when Google request fails', async () => {
    const promise = detectRegion();

    // Simulate network error
    await vi.waitFor(() => {
      expect(mockRequestHandlers.onError).toBeDefined();
    });
    mockRequestHandlers.onError!();

    const result = await promise;
    expect(result).toBe("cn");
  });

  it('returns "cn" when request times out', async () => {
    vi.useFakeTimers();

    // Don't fire any handlers — let it time out
    const promise = detectRegion(100);

    await vi.advanceTimersByTimeAsync(150);

    const result = await promise;
    expect(result).toBe("cn");

    vi.useRealTimers();
  });

  it("respects custom timeout parameter", async () => {
    vi.useFakeTimers();

    const promise = detectRegion(500);

    // At 400ms, should not have resolved yet
    await vi.advanceTimersByTimeAsync(400);

    // At 600ms, should resolve as "cn"
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe("cn");

    vi.useRealTimers();
  });
});
