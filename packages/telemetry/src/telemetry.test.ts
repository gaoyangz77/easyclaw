import { describe, it, expect, beforeEach } from "vitest";
import { estimateCost } from "./cost.js";
import { InMemoryUsageStore } from "./store.js";
import { UsageCollector } from "./collector.js";
import type { UsageRecord, UsageSummary } from "./types.js";

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------
describe("estimateCost", () => {
  it("returns correct cost for claude-sonnet-4-5-20250929", () => {
    // 1000 input, 1000 output => (1 * 0.003) + (1 * 0.015) = 0.018
    expect(estimateCost("claude-sonnet-4-5-20250929", 1000, 1000)).toBeCloseTo(
      0.018,
      6,
    );
  });

  it("returns correct cost for claude-opus-4-6", () => {
    // 2000 input, 500 output => (2 * 0.015) + (0.5 * 0.075) = 0.03 + 0.0375 = 0.0675
    expect(estimateCost("claude-opus-4-6", 2000, 500)).toBeCloseTo(0.0675, 6);
  });

  it("returns correct cost for gpt-4o", () => {
    // 1000 input, 1000 output => (1 * 0.0025) + (1 * 0.01) = 0.0125
    expect(estimateCost("gpt-4o", 1000, 1000)).toBeCloseTo(0.0125, 6);
  });

  it("returns correct cost for gpt-4o-mini", () => {
    // 10000 input, 5000 output => (10 * 0.00015) + (5 * 0.0006) = 0.0015 + 0.003 = 0.0045
    expect(estimateCost("gpt-4o-mini", 10000, 5000)).toBeCloseTo(0.0045, 6);
  });

  it("returns correct cost for deepseek-chat", () => {
    // 1000 input, 1000 output => (1 * 0.00014) + (1 * 0.00028) = 0.00042
    expect(estimateCost("deepseek-chat", 1000, 1000)).toBeCloseTo(0.00042, 6);
  });

  it("returns default cost for unknown model", () => {
    // Default: input=0.002, output=0.008
    // 1000 input, 1000 output => (1 * 0.002) + (1 * 0.008) = 0.01
    expect(estimateCost("unknown-model-xyz", 1000, 1000)).toBeCloseTo(0.01, 6);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCost("claude-sonnet-4-5-20250929", 0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// InMemoryUsageStore
// ---------------------------------------------------------------------------
describe("InMemoryUsageStore", () => {
  let store: InMemoryUsageStore;

  beforeEach(() => {
    store = new InMemoryUsageStore();
  });

  it("starts empty", () => {
    expect(store.getAll()).toEqual([]);
  });

  it("inserts and retrieves a record", () => {
    const record: UsageRecord = {
      id: "r1",
      timestamp: "2025-06-01T10:00:00.000Z",
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      estimatedCostUsd: 0.01,
    };
    store.insert(record);
    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(record);
  });

  it("filters by date range (since)", () => {
    store.insert(makeRecord({ id: "r1", timestamp: "2025-01-01T00:00:00Z" }));
    store.insert(makeRecord({ id: "r2", timestamp: "2025-06-15T00:00:00Z" }));
    store.insert(makeRecord({ id: "r3", timestamp: "2025-12-01T00:00:00Z" }));

    const results = store.getAll({ since: "2025-06-01T00:00:00Z" });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual(["r2", "r3"]);
  });

  it("filters by date range (until)", () => {
    store.insert(makeRecord({ id: "r1", timestamp: "2025-01-01T00:00:00Z" }));
    store.insert(makeRecord({ id: "r2", timestamp: "2025-06-15T00:00:00Z" }));
    store.insert(makeRecord({ id: "r3", timestamp: "2025-12-01T00:00:00Z" }));

    const results = store.getAll({ until: "2025-06-30T00:00:00Z" });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("filters by model", () => {
    store.insert(makeRecord({ id: "r1", model: "gpt-4o" }));
    store.insert(makeRecord({ id: "r2", model: "claude-opus-4-6" }));
    store.insert(makeRecord({ id: "r3", model: "gpt-4o" }));

    const results = store.getAll({ model: "gpt-4o" });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.model === "gpt-4o")).toBe(true);
  });

  it("filters by provider", () => {
    store.insert(makeRecord({ id: "r1", provider: "openai" }));
    store.insert(makeRecord({ id: "r2", provider: "anthropic" }));
    store.insert(makeRecord({ id: "r3", provider: "openai" }));

    const results = store.getAll({ provider: "anthropic" });
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("anthropic");
  });

  it("applies limit", () => {
    store.insert(
      makeRecord({ id: "r1", timestamp: "2025-01-01T00:00:00Z" }),
    );
    store.insert(
      makeRecord({ id: "r2", timestamp: "2025-06-01T00:00:00Z" }),
    );
    store.insert(
      makeRecord({ id: "r3", timestamp: "2025-12-01T00:00:00Z" }),
    );

    const results = store.getAll({ limit: 2 });
    expect(results).toHaveLength(2);
    // Should be sorted descending by timestamp, so r3 first
    expect(results[0].id).toBe("r3");
    expect(results[1].id).toBe("r2");
  });

  it("combines multiple filters", () => {
    store.insert(
      makeRecord({
        id: "r1",
        model: "gpt-4o",
        provider: "openai",
        timestamp: "2025-01-01T00:00:00Z",
      }),
    );
    store.insert(
      makeRecord({
        id: "r2",
        model: "gpt-4o",
        provider: "openai",
        timestamp: "2025-07-01T00:00:00Z",
      }),
    );
    store.insert(
      makeRecord({
        id: "r3",
        model: "claude-opus-4-6",
        provider: "anthropic",
        timestamp: "2025-07-15T00:00:00Z",
      }),
    );

    const results = store.getAll({
      model: "gpt-4o",
      since: "2025-06-01T00:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("r2");
  });
});

// ---------------------------------------------------------------------------
// UsageCollector
// ---------------------------------------------------------------------------
describe("UsageCollector", () => {
  let store: InMemoryUsageStore;
  let collector: UsageCollector;

  beforeEach(() => {
    store = new InMemoryUsageStore();
    collector = new UsageCollector(store);
  });

  it("record() creates a complete record with auto-generated id, timestamp, and cost", () => {
    const record = collector.record({
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    expect(record.id).toBeDefined();
    expect(record.id.length).toBeGreaterThan(0);
    expect(record.timestamp).toBeDefined();
    // Verify timestamp is valid ISO 8601
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
    expect(record.estimatedCostUsd).toBeGreaterThan(0);
    expect(record.model).toBe("claude-sonnet-4-5-20250929");
    expect(record.provider).toBe("anthropic");
    expect(record.inputTokens).toBe(1000);
    expect(record.outputTokens).toBe(500);
    expect(record.totalTokens).toBe(1500);
  });

  it("record() generates unique IDs for each record", () => {
    const r1 = collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    });
    const r2 = collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    });

    expect(r1.id).not.toBe(r2.id);
  });

  it("record() preserves optional sessionId", () => {
    const record = collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      sessionId: "session-123",
    });

    expect(record.sessionId).toBe("session-123");
  });

  it("query() delegates to store with filters", () => {
    collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    });
    collector.record({
      model: "claude-opus-4-6",
      provider: "anthropic",
      inputTokens: 500,
      outputTokens: 1000,
      totalTokens: 1500,
    });

    const all = collector.query();
    expect(all).toHaveLength(2);

    const filtered = collector.query({ model: "gpt-4o" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].model).toBe("gpt-4o");
  });

  it("summarize() returns correct totals for empty store", () => {
    const summary = collector.summarize();
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalEstimatedCostUsd).toBe(0);
    expect(summary.recordCount).toBe(0);
    expect(Object.keys(summary.byModel)).toHaveLength(0);
    expect(Object.keys(summary.byProvider)).toHaveLength(0);
  });

  it("summarize() aggregates a single record correctly", () => {
    collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 1000,
      outputTokens: 2000,
      totalTokens: 3000,
    });

    const summary = collector.summarize();
    expect(summary.totalInputTokens).toBe(1000);
    expect(summary.totalOutputTokens).toBe(2000);
    expect(summary.totalTokens).toBe(3000);
    expect(summary.recordCount).toBe(1);
    expect(summary.totalEstimatedCostUsd).toBeGreaterThan(0);

    // byModel
    expect(Object.keys(summary.byModel)).toEqual(["gpt-4o"]);
    expect(summary.byModel["gpt-4o"].count).toBe(1);
    expect(summary.byModel["gpt-4o"].inputTokens).toBe(1000);

    // byProvider
    expect(Object.keys(summary.byProvider)).toEqual(["openai"]);
    expect(summary.byProvider["openai"].count).toBe(1);
  });

  it("summarize() aggregates multiple models and providers correctly", () => {
    collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    collector.record({
      model: "gpt-4o-mini",
      provider: "openai",
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
    });
    collector.record({
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      inputTokens: 800,
      outputTokens: 400,
      totalTokens: 1200,
    });

    const summary = collector.summarize();

    expect(summary.totalInputTokens).toBe(3800);
    expect(summary.totalOutputTokens).toBe(1900);
    expect(summary.totalTokens).toBe(5700);
    expect(summary.recordCount).toBe(3);

    // byModel should have 3 entries
    expect(Object.keys(summary.byModel).sort()).toEqual([
      "claude-sonnet-4-5-20250929",
      "gpt-4o",
      "gpt-4o-mini",
    ]);
    expect(summary.byModel["gpt-4o"].count).toBe(1);
    expect(summary.byModel["gpt-4o-mini"].count).toBe(1);
    expect(summary.byModel["claude-sonnet-4-5-20250929"].count).toBe(1);

    // byProvider should have 2 entries
    expect(Object.keys(summary.byProvider).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
    expect(summary.byProvider["openai"].count).toBe(2);
    expect(summary.byProvider["openai"].inputTokens).toBe(3000);
    expect(summary.byProvider["anthropic"].count).toBe(1);
    expect(summary.byProvider["anthropic"].inputTokens).toBe(800);
  });

  it("summarize() respects filters", () => {
    collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    collector.record({
      model: "claude-opus-4-6",
      provider: "anthropic",
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
    });

    const summary = collector.summarize({ provider: "anthropic" });
    expect(summary.recordCount).toBe(1);
    expect(summary.totalInputTokens).toBe(2000);
    expect(summary.totalOutputTokens).toBe(1000);
    expect(Object.keys(summary.byModel)).toEqual(["claude-opus-4-6"]);
    expect(Object.keys(summary.byProvider)).toEqual(["anthropic"]);
  });

  it("summarize() cost totals match sum of individual record costs", () => {
    const r1 = collector.record({
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 5000,
      outputTokens: 2000,
      totalTokens: 7000,
    });
    const r2 = collector.record({
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      inputTokens: 3000,
      outputTokens: 1000,
      totalTokens: 4000,
    });

    const summary = collector.summarize();
    const expectedTotal =
      Math.round((r1.estimatedCostUsd + r2.estimatedCostUsd) * 1_000_000) /
      1_000_000;
    expect(summary.totalEstimatedCostUsd).toBeCloseTo(expectedTotal, 6);
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeRecord(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    id: "test-id",
    timestamp: "2025-06-01T00:00:00Z",
    model: "gpt-4o",
    provider: "openai",
    inputTokens: 100,
    outputTokens: 200,
    totalTokens: 300,
    estimatedCostUsd: 0.01,
    ...overrides,
  };
}
