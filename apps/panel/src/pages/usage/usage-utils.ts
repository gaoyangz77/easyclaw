import { CNY_USD } from "@easyclaw/core";
import type { KeyModelUsageSummary, ActiveKeyInfo, KeyUsageDailyBucket, ProviderPricing } from "../../api/index.js";

export type TimeRange = "7d" | "30d" | "all";

export const CHART_COLORS = [
  "#6c63ff",
  "#00d4ff",
  "#ff6b6b",
  "#ffc078",
  "#63e6be",
  "#cc5de8",
  "#ff922b",
  "#20c997",
];

export function formatCost(amount: number, nativeCurrency: string, isCN: boolean): string {
  if (isCN) {
    const cny = nativeCurrency === "CNY" ? amount : amount * CNY_USD;
    return "\u00a5" + cny.toFixed(4);
  }
  const usd = nativeCurrency === "USD" ? amount : amount / CNY_USD;
  return "$" + usd.toFixed(4);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export type PricingEntry = { inputPerM: number; outputPerM: number; currency: string };
export type PricingMap = Map<string, PricingEntry>; // key: "provider/modelId"

export function buildPricingMap(list: ProviderPricing[]): PricingMap {
  const map: PricingMap = new Map();
  for (const pp of list) {
    for (const m of pp.models) {
      map.set(`${pp.provider}/${m.modelId}`, {
        inputPerM: parseFloat(m.inputPricePerMillion) || 0,
        outputPerM: parseFloat(m.outputPricePerMillion) || 0,
        currency: pp.currency,
      });
    }
  }
  return map;
}

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  provider: string,
  model: string,
  pricingMap: PricingMap,
): { amount: number; currency: string } {
  const entry = pricingMap.get(`${provider}/${model}`);
  if (!entry) {
    return { amount: 0, currency: "USD" };
  }
  return {
    amount: (inputTokens * entry.inputPerM + outputTokens * entry.outputPerM) / 1_000_000,
    currency: entry.currency,
  };
}

export interface CostInfo {
  amount: number;
  currency: string;
}

export interface ModelRow {
  row: KeyModelUsageSummary;
  isActive: boolean;
  cost: CostInfo;
}

export interface KeyGroup {
  keyId: string;
  keyLabel: string;
  authType: "api_key" | "oauth";
  models: ModelRow[];
  totalCost: number;
  currency: string;
}

export interface ProviderGroup {
  provider: string;
  keys: KeyGroup[];
  totalCost: number;
  currency: string;
}

export function toUsd(amount: number, currency: string): number {
  return currency === "USD" ? amount : amount / CNY_USD;
}

export function buildGroups(
  allRows: KeyModelUsageSummary[],
  activeKey: ActiveKeyInfo | null,
  pricingMap: PricingMap,
): ProviderGroup[] {
  const providerMap = new Map<string, Map<string, ModelRow[]>>();

  for (const row of allRows) {
    if (!providerMap.has(row.provider)) {
      providerMap.set(row.provider, new Map());
    }
    const keyMap = providerMap.get(row.provider)!;
    if (!keyMap.has(row.keyId)) {
      keyMap.set(row.keyId, []);
    }
    const isActive = activeKey !== null
      && row.keyId === activeKey.keyId
      && row.model === activeKey.model;
    const cost = computeCost(row.inputTokens, row.outputTokens, row.provider, row.model, pricingMap);
    keyMap.get(row.keyId)!.push({ row, isActive, cost });
  }

  const result: ProviderGroup[] = [];
  for (const [provider, keyMap] of providerMap) {
    const keys: KeyGroup[] = [];
    for (const [keyId, models] of keyMap) {
      const first = models[0];
      const totalCost = models.reduce((s, m) => s + m.cost.amount, 0);
      keys.push({
        keyId,
        keyLabel: first.row.keyLabel,
        authType: first.row.authType,
        models,
        totalCost,
        currency: first.cost.currency,
      });
    }
    keys.sort((a, b) => toUsd(b.totalCost, b.currency) - toUsd(a.totalCost, a.currency));
    const totalCost = keys.reduce((s, k) => s + k.totalCost, 0);
    const currency = keys[0]?.currency ?? "USD";
    result.push({ provider, keys, totalCost, currency });
  }
  result.sort((a, b) => toUsd(b.totalCost, b.currency) - toUsd(a.totalCost, a.currency));
  return result;
}

export function ensureActiveKey(
  rows: KeyModelUsageSummary[],
  activeKey: ActiveKeyInfo | null,
): KeyModelUsageSummary[] {
  const allRows = [...rows];
  if (activeKey) {
    const found = allRows.some(
      (r) => r.keyId === activeKey.keyId && r.model === activeKey.model,
    );
    if (!found) {
      allRows.push({
        keyId: activeKey.keyId,
        keyLabel: activeKey.keyLabel,
        provider: activeKey.provider,
        model: activeKey.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: "0",
        authType: activeKey.authType,
      });
    }
  }
  return allRows;
}

/** Transform timeseries data for Recharts, filling missing dates with zeros. */
export function buildChartData(
  timeseries: KeyUsageDailyBucket[],
  timeRange: TimeRange,
): { chartData: Record<string, unknown>[]; seriesKeys: string[] } {
  if (timeseries.length === 0) return { chartData: [], seriesKeys: [] };

  const seriesSet = new Set<string>();
  const dateMap = new Map<string, Record<string, number>>();

  for (const bucket of timeseries) {
    const key = `${bucket.keyLabel} / ${bucket.model}`;
    seriesSet.add(key);

    if (!dateMap.has(bucket.date)) {
      dateMap.set(bucket.date, {});
    }
    const entry = dateMap.get(bucket.date)!;
    entry[key] = (entry[key] ?? 0) + bucket.inputTokens + bucket.outputTokens;
  }

  const keys = Array.from(seriesSet);

  // Determine date range from timeRange selection
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let startDate: Date;
  if (timeRange === "7d") {
    startDate = new Date(today.getTime() - 6 * 86_400_000);
  } else if (timeRange === "30d") {
    startDate = new Date(today.getTime() - 29 * 86_400_000);
  } else {
    // "all": span from earliest data point to today
    const allDates = Array.from(dateMap.keys()).sort();
    startDate = allDates.length > 0 ? new Date(allDates[0] + "T00:00:00") : today;
  }

  // Fill in every date in the range
  const allData: Record<string, unknown>[] = [];
  const cursor = new Date(startDate);
  while (cursor <= today) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const existing = dateMap.get(dateStr) ?? {};
    allData.push({ date: dateStr, ...existing });
    cursor.setDate(cursor.getDate() + 1);
  }

  return { chartData: allData, seriesKeys: keys };
}
