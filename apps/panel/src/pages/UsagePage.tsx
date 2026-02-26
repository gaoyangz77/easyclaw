/** @deprecated Replaced by KeyUsagePage. Kept for reference only. */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CNY_USD } from "@easyclaw/core";
import { fetchUsage, type UsageSummary } from "../api/index.js";

type TimeRange = "7d" | "30d" | "all";

function formatCost(usd: number, isCN: boolean): string {
  if (isCN) {
    const cny = usd * CNY_USD;
    return "¥" + cny.toFixed(4);
  }
  return "$" + usd.toFixed(4);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function UsagePage() {
  const { t, i18n } = useTranslation();
  const isCN = i18n.language === "zh";
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    loadUsage();
  }, [timeRange]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadUsage();
    }, 60_000); // 60 seconds

    return () => clearInterval(interval);
  }, [timeRange]);

  async function loadUsage() {
    setLoading(true);
    setError(null);
    try {
      const filter: { since?: string } = {};
      if (timeRange === "7d") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        filter.since = d.toISOString();
      } else if (timeRange === "30d") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        filter.since = d.toISOString();
      }
      const data = await fetchUsage(filter);
      setSummary(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError({ key: "usage.failedToLoad", detail: String(err) });
    } finally {
      setLoading(false);
    }
  }

  function handleManualRefresh() {
    loadUsage();
  }

  const rangeLabels: Record<TimeRange, string> = {
    "7d": t("usage.last7d"),
    "30d": t("usage.last30d"),
    all: t("usage.allTime"),
  };

  return (
    <div className="page-enter">
      <h1>{t("usage.title")}</h1>
      <p>{t("usage.description")}</p>

      {/* Time range filter and refresh button */}
      <div className="form-row mb-lg flex-row-between">
        <div className="form-row">
          {(["7d", "30d", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              className={timeRange === range ? "btn btn-outline" : "btn btn-secondary"}
              onClick={() => setTimeRange(range)}
            >
              {rangeLabels[range]}
            </button>
          ))}
        </div>
        <div className="form-row flex-row-center">
          <span className="text-sm text-muted">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleManualRefresh}
            disabled={loading}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="error-alert">{t(error.key)}{error.detail ?? ""}</div>
      )}

      {loading && <p className="text-muted">{t("usage.loadingData")}</p>}

      {!loading && !error && summary && (
        <>
          {/* Summary cards */}
          <div className="stat-grid">
            <SummaryCard
              label={t("usage.totalTokens")}
              value={formatTokens(summary.totalTokens)}
            />
            <SummaryCard
              label={t("usage.inputTokens")}
              value={formatTokens(summary.totalInputTokens)}
            />
            <SummaryCard
              label={t("usage.outputTokens")}
              value={formatTokens(summary.totalOutputTokens)}
            />
            <SummaryCard
              label={t("usage.estimatedCost")}
              value={formatCost(summary.totalEstimatedCostUsd, isCN)}
            />
            <SummaryCard
              label={t("usage.apiCalls")}
              value={String(summary.recordCount)}
            />
          </div>

          <div className="text-sm text-muted mb-md">
            {t("usage.costDisclaimer")}
          </div>

          {/* By Model */}
          <div className="section-card">
          <h3>{t("usage.byModel")}</h3>
          {Object.keys(summary.byModel).length === 0 ? (
            <p className="text-muted">{t("usage.noData")}</p>
          ) : (
            <div className="table-scroll-wrap">
            <table>
              <thead>
                <tr>
                  <Th>{t("usage.model")}</Th>
                  <Th>{t("usage.calls")}</Th>
                  <Th>{t("usage.input")}</Th>
                  <Th>{t("usage.output")}</Th>
                  <Th>{t("usage.total")}</Th>
                  <Th>{t("usage.cost")}</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byModel).map(([model, data]) => (
                  <tr key={model} className="table-hover-row">
                    <Td>{model}</Td>
                    <Td>{data.count}</Td>
                    <Td>{formatTokens(data.inputTokens)}</Td>
                    <Td>{formatTokens(data.outputTokens)}</Td>
                    <Td>{formatTokens(data.totalTokens)}</Td>
                    <Td>{formatCost(data.estimatedCostUsd, isCN)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          </div>

          {/* By Provider */}
          <div className="section-card">
          <h3>{t("usage.byProvider")}</h3>
          {Object.keys(summary.byProvider).length === 0 ? (
            <p className="text-muted">{t("usage.noData")}</p>
          ) : (
            <div className="table-scroll-wrap">
            <table>
              <thead>
                <tr>
                  <Th>{t("usage.provider")}</Th>
                  <Th>{t("usage.calls")}</Th>
                  <Th>{t("usage.input")}</Th>
                  <Th>{t("usage.output")}</Th>
                  <Th>{t("usage.total")}</Th>
                  <Th>{t("usage.cost")}</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byProvider).map(
                  ([provider, data]) => (
                    <tr key={provider} className="table-hover-row">
                      <Td>{provider}</Td>
                      <Td>{data.count}</Td>
                      <Td>{formatTokens(data.inputTokens)}</Td>
                      <Td>{formatTokens(data.outputTokens)}</Td>
                      <Td>{formatTokens(data.totalTokens)}</Td>
                      <Td>{formatCost(data.estimatedCostUsd, isCN)}</Td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            </div>
          )}
          </div>
        </>
      )}

      {!loading && !error && summary && summary.recordCount === 0 && (
        <div className="empty-state">
          <p>{t("usage.noRecords")}</p>
          <p className="text-sm">
            {t("usage.noRecordsHelp")}
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td>{children}</td>;
}
