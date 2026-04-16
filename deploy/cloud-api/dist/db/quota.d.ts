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
export declare function getActiveSubscription(userId: string): Promise<ActiveSubscription | null>;
/**
 * Deducts tokens from the user's daily quota using a lazy reset strategy.
 * If the stored date is before today, tokens_used resets to 0 first.
 * Returns true if deduction succeeded (within limit), false if over limit.
 */
export declare function deductDailyTokens(userId: string, tokens: number, dailyLimit: number): Promise<boolean>;
/**
 * Deducts tokens from the user's monthly subscription pool.
 * Returns true if deduction succeeded, false if monthly quota exhausted.
 */
export declare function deductMonthlyTokens(subscriptionId: string, tokens: number): Promise<boolean>;
//# sourceMappingURL=quota.d.ts.map