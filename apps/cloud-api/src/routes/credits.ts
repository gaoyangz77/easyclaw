import { Hono } from "hono";
import { sql } from "../db/client.js";

export const creditsRoute = new Hono<{ Variables: { userId: string } }>();

creditsRoute.get("/balance", async (c) => {
  const userId = c.get("userId");
  const [row] = await sql<{ balance: number }[]>`
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

  const entries = await sql<{
    id: string;
    delta: number;
    reason: string;
    model: string | null;
    tokens: number | null;
    created_at: string;
  }[]>`
    SELECT id, delta, reason, model, tokens, created_at
    FROM credit_ledger
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countRow] = await sql<{ total: string }[]>`
    SELECT COUNT(*) AS total FROM credit_ledger WHERE user_id = ${userId}
  `;

  return c.json({ entries, total: Number(countRow?.total ?? 0) });
});
