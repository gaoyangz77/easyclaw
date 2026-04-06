# Credits System: Daily Quota + Subscription Plans

**Date:** 2026-04-06  
**Status:** Approved

## Overview

Extend the existing `apps/cloud-api` credits backend to support:
- Daily free token quota (100k tokens/day, resets at midnight)
- Two paid subscription tiers with monthly token pools
- Model access control (free users restricted to OpenRouter free models)
- Model name hidden from free users

---

## 1. Database Schema Changes

### New table: `daily_quota`

Tracks per-user daily token consumption. Lazy reset: quota resets when the first request on a new day arrives (no cron job needed).

```sql
CREATE TABLE daily_quota (
  user_id    UUID PRIMARY KEY REFERENCES users(id),
  date       DATE NOT NULL,          -- current quota date (YYYY-MM-DD)
  tokens_used INTEGER NOT NULL DEFAULT 0
);
```

### New table: `subscriptions`

Tracks paid subscription state per user.

```sql
CREATE TABLE subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID UNIQUE REFERENCES users(id),
  tier           TEXT NOT NULL CHECK (tier IN ('basic', 'pro')),
  tokens_monthly INTEGER NOT NULL,   -- 5_000_000 or 20_000_000
  tokens_used    INTEGER NOT NULL DEFAULT 0,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired'))
);
```

### Constants

| Plan    | Daily Free | Monthly Tokens | Price  |
|---------|-----------|----------------|--------|
| Free    | 100,000   | —              | ¥0     |
| Basic   | 100,000   | 5,000,000      | ¥19/月 |
| Pro     | 100,000   | 20,000,000     | ¥49/月 |

Paid subscribers consume monthly tokens first; if exhausted, fall back to daily free quota.

---

## 2. Free Model Whitelist

Stored as a config array in cloud-api (not hardcoded per-route). Initially:

```ts
const FREE_MODELS = [
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-8b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "microsoft/phi-3-mini-128k-instruct:free",
];
```

Free users may only use models in this list. Requests to other models return `403 Forbidden`.

**Free users see "默认模型" as the model label** — the actual model ID is hidden. Paid users see the real model name (e.g., "gpt-4o", "claude-3-5-sonnet").

---

## 3. Proxy Layer Logic

File: `apps/cloud-api/src/routes/proxy.ts`

Decision flow per request:

```
1. Verify JWT → userId

2. Load user plan:
   - Query subscriptions WHERE user_id = ? AND status = 'active' AND period_end >= today
   - has_subscription = true/false

3. Check model access:
   - If NOT has_subscription AND model NOT IN FREE_MODELS → 403

4. Check & update quota:
   a. If has_subscription:
      - If subscriptions.tokens_used < tokens_monthly → deduct from monthly pool
      - Else → fall through to daily quota check
   b. Daily quota check:
      - Load daily_quota WHERE user_id = ? 
      - If daily_quota.date < today → reset tokens_used = 0, date = today (lazy reset)
      - If tokens_used + estimated_tokens > 100_000 → 402 "Daily quota exceeded"
      - Deduct estimated tokens optimistically

5. Forward to OpenRouter (use master OPENROUTER_API_KEY)

6. On response: update actual token usage from usage.total_tokens
   - Correct optimistic deduction with actual value
```

---

## 4. New API Endpoints

### `GET /api/credits/quota`

Returns current quota status for the authenticated user.

```ts
Response: {
  plan: "free" | "basic" | "pro",
  daily: {
    used: number,
    limit: number,         // always 100_000
    resets_at: string,     // ISO datetime of next midnight (user's server TZ)
  },
  monthly: {               // null if free plan
    used: number,
    limit: number,
    period_end: string,
  } | null,
  show_model: boolean,     // true for paid users; false = display "默认模型" for free users
}
```

### `GET /api/subscription`

Returns current subscription details or null.

```ts
Response: {
  subscription: {
    tier: "basic" | "pro",
    tokens_monthly: number,
    tokens_used: number,
    period_start: string,
    period_end: string,
    status: "active" | "expired",
  } | null
}
```

### `POST /api/subscription/create`

Initiates subscription purchase. Returns a stub for now (payment integration TBD).

```ts
Body: { tier: "basic" | "pro" }
Response: { status: "pending", message: "支付功能即将上线" }
```

---

## 5. Desktop API Routes Changes

File: `apps/desktop/src/api-routes/credits-routes.ts`

- Replace `GET /api/credits/balance` proxy with `GET /api/credits/quota` proxy
- Add `GET /api/subscription` proxy
- Add `POST /api/subscription/create` proxy
- Keep `GET /api/credits/history` (unchanged)

---

## 6. Panel UI Changes

### CreditsPage (`apps/panel/src/pages/CreditsPage.tsx`)

Replace current balance card with:

1. **Daily quota card**
   - Progress bar: `tokens_used / 100,000`
   - Text: "今日剩余 XX,XXX token · 重置于 00:00"

2. **Subscription cards** (shown below daily card)
   - If free: show Basic and Pro cards with [订阅] button
   - If subscribed: show current plan status + monthly usage progress

3. **Consumption history table** (unchanged)
   - Model column: show "—" for free-user entries (model was null)

### CreditsBalance sidebar widget

Change display from `balance` to today's remaining tokens:
```
⚡ 82,340
```

### `apps/panel/src/api/credits.ts`

Replace `fetchCreditsInfo()` with `fetchQuota()` returning the new quota shape.

---

## 7. Model Name Display

- **Free users**: proxy records actual model in `credit_ledger` internally, but `GET /api/credits/quota` returns `show_model: false`. Panel displays "默认模型" wherever the model name would appear (chat history, consumption table).
- **Paid users**: `show_model: true`, actual model ID shown everywhere.

---

## 8. Access Mode Scope

This entire credits system only applies when `access_mode = "credits"`.

- `coding-plan` and `subscription` modes use the user's own configured provider keys (set in the Providers page) — the cloud-api proxy and quota system are bypassed entirely for those modes.
- The credits initializer in the desktop app already skips setup when mode is not "credits".

---

## 9. Out of Scope

- Actual payment processing (stubbed with "即将上线" message)
- Multi-device account linking
- Credit expiration policies
- Admin panel
