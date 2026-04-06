import { useState, useEffect, useCallback } from "react";
import {
  fetchCreditsInfo,
  fetchCreditsHistory,
  createRechargeOrder,
  type LedgerEntry,
} from "../api/credits.js";

export function CreditsPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rechargeMsg, setRechargeMsg] = useState<string | null>(null);
  const limit = 20;

  const loadData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const [info, history] = await Promise.all([
        fetchCreditsInfo(),
        fetchCreditsHistory(p, limit),
      ]);
      setBalance(info.balance);
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

  async function handleRecharge() {
    try {
      const result = await createRechargeOrder(100);
      setRechargeMsg(result.message);
    } catch (err) {
      setRechargeMsg(String(err));
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="page credits-page">
      <h1>积分中心</h1>

      <div className="credits-page__balance-card">
        <div className="credits-page__balance-label">当前积分</div>
        <div className="credits-page__balance-value">
          {balance === null ? "加载中…" : balance.toLocaleString()}
        </div>
        <button className="btn btn-primary" onClick={handleRecharge}>
          充值
        </button>
        {rechargeMsg && (
          <p className="credits-page__recharge-msg">{rechargeMsg}</p>
        )}
      </div>

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
              <th>变化</th>
              <th>原因</th>
              <th>模型</th>
              <th>Token</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString("zh-CN")}</td>
                <td className={e.delta < 0 ? "neg" : "pos"}>
                  {e.delta > 0 ? `+${e.delta}` : e.delta}
                </td>
                <td>
                  {e.reason === "signup_bonus" ? "注册赠送" :
                   e.reason === "consumption" ? "消费" : "充值"}
                </td>
                <td>{e.model ?? "—"}</td>
                <td>{e.tokens?.toLocaleString() ?? "—"}</td>
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
    </div>
  );
}
