import { sql } from "./client.js";

export interface ActiveSubscription {
  id: string;
  tier: string;
  tokens_monthly: number;
  tokens_used: number;
  period_end: string;
}

/**
 * Returns the user's active subscription, or null if free tier.
 */
export async function getActiveSubscription(userId: string): Promise<ActiveSubscription | null> {
  const [row] = await sql<ActiveSubscription[]>`
    SELECT id, tier, tokens_monthly, tokens_used, period_end
    FROM subscriptions
    WHERE user_id = ${userId}
      AND status = 'active'
      AND period_end >= CURRENT_DATE
  `;
  return row ?? null;
}

/**
 * Deducts tokens from the user's daily quota using a lazy reset strategy.
 * If the stored date is before today, tokens_used resets to 0 first.
 * Returns true if deduction succeeded (within limit), false if over limit.
 */
export async function deductDailyTokens(
  userId: string,
  tokens: number,
  dailyLimit: number,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  return sql.begin(async (tx) => {
    // Upsert row; if date is stale, reset tokens_used to 0
    await tx`
      INSERT INTO daily_quota (user_id, date, tokens_used)
      VALUES (${userId}, ${today}::date, 0)
      ON CONFLICT (user_id) DO UPDATE
        SET tokens_used = CASE
              WHEN daily_quota.date < ${today}::date THEN 0
              ELSE daily_quota.tokens_used
            END,
            date = ${today}::date
    `;

    // Deduct only if within limit
    const [updated] = await tx<{ tokens_used: number }[]>`
      UPDATE daily_quota
      SET tokens_used = tokens_used + ${tokens}
      WHERE user_id = ${userId}
        AND tokens_used + ${tokens} <= ${dailyLimit}
      RETURNING tokens_used
    `;

    return !!updated;
  });
}

/**
 * Deducts tokens from the user's monthly subscription pool.
 * Returns true if deduction succeeded, false if monthly quota exhausted.
 */
export async function deductMonthlyTokens(
  subscriptionId: string,
  tokens: number,
): Promise<boolean> {
  const [updated] = await sql<{ id: string }[]>`
    UPDATE subscriptions
    SET tokens_used = tokens_used + ${tokens}
    WHERE id = ${subscriptionId}
      AND tokens_used + ${tokens} <= tokens_monthly
    RETURNING id
  `;
  return !!updated;
}
