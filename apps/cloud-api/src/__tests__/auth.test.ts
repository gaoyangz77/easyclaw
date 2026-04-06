import { describe, it, expect, vi, beforeEach } from "vitest";
import { testClient } from "hono/testing";
import { authRoute } from "../routes/auth.js";

vi.mock("../db/client.js", () => ({
  sql: vi.fn(),
}));

import { sql } from "../db/client.js";

describe("POST /device", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FREE_CREDITS = "100";
  });

  it("registers a new device and returns token + balance", async () => {
    const mockUser = {
      id: "uuid-123",
      device_id: "device-abc",
      jwt_secret: "user-secret-12345678901234567890ab",
      credits_init: false,
    };

    const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
    sqlMock
      .mockResolvedValueOnce([mockUser])           // upsert user
      .mockResolvedValueOnce(undefined)             // INSERT ledger (signup_bonus)
      .mockResolvedValueOnce(undefined)             // UPSERT credit_balance
      .mockResolvedValueOnce(undefined)             // UPDATE users SET credits_init
      .mockResolvedValueOnce([{ balance: 100 }]);   // SELECT balance

    const client = testClient(authRoute);
    const res = await client.device.$post({ json: { deviceId: "device-abc" } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ balance: 100 });
    expect(typeof body.token).toBe("string");
  });

  it("returns 400 when deviceId is missing", async () => {
    const client = testClient(authRoute);
    const res = await client.device.$post({ json: {} });
    expect(res.status).toBe(400);
  });
});
