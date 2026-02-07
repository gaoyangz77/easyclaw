import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { UsageRecord, UsageSummary, UsageFilter } from "./types.js";
import type { UsageStore } from "./store.js";
import { estimateCost } from "./cost.js";

const log = createLogger("telemetry");

export class UsageCollector {
  constructor(private store: UsageStore) {}

  /** Record a new usage entry. Returns the complete record with generated id, timestamp, and cost. */
  record(
    entry: Omit<UsageRecord, "id" | "timestamp" | "estimatedCostUsd">,
  ): UsageRecord {
    const record: UsageRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      model: entry.model,
      provider: entry.provider,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.totalTokens,
      estimatedCostUsd: estimateCost(
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
      ),
      sessionId: entry.sessionId,
    };

    this.store.insert(record);
    log.debug(
      `Recorded usage: ${record.model} (${record.totalTokens} tokens, $${record.estimatedCostUsd})`,
    );

    return record;
  }

  /** Get usage records with optional filtering. */
  query(filter?: UsageFilter): UsageRecord[] {
    return this.store.getAll(filter);
  }

  /** Get aggregated usage summary. */
  summarize(filter?: UsageFilter): UsageSummary {
    const records = this.store.getAll(filter);

    const summary: UsageSummary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalEstimatedCostUsd: 0,
      recordCount: records.length,
      byModel: {},
      byProvider: {},
    };

    for (const record of records) {
      summary.totalInputTokens += record.inputTokens;
      summary.totalOutputTokens += record.outputTokens;
      summary.totalTokens += record.totalTokens;
      summary.totalEstimatedCostUsd += record.estimatedCostUsd;

      // Aggregate by model
      if (!summary.byModel[record.model]) {
        summary.byModel[record.model] = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          count: 0,
        };
      }
      const modelEntry = summary.byModel[record.model];
      modelEntry.inputTokens += record.inputTokens;
      modelEntry.outputTokens += record.outputTokens;
      modelEntry.totalTokens += record.totalTokens;
      modelEntry.estimatedCostUsd += record.estimatedCostUsd;
      modelEntry.count += 1;

      // Aggregate by provider
      if (!summary.byProvider[record.provider]) {
        summary.byProvider[record.provider] = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          count: 0,
        };
      }
      const providerEntry = summary.byProvider[record.provider];
      providerEntry.inputTokens += record.inputTokens;
      providerEntry.outputTokens += record.outputTokens;
      providerEntry.totalTokens += record.totalTokens;
      providerEntry.estimatedCostUsd += record.estimatedCostUsd;
      providerEntry.count += 1;
    }

    // Round the total cost to avoid floating-point drift
    summary.totalEstimatedCostUsd =
      Math.round(summary.totalEstimatedCostUsd * 1_000_000) / 1_000_000;

    return summary;
  }
}
