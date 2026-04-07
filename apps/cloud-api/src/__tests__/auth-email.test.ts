import { describe, it, expect, vi, beforeEach } from "vitest";
import { testClient } from "hono/testing";
import { authRoute } from "../routes/auth.js";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";

vi.mock("../db/client.js", () => ({ sql: vi.fn() }));
vi.mock("../lib/password.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$2b$12$hashed"),
  verifyPassword: vi.fn(),
}));
vi.mock("../db/quota.js", () => ({
  getActiveSubscription: vi.fn(),
}));

import { sql } from "../db/client.js";
import { verifyPassword } from "../lib/password.js";
import { getActiveSubscription } from "../db/quota.js";
const mockGetSub = getActiveSubscription as ReturnType<typeof vi.fn>;

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const verifyMock = verifyPassword as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("POST /register", () => {
  it("returns 400 when email is missing", async () => {
    const res = await testClient(authRoute).register.$post({ json: { password: "secret123" } as any });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too short", async () => {
    const res = await testClient(authRoute).register.$post({ json: { email: "a@b.com", password: "short" } as any });
    expect(res.status).toBe(400);
  });

  it("returns 409 when email already exists", async () => {
    sqlMock.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    const res = await testClient(authRoute).register.$post({ json: { email: "a@b.com", password: "secret123" } });
    expect(res.status).toBe(409);
  });

  it("creates user and returns token + userId", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "user-1", jwt_secret: "secret-32-chars-padding-here-xx" }]);
    const res = await testClient(authRoute).register.$post({ json: { email: "a@b.com", password: "secret123" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ userId: "user-1" });
    expect(typeof (body as any).token).toBe("string");
  });
});

describe("POST /login", () => {
  it("returns 400 when fields are missing", async () => {
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com" } as any });
    expect(res.status).toBe(400);
  });

  it("returns 401 when user not found", async () => {
    sqlMock.mockResolvedValueOnce([]);
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com", password: "secret123" } });
    expect(res.status).toBe(401);
  });

  it("returns 401 when password is wrong", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "u1", jwt_secret: "s".repeat(32), password_hash: "$2b$12$hash" }]);
    verifyMock.mockResolvedValueOnce(false);
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com", password: "wrong" } });
    expect(res.status).toBe(401);
  });

  it("returns token on correct credentials", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "u1", jwt_secret: "secret-32-chars-padding-here-xx", password_hash: "$2b$12$hash" }]);
    verifyMock.mockResolvedValueOnce(true);
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com", password: "correct" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof (body as any).token).toBe("string");
    expect((body as any).userId).toBe("u1");
  });
});

describe("GET /me", () => {
  async function makeToken(userId = "user-uuid-me") {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode("test-user-secret-32-chars-padded!!");
    return new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(secret);
  }

  function makeApp() {
    const app = new Hono();
    app.use("/api/auth/*", authMiddleware);
    app.route("/api/auth", authRoute);
    return app;
  }

  it("returns 401 when no token provided", async () => {
    const res = await makeApp().request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns userId, email and plan for authenticated user", async () => {
    sqlMock
      .mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]) // authMiddleware app-level lookup
      .mockResolvedValueOnce([{ jwt_secret: "test-user-secret-32-chars-padded!!" }]) // authMiddleware route-level lookup
      .mockResolvedValueOnce([{ email: "test@example.com" }]); // SELECT email
    mockGetSub.mockResolvedValueOnce(null); // free plan
    const token = await makeToken();
    const res = await makeApp().request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { userId: string; email: string; plan: string };
    expect(body.userId).toBe("user-uuid-me");
    expect(body.email).toBe("test@example.com");
    expect(body.plan).toBe("free");
  });
});
