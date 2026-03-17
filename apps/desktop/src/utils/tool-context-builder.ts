/**
 * Bridge/adapter for run-scoped tool context.
 *
 * This module reads tool selections from local SQLite and delegates
 * context building to the server-side RunCapabilityContextService.
 * The server is the single authority for:
 * - Entitlement checking (via ToolRegistryService)
 * - Default preset application
 * - Selection + entitlement intersection
 *
 * This bridge exists because tool selections are stored locally
 * in SQLite (desktop-side), while entitlements and presets are
 * managed by the cloud backend.
 */
import type { ToolScopeType, AgentRunToolContext } from "@rivonclaw/core";
import type { Storage } from "@rivonclaw/storage";
import type { AuthSessionManager } from "../auth/auth-session.js";

const RUN_CAPABILITY_CONTEXT_QUERY = `
  query RunCapabilityContext($input: RunCapabilityContextInput!) {
    runCapabilityContext(input: $input) {
      scopeType
      scopeKey
      entitledTools
      selectedTools
    }
  }
`;

/**
 * Bridge/adapter: reads local selections from SQLite and delegates
 * context building to the server-side RunCapabilityContextService.
 *
 * The server is the single authority for combining entitlements + selections + default presets.
 * This function only provides local selections as input.
 */
export async function buildToolContext(
  scopeType: ToolScopeType,
  scopeKey: string,
  storage: Storage,
  authSession: AuthSessionManager,
): Promise<AgentRunToolContext> {
  // 1. Read selections from local SQLite
  const selections = storage.toolSelections.getForScope(scopeType, scopeKey);

  // 2. Build input for server query
  const input: Record<string, unknown> = {
    scopeType,
    scopeKey,
  };

  // Only pass selections if there are explicit ones.
  // If no selections exist locally, let the server apply default presets.
  if (selections.length > 0) {
    input.selections = selections.map(s => ({
      toolId: s.toolId,
      enabled: s.enabled,
    }));
  }

  // 3. Call server-side RunCapabilityContextService via GraphQL
  const result = await authSession.graphqlFetch<{
    runCapabilityContext: {
      scopeType: string;
      scopeKey: string;
      entitledTools: string[];
      selectedTools: string[];
    };
  }>(RUN_CAPABILITY_CONTEXT_QUERY, { input });

  return result.runCapabilityContext as AgentRunToolContext;
}
