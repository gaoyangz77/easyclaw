import { useState, useEffect } from "react";
import { fetchCreditsInfo } from "../api/credits.js";

export function CreditsBalance() {
  const [balance, setBalance] = useState<number | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCreditsInfo()
      .then((info) => {
        setBalance(info.balance);
        setMode(info.mode);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (mode !== "credits") return null;
  if (loading) return null;

  return (
    <div className="credits-balance" title="积分余额">
      <span className="credits-balance__icon">⚡</span>
      <span className="credits-balance__value">
        {balance === null ? "—" : balance.toLocaleString()}
      </span>
    </div>
  );
}
