import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { creditsRoute } from "../routes/credits.js";

vi.mock("../db/client.js", () => ({ sql: vi.fn() }));
import { sql } from "../db/client.js";

const app = new Hono();
app.use("/api/credits/*", authMiddleware);
app.route("/api/credits", creditsRoute);

async function makeToken(userId = "user-uuid-123") {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode("test-user-secret-32-chars-padded!!");
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
}

describe("GET /api/credits/balance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without token", async () => {
    const res = await app.request("/api/credits/balance");
    expect(res.status).toBe(401);
  });

  it("returns balance with valid JWT", async () => {
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
    sqlMock
      .mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }])
      .mockResolvedValueOnce([{ balance: 42 }]);

    const token = await makeToken();
    const res = await app.request("/api/credits/balance", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balance: 42 });
  });
});

describe("GET /api/credits/history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated ledger entries", async () => {
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
    sqlMock
      .mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }])
      .mockResolvedValueOnce([
        { id: "e1", delta: -1, reason: "consumption", model: "openai/gpt-4o", tokens: 1000, created_at: new Date().toISOString() },
      ])
      .mockResolvedValueOnce([{ total: "1" }]);

    const token = await makeToken();
    const res = await app.request("/api/credits/history?page=1&limit=20", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("uses default page=1 and limit=20 for invalid params", async () => {
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
    sqlMock
      .mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: "0" }]);

    const token = await makeToken();
    const res = await app.request("/api/credits/history?page=abc&limit=xyz", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
