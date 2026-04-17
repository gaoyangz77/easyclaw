/**
 * RivonClaw-owned session usage service.
 *
 * Re-implements the subset of vendor session-cost-usage logic that RivonClaw
 * consumers actually use, avoiding direct vendor imports.
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { resolveAgentSessionsDir } from "@rivonclaw/core/node";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
};

export type CostUsageDailyEntry = CostUsageTotals & { date: string };

export type CostUsageSummary = {
  updatedAt: number;
  days: number;
  daily: CostUsageDailyEntry[];
  totals: CostUsageTotals;
};

export type SessionModelUsage = {
  provider?: string;
  model?: string;
  count: number;
  totals: CostUsageTotals;
};

export type SessionCostSummary = CostUsageTotals & {
  sessionId?: string;
  sessionFile?: string;
  firstActivity?: number;
  lastActivity?: number;
  durationMs?: number;
  activityDates?: string[];
  dailyBreakdown?: Array<{ date: string; tokens: number; cost: number }>;
  modelUsage?: SessionModelUsage[];
};

export type DiscoveredSession = {
  sessionId: string;
  sessionFile: string;
  mtime: number;
  firstUserMessage?: string;
};

/**
 * Minimal config shape used for cost estimation fallback.
 * Matches the runtime structure of the OpenClaw config file.
 */
export type OpenClawConfig = {
  models?: {
    providers?: Record<
      string,
      {
        models?: Array<{
          id: string;
          cost?: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
          };
        }>;
      }
    >;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionsDir(): string {
  return resolveAgentSessionsDir();
}

function emptyCostTotals(): CostUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleDateString("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

// ---------------------------------------------------------------------------
// Usage field normalisation
// ---------------------------------------------------------------------------

interface NormalisedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function normaliseUsage(raw: Record<string, unknown>): NormalisedUsage {
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const input = Math.max(
    0,
    num(
      raw.input_tokens ??
        raw.input ??
        raw.inputTokens ??
        raw.promptTokens ??
        raw.prompt_tokens ??
        0,
    ),
  );

  const output = Math.max(
    0,
    num(
      raw.output_tokens ??
        raw.output ??
        raw.outputTokens ??
        raw.completionTokens ??
        raw.completion_tokens ??
        0,
    ),
  );

  let cacheRead = num(
    raw.cache_read_input_tokens ??
      raw.cacheRead ??
      raw.cache_read ??
      raw.cached_tokens ??
      0,
  );
  if (cacheRead === 0 && raw.prompt_tokens_details && typeof raw.prompt_tokens_details === "object") {
    cacheRead = num((raw.prompt_tokens_details as Record<string, unknown>).cached_tokens ?? 0);
  }
  cacheRead = Math.max(0, cacheRead);

  const cacheWrite = Math.max(
    0,
    num(
      raw.cache_creation_input_tokens ??
        raw.cacheWrite ??
        raw.cache_write ??
        0,
    ),
  );

  return { input, output, cacheRead, cacheWrite };
}

// ---------------------------------------------------------------------------
// Cost extraction / estimation
// ---------------------------------------------------------------------------

interface CostBreakdown {
  total: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  estimated: boolean;
}

function extractCost(
  usage: Record<string, unknown>,
  normalised: NormalisedUsage,
  provider: string | undefined,
  model: string | undefined,
  config: OpenClawConfig | undefined,
): CostBreakdown {
  // Prefer API-reported cost
  const costObj = usage.cost as Record<string, unknown> | undefined;
  if (costObj && typeof costObj === "object" && typeof costObj.total === "number") {
    return {
      total: costObj.total as number,
      inputCost: (costObj.input as number) ?? 0,
      outputCost: (costObj.output as number) ?? 0,
      cacheReadCost: (costObj.cacheRead as number) ?? 0,
      cacheWriteCost: (costObj.cacheWrite as number) ?? 0,
      estimated: false,
    };
  }

  // Fallback: estimate from config pricing
  if (config && provider && model) {
    const providerConfig = config.models?.providers?.[provider];
    const modelConfig = providerConfig?.models?.find((m) => m.id === model);
    if (modelConfig?.cost) {
      const c = modelConfig.cost;
      const inputCost = (normalised.input * c.input) / 1_000_000;
      const outputCost = (normalised.output * c.output) / 1_000_000;
      const cacheReadCost = (normalised.cacheRead * c.cacheRead) / 1_000_000;
      const cacheWriteCost = (normalised.cacheWrite * c.cacheWrite) / 1_000_000;
      return {
        total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
        inputCost,
        outputCost,
        cacheReadCost,
        cacheWriteCost,
        estimated: true,
      };
    }
  }

  return { total: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, estimated: true };
}

// ---------------------------------------------------------------------------
// Timestamp extraction
// ---------------------------------------------------------------------------

function extractTimestamp(entry: Record<string, unknown>): number | null {
  // Top-level ISO timestamp
  if (typeof entry.timestamp === "string") {
    const t = new Date(entry.timestamp).getTime();
    if (Number.isFinite(t)) return t;
  }
  // message.timestamp as epoch ms
  const msg = entry.message as Record<string, unknown> | undefined;
  if (msg && typeof msg.timestamp === "number" && Number.isFinite(msg.timestamp)) {
    return msg.timestamp;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSONL line iteration helper
// ---------------------------------------------------------------------------

async function* readJsonlLines(
  filePath: string,
): AsyncGenerator<Record<string, unknown>> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        yield parsed as Record<string, unknown>;
      }
    } catch {
      // Skip malformed lines
    }
  }
}

// ---------------------------------------------------------------------------
// discoverAllSessions
// ---------------------------------------------------------------------------

export async function discoverAllSessions(
  params?: { startMs?: number; endMs?: number },
): Promise<DiscoveredSession[]> {
  const dir = sessionsDir();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  files = files.filter((f) => f.endsWith(".jsonl"));

  const results: DiscoveredSession[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const fileStat = await stat(filePath);
    const mtime = fileStat.mtimeMs;

    if (params?.startMs !== undefined && mtime < params.startMs) continue;

    const sessionId = file.replace(/\.jsonl$/, "");

    let firstUserMessage: string | undefined;
    try {
      for await (const entry of readJsonlLines(filePath)) {
        const msg = entry.message as Record<string, unknown> | undefined;
        if (msg?.role !== "user") continue;
        const content = msg.content;
        if (typeof content === "string") {
          firstUserMessage = content.slice(0, 100);
        } else if (Array.isArray(content)) {
          const textPart = content.find(
            (p: unknown) =>
              typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "text",
          ) as Record<string, unknown> | undefined;
          if (textPart && typeof textPart.text === "string") {
            firstUserMessage = (textPart.text as string).slice(0, 100);
          }
        }
        break; // Only need first user message
      }
    } catch {
      // If we can't read the file for the label, that's fine
    }

    results.push({ sessionId, sessionFile: filePath, mtime, firstUserMessage });
  }

  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

// ---------------------------------------------------------------------------
// loadSessionCostSummary
// ---------------------------------------------------------------------------

export async function loadSessionCostSummary(params: {
  sessionFile: string;
  config?: OpenClawConfig | Record<string, unknown>;
  startMs?: number;
  endMs?: number;
}): Promise<SessionCostSummary | null> {
  const { sessionFile, config, startMs, endMs } = params;

  // Check file exists
  try {
    await stat(sessionFile);
  } catch {
    return null;
  }

  const modelMap = new Map<string, { count: number; totals: CostUsageTotals }>();
  const grandTotals = emptyCostTotals();
  let firstActivity: number | undefined;
  let lastActivity: number | undefined;
  const activityDateSet = new Set<string>();
  const dailyMap = new Map<string, { tokens: number; cost: number }>();
  let entryCount = 0;

  for await (const entry of readJsonlLines(sessionFile)) {
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const role = msg.role as string | undefined;
    // Only assistant messages carry billable LLM `usage` fields. Counting
    // user-role usage (theoretically possible if a provider attaches input
    // accounting on the user echo) would double-count input tokens.
    if (role !== "assistant") continue;

    const usage = msg.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    const ts = extractTimestamp(entry);
    if (ts !== null) {
      if (startMs !== undefined && ts < startMs) continue;
      if (endMs !== undefined && ts > endMs) continue;
    }

    entryCount++;

    const provider = (msg.provider as string) ?? (entry.provider as string) ?? undefined;
    const model = (msg.model as string) ?? (entry.model as string) ?? undefined;

    const normalised = normaliseUsage(usage);
    const cost = extractCost(usage, normalised, provider, model, config as OpenClawConfig | undefined);

    // Accumulate grand totals
    grandTotals.input += normalised.input;
    grandTotals.output += normalised.output;
    grandTotals.cacheRead += normalised.cacheRead;
    grandTotals.cacheWrite += normalised.cacheWrite;
    grandTotals.totalTokens += normalised.input + normalised.output + normalised.cacheRead + normalised.cacheWrite;
    grandTotals.totalCost += cost.total;
    grandTotals.inputCost += cost.inputCost;
    grandTotals.outputCost += cost.outputCost;
    grandTotals.cacheReadCost += cost.cacheReadCost;
    grandTotals.cacheWriteCost += cost.cacheWriteCost;
    if (cost.total === 0 && cost.estimated) {
      grandTotals.missingCostEntries++;
    }

    // Model usage aggregation
    const key = `${provider ?? "unknown"}::${model ?? "unknown"}`;
    const existing = modelMap.get(key);
    if (existing) {
      existing.count++;
      existing.totals.input += normalised.input;
      existing.totals.output += normalised.output;
      existing.totals.cacheRead += normalised.cacheRead;
      existing.totals.cacheWrite += normalised.cacheWrite;
      existing.totals.totalTokens += normalised.input + normalised.output + normalised.cacheRead + normalised.cacheWrite;
      existing.totals.totalCost += cost.total;
      existing.totals.inputCost += cost.inputCost;
      existing.totals.outputCost += cost.outputCost;
      existing.totals.cacheReadCost += cost.cacheReadCost;
      existing.totals.cacheWriteCost += cost.cacheWriteCost;
      if (cost.total === 0 && cost.estimated) {
        existing.totals.missingCostEntries++;
      }
    } else {
      const totals = emptyCostTotals();
      totals.input = normalised.input;
      totals.output = normalised.output;
      totals.cacheRead = normalised.cacheRead;
      totals.cacheWrite = normalised.cacheWrite;
      totals.totalTokens = normalised.input + normalised.output + normalised.cacheRead + normalised.cacheWrite;
      totals.totalCost = cost.total;
      totals.inputCost = cost.inputCost;
      totals.outputCost = cost.outputCost;
      totals.cacheReadCost = cost.cacheReadCost;
      totals.cacheWriteCost = cost.cacheWriteCost;
      totals.missingCostEntries = cost.total === 0 && cost.estimated ? 1 : 0;
      modelMap.set(key, { count: 1, totals });
    }

    // Activity tracking
    if (ts !== null) {
      if (firstActivity === undefined || ts < firstActivity) firstActivity = ts;
      if (lastActivity === undefined || ts > lastActivity) lastActivity = ts;
      const dateKey = localDateKey(ts);
      activityDateSet.add(dateKey);

      const dailyEntry = dailyMap.get(dateKey) ?? { tokens: 0, cost: 0 };
      dailyEntry.tokens += normalised.input + normalised.output + normalised.cacheRead + normalised.cacheWrite;
      dailyEntry.cost += cost.total;
      dailyMap.set(dateKey, dailyEntry);
    }
  }

  if (entryCount === 0) return null;

  const sessionId = sessionFile.replace(/.*[/\\]/, "").replace(/\.jsonl$/, "");

  const modelUsage: SessionModelUsage[] = [];
  for (const [key, val] of modelMap) {
    const [provider, model] = key.split("::");
    modelUsage.push({
      provider: provider === "unknown" ? undefined : provider,
      model: model === "unknown" ? undefined : model,
      count: val.count,
      totals: val.totals,
    });
  }

  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, tokens: v.tokens, cost: v.cost }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    ...grandTotals,
    sessionId,
    sessionFile,
    firstActivity,
    lastActivity,
    durationMs: firstActivity !== undefined && lastActivity !== undefined ? lastActivity - firstActivity : undefined,
    activityDates: Array.from(activityDateSet).sort(),
    dailyBreakdown,
    modelUsage,
  };
}

// ---------------------------------------------------------------------------
// loadCostUsageSummary
// ---------------------------------------------------------------------------

export async function loadCostUsageSummary(params?: {
  startMs?: number;
  endMs?: number;
  config?: OpenClawConfig | Record<string, unknown>;
}): Promise<CostUsageSummary> {
  const { startMs, endMs, config } = params ?? {};
  const dir = sessionsDir();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return {
      updatedAt: Date.now(),
      days: 0,
      daily: [],
      totals: emptyCostTotals(),
    };
  }

  files = files.filter((f) => f.endsWith(".jsonl"));

  const grandTotals = emptyCostTotals();
  const dailyMap = new Map<string, CostUsageTotals>();

  for (const file of files) {
    const filePath = join(dir, file);

    // Optionally filter by mtime
    if (startMs !== undefined) {
      const fileStat = await stat(filePath);
      if (fileStat.mtimeMs < startMs) continue;
    }

    for await (const entry of readJsonlLines(filePath)) {
      const msg = entry.message as Record<string, unknown> | undefined;
      if (!msg) continue;
      const role = msg.role as string | undefined;
      // Only assistant messages carry billable LLM `usage` fields. See the
      // matching guard in `loadSessionCostSummary` for rationale.
      if (role !== "assistant") continue;

      const usage = msg.usage as Record<string, unknown> | undefined;
      if (!usage) continue;

      const ts = extractTimestamp(entry);
      if (ts !== null) {
        if (startMs !== undefined && ts < startMs) continue;
        if (endMs !== undefined && ts > endMs) continue;
      }

      const provider = (msg.provider as string) ?? (entry.provider as string) ?? undefined;
      const model = (msg.model as string) ?? (entry.model as string) ?? undefined;

      const normalised = normaliseUsage(usage);
      const cost = extractCost(usage, normalised, provider, model, config as OpenClawConfig | undefined);

      const tokens = normalised.input + normalised.output + normalised.cacheRead + normalised.cacheWrite;

      // Grand totals
      grandTotals.input += normalised.input;
      grandTotals.output += normalised.output;
      grandTotals.cacheRead += normalised.cacheRead;
      grandTotals.cacheWrite += normalised.cacheWrite;
      grandTotals.totalTokens += tokens;
      grandTotals.totalCost += cost.total;
      grandTotals.inputCost += cost.inputCost;
      grandTotals.outputCost += cost.outputCost;
      grandTotals.cacheReadCost += cost.cacheReadCost;
      grandTotals.cacheWriteCost += cost.cacheWriteCost;
      if (cost.total === 0 && cost.estimated) {
        grandTotals.missingCostEntries++;
      }

      // Daily bucket
      if (ts !== null) {
        const dateKey = localDateKey(ts);
        const day = dailyMap.get(dateKey) ?? emptyCostTotals();
        day.input += normalised.input;
        day.output += normalised.output;
        day.cacheRead += normalised.cacheRead;
        day.cacheWrite += normalised.cacheWrite;
        day.totalTokens += tokens;
        day.totalCost += cost.total;
        day.inputCost += cost.inputCost;
        day.outputCost += cost.outputCost;
        day.cacheReadCost += cost.cacheReadCost;
        day.cacheWriteCost += cost.cacheWriteCost;
        if (cost.total === 0 && cost.estimated) {
          day.missingCostEntries++;
        }
        dailyMap.set(dateKey, day);
      }
    }
  }

  const daily: CostUsageDailyEntry[] = Array.from(dailyMap.entries())
    .map(([date, totals]) => ({ ...totals, date }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const effectiveStart = startMs ?? Date.now();
  const effectiveEnd = endMs ?? Date.now();
  const days = Math.max(1, Math.ceil((effectiveEnd - effectiveStart) / 86_400_000) + 1);

  return {
    updatedAt: Date.now(),
    days,
    daily,
    totals: grandTotals,
  };
}
