import { Hono } from "hono";
import { stream } from "hono/streaming";
import { sql } from "../db/client.js";
import { isFreeModel } from "../config/free-models.js";
import { getActiveSubscription, deductDailyTokens, deductMonthlyTokens } from "../db/quota.js";

function estimateInputTokens(messages: Array<{ role: string; content: unknown }>): number {
  let chars = 0;
  for (const msg of messages) {
    chars += typeof msg.content === "string"
      ? msg.content.length
      : JSON.stringify(msg.content).length;
  }
  return Math.ceil(chars / 4) + 50;
}

export const proxyRoute = new Hono<{ Variables: { userId: string } }>();

const DAILY_FREE_DEFAULT = 100_000;

proxyRoute.post("/openrouter/chat/completions", async (c) => {
  const userId = c.get("userId");
  const masterKey = process.env.OPENROUTER_MASTER_KEY;
  if (!masterKey) return c.json({ error: "Proxy not configured" }, 503);

  let payload: { model: string; messages: Array<{ role: string; content: unknown }>; stream?: boolean };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // 1. Check model access
  const sub = await getActiveSubscription(userId);
  if (!sub && !isFreeModel(payload.model)) {
    return c.json({ error: "Model not available on free plan. Upgrade to access premium models." }, 403);
  }

  // 2. Deduct quota
  const dailyLimit = parseInt(process.env.DAILY_FREE_TOKENS ?? String(DAILY_FREE_DEFAULT), 10);
  const estimatedTokens = estimateInputTokens(payload.messages ?? []);

  if (sub) {
    // Try monthly pool first; fall back to daily quota
    const fromMonthly = await deductMonthlyTokens(sub.id, estimatedTokens);
    if (!fromMonthly) {
      const fromDaily = await deductDailyTokens(userId, estimatedTokens, dailyLimit);
      if (!fromDaily) {
        return c.json({ error: "Daily quota exceeded. Resets at midnight.", used: dailyLimit, limit: dailyLimit }, 402);
      }
    }
  } else {
    const fromDaily = await deductDailyTokens(userId, estimatedTokens, dailyLimit);
    if (!fromDaily) {
      return c.json({ error: "Daily quota exceeded. Resets at midnight.", used: dailyLimit, limit: dailyLimit }, 402);
    }
  }

  // 3. Record in ledger and deduct from credit balance
  await sql`
    INSERT INTO credit_ledger (user_id, delta, reason, model, tokens)
    VALUES (${userId}, ${-estimatedTokens}, 'consumption', ${payload.model}, ${estimatedTokens})
  `;
  await sql`
    UPDATE credit_balance
    SET balance = balance - ${estimatedTokens}, updated_at = now()
    WHERE user_id = ${userId}
  `;

  // 4. Forward to OpenRouter
  const upstreamRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${masterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://dlxai.app",
      "X-Title": "DlxAI",
    },
    body: JSON.stringify(payload),
  });

  const isStreaming = payload.stream === true;
  if (isStreaming && upstreamRes.ok && upstreamRes.body) {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    return stream(c, async (s) => {
      const reader = upstreamRes.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await s.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    });
  }

  const responseBody = await upstreamRes.text();
  return new Response(responseBody, {
    status: upstreamRes.status,
    headers: { "Content-Type": upstreamRes.headers.get("Content-Type") ?? "application/json" },
  });
});
