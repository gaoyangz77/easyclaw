import { Hono } from "hono";
import { sql } from "../db/client.js";
import { getActiveSubscription } from "../db/quota.js";
export const creditsRoute = new Hono();
creditsRoute.get("/balance", async (c) => {
    const userId = c.get("userId");
    const [row] = await sql `
    SELECT balance FROM credit_balance WHERE user_id = ${userId}
  `;
    return c.json({ balance: row?.balance ?? 0 });
});
creditsRoute.get("/history", async (c) => {
    const userId = c.get("userId");
    const rawPage = parseInt(c.req.query("page") ?? "", 10);
    const page = isNaN(rawPage) ? 1 : Math.max(1, rawPage);
    const rawLimit = parseInt(c.req.query("limit") ?? "", 10);
    const limit = isNaN(rawLimit) ? 20 : Math.min(50, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;
    const entries = await sql `
    SELECT id, delta, reason, model, tokens, created_at
    FROM credit_ledger
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
    const [countRow] = await sql `
    SELECT COUNT(*) AS total FROM credit_ledger WHERE user_id = ${userId}
  `;
    return c.json({ entries, total: Number(countRow?.total ?? 0) });
});
creditsRoute.get("/quota", async (c) => {
    const userId = c.get("userId");
    const today = new Date().toISOString().slice(0, 10);
    const dailyLimit = parseInt(process.env.DAILY_FREE_TOKENS ?? "100000", 10);
    const [quotaRow] = await sql `
    SELECT date::text, tokens_used FROM daily_quota WHERE user_id = ${userId}
  `;
    const dailyUsed = quotaRow?.date === today ? (quotaRow?.tokens_used ?? 0) : 0;
    const sub = await getActiveSubscription(userId);
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    return c.json({
        plan: sub ? sub.tier : "free",
        show_model: !!sub,
        daily: {
            used: dailyUsed,
            limit: dailyLimit,
            resets_at: midnight.toISOString(),
        },
        monthly: sub
            ? { used: sub.tokens_used, limit: sub.tokens_monthly, period_end: sub.period_end }
            : null,
    });
});
//# sourceMappingURL=credits.js.map