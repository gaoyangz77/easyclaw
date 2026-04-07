import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB module
vi.mock("../db/client.js", () => ({
  sql: Object.assign(
    vi.fn(),
    { begin: vi.fn() }
  ),
}));

import { sql } from "../db/client.js";
import { getActiveSubscription, deductDailyTokens, deductMonthlyTokens } from "../db/quota.js";

const mockSql = sql as unknown as ReturnType<typeof vi.fn> & { begin: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActiveSubscription", () => {
  it("returns null when user has no subscription", async () => {
    mockSql.mockResolvedValueOnce([]);
    const result = await getActiveSubscription("user-1");
    expect(result).toBeNull();
  });

  it("returns subscription row when active", async () => {
    const sub = { id: "sub-1", tier: "basic", tokens_monthly: 5_000_000, tokens_used: 100, period_end: "2026-05-01" };
    mockSql.mockResolvedValueOnce([sub]);
    const result = await getActiveSubscription("user-1");
    expect(result).toEqual(sub);
  });
});

describe("deductDailyTokens", () => {
  it("returns true when quota is available", async () => {
    const txFn = vi.fn()
      .mockResolvedValueOnce([]) // upsert
      .mockResolvedValueOnce([{ tokens_used: 1000 }]); // update succeeds
    mockSql.begin.mockImplementationOnce((fn: (tx: typeof txFn) => Promise<boolean>) => fn(txFn));
    const result = await deductDailyTokens("user-1", 1000, 100_000);
    expect(result).toBe(true);
  });

  it("returns false when daily limit exceeded", async () => {
    const txFn = vi.fn()
      .mockResolvedValueOnce([])  // upsert
      .mockResolvedValueOnce([]); // update returns nothing (limit exceeded)
    mockSql.begin.mockImplementationOnce((fn: (tx: typeof txFn) => Promise<boolean>) => fn(txFn));
    const result = await deductDailyTokens("user-1", 100_001, 100_000);
    expect(result).toBe(false);
  });
});

describe("deductMonthlyTokens", () => {
  it("returns true when monthly quota is available", async () => {
    mockSql.mockResolvedValueOnce([{ id: "sub-1" }]);
    const result = await deductMonthlyTokens("sub-1", 1000);
    expect(result).toBe(true);
  });

  it("returns false when monthly quota exhausted", async () => {
    mockSql.mockResolvedValueOnce([]);
    const result = await deductMonthlyTokens("sub-1", 1000);
    expect(result).toBe(false);
  });
});
