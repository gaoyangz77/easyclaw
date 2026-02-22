import { getSystemPrompt } from "./system-prompt.js";

/**
 * Build the complete customer service prompt by combining
 * the immutable system prompt with the user's business rules.
 */
export function buildCustomerServicePrompt(businessPrompt: string, locale?: string): string {
  const systemPrompt = getSystemPrompt(locale);
  if (!businessPrompt.trim()) return systemPrompt;
  return systemPrompt + "\n\n---\n\n" + businessPrompt;
}
