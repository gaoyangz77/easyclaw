export interface UsageRecord {
  id: string;
  timestamp: string; // ISO 8601
  model: string; // e.g. "claude-sonnet-4-5-20250929"
  provider: string; // e.g. "anthropic", "openai"
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number; // approximate cost in USD
  sessionId?: string; // optional session grouping
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  recordCount: number;
  byModel: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      count: number;
    }
  >;
  byProvider: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      count: number;
    }
  >;
}

export interface UsageFilter {
  since?: string; // ISO 8601 date
  until?: string; // ISO 8601 date
  model?: string;
  provider?: string;
  limit?: number;
}
