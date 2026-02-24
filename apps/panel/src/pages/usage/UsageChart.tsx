import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { CHART_COLORS, formatTokens } from "./usage-utils.js";

export function UsageChart({
  chartData,
  seriesKeys,
  t,
}: {
  chartData: Record<string, unknown>[];
  seriesKeys: string[];
  t: (key: string) => string;
}) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  /** Solo mode: click shows only that series; click again restores all. */
  function handleLegendClick(dataKey: string) {
    setHiddenSeries((prev) => {
      const allOthersHidden = seriesKeys.every(
        (k) => k === dataKey || prev.has(k),
      );
      if (allOthersHidden) {
        return new Set();
      }
      return new Set(seriesKeys.filter((k) => k !== dataKey));
    });
  }

  return (
    <div className="section-card">
      <h3 className="usage-section-title">{t("keyUsage.historyChart")}</h3>
      <div className="usage-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="date" stroke="#999" fontSize={12} />
            <YAxis stroke="#999" fontSize={12} tickFormatter={formatTokens} />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg-alt)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                color: "var(--color-text)",
              }}
              formatter={(value: unknown) => [formatTokens(Number(value)), t("keyUsage.tokens")]}
              labelFormatter={(label: unknown) => `${t("keyUsage.date")}: ${label}`}
            />
            <Legend
              onClick={(e) => handleLegendClick(e.dataKey as string)}
              wrapperStyle={{ cursor: "pointer" }}
            />
            {seriesKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                hide={hiddenSeries.has(key)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
