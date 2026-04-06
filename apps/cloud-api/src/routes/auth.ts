import { Hono } from "hono";
import { SignJWT } from "jose";
import { sql } from "../db/client.js";
import { randomBytes } from "node:crypto";

export const authRoute = new Hono();

authRoute.post("/device", async (c) => {
  const body = await c.req.json<{ deviceId?: string }>();
  if (!body.deviceId || typeof body.deviceId !== "string") {
    return c.json({ error: "deviceId is required" }, 400);
  }

  const { deviceId } = body;
  const jwtSecret = randomBytes(32).toString("hex");
  const freeCredits = Number(process.env.FREE_CREDITS ?? 100);

  // Upsert user — create if not exists, return existing if already there
  const [user] = await sql<{ id: string; jwt_secret: string; credits_init: boolean }[]>`
    INSERT INTO users (device_id, jwt_secret)
    VALUES (${deviceId}, ${jwtSecret})
    ON CONFLICT (device_id) DO UPDATE SET device_id = EXCLUDED.device_id
    RETURNING id, jwt_secret, credits_init
  `;

  if (!user) return c.json({ error: "db error" }, 500);

  // Grant signup bonus on first auth
  if (!user.credits_init) {
    await sql`
      INSERT INTO credit_ledger (user_id, delta, reason)
      VALUES (${user.id}, ${freeCredits}, 'signup_bonus')
    `;
    await sql`
      INSERT INTO credit_balance (user_id, balance)
      VALUES (${user.id}, ${freeCredits})
      ON CONFLICT (user_id) DO UPDATE SET balance = credit_balance.balance + ${freeCredits}, updated_at = now()
    `;
    await sql`
      UPDATE users SET credits_init = true WHERE id = ${user.id}
    `;
  }

  // Read current balance
  const [row] = await sql<{ balance: number }[]>`
    SELECT balance FROM credit_balance WHERE user_id = ${user.id}
  `;
  const balance = row?.balance ?? 0;

  // Issue JWT signed with user's own secret
  const secret = new TextEncoder().encode(user.jwt_secret);
  const token = await new SignJWT({ sub: user.id, did: deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  return c.json({ token, balance });
});
