import type { UsageRecord, UsageFilter } from "./types.js";

export interface UsageStore {
  insert(record: UsageRecord): void;
  getAll(filter?: UsageFilter): UsageRecord[];
}

export class InMemoryUsageStore implements UsageStore {
  private records: UsageRecord[] = [];

  insert(record: UsageRecord): void {
    this.records.push(record);
  }

  getAll(filter?: UsageFilter): UsageRecord[] {
    let results = [...this.records];

    if (filter?.since) {
      const since = filter.since;
      results = results.filter((r) => r.timestamp >= since);
    }

    if (filter?.until) {
      const until = filter.until;
      results = results.filter((r) => r.timestamp <= until);
    }

    if (filter?.model) {
      const model = filter.model;
      results = results.filter((r) => r.model === model);
    }

    if (filter?.provider) {
      const provider = filter.provider;
      results = results.filter((r) => r.provider === provider);
    }

    // Sort by timestamp descending (most recent first)
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }
}
