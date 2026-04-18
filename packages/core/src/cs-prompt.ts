/**
 * Shared customer-service prompt assembly logic.
 *
 * Each shop response carries both the platform-managed CS `systemPrompt`
 * (as `services.customerService.platformSystemPrompt` — a virtual field
 * resolved from the backend's in-memory `ServicePrompt` cache, identical
 * for every shop on a given backend version) and the user-owned
 * `businessPrompt`. Panel MST and Desktop cs-bridge compose the two into
 * the final per-shop system prompt via this pure function — there is no
 * longer a backend-computed `assembledPrompt` field on the GraphQL
 * schema, nor a separate `csPlatformPrompt` singleton query.
 *
 * Keep this module free of runtime dependencies so it can be imported from
 * core MST views, Panel UI, and Desktop runtime paths alike.
 */

export interface AssembleCsPromptInput {
  /** Platform-managed CS system prompt (embedded per-shop from the backend). */
  platformSystemPrompt: string | null | undefined;
  /** Per-shop business prompt the user configures. */
  businessPrompt?: string | null;
}

/**
 * Assemble the full CS system prompt for a shop.
 *
 * Returns `null` when the platform prompt is missing or blank — callers
 * should treat this as "prompt not yet ready" and skip dispatching work.
 * Otherwise the platform prompt is returned on its own, or concatenated
 * with a "## Store Instructions" section when a non-blank business prompt
 * is provided.
 */
export function assembleCsPrompt({
  platformSystemPrompt,
  businessPrompt,
}: AssembleCsPromptInput): string | null {
  const platform = platformSystemPrompt?.trim();
  if (!platform) return null;
  const biz = businessPrompt?.trim();
  if (!biz) return platform;
  return `${platform}\n\n## Store Instructions\n\n${biz}`;
}
