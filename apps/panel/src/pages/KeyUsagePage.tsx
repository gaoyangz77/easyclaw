import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchKeyUsage, fetchActiveKeyUsage, fetchKeyUsageTimeseries, fetchPricing,
  type KeyModelUsageSummary, type ActiveKeyInfo, type KeyUsageDailyBucket,
} from "../api/index.js";
import {
  type TimeRange, type PricingMap,
  buildPricingMap, buildGroups, ensureActiveKey, buildChartData,
} from "./usage/usage-utils.js";
import { UsageTable } from "./usage/UsageTable.js";
import { UsageChart } from "./usage/UsageChart.js";

export function KeyUsagePage() {
  const { t, i18n } = useTranslation();
  const isCN = i18n.language === "zh";
  const [rows, setRows] = useState<KeyModelUsageSummary[]>([]);
  const [todayRows, setTodayRows] = useState<KeyModelUsageSummary[]>([]);
  const [timeseries, setTimeseries] = useState<KeyUsageDailyBucket[]>([]);
  const [activeKey, setActiveKey] = useState<ActiveKeyInfo | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [pricingMap, setPricingMap] = useState<PricingMap>(new Map());

  /** Build time-range filter from current timeRange state. */
  const buildFilter = useCallback(() => {
    const filter: { windowStart?: number; windowEnd?: number } = {};
    const now = Date.now();
    if (timeRange === "7d") {
      filter.windowStart = now - 7 * 24 * 60 * 60 * 1000;
      filter.windowEnd = now;
    } else if (timeRange === "30d") {
      filter.windowStart = now - 30 * 24 * 60 * 60 * 1000;
      filter.windowEnd = now;
    }
    return filter;
  }, [timeRange]);

  /** Fetch today's usage + active key (independent of time range). */
  const loadTodayAndActive = useCallback(async () => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [activeData, todayData] = await Promise.all([
      fetchActiveKeyUsage(),
      fetchKeyUsage({ windowStart: todayStart.getTime(), windowEnd: now }).catch(() => [] as KeyModelUsageSummary[]),
    ]);

    setActiveKey(activeData);
    setTodayRows(todayData);
  }, []);

  /** Fetch historical table + chart (depends on time range). */
  const loadHistorical = useCallback(async () => {
    const filter = buildFilter();

    const [usageData, tsData] = await Promise.all([
      fetchKeyUsage(filter),
      fetchKeyUsageTimeseries(filter).catch(() => [] as KeyUsageDailyBucket[]),
    ]);

    setRows(usageData);
    setTimeseries(tsData);
  }, [buildFilter]);

  /** Full load — initial page load and manual refresh. */
  const loadAll = useCallback(async () => {
    setInitialLoading(true);
    setError(null);
    try {
      await Promise.all([loadTodayAndActive(), loadHistorical()]);
      setLastRefresh(new Date());
    } catch (err) {
      const errMsg = String(err);
      if (errMsg.includes("501")) {
        setRows([]);
        setActiveKey(null);
        setTodayRows([]);
        setTimeseries([]);
        setLastRefresh(new Date());
      } else {
        setError({ key: "keyUsage.failedToLoad", detail: errMsg });
      }
    } finally {
      setInitialLoading(false);
    }
  }, [loadTodayAndActive, loadHistorical]);

  // Fetch pricing data once on mount
  useEffect(() => {
    (async () => {
      try {
        const statusRes = await fetch("/api/status");
        const status = await statusRes.json();
        const deviceId = status.deviceId || "unknown";
        const lang = navigator.language?.slice(0, 2) || "en";
        const platform = navigator.userAgent.includes("Mac") ? "darwin"
          : navigator.userAgent.includes("Win") ? "win32" : "linux";
        const data = await fetchPricing(deviceId, platform, "0.8.0", lang);
        if (data) setPricingMap(buildPricingMap(data));
      } catch { /* graceful degradation — use empty map */ }
    })();
  }, []);

  // Initial load
  useEffect(() => {
    loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When time range changes, only reload historical data (not today/active)
  const [isFirstRender, setIsFirstRender] = useState(true);
  useEffect(() => {
    if (isFirstRender) {
      setIsFirstRender(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    loadHistorical()
      .then(() => { if (!cancelled) setLastRefresh(new Date()); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadAll();
    }, 60_000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // Group rows for historical table (with active key injected)
  const grouped = useMemo(
    () => buildGroups(ensureActiveKey(rows, activeKey), activeKey, pricingMap),
    [rows, activeKey, pricingMap],
  );

  // Group rows for today's table (with active key injected)
  const todayGrouped = useMemo(
    () => buildGroups(ensureActiveKey(todayRows, activeKey), activeKey, pricingMap),
    [todayRows, activeKey, pricingMap],
  );

  // Transform timeseries data for Recharts
  const { chartData, seriesKeys } = useMemo(
    () => buildChartData(timeseries, timeRange),
    [timeseries, timeRange],
  );

  const rangeLabels: Record<TimeRange, string> = {
    "7d": t("keyUsage.timeRange7d"),
    "30d": t("keyUsage.timeRange30d"),
    all: t("keyUsage.timeRangeAll"),
  };

  const loading = initialLoading;
  const hasData = rows.length > 0 || activeKey;
  const hasTodayData = todayRows.length > 0 || activeKey;

  return (
    <div className="page-enter">
      <div className="page-header">
        <h1>{t("keyUsage.title")}</h1>
        <div className="page-header-actions">
          <button
            className="btn btn-secondary"
            onClick={loadAll}
            disabled={loading}
          >
            {t("keyUsage.refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-alert">{t(error.key)}{error.detail ?? ""}</div>
      )}

      {loading && <div className="loading-state"><span className="spinner" /> {t("keyUsage.loadingData")}</div>}

      {/* Today's Usage Table */}
      {!loading && !error && hasTodayData && (
        <div className="section-card">
          <h3 className="usage-section-title">{t("keyUsage.todayTitle")}</h3>
          <UsageTable grouped={todayGrouped} isCN={isCN} t={t} />
        </div>
      )}

      {/* Time range selector — controls historical table + chart */}
      {!loading && !error && (
        <div className="usage-time-range-bar">
          {(["7d", "30d", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              className={timeRange === range ? "btn btn-outline" : "btn btn-secondary"}
              onClick={() => setTimeRange(range)}
              disabled={historyLoading}
            >
              {rangeLabels[range]}
            </button>
          ))}
        </div>
      )}

      {/* Historical Usage Table */}
      {!loading && !error && hasData && (
        <div className="section-card">
          <h3 className="usage-section-title">{t("keyUsage.historyTitle")}</h3>
          <UsageTable grouped={grouped} isCN={isCN} t={t} />
        </div>
      )}

      {/* Historical Usage Line Chart */}
      {!loading && !error && chartData.length > 0 && (
        <UsageChart chartData={chartData} seriesKeys={seriesKeys} t={t} />
      )}

      {!loading && !error && !hasData && !hasTodayData && (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">{t("keyUsage.noData")}</div>
        </div>
      )}

      <p className="td-meta">
        {t("keyUsage.lastUpdated")}: {lastRefresh.toLocaleTimeString()}
      </p>
    </div>
  );
}
