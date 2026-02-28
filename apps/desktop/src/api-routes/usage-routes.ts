import { createLogger } from "@easyclaw/logger";
import { resolveOpenClawConfigPath, readExistingConfig } from "@easyclaw/gateway";
import { loadCostUsageSummary, discoverAllSessions, loadSessionCostSummary } from "../../../../vendor/openclaw/src/infra/session-cost-usage.js";
import type { CostUsageSummary, SessionCostSummary } from "../../../../vendor/openclaw/src/infra/session-cost-usage.js";
import type { RouteHandler } from "./api-context.js";
import { sendJson } from "./route-utils.js";

const log = createLogger("panel-server");

// --- Usage Types and Helpers ---

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  recordCount: number;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>;
  byProvider: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>;
}

interface UsageFilter {
  since?: string;
  until?: string;
  model?: string;
  provider?: string;
}

// Simple cache with TTL for usage data
const usageCache = new Map<string, { data: UsageSummary; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function getCachedUsage(cacheKey: string): UsageSummary | null {
  const cached = usageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  usageCache.delete(cacheKey);
  return null;
}

function setCachedUsage(cacheKey: string, data: UsageSummary): void {
  usageCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function transformToUsageSummary(
  costSummary: CostUsageSummary,
  sessionSummaries: SessionCostSummary[]
): UsageSummary {
  const byModelMap = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>();

  const byProviderMap = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>();

  for (const session of sessionSummaries) {
    if (!session.modelUsage) continue;

    for (const modelUsage of session.modelUsage) {
      const model = modelUsage.model || "unknown";
      const provider = modelUsage.provider || "unknown";

      const modelKey = `${provider}/${model}`;
      const modelEntry = byModelMap.get(modelKey) || {
        inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, count: 0,
      };
      modelEntry.inputTokens += modelUsage.totals.input;
      modelEntry.outputTokens += modelUsage.totals.output;
      modelEntry.totalTokens += modelUsage.totals.totalTokens;
      modelEntry.estimatedCostUsd += modelUsage.totals.totalCost;
      modelEntry.count += modelUsage.count;
      byModelMap.set(modelKey, modelEntry);

      const providerEntry = byProviderMap.get(provider) || {
        inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, count: 0,
      };
      providerEntry.inputTokens += modelUsage.totals.input;
      providerEntry.outputTokens += modelUsage.totals.output;
      providerEntry.totalTokens += modelUsage.totals.totalTokens;
      providerEntry.estimatedCostUsd += modelUsage.totals.totalCost;
      providerEntry.count += modelUsage.count;
      byProviderMap.set(provider, providerEntry);
    }
  }

  return {
    totalInputTokens: costSummary.totals.input,
    totalOutputTokens: costSummary.totals.output,
    totalTokens: costSummary.totals.totalTokens,
    totalEstimatedCostUsd: costSummary.totals.totalCost,
    recordCount: costSummary.daily.length,
    byModel: Object.fromEntries(byModelMap),
    byProvider: Object.fromEntries(byProviderMap),
  };
}

function emptyUsageSummary(): UsageSummary {
  return {
    totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
    totalEstimatedCostUsd: 0, recordCount: 0,
    byModel: {}, byProvider: {},
  };
}

export const handleUsageRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  const { storage, queryService } = ctx;

  // --- Usage ---
  if (pathname === "/api/usage" && req.method === "GET") {
    const filter: UsageFilter = {};
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");
    if (since) filter.since = since;
    if (until) filter.until = until;

    const cacheKey = `usage-${filter.since ?? "all"}-${filter.until ?? "all"}`;
    const cached = getCachedUsage(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return true;
    }

    try {
      const startMs = filter.since ? new Date(filter.since).getTime() : undefined;
      const endMs = filter.until ? new Date(filter.until).getTime() : undefined;

      const configPath = resolveOpenClawConfigPath();
      const config = readExistingConfig(configPath);

      const costSummary = await loadCostUsageSummary({ startMs, endMs, config });

      const sessions = await discoverAllSessions({ startMs, endMs });
      const sessionSummaries: SessionCostSummary[] = [];

      for (const session of sessions) {
        const summary = await loadSessionCostSummary({
          sessionFile: session.sessionFile,
          config,
          startMs,
          endMs,
        });
        if (summary && summary.modelUsage) {
          sessionSummaries.push(summary);
        }
      }

      const summary = transformToUsageSummary(costSummary, sessionSummaries);
      setCachedUsage(cacheKey, summary);

      sendJson(res, 200, summary);
    } catch (error) {
      log.error("Failed to load usage data", error);
      sendJson(res, 200, emptyUsageSummary());
    }
    return true;
  }

  // --- Per-Key/Model Usage ---
  if (pathname === "/api/key-usage" && req.method === "GET") {
    if (!queryService) {
      sendJson(res, 501, { error: "Per-key usage tracking not available" });
      return true;
    }
    try {
      const windowStart = url.searchParams.get("windowStart");
      const windowEnd = url.searchParams.get("windowEnd");
      const results = await queryService.queryUsage({
        windowStart: windowStart ? Number(windowStart) : 0,
        windowEnd: windowEnd ? Number(windowEnd) : Date.now(),
        keyId: url.searchParams.get("keyId") ?? undefined,
        provider: url.searchParams.get("provider") ?? undefined,
        model: url.searchParams.get("model") ?? undefined,
      });
      sendJson(res, 200, results);
    } catch (err) {
      log.error("Failed to query key usage:", err);
      sendJson(res, 500, { error: "Failed to query key usage" });
    }
    return true;
  }

  if (pathname === "/api/key-usage/active" && req.method === "GET") {
    try {
      const activeKey = storage.providerKeys.getActive();
      sendJson(res, 200, activeKey ? { keyId: activeKey.id, keyLabel: activeKey.label, provider: activeKey.provider, model: activeKey.model, authType: activeKey.authType ?? "api_key" } : null);
    } catch (err) {
      log.error("Failed to get active key:", err);
      sendJson(res, 500, { error: "Failed to get active key" });
    }
    return true;
  }

  if (pathname === "/api/key-usage/timeseries" && req.method === "GET") {
    if (!queryService) {
      sendJson(res, 501, { error: "Per-key usage tracking not available" });
      return true;
    }
    try {
      const windowStart = Number(url.searchParams.get("windowStart")) || 0;
      const windowEnd = Number(url.searchParams.get("windowEnd")) || Date.now();
      const buckets = queryService.queryTimeseries({ windowStart, windowEnd });
      sendJson(res, 200, buckets);
    } catch (err) {
      log.error("Failed to query key usage timeseries:", err);
      sendJson(res, 500, { error: "Failed to query key usage timeseries" });
    }
    return true;
  }

  return false;
};
