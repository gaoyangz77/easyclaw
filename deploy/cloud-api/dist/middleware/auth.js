import { jwtVerify, decodeJwt } from "jose";
import { sql } from "../db/client.js";
export const authMiddleware = async (c, next) => {
    const path = c.req.path;
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        console.warn(`[auth] ${path} → 401 missing/invalid Bearer header (got: ${authHeader ? authHeader.slice(0, 20) + "..." : "null"})`);
        return c.json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.slice(7);
    let userId;
    try {
        const payload = decodeJwt(token);
        if (typeof payload.sub !== "string")
            throw new Error("missing sub");
        userId = payload.sub;
    }
    catch (err) {
        console.warn(`[auth] ${path} → 401 jwt decode failed:`, err);
        return c.json({ error: "Invalid token" }, 401);
    }
    const [user] = await sql `
    SELECT jwt_secret FROM users WHERE id = ${userId}
  `;
    if (!user) {
        console.warn(`[auth] ${path} → 401 user not found in db: ${userId}`);
        return c.json({ error: "User not found" }, 401);
    }
    try {
        const secret = new TextEncoder().encode(user.jwt_secret);
        await jwtVerify(token, secret);
    }
    catch (err) {
        console.warn(`[auth] ${path} → 401 jwt verify failed:`, err);
        return c.json({ error: "Token verification failed" }, 401);
    }
    console.log(`[auth] ${path} → ok userId=${userId}`);
    c.set("userId", userId);
    await next();
};
//# sourceMappingURL=auth.js.map