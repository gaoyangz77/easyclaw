import { useState, useEffect } from "react";
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
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

  useEffect(() => {
    loadUsage();
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
    } catch (err) {
      setError("Failed to load usage data: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Token Usage</h1>
      <p>View token usage and cost tracking.</p>

      {/* Time range filter */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8 }}>
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
            {range === "7d"
              ? "Last 7 days"
              : range === "30d"
                ? "Last 30 days"
                : "All time"}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ color: "red", marginBottom: 16 }}>{error}</div>
      )}

      {loading && <p style={{ color: "#888" }}>Loading usage data...</p>}

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
              label="Total Tokens"
              value={formatTokens(summary.totalTokens)}
            />
            <SummaryCard
              label="Input Tokens"
              value={formatTokens(summary.totalInputTokens)}
            />
            <SummaryCard
              label="Output Tokens"
              value={formatTokens(summary.totalOutputTokens)}
            />
            <SummaryCard
              label="Estimated Cost"
              value={formatCost(summary.totalEstimatedCostUsd)}
            />
            <SummaryCard
              label="API Calls"
              value={String(summary.recordCount)}
            />
          </div>

          {/* By Model */}
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>By Model</h2>
          {Object.keys(summary.byModel).length === 0 ? (
            <p style={{ color: "#888" }}>No usage data available.</p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginBottom: 32,
              }}
            >
              <thead>
                <tr>
                  <Th>Model</Th>
                  <Th>Calls</Th>
                  <Th>Input</Th>
                  <Th>Output</Th>
                  <Th>Total</Th>
                  <Th>Cost</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byModel).map(([model, data]) => (
                  <tr key={model}>
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

          {/* By Provider */}
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>By Provider</h2>
          {Object.keys(summary.byProvider).length === 0 ? (
            <p style={{ color: "#888" }}>No usage data available.</p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginBottom: 32,
              }}
            >
              <thead>
                <tr>
                  <Th>Provider</Th>
                  <Th>Calls</Th>
                  <Th>Input</Th>
                  <Th>Output</Th>
                  <Th>Total</Th>
                  <Th>Cost</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byProvider).map(
                  ([provider, data]) => (
                    <tr key={provider}>
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
          <p>No usage data recorded yet.</p>
          <p style={{ fontSize: 12 }}>
            Token usage will appear here as API calls are made through the
            gateway.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
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
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 12px",
        borderBottom: "2px solid #e0e0e0",
        fontSize: 13,
        fontWeight: 600,
        color: "#555",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid #f0f0f0",
        fontSize: 14,
      }}
    >
      {children}
    </td>
  );
}
