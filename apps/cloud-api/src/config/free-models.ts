/**
 * Models available to free-tier users via OpenRouter.
 * These are models with :free suffix or genuinely free quotas on OpenRouter.
 * Add/remove entries here to control free-tier access — no code changes elsewhere needed.
 */
export const FREE_MODELS: readonly string[] = [
  // OpenRouter "free" auto-router — picks any available free model behind the scenes
  "openrouter/free",
  // Currently live free models on OpenRouter (verify periodically — providers churn)
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "minimax/minimax-m2.5:free",
  "stepfun/step-3.5-flash:free",
  "arcee-ai/trinity-large-preview:free",
  "arcee-ai/trinity-mini:free",
  "liquid/lfm-2.5-1.2b-instruct:free",
];

/** Returns true if the given model ID is available on the free tier. */
export function isFreeModel(model: string): boolean {
  return FREE_MODELS.includes(model);
}
