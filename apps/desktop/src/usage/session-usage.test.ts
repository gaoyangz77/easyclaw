import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverAllSessions,
  loadSessionCostSummary,
  loadCostUsageSummary,
} from "./session-usage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let sessionsDir: string;

function jsonlLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

function makeEntry(opts: {
  role: string;
  provider?: string;
  model?: string;
  content?: string;
  timestamp?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost?: { total: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}): string {
  const usage: Record<string, unknown> = {};
  if (opts.input_tokens !== undefined) usage.input_tokens = opts.input_tokens;
  if (opts.output_tokens !== undefined) usage.output_tokens = opts.output_tokens;
  if (opts.cache_read_input_tokens !== undefined) usage.cache_read_input_tokens = opts.cache_read_input_tokens;
  if (opts.cache_creation_input_tokens !== undefined) usage.cache_creation_input_tokens = opts.cache_creation_input_tokens;
  if (opts.cost) usage.cost = opts.cost;

  return jsonlLine({
    timestamp: opts.timestamp ?? "2026-03-15T10:00:00Z",
    message: {
      role: opts.role,
      content: opts.content ?? "hello",
      provider: opts.provider,
      model: opts.model,
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    },
  });
}

async function writeSession(name: string, lines: string[]): Promise<string> {
  const filePath = join(sessionsDir, `${name}.jsonl`);
  await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
  return filePath;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "session-usage-test-"));
  sessionsDir = join(tempDir, "agents", "main", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.OPENCLAW_STATE_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// discoverAllSessions
// ---------------------------------------------------------------------------

describe("discoverAllSessions", () => {
  it("discovers .jsonl files, extracts sessionId, sorts by mtime desc", async () => {
    await writeSession("session-aaa", [
      makeEntry({ role: "user", content: "First question" }),
    ]);
    // Ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    await writeSession("session-bbb", [
      makeEntry({ role: "user", content: "Second question" }),
    ]);

    const sessions = await discoverAllSessions();

    expect(sessions).toHaveLength(2);
    // Most recent first
    expect(sessions[0].sessionId).toBe("session-bbb");
    expect(sessions[1].sessionId).toBe("session-aaa");
    expect(sessions[0].firstUserMessage).toBe("Second question");
    expect(sessions[1].firstUserMessage).toBe("First question");
    expect(sessions[0].sessionFile).toContain("session-bbb.jsonl");
  });

  it("respects startMs filter", async () => {
    await writeSession("old-session", [
      makeEntry({ role: "user", content: "Old" }),
    ]);

    const futureMs = Date.now() + 100_000;

    const sessions = await discoverAllSessions({ startMs: futureMs });
    expect(sessions).toHaveLength(0);
  });

  it("ignores non-jsonl files", async () => {
    await writeSession("valid", [makeEntry({ role: "user", content: "hi" })]);
    await writeFile(join(sessionsDir, "readme.txt"), "not a session");

    const sessions = await discoverAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("valid");
  });

  it("returns empty array for missing sessions directory", async () => {
    process.env.OPENCLAW_STATE_DIR = join(tempDir, "nonexistent");
    const sessions = await discoverAllSessions();
    expect(sessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadSessionCostSummary
// ---------------------------------------------------------------------------

describe("loadSessionCostSummary", () => {
  it("parses JSONL and aggregates modelUsage with correct totals", async () => {
    // Two assistant turns from the same model — only assistant entries carry
    // billable `usage`, so a user-role entry with usage would be ignored
    // (and indeed shouldn't appear in real transcripts).
    const filePath = await writeSession("test-session", [
      makeEntry({
        role: "user",
        content: "Hello",
      }),
      makeEntry({
        role: "assistant",
        content: "Hi there",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        input_tokens: 100,
        output_tokens: 50,
        cost: { total: 0.001, input: 0.0005, output: 0.0003, cacheRead: 0.0001, cacheWrite: 0.0001 },
      }),
      makeEntry({
        role: "assistant",
        content: "Anything else?",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        input_tokens: 100,
        output_tokens: 0,
      }),
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });

    expect(result).not.toBeNull();
    expect(result!.modelUsage).toHaveLength(1);
    expect(result!.modelUsage![0].provider).toBe("anthropic");
    expect(result!.modelUsage![0].model).toBe("claude-sonnet-4-20250514");
    expect(result!.modelUsage![0].count).toBe(2);
    expect(result!.modelUsage![0].totals.input).toBe(200);
    expect(result!.modelUsage![0].totals.output).toBe(50);
    expect(result!.totalCost).toBeCloseTo(0.001);
  });

  it("ignores `usage` on user-role entries (only assistant turns are billable)", async () => {
    // Defensive coverage for the role-filter strictness fix: even if a
    // provider attaches a `usage` block to a user-role echo, that input
    // accounting must not double-count against the assistant's own usage.
    const filePath = await writeSession("user-usage-ignored", [
      makeEntry({
        role: "user",
        content: "Hello",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        // If user-role usage were counted, total input would be 700, not 500.
        input_tokens: 200,
        output_tokens: 0,
      }),
      makeEntry({
        role: "assistant",
        content: "Hi",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        input_tokens: 500,
        output_tokens: 100,
      }),
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result).not.toBeNull();
    expect(result!.input).toBe(500);
    expect(result!.output).toBe(100);
    expect(result!.modelUsage).toHaveLength(1);
    expect(result!.modelUsage![0].count).toBe(1);
  });

  it("handles API-reported costs", async () => {
    const filePath = await writeSession("cost-session", [
      makeEntry({
        role: "assistant",
        provider: "openai",
        model: "gpt-4o",
        input_tokens: 500,
        output_tokens: 200,
        cost: { total: 0.05, input: 0.03, output: 0.02 },
      }),
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result).not.toBeNull();
    expect(result!.totalCost).toBeCloseTo(0.05);
    expect(result!.inputCost).toBeCloseTo(0.03);
    expect(result!.outputCost).toBeCloseTo(0.02);
  });

  it("falls back to config-based cost estimation", async () => {
    const filePath = await writeSession("estimate-session", [
      makeEntry({
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        input_tokens: 1_000_000,
        output_tokens: 500_000,
      }),
    ]);

    const config = {
      models: {
        providers: {
          anthropic: {
            models: [{
              id: "claude-sonnet-4-20250514",
              cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
            }],
          },
        },
      },
    };

    const result = await loadSessionCostSummary({ sessionFile: filePath, config });
    expect(result).not.toBeNull();
    // 1M * 3/1M + 500K * 15/1M = 3 + 7.5 = 10.5
    expect(result!.totalCost).toBeCloseTo(10.5);
  });

  it("returns null for empty/missing file", async () => {
    const result1 = await loadSessionCostSummary({
      sessionFile: join(sessionsDir, "nonexistent.jsonl"),
    });
    expect(result1).toBeNull();

    // Empty file (no usage entries)
    const filePath = await writeSession("empty-session", [
      jsonlLine({ timestamp: "2026-03-15T10:00:00Z", message: { role: "system", content: "system prompt" } }),
    ]);
    const result2 = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result2).toBeNull();
  });

  it("handles multiple providers/models in one session", async () => {
    const filePath = await writeSession("multi-model", [
      makeEntry({ role: "assistant", provider: "anthropic", model: "claude-sonnet-4-20250514", input_tokens: 100, output_tokens: 50 }),
      makeEntry({ role: "assistant", provider: "openai", model: "gpt-4o", input_tokens: 200, output_tokens: 100 }),
      makeEntry({ role: "assistant", provider: "anthropic", model: "claude-sonnet-4-20250514", input_tokens: 300, output_tokens: 150 }),
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result).not.toBeNull();
    expect(result!.modelUsage).toHaveLength(2);

    const anthropic = result!.modelUsage!.find((m) => m.provider === "anthropic");
    const openai = result!.modelUsage!.find((m) => m.provider === "openai");
    expect(anthropic!.count).toBe(2);
    expect(anthropic!.totals.input).toBe(400);
    expect(openai!.count).toBe(1);
    expect(openai!.totals.input).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// loadCostUsageSummary
// ---------------------------------------------------------------------------

describe("loadCostUsageSummary", () => {
  it("aggregates across sessions into daily buckets", async () => {
    await writeSession("s1", [
      makeEntry({
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        timestamp: "2026-03-14T10:00:00Z",
        input_tokens: 100,
        output_tokens: 50,
        cost: { total: 0.01 },
      }),
    ]);
    await writeSession("s2", [
      makeEntry({
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        timestamp: "2026-03-15T10:00:00Z",
        input_tokens: 200,
        output_tokens: 100,
        cost: { total: 0.02 },
      }),
    ]);

    const result = await loadCostUsageSummary();

    expect(result.totals.input).toBe(300);
    expect(result.totals.output).toBe(150);
    expect(result.totals.totalCost).toBeCloseTo(0.03);
    expect(result.daily.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty summary for missing sessions dir", async () => {
    process.env.OPENCLAW_STATE_DIR = join(tempDir, "nonexistent");
    const result = await loadCostUsageSummary();
    expect(result.totals.totalTokens).toBe(0);
    expect(result.daily).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Usage normalization
// ---------------------------------------------------------------------------

describe("usage normalization", () => {
  it("handles prompt_tokens / completion_tokens naming", async () => {
    const filePath = await writeSession("norm-test", [
      jsonlLine({
        timestamp: "2026-03-15T10:00:00Z",
        message: {
          role: "assistant",
          content: "response",
          provider: "openai",
          model: "gpt-4o",
          usage: {
            prompt_tokens: 500,
            completion_tokens: 200,
            cached_tokens: 100,
          },
        },
      }),
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result).not.toBeNull();
    expect(result!.input).toBe(500);
    expect(result!.output).toBe(200);
    expect(result!.cacheRead).toBe(100);
  });

  it("handles inputTokens / outputTokens naming", async () => {
    const filePath = await writeSession("norm-test-2", [
      jsonlLine({
        timestamp: "2026-03-15T10:00:00Z",
        message: {
          role: "assistant",
          content: "response",
          usage: {
            inputTokens: 300,
            outputTokens: 150,
            cacheRead: 50,
            cacheWrite: 25,
          },
        },
      }),
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result).not.toBeNull();
    expect(result!.input).toBe(300);
    expect(result!.output).toBe(150);
    expect(result!.cacheRead).toBe(50);
    expect(result!.cacheWrite).toBe(25);
  });

  it("clamps negative input values to 0", async () => {
    const filePath = await writeSession("neg-test", [
      jsonlLine({
        timestamp: "2026-03-15T10:00:00Z",
        message: {
          role: "assistant",
          content: "response",
          usage: {
            input_tokens: -100,
            output_tokens: 50,
          },
        },
      }),
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result).not.toBeNull();
    expect(result!.input).toBe(0);
    expect(result!.output).toBe(50);
  });

  it("skips malformed JSONL lines gracefully", async () => {
    const filePath = await writeSession("malformed", [
      "this is not json",
      makeEntry({ role: "assistant", provider: "anthropic", model: "claude-sonnet-4-20250514", input_tokens: 100, output_tokens: 50 }),
      "{broken json",
    ]);

    const result = await loadSessionCostSummary({ sessionFile: filePath });
    expect(result).not.toBeNull();
    expect(result!.input).toBe(100);
    expect(result!.output).toBe(50);
  });
});
