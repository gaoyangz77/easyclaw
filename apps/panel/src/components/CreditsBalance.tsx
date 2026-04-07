import { useState, useEffect } from "react";
import { fetchQuota, type QuotaInfo } from "../api/credits.js";

export function CreditsBalance() {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQuota()
      .then(setQuota)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!quota) return null;

  const remaining = Math.max(0, quota.daily.limit - quota.daily.used);

  return (
    <div className="credits-balance" title={`今日剩余 ${remaining.toLocaleString()} token`}>
      <span className="credits-balance__icon">⚡</span>
      <span className="credits-balance__value">
        {remaining >= 1000
          ? `${Math.floor(remaining / 1000)}k`
          : remaining.toLocaleString()}
      </span>
    </div>
  );
}
