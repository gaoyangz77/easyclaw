import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { proxyRoute } from "../routes/proxy.js";

vi.mock("../db/client.js", () => ({ sql: vi.fn() }));
vi.mock("../db/quota.js", () => ({
  getActiveSubscription: vi.fn(),
  deductDailyTokens: vi.fn(),
  deductMonthlyTokens: vi.fn(),
}));

import { sql } from "../db/client.js";
import { getActiveSubscription, deductDailyTokens, deductMonthlyTokens } from "../db/quota.js";

const mockGetSub = getActiveSubscription as ReturnType<typeof vi.fn>;
const mockDeductDaily = deductDailyTokens as ReturnType<typeof vi.fn>;
const mockDeductMonthly = deductMonthlyTokens as ReturnType<typeof vi.fn>;
const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const app = new Hono();
app.use("/api/proxy/*", authMiddleware);
app.route("/api/proxy", proxyRoute);

async function makeToken(userId = "user-uuid-123") {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode("test-user-secret-32-chars-padded!!");
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
}

describe("POST /api/proxy/openrouter/chat/completions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_MASTER_KEY = "sk-or-test-key";
  });

  it("returns 503 when OPENROUTER_MASTER_KEY is not set", async () => {
    delete process.env.OPENROUTER_MASTER_KEY;
    sqlMock.mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]);
    const token = await makeToken();
    const res = await app.request("/api/proxy/openrouter/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 403 when free user requests non-free model", async () => {
    sqlMock.mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]);
    mockGetSub.mockResolvedValueOnce(null); // no subscription = free user
    const token = await makeToken();
    const res = await app.request("/api/proxy/openrouter/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/free plan/i);
  });

  it("returns 402 when free user exceeds daily quota", async () => {
    sqlMock.mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]);
    mockGetSub.mockResolvedValueOnce(null);
    mockDeductDaily.mockResolvedValueOnce(false); // quota exceeded
    const token = await makeToken();
    const res = await app.request("/api/proxy/openrouter/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-flash-1.5", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toMatch(/quota/i);
  });

  it("proxies request when free user uses free model within quota", async () => {
    sqlMock
      .mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }])
      .mockResolvedValueOnce(undefined); // INSERT credit_ledger
    mockGetSub.mockResolvedValueOnce(null);
    mockDeductDaily.mockResolvedValueOnce(true); // within quota
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "Hi" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const token = await makeToken();
    const res = await app.request("/api/proxy/openrouter/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-flash-1.5", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses monthly pool first for subscribed user, then daily fallback", async () => {
    sqlMock
      .mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }])
      .mockResolvedValueOnce(undefined); // INSERT credit_ledger
    const sub = { id: "sub-1", tier: "basic", tokens_monthly: 5_000_000, tokens_used: 0, period_end: "2026-05-01" };
    mockGetSub.mockResolvedValueOnce(sub);
    mockDeductMonthly.mockResolvedValueOnce(true); // monthly pool has space
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const token = await makeToken();
    const res = await app.request("/api/proxy/openrouter/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(res.status).toBe(200);
    expect(mockDeductMonthly).toHaveBeenCalledWith("sub-1", expect.any(Number));
    expect(mockDeductDaily).not.toHaveBeenCalled();
  });
});
