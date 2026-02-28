import type { Storage } from "@easyclaw/storage";
import type { KeyModelUsageRecord, KeyModelUsageSummary, KeyUsageDailyBucket, KeyUsageQueryParams } from "@easyclaw/core";

/** Cumulative per-model usage totals (same shape used in snapshot engine). */
export interface ModelUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: string;
}

/**
 * A function that captures current cumulative usage from the live provider.
 * The map key is `"provider/model"` (e.g. `"openai/gpt-4o"`).
 */
export type CaptureUsageFn = () => Promise<Map<string, ModelUsageTotals>>;

/**
 * Mutable accumulator for aggregating token counts and costs
 * across multiple records for a single (keyId, model) pair.
 */
interface UsageAccumulator {
  keyId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number;
}

export class UsageQueryService {
  constructor(
    private storage: Storage,
    private captureUsage: CaptureUsageFn,
  ) {}

  /**
   * Query per-key/model usage for a time window, combining:
   * 1. Historical records with proportional overlap
   * 2. Live delta for currently active keys/models
   */
  async queryUsage(params: KeyUsageQueryParams): Promise<KeyModelUsageSummary[]> {
    const accumulators = new Map<string, UsageAccumulator>();

    // --- 1. Historical records ---
    const records = this.storage.keyUsageHistory.queryByWindow(params);
    for (const record of records) {
      const contribution = this.computeContribution(record, params.windowStart);
      this.addToAccumulator(accumulators, record.keyId, record.provider, record.model, contribution);
    }

    // --- 2. Active key live deltas ---
    await this.addLiveDeltas(accumulators, params);

    // --- 3. Build sorted result ---
    return this.buildSortedResult(accumulators);
  }

  /**
   * Compute the proportional contribution of a historical record
   * relative to the query window start.
   */
  private computeContribution(
    record: KeyModelUsageRecord,
    windowStart: number,
  ): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCostUsd: number } {
    if (record.startTime >= windowStart) {
      // Full contribution — the entire record falls within the window
      return {
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheReadTokens: record.cacheReadTokens,
        cacheWriteTokens: record.cacheWriteTokens,
        totalCostUsd: parseFloat(record.totalCostUsd),
      };
    }

    // Proportional contribution — record started before window
    const duration = record.endTime - record.startTime;
    if (duration <= 0) {
      return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0 };
    }

    const overlap = record.endTime - windowStart;
    const ratio = overlap / duration;

    return {
      inputTokens: Math.round(record.inputTokens * ratio),
      outputTokens: Math.round(record.outputTokens * ratio),
      cacheReadTokens: Math.round(record.cacheReadTokens * ratio),
      cacheWriteTokens: Math.round(record.cacheWriteTokens * ratio),
      totalCostUsd: parseFloat(record.totalCostUsd) * ratio,
    };
  }

  /**
   * Add live deltas for all active (isDefault) provider keys.
   * Computes delta = currentUsage - latestSnapshot, applies proportional
   * overlap if the snapshot predates the window, and merges into accumulators.
   */
  private async addLiveDeltas(
    accumulators: Map<string, UsageAccumulator>,
    params: KeyUsageQueryParams,
  ): Promise<void> {
    const activeKey = this.storage.providerKeys.getActive();
    const activeKeys = activeKey ? [activeKey] : [];

    if (activeKeys.length === 0) return;

    const currentUsage = await this.captureUsage();
    if (currentUsage.size === 0) return;

    const now = Date.now();

    for (const key of activeKeys) {
      // Apply query filters
      if (params.keyId && params.keyId !== key.id) continue;
      if (params.provider && params.provider !== key.provider) continue;

      const mapKey = `${key.provider}/${key.model}`;
      const current = currentUsage.get(mapKey);
      if (!current) continue;

      // Apply model filter
      if (params.model && params.model !== key.model) continue;

      const snapshot = this.storage.usageSnapshots.getLatest(key.id, key.model);

      // Compute delta (current cumulative - last snapshot)
      const deltaInput = Math.max(0, current.inputTokens - (snapshot?.inputTokens ?? 0));
      const deltaOutput = Math.max(0, current.outputTokens - (snapshot?.outputTokens ?? 0));
      const deltaCacheRead = Math.max(0, current.cacheReadTokens - (snapshot?.cacheReadTokens ?? 0));
      const deltaCacheWrite = Math.max(0, current.cacheWriteTokens - (snapshot?.cacheWriteTokens ?? 0));
      const deltaCost = Math.max(0, parseFloat(current.totalCostUsd) - parseFloat(snapshot?.totalCostUsd ?? "0"));

      // Skip if no actual usage since last snapshot
      if (deltaInput === 0 && deltaOutput === 0 && deltaCacheRead === 0 && deltaCacheWrite === 0 && deltaCost === 0) {
        continue;
      }

      // Determine the effective start time of this live delta
      const snapshotTime = snapshot?.snapshotTime ?? 0;

      let contribution: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCostUsd: number };

      if (snapshotTime >= params.windowStart) {
        // Full contribution
        contribution = {
          inputTokens: deltaInput,
          outputTokens: deltaOutput,
          cacheReadTokens: deltaCacheRead,
          cacheWriteTokens: deltaCacheWrite,
          totalCostUsd: deltaCost,
        };
      } else {
        // Proportional contribution
        const totalDuration = now - snapshotTime;
        if (totalDuration <= 0) continue;

        const overlapDuration = now - params.windowStart;
        const ratio = overlapDuration / totalDuration;

        contribution = {
          inputTokens: Math.round(deltaInput * ratio),
          outputTokens: Math.round(deltaOutput * ratio),
          cacheReadTokens: Math.round(deltaCacheRead * ratio),
          cacheWriteTokens: Math.round(deltaCacheWrite * ratio),
          totalCostUsd: deltaCost * ratio,
        };
      }

      this.addToAccumulator(accumulators, key.id, key.provider, key.model, contribution);
    }
  }

  /**
   * Merge a contribution into the accumulator map, keyed by `keyId|model`.
   */
  private addToAccumulator(
    accumulators: Map<string, UsageAccumulator>,
    keyId: string,
    provider: string,
    model: string,
    contribution: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCostUsd: number },
  ): void {
    const key = `${keyId}|${model}`;
    const existing = accumulators.get(key);
    if (existing) {
      existing.inputTokens += contribution.inputTokens;
      existing.outputTokens += contribution.outputTokens;
      existing.cacheReadTokens += contribution.cacheReadTokens;
      existing.cacheWriteTokens += contribution.cacheWriteTokens;
      existing.totalCostUsd += contribution.totalCostUsd;
    } else {
      accumulators.set(key, {
        keyId,
        provider,
        model,
        inputTokens: contribution.inputTokens,
        outputTokens: contribution.outputTokens,
        cacheReadTokens: contribution.cacheReadTokens,
        cacheWriteTokens: contribution.cacheWriteTokens,
        totalCostUsd: contribution.totalCostUsd,
      });
    }
  }

  /**
   * Convert accumulators to sorted KeyModelUsageSummary[], enriched with key labels.
   * Sorted by totalCostUsd descending.
   */
  private buildSortedResult(accumulators: Map<string, UsageAccumulator>): KeyModelUsageSummary[] {
    const results: KeyModelUsageSummary[] = [];

    for (const acc of accumulators.values()) {
      const keyEntry = this.storage.providerKeys.getById(acc.keyId);
      results.push({
        keyId: acc.keyId,
        keyLabel: keyEntry?.label ?? "Unknown",
        provider: acc.provider,
        model: acc.model,
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
        cacheReadTokens: acc.cacheReadTokens,
        cacheWriteTokens: acc.cacheWriteTokens,
        totalCostUsd: acc.totalCostUsd.toFixed(6),
        authType: keyEntry?.authType ?? "api_key",
      });
    }

    // Sort by cost descending
    results.sort((a, b) => parseFloat(b.totalCostUsd) - parseFloat(a.totalCostUsd));

    return results;
  }

  /**
   * Query daily-bucketed time-series data for charts.
   * Enriches with key labels from the provider keys repo.
   */
  queryTimeseries(params: KeyUsageQueryParams): KeyUsageDailyBucket[] {
    const rawBuckets = this.storage.keyUsageHistory.queryByDay(params);
    return rawBuckets.map((b) => {
      const keyEntry = this.storage.providerKeys.getById(b.keyId);
      return { ...b, keyLabel: keyEntry?.label ?? "Unknown" };
    });
  }
}
