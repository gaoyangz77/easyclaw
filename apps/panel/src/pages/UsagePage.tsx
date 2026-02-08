import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchUsage, type UsageSummary } from "../api.js";

type TimeRange = "7d" | "30d" | "all";

function formatCost(usd: number): string {
  return "$" + usd.toFixed(4);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function UsagePage() {
  const { t } = useTranslation();
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
    <div>
      <h1>{t("usage.title")}</h1>
      <p>{t("usage.description")}</p>

      {/* Time range filter and refresh button */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {(["7d", "30d", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              style={{
                padding: "6px 16px",
                borderRadius: 4,
                border: "1px solid #ccc",
                backgroundColor: timeRange === range ? "#1a73e8" : "#fff",
                color: timeRange === range ? "#fff" : "#333",
                cursor: "pointer",
                fontWeight: timeRange === range ? 600 : 400,
              }}
            >
              {rangeLabels[range]}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#888" }}>
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

      {loading && <p style={{ color: "#888" }}>{t("usage.loadingData")}</p>}

      {!loading && !error && summary && (
        <>
          {/* Summary cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
              marginBottom: 32,
            }}
          >
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
              value={formatCost(summary.totalEstimatedCostUsd)}
            />
            <SummaryCard
              label={t("usage.apiCalls")}
              value={String(summary.recordCount)}
            />
          </div>

          {/* By Model */}
          <div className="section-card">
          <h3>{t("usage.byModel")}</h3>
          {Object.keys(summary.byModel).length === 0 ? (
            <p style={{ color: "#888" }}>{t("usage.noData")}</p>
          ) : (
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
                    <Td>{formatCost(data.estimatedCostUsd)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>

          {/* By Provider */}
          <div className="section-card">
          <h3>{t("usage.byProvider")}</h3>
          {Object.keys(summary.byProvider).length === 0 ? (
            <p style={{ color: "#888" }}>{t("usage.noData")}</p>
          ) : (
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
                      <Td>{formatCost(data.estimatedCostUsd)}</Td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          </div>
        </>
      )}

      {!loading && !error && summary && summary.recordCount === 0 && (
        <div
          style={{
            padding: 24,
            border: "1px solid #e0e0e0",
            borderRadius: 4,
            backgroundColor: "#fafafa",
            textAlign: "center",
            color: "#888",
          }}
        >
          <p>{t("usage.noRecords")}</p>
          <p style={{ fontSize: 12 }}>
            {t("usage.noRecordsHelp")}
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="card"
      style={{
        padding: 16,
        border: "1px solid #e0e0e0",
        borderRadius: 4,
        backgroundColor: "#fafafa",
      }}
    >
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td>{children}</td>;
}
