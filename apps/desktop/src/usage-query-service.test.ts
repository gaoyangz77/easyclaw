import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStorage, type Storage } from "@easyclaw/storage";
import { UsageQueryService, type CaptureUsageFn, type ModelUsageTotals } from "./usage-query-service.js";

let storage: Storage;

beforeEach(() => {
  storage = createStorage(":memory:");
});

afterEach(() => {
  storage.close();
});

/** Helper: create a provider key in storage. */
function createKey(opts: {
  id: string;
  provider: string;
  label: string;
  model: string;
  isDefault: boolean;
}) {
  storage.providerKeys.create({
    id: opts.id,
    provider: opts.provider,
    label: opts.label,
    model: opts.model,
    isDefault: opts.isDefault,
    createdAt: "",
    updatedAt: "",
  });
}

/** Helper: insert a historical usage record. */
function insertRecord(opts: {
  keyId: string;
  provider: string;
  model: string;
  startTime: number;
  endTime: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCostUsd: string;
}) {
  storage.keyUsageHistory.insert({
    keyId: opts.keyId,
    provider: opts.provider,
    model: opts.model,
    startTime: opts.startTime,
    endTime: opts.endTime,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    cacheReadTokens: opts.cacheReadTokens ?? 0,
    cacheWriteTokens: opts.cacheWriteTokens ?? 0,
    totalCostUsd: opts.totalCostUsd,
  });
}

/** Helper: a captureUsage mock that returns an empty map. */
const emptyCapture: CaptureUsageFn = async () => new Map();

describe("UsageQueryService", () => {
  // -------------------------------------------------------
  // 1. Empty state
  // -------------------------------------------------------
  describe("empty state", () => {
    it("returns empty array when no records exist", async () => {
      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 0,
        windowEnd: 10000,
      });
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------
  // 2. Full contribution
  // -------------------------------------------------------
  describe("full contribution", () => {
    it("returns full tokens when record startTime >= windowStart", async () => {
      createKey({ id: "key-1", provider: "openai", label: "My OpenAI Key", model: "gpt-4o", isDefault: false });

      insertRecord({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        startTime: 1000,
        endTime: 3000,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        totalCostUsd: "0.100000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].keyId).toBe("key-1");
      expect(results[0].keyLabel).toBe("My OpenAI Key");
      expect(results[0].provider).toBe("openai");
      expect(results[0].model).toBe("gpt-4o");
      expect(results[0].inputTokens).toBe(1000);
      expect(results[0].outputTokens).toBe(500);
      expect(results[0].cacheReadTokens).toBe(100);
      expect(results[0].cacheWriteTokens).toBe(50);
      expect(results[0].totalCostUsd).toBe("0.100000");
    });
  });

  // -------------------------------------------------------
  // 3. Proportional overlap
  // -------------------------------------------------------
  describe("proportional overlap", () => {
    it("applies proportional ratio when record startTime < windowStart", async () => {
      createKey({ id: "key-1", provider: "openai", label: "OpenAI", model: "gpt-4o", isDefault: false });

      // Record spans [1000, 3000], window starts at 2000
      // ratio = (3000 - 2000) / (3000 - 1000) = 0.5
      insertRecord({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        startTime: 1000,
        endTime: 3000,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        totalCostUsd: "0.100000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 2000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(500);   // 1000 * 0.5
      expect(results[0].outputTokens).toBe(250);   // 500 * 0.5
      expect(results[0].cacheReadTokens).toBe(100); // 200 * 0.5
      expect(results[0].cacheWriteTokens).toBe(50); // 100 * 0.5
      expect(results[0].totalCostUsd).toBe("0.050000"); // 0.1 * 0.5
    });

    it("handles non-even proportional ratio correctly", async () => {
      createKey({ id: "key-1", provider: "openai", label: "OpenAI", model: "gpt-4o", isDefault: false });

      // Record spans [0, 3000], window starts at 1000
      // ratio = (3000 - 1000) / (3000 - 0) = 2000/3000 = 2/3
      insertRecord({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        startTime: 0,
        endTime: 3000,
        inputTokens: 900,
        outputTokens: 300,
        totalCostUsd: "0.090000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(600);   // Math.round(900 * 2/3) = 600
      expect(results[0].outputTokens).toBe(200);   // Math.round(300 * 2/3) = 200
      expect(parseFloat(results[0].totalCostUsd)).toBeCloseTo(0.06, 5); // 0.09 * 2/3
    });
  });

  // -------------------------------------------------------
  // 4. Multiple records same key/model
  // -------------------------------------------------------
  describe("multiple records same key/model", () => {
    it("correctly sums multiple records for the same key/model", async () => {
      createKey({ id: "key-1", provider: "openai", label: "OpenAI", model: "gpt-4o", isDefault: false });

      insertRecord({
        keyId: "key-1", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 100, outputTokens: 50,
        totalCostUsd: "0.010000",
      });
      insertRecord({
        keyId: "key-1", provider: "openai", model: "gpt-4o",
        startTime: 2000, endTime: 3000,
        inputTokens: 200, outputTokens: 100,
        totalCostUsd: "0.020000",
      });
      insertRecord({
        keyId: "key-1", provider: "openai", model: "gpt-4o",
        startTime: 3000, endTime: 4000,
        inputTokens: 300, outputTokens: 150,
        totalCostUsd: "0.030000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(600);   // 100 + 200 + 300
      expect(results[0].outputTokens).toBe(300);   // 50 + 100 + 150
      expect(results[0].totalCostUsd).toBe("0.060000"); // 0.01 + 0.02 + 0.03
    });
  });

  // -------------------------------------------------------
  // 5. Multiple keys
  // -------------------------------------------------------
  describe("multiple keys", () => {
    it("returns separate summaries for different keys", async () => {
      createKey({ id: "key-A", provider: "openai", label: "Key A", model: "gpt-4o", isDefault: false });
      createKey({ id: "key-B", provider: "anthropic", label: "Key B", model: "claude-sonnet-4-5-20250929", isDefault: false });

      insertRecord({
        keyId: "key-A", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 500, outputTokens: 200,
        totalCostUsd: "0.050000",
      });
      insertRecord({
        keyId: "key-B", provider: "anthropic", model: "claude-sonnet-4-5-20250929",
        startTime: 1000, endTime: 2000,
        inputTokens: 800, outputTokens: 400,
        totalCostUsd: "0.120000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(2);

      // Sorted by cost descending: key-B ($0.12) first, then key-A ($0.05)
      expect(results[0].keyId).toBe("key-B");
      expect(results[0].inputTokens).toBe(800);
      expect(results[0].totalCostUsd).toBe("0.120000");

      expect(results[1].keyId).toBe("key-A");
      expect(results[1].inputTokens).toBe(500);
      expect(results[1].totalCostUsd).toBe("0.050000");
    });
  });

  // -------------------------------------------------------
  // 6. Filter by keyId
  // -------------------------------------------------------
  describe("filter by keyId", () => {
    it("only returns matching key's records", async () => {
      createKey({ id: "key-A", provider: "openai", label: "Key A", model: "gpt-4o", isDefault: false });
      createKey({ id: "key-B", provider: "openai", label: "Key B", model: "gpt-4o", isDefault: false });

      insertRecord({
        keyId: "key-A", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 500, outputTokens: 200,
        totalCostUsd: "0.050000",
      });
      insertRecord({
        keyId: "key-B", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 800, outputTokens: 400,
        totalCostUsd: "0.080000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        keyId: "key-A",
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].keyId).toBe("key-A");
      expect(results[0].inputTokens).toBe(500);
    });
  });

  // -------------------------------------------------------
  // 7. Filter by provider
  // -------------------------------------------------------
  describe("filter by provider", () => {
    it("only returns matching provider's records", async () => {
      createKey({ id: "key-A", provider: "openai", label: "Key A", model: "gpt-4o", isDefault: false });
      createKey({ id: "key-B", provider: "anthropic", label: "Key B", model: "claude-sonnet-4-5-20250929", isDefault: false });

      insertRecord({
        keyId: "key-A", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 500, outputTokens: 200,
        totalCostUsd: "0.050000",
      });
      insertRecord({
        keyId: "key-B", provider: "anthropic", model: "claude-sonnet-4-5-20250929",
        startTime: 1000, endTime: 2000,
        inputTokens: 800, outputTokens: 400,
        totalCostUsd: "0.080000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        provider: "anthropic",
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].keyId).toBe("key-B");
      expect(results[0].provider).toBe("anthropic");
    });
  });

  // -------------------------------------------------------
  // 8. Filter by model
  // -------------------------------------------------------
  describe("filter by model", () => {
    it("only returns matching model's records", async () => {
      createKey({ id: "key-A", provider: "openai", label: "Key A", model: "gpt-4o", isDefault: false });
      createKey({ id: "key-B", provider: "openai", label: "Key B", model: "gpt-4o-mini", isDefault: false });

      insertRecord({
        keyId: "key-A", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 500, outputTokens: 200,
        totalCostUsd: "0.050000",
      });
      insertRecord({
        keyId: "key-B", provider: "openai", model: "gpt-4o-mini",
        startTime: 1000, endTime: 2000,
        inputTokens: 800, outputTokens: 400,
        totalCostUsd: "0.080000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        model: "gpt-4o-mini",
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].keyId).toBe("key-B");
      expect(results[0].model).toBe("gpt-4o-mini");
    });
  });

  // -------------------------------------------------------
  // 9. Active key live delta
  // -------------------------------------------------------
  describe("active key live delta", () => {
    it("includes live delta for active key with snapshot", async () => {
      createKey({ id: "key-1", provider: "openai", label: "Active Key", model: "gpt-4o", isDefault: true });

      // Insert a snapshot representing the last known cumulative usage
      storage.usageSnapshots.insert({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        totalCostUsd: "0.100000",
        snapshotTime: 2000,
      });

      // Mock captureUsage returning higher cumulative values
      const mockCapture: CaptureUsageFn = async () => {
        const map = new Map<string, ModelUsageTotals>();
        map.set("openai/gpt-4o", {
          inputTokens: 1500,
          outputTokens: 700,
          cacheReadTokens: 150,
          cacheWriteTokens: 80,
          totalCostUsd: "0.160000",
        });
        return map;
      };

      const service = new UsageQueryService(storage, mockCapture);
      const results = await service.queryUsage({
        windowStart: 2000,
        windowEnd: 10000,
      });

      expect(results).toHaveLength(1);
      // Delta: 1500-1000=500, 700-500=200, 150-100=50, 80-50=30, 0.16-0.10=0.06
      // snapshotTime (2000) >= windowStart (2000), so full contribution
      expect(results[0].keyId).toBe("key-1");
      expect(results[0].keyLabel).toBe("Active Key");
      expect(results[0].inputTokens).toBe(500);
      expect(results[0].outputTokens).toBe(200);
      expect(results[0].cacheReadTokens).toBe(50);
      expect(results[0].cacheWriteTokens).toBe(30);
      expect(parseFloat(results[0].totalCostUsd)).toBeCloseTo(0.06, 5);
    });

    it("skips live delta when delta is zero", async () => {
      createKey({ id: "key-1", provider: "openai", label: "Active Key", model: "gpt-4o", isDefault: true });

      storage.usageSnapshots.insert({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        totalCostUsd: "0.100000",
        snapshotTime: 2000,
      });

      // captureUsage returns same values as snapshot = zero delta
      const mockCapture: CaptureUsageFn = async () => {
        const map = new Map<string, ModelUsageTotals>();
        map.set("openai/gpt-4o", {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
          totalCostUsd: "0.100000",
        });
        return map;
      };

      const service = new UsageQueryService(storage, mockCapture);
      const results = await service.queryUsage({
        windowStart: 2000,
        windowEnd: 10000,
      });

      expect(results).toEqual([]);
    });

    it("combines historical records with live delta", async () => {
      createKey({ id: "key-1", provider: "openai", label: "Active Key", model: "gpt-4o", isDefault: true });

      // Historical record
      insertRecord({
        keyId: "key-1", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 300, outputTokens: 100,
        totalCostUsd: "0.030000",
      });

      // Snapshot at time 2000
      storage.usageSnapshots.insert({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: "0.050000",
        snapshotTime: 2000,
      });

      // Current usage is higher
      const mockCapture: CaptureUsageFn = async () => {
        const map = new Map<string, ModelUsageTotals>();
        map.set("openai/gpt-4o", {
          inputTokens: 700,
          outputTokens: 350,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: "0.080000",
        });
        return map;
      };

      const service = new UsageQueryService(storage, mockCapture);
      const results = await service.queryUsage({
        windowStart: 1000,
        windowEnd: 10000,
      });

      expect(results).toHaveLength(1);
      // Historical: 300 input, 100 output, $0.03
      // Live delta: 700-500=200 input, 350-200=150 output, 0.08-0.05=$0.03
      // snapshotTime (2000) >= windowStart (1000), full contribution
      // Total: 500 input, 250 output, $0.06
      expect(results[0].inputTokens).toBe(500);
      expect(results[0].outputTokens).toBe(250);
      expect(parseFloat(results[0].totalCostUsd)).toBeCloseTo(0.06, 5);
    });
  });

  // -------------------------------------------------------
  // 10. Active key proportional
  // -------------------------------------------------------
  describe("active key proportional", () => {
    it("applies proportional ratio when snapshot time is before window start", async () => {
      createKey({ id: "key-1", provider: "openai", label: "Active Key", model: "gpt-4o", isDefault: true });

      // Snapshot at time 1000 (before window start of 3000)
      storage.usageSnapshots.insert({
        keyId: "key-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: "0.100000",
        snapshotTime: 1000,
      });

      // Current cumulative usage is higher
      const mockCapture: CaptureUsageFn = async () => {
        const map = new Map<string, ModelUsageTotals>();
        map.set("openai/gpt-4o", {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: "0.200000",
        });
        return map;
      };

      // We need to control "now" for deterministic testing.
      // The ratio is (now - windowStart) / (now - snapshotTime).
      // We'll mock Date.now to return 5000.
      // ratio = (5000 - 3000) / (5000 - 1000) = 2000 / 4000 = 0.5
      const originalDateNow = Date.now;
      Date.now = () => 5000;

      try {
        const service = new UsageQueryService(storage, mockCapture);
        const results = await service.queryUsage({
          windowStart: 3000,
          windowEnd: 6000,
        });

        expect(results).toHaveLength(1);
        // Delta: 2000-1000=1000 input, 1000-500=500 output, 0.20-0.10=0.10 cost
        // Proportional (ratio 0.5): 500 input, 250 output, $0.05
        expect(results[0].inputTokens).toBe(500);
        expect(results[0].outputTokens).toBe(250);
        expect(parseFloat(results[0].totalCostUsd)).toBeCloseTo(0.05, 5);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  // -------------------------------------------------------
  // 11. Sorted by cost
  // -------------------------------------------------------
  describe("sorted by cost descending", () => {
    it("returns results sorted by totalCostUsd descending", async () => {
      createKey({ id: "key-A", provider: "openai", label: "Cheap Key", model: "gpt-4o-mini", isDefault: false });
      createKey({ id: "key-B", provider: "openai", label: "Medium Key", model: "gpt-4o", isDefault: false });
      createKey({ id: "key-C", provider: "anthropic", label: "Expensive Key", model: "claude-sonnet-4-5-20250929", isDefault: false });

      insertRecord({
        keyId: "key-A", provider: "openai", model: "gpt-4o-mini",
        startTime: 1000, endTime: 2000,
        inputTokens: 100, outputTokens: 50,
        totalCostUsd: "0.010000",
      });
      insertRecord({
        keyId: "key-B", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 500, outputTokens: 250,
        totalCostUsd: "0.050000",
      });
      insertRecord({
        keyId: "key-C", provider: "anthropic", model: "claude-sonnet-4-5-20250929",
        startTime: 1000, endTime: 2000,
        inputTokens: 1000, outputTokens: 500,
        totalCostUsd: "0.200000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(3);
      expect(results[0].keyId).toBe("key-C");
      expect(results[0].totalCostUsd).toBe("0.200000");
      expect(results[1].keyId).toBe("key-B");
      expect(results[1].totalCostUsd).toBe("0.050000");
      expect(results[2].keyId).toBe("key-A");
      expect(results[2].totalCostUsd).toBe("0.010000");
    });
  });

  // -------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------
  describe("edge cases", () => {
    it("uses 'Unknown' label when key is not found in providerKeys", async () => {
      // Insert record for a key that does not exist in providerKeys
      insertRecord({
        keyId: "deleted-key", provider: "openai", model: "gpt-4o",
        startTime: 1000, endTime: 2000,
        inputTokens: 100, outputTokens: 50,
        totalCostUsd: "0.010000",
      });

      const service = new UsageQueryService(storage, emptyCapture);
      const results = await service.queryUsage({
        windowStart: 1000,
        windowEnd: 5000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].keyLabel).toBe("Unknown");
    });

    it("handles active key with no prior snapshot (treats snapshot as zero)", async () => {
      createKey({ id: "key-1", provider: "openai", label: "Fresh Key", model: "gpt-4o", isDefault: true });

      // No snapshot inserted — first time usage
      const mockCapture: CaptureUsageFn = async () => {
        const map = new Map<string, ModelUsageTotals>();
        map.set("openai/gpt-4o", {
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: "0.020000",
        });
        return map;
      };

      // No snapshot => snapshotTime = 0, which is < windowStart = 1000
      // ratio = (now - 1000) / (now - 0)
      // Mock now = 2000: ratio = (2000-1000)/(2000-0) = 0.5
      const originalDateNow = Date.now;
      Date.now = () => 2000;

      try {
        const service = new UsageQueryService(storage, mockCapture);
        const results = await service.queryUsage({
          windowStart: 1000,
          windowEnd: 5000,
        });

        expect(results).toHaveLength(1);
        // Delta = current - 0 = 200, 100, 0.02
        // Proportional: ratio = 0.5 => 100, 50, 0.01
        expect(results[0].inputTokens).toBe(100);
        expect(results[0].outputTokens).toBe(50);
        expect(parseFloat(results[0].totalCostUsd)).toBeCloseTo(0.01, 5);
      } finally {
        Date.now = originalDateNow;
      }
    });

    it("filters live delta by keyId", async () => {
      createKey({ id: "key-1", provider: "openai", label: "Key 1", model: "gpt-4o", isDefault: true });
      createKey({ id: "key-2", provider: "anthropic", label: "Key 2", model: "claude-sonnet-4-5-20250929", isDefault: false });

      storage.usageSnapshots.insert({
        keyId: "key-1", provider: "openai", model: "gpt-4o",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        totalCostUsd: "0.000000", snapshotTime: 1000,
      });
      storage.usageSnapshots.insert({
        keyId: "key-2", provider: "anthropic", model: "claude-sonnet-4-5-20250929",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        totalCostUsd: "0.000000", snapshotTime: 1000,
      });

      const mockCapture: CaptureUsageFn = async () => {
        const map = new Map<string, ModelUsageTotals>();
        map.set("openai/gpt-4o", {
          inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0,
          totalCostUsd: "0.010000",
        });
        map.set("anthropic/claude-sonnet-4-5-20250929", {
          inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
          totalCostUsd: "0.020000",
        });
        return map;
      };

      const service = new UsageQueryService(storage, mockCapture);
      const results = await service.queryUsage({
        keyId: "key-1",
        windowStart: 1000,
        windowEnd: 10000,
      });

      expect(results).toHaveLength(1);
      expect(results[0].keyId).toBe("key-1");
    });

    it("filters live delta by model", async () => {
      createKey({ id: "key-1", provider: "openai", label: "Key 1", model: "gpt-4o", isDefault: true });

      storage.usageSnapshots.insert({
        keyId: "key-1", provider: "openai", model: "gpt-4o",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        totalCostUsd: "0.000000", snapshotTime: 1000,
      });

      const mockCapture: CaptureUsageFn = async () => {
        const map = new Map<string, ModelUsageTotals>();
        map.set("openai/gpt-4o", {
          inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0,
          totalCostUsd: "0.010000",
        });
        return map;
      };

      const service = new UsageQueryService(storage, mockCapture);
      const results = await service.queryUsage({
        model: "gpt-4o-mini",  // does not match key-1's model
        windowStart: 1000,
        windowEnd: 10000,
      });

      expect(results).toEqual([]);
    });
  });
});
