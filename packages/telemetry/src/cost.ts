const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5-20250929": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5-20251001": { input: 0.0008, output: 0.004 },
  "claude-opus-4-6": { input: 0.015, output: 0.075 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "deepseek-chat": { input: 0.00014, output: 0.00028 },
};

/** Default cost per 1K tokens for unknown models. */
const DEFAULT_COST_PER_1K: { input: number; output: number } = {
  input: 0.002,
  output: 0.008,
};

/**
 * Estimate the cost in USD for a given model and token counts.
 * Falls back to a default rate if the model is unknown.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = COST_PER_1K_TOKENS[model] ?? DEFAULT_COST_PER_1K;
  const cost =
    (inputTokens / 1000) * rates.input +
    (outputTokens / 1000) * rates.output;
  return Math.round(cost * 1_000_000) / 1_000_000; // round to 6 decimal places
}
