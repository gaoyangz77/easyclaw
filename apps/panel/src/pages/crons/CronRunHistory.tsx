import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal.js";
import type { CronRunLogEntry, CronRunsResult } from "./cron-utils.js";
import { formatDuration } from "./cron-utils.js";

interface CronRunHistoryProps {
  jobId: string;
  jobName: string;
  fetchRuns: (params: { id: string; scope: "job"; limit: number; offset: number; sortDir: "desc" }) => Promise<CronRunsResult>;
  onClose: () => void;
}

const PAGE_SIZE = 20;

export function CronRunHistory({ jobId, jobName, fetchRuns, onClose }: CronRunHistoryProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CronRunLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    try {
      setLoading(true);
      const result = await fetchRuns({ id: jobId, scope: "job", limit: PAGE_SIZE, offset, sortDir: "desc" });
      if (offset === 0) {
        setEntries(result.entries);
      } else {
        setEntries((prev) => [...prev, ...result.entries]);
      }
      setTotal(result.total);
      setHasMore(result.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchRuns, jobId]);

  useEffect(() => {
    load(0);
  }, [load]);

  const loadMore = useCallback(() => {
    load(entries.length);
  }, [load, entries.length]);

  function statusBadge(status?: string) {
    if (!status) return null;
    const cls = status === "ok" ? "badge-success" : status === "error" ? "badge-danger" : "badge-warning";
    return <span className={`badge ${cls}`}>{status}</span>;
  }

  function deliveryBadge(status?: string) {
    if (!status || status === "not-requested") return null;
    const cls = status === "delivered" ? "badge-success" : status === "not-delivered" ? "badge-danger" : "badge-default";
    return <span className={`badge ${cls}`}>{status}</span>;
  }

  return (
    <Modal isOpen onClose={onClose} title={`${t("crons.historyTitle")} — ${jobName}`} maxWidth={720}>
      {error && <div className="error-alert">{error}</div>}

      {loading && entries.length === 0 ? (
        <div className="loading-state">
          <span className="spinner" />
          <span>{t("common.loading")}</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t("crons.emptyRuns")}</div>
        </div>
      ) : (
        <>
          <div className="table-scroll-wrap">
            <table className="crons-runs-table">
              <thead>
                <tr>
                  <th>{t("crons.historyTimestamp")}</th>
                  <th>{t("crons.historyStatus")}</th>
                  <th>{t("crons.historyDuration")}</th>
                  <th>{t("crons.historyDelivery")}</th>
                  <th>{t("crons.historySummary")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={`${entry.ts}-${i}`} className="table-hover-row">
                    <td className="crons-time-cell">
                      {new Date(entry.ts).toLocaleString()}
                    </td>
                    <td>{statusBadge(entry.status)}</td>
                    <td className="crons-time-cell">
                      {entry.durationMs != null ? formatDuration(entry.durationMs) : "—"}
                    </td>
                    <td>{deliveryBadge(entry.deliveryStatus)}</td>
                    <td>
                      {entry.error ? (
                        <span className="text-muted" title={entry.error}>
                          {entry.error.length > 80 ? entry.error.slice(0, 80) + "…" : entry.error}
                        </span>
                      ) : entry.summary ? (
                        <span className="text-muted" title={entry.summary}>
                          {entry.summary.length > 80 ? entry.summary.slice(0, 80) + "…" : entry.summary}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={loadMore} disabled={loading}>
                {loading ? t("common.loading") : `${t("crons.loadMore")} (${entries.length}/${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
