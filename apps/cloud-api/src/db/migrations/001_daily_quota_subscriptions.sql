-- Daily token quota per user (lazy reset — no cron needed)
CREATE TABLE IF NOT EXISTS daily_quota (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  tokens_used INTEGER NOT NULL DEFAULT 0
);

-- Paid subscription plans
CREATE TABLE IF NOT EXISTS subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier           TEXT NOT NULL CHECK (tier IN ('basic', 'pro')),
  tokens_monthly INTEGER NOT NULL,
  tokens_used    INTEGER NOT NULL DEFAULT 0,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions (user_id, status, period_end);
