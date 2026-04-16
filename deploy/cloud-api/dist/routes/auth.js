import { Hono } from "hono";
import { SignJWT } from "jose";
import { sql } from "../db/client.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { getActiveSubscription } from "../db/quota.js";
import { authMiddleware } from "../middleware/auth.js";
import { randomBytes } from "node:crypto";
export const authRoute = new Hono();
// ── Device auth (unchanged) ─────────────────────────────────────────────────
authRoute.post("/device", async (c) => {
    const body = await c.req.json();
    if (!body.deviceId || typeof body.deviceId !== "string") {
        return c.json({ error: "deviceId is required" }, 400);
    }
    const { deviceId } = body;
    const jwtSecret = randomBytes(32).toString("hex");
    const freeCredits = Math.max(0, parseInt(process.env.FREE_CREDITS ?? "100", 10)) || 100;
    const [user] = await sql `
    INSERT INTO users (device_id, jwt_secret)
    VALUES (${deviceId}, ${jwtSecret})
    ON CONFLICT (device_id) DO UPDATE SET device_id = EXCLUDED.device_id
    RETURNING id, jwt_secret, credits_init
  `;
    if (!user)
        return c.json({ error: "db error" }, 500);
    const claimed = await sql `
    UPDATE users SET credits_init = true
    WHERE id = ${user.id} AND credits_init = false
    RETURNING id
  `;
    if (claimed.length > 0) {
        await sql `
      INSERT INTO credit_ledger (user_id, delta, reason)
      VALUES (${user.id}, ${freeCredits}, 'signup_bonus')
    `;
        await sql `
      INSERT INTO credit_balance (user_id, balance)
      VALUES (${user.id}, ${freeCredits})
      ON CONFLICT (user_id) DO UPDATE SET balance = credit_balance.balance + ${freeCredits}, updated_at = now()
    `;
    }
    const [row] = await sql `
    SELECT balance FROM credit_balance WHERE user_id = ${user.id}
  `;
    const balance = row?.balance ?? 0;
    const secret = new TextEncoder().encode(user.jwt_secret);
    const token = await new SignJWT({ sub: user.id, did: deviceId })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(secret);
    return c.json({ token, balance });
});
// ── Email register ──────────────────────────────────────────────────────────
authRoute.post("/register", async (c) => {
    const body = await c.req.json();
    if (!body.email || !body.password) {
        return c.json({ error: "email and password are required" }, 400);
    }
    if (!body.email.includes("@")) {
        return c.json({ error: "Invalid email address" }, 400);
    }
    if (body.password.length < 8) {
        return c.json({ error: "Password must be at least 8 characters" }, 400);
    }
    const passwordHash = await hashPassword(body.password);
    const deviceId = randomBytes(16).toString("hex"); // placeholder so NOT NULL is satisfied
    const jwtSecret = randomBytes(32).toString("hex");
    let user;
    try {
        const [row] = await sql `
      INSERT INTO users (device_id, jwt_secret, email, password_hash)
      VALUES (${deviceId}, ${jwtSecret}, ${body.email}, ${passwordHash})
      RETURNING id, jwt_secret
    `;
        if (!row)
            return c.json({ error: "Registration failed" }, 500);
        user = row;
    }
    catch (err) {
        if (err?.code === "23505") {
            return c.json({ error: "Email already registered" }, 409);
        }
        throw err;
    }
    const secret = new TextEncoder().encode(user.jwt_secret);
    const token = await new SignJWT({ sub: user.id })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(secret);
    return c.json({ token, userId: user.id });
});
// ── Email login ─────────────────────────────────────────────────────────────
authRoute.post("/login", async (c) => {
    const body = await c.req.json();
    if (!body.email || !body.password) {
        return c.json({ error: "email and password are required" }, 400);
    }
    const [user] = await sql `
    SELECT id, jwt_secret, password_hash FROM users WHERE email = ${body.email}
  `;
    if (!user || !user.password_hash) {
        return c.json({ error: "Invalid email or password" }, 401);
    }
    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
        return c.json({ error: "Invalid email or password" }, 401);
    }
    const secret = new TextEncoder().encode(user.jwt_secret);
    const token = await new SignJWT({ sub: user.id })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(secret);
    return c.json({ token, userId: user.id });
});
// ── Me (requires JWT) ───────────────────────────────────────────────────────
authRoute.get("/me", authMiddleware, async (c) => {
    const userId = c.get("userId");
    const [user] = await sql `
    SELECT email FROM users WHERE id = ${userId}
  `;
    const sub = await getActiveSubscription(userId);
    return c.json({
        userId,
        email: user?.email ?? null,
        plan: sub ? sub.tier : "free",
    });
});
//# sourceMappingURL=auth.js.map