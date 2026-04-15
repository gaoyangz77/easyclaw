import { useState, useEffect, useCallback } from "react";
import {
  fetchQuota,
  fetchCreditsHistory,
  createSubscription,
  type QuotaInfo,
  type LedgerEntry,
} from "../api/credits.js";
import { useCreditsAuth } from "../hooks/useCreditsAuth.js";
import { CreditsAuthModal } from "../components/CreditsAuthModal.js";

const PLAN_LABELS: Record<string, string> = {
  free: "免费版",
  basic: "基础版",
  pro: "专业版",
};

export function CreditsPage() {
  const { me } = useCreditsAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [subMsg, setSubMsg] = useState<string | null>(null);
  const limit = 20;

  const loadData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const [q, history] = await Promise.all([
        fetchQuota(),
        fetchCreditsHistory(p, limit),
      ]);
      setQuota(q);
      setEntries(history.entries);
      setTotal(history.total);
      setPage(p);
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(1); }, [loadData]);

  async function handleSubscribe(tier: "basic" | "pro") {
    try {
      const result = await createSubscription(tier);
      setSubMsg(result.message);
    } catch (err) {
      setSubMsg(String(err));
    }
  }

  const totalPages = Math.ceil(total / limit);
  const dailyRemaining = quota ? Math.max(0, quota.daily.limit - quota.daily.used) : 0;
  const dailyPct = quota ? Math.min(100, (quota.daily.used / quota.daily.limit) * 100) : 0;

  return (
    <div className="page credits-page">
      <h1>积分中心</h1>

      {/* Daily quota card */}
      <div className="credits-page__balance-card">
        <div className="credits-page__balance-label">
          今日剩余（{PLAN_LABELS[quota?.plan ?? "free"]}）
        </div>
        <div className="credits-page__balance-value">
          {loading ? "加载中…" : dailyRemaining.toLocaleString()}
          <span className="credits-page__balance-unit"> / {(quota?.daily.limit ?? 100_000).toLocaleString()} token</span>
        </div>
        <div className="credits-page__progress-bar">
          <div
            className="credits-page__progress-fill"
            style={{ width: `${dailyPct}%` }}
          />
        </div>
        <div className="credits-page__reset-hint">每日零点重置</div>

        {/* Monthly pool (paid users) */}
        {quota?.monthly && (
          <div className="credits-page__monthly">
            <div className="credits-page__balance-label">本月套餐剩余</div>
            <div className="credits-page__balance-value">
              {(quota.monthly.limit - quota.monthly.used).toLocaleString()}
              <span className="credits-page__balance-unit"> / {quota.monthly.limit.toLocaleString()} token</span>
            </div>
            <div className="credits-page__reset-hint">到期：{quota.monthly.period_end}</div>
          </div>
        )}
      </div>

      {/* Subscription cards (shown for free users) */}
      {quota?.plan === "free" && (
        <div className="credits-page__plans">
          <h2>升级套餐</h2>
          {subMsg && <p className="credits-page__recharge-msg">{subMsg}</p>}
          <div className="credits-page__plan-cards">
            <div className="credits-page__plan-card">
              <div className="credits-page__plan-name">基础版</div>
              <div className="credits-page__plan-price">¥19 / 月</div>
              <div className="credits-page__plan-desc">500 万 token/月 · 所有模型</div>
              <button
                className="btn btn-primary"
                onClick={() => me ? handleSubscribe("basic") : setAuthModalOpen(true)}
              >
                {me ? "订阅" : "登录后订阅"}
              </button>
            </div>
            <div className="credits-page__plan-card credits-page__plan-card--featured">
              <div className="credits-page__plan-name">专业版</div>
              <div className="credits-page__plan-price">¥49 / 月</div>
              <div className="credits-page__plan-desc">2000 万 token/月 · 所有模型</div>
              <button
                className="btn btn-primary"
                onClick={() => me ? handleSubscribe("pro") : setAuthModalOpen(true)}
              >
                {me ? "订阅" : "登录后订阅"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Consumption history */}
      <h2>消费记录</h2>
      {loading ? (
        <p>加载中…</p>
      ) : entries.length === 0 ? (
        <p>暂无记录</p>
      ) : (
        <table className="credits-page__table">
          <thead>
            <tr>
              <th>时间</th>
              <th>Token</th>
              <th>原因</th>
              <th>模型</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td className={e.delta < 0 ? "neg" : "pos"}>
                  {e.delta > 0 ? `+${e.delta}` : e.delta}
                </td>
                <td>
                  {e.reason === "signup_bonus" ? "注册赠送" :
                   e.reason === "consumption" ? "消费" : "充值"}
                </td>
                <td>
                  {e.reason === "consumption"
                    ? (quota?.show_model ? (e.model ?? "—") : "默认模型")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="credits-page__pagination">
          <button disabled={page <= 1} onClick={() => loadData(page - 1)}>上一页</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => loadData(page + 1)}>下一页</button>
        </div>
      )}
      <CreditsAuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}
