import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { proxyRoute } from "../routes/proxy.js";

vi.mock("../db/client.js", () => ({ sql: vi.fn() }));
import { sql } from "../db/client.js";

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

describe("POST /api/proxy/openrouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_MASTER_KEY = "sk-or-test-key";
  });

  it("returns 402 when balance is insufficient", async () => {
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn> & { begin: ReturnType<typeof vi.fn> };
    sqlMock.mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]);

    sqlMock.begin = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = vi.fn()
        .mockResolvedValueOnce([])              // UPDATE returns empty (balance insufficient)
        .mockResolvedValueOnce([{ balance: 0 }]); // SELECT balance for error message
      await fn(tx);
    });

    const token = await makeToken();
    const res = await app.request("/api/proxy/openrouter/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] }),
    });
    expect(res.status).toBe(402);
  });

  it("deducts credits and proxies request when balance sufficient", async () => {
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn> & { begin: ReturnType<typeof vi.fn> };
    // auth middleware lookup
    sqlMock.mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]);

    // mock sql.begin to execute the callback with a mock tx
    sqlMock.begin = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = vi.fn()
        .mockResolvedValueOnce([{ balance: 49 }])  // UPDATE RETURNING
        .mockResolvedValueOnce(undefined);           // INSERT ledger
      await fn(tx);
    });

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
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] }),
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-or-test-key" }),
      })
    );
  });

  it("returns 503 when OPENROUTER_MASTER_KEY is not set", async () => {
    delete process.env.OPENROUTER_MASTER_KEY;
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
    sqlMock.mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]);

    const token = await makeToken();
    const res = await app.request("/api/proxy/openrouter/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [] }),
    });
    expect(res.status).toBe(503);
  });
});
