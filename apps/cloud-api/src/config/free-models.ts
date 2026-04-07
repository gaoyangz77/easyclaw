/**
 * Models available to free-tier users via OpenRouter.
 * These are models with :free suffix or genuinely free quotas on OpenRouter.
 * Add/remove entries here to control free-tier access — no code changes elsewhere needed.
 */
export const FREE_MODELS: readonly string[] = [
  "google/gemini-flash-1.5",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "microsoft/phi-3-mini-128k-instruct:free",
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat:free",
];

/** Returns true if the given model ID is available on the free tier. */
export function isFreeModel(model: string): boolean {
  return FREE_MODELS.includes(model);
}
