import { createLogger } from "@easyclaw/logger";
import type {
  AgentStartContext,
  AgentStartResult,
  GuardProvider,
  PolicyProvider,
} from "./types.js";

const log = createLogger("easyclaw:policy-injector");

/**
 * Parse a guard artifact's JSON content into a human-readable directive
 * for system prompt injection. Returns null if content is unparseable.
 */
function formatGuardDirective(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    const condition = typeof obj.condition === "string" ? obj.condition : null;
    const reason = typeof obj.reason === "string" ? obj.reason : null;
    const action = typeof obj.action === "string" ? obj.action.toUpperCase() : "BLOCK";

    if (!condition && !reason) return null;

    if (reason && reason !== condition) {
      return `[${action}] ${condition ?? reason} — ${reason}`;
    }
    return `[${action}] ${condition ?? reason}`;
  } catch {
    return null;
  }
}

/**
 * Creates a before_agent_start handler that injects the compiled policy view
 * and active guard directives as prependContext. Both blocks are wrapped with
 * delimiters and placed before any existing prependContext.
 */
export function createPolicyInjector(
  provider: PolicyProvider,
  guardProvider?: GuardProvider,
): (ctx: AgentStartContext) => AgentStartResult {
  return function handleAgentStart(ctx: AgentStartContext): AgentStartResult {
    const policyView = provider.getCompiledPolicyView();
    const guards = guardProvider?.getActiveGuards() ?? [];

    // Format guard directives
    const guardDirectives: string[] = [];
    for (const guard of guards) {
      const directive = formatGuardDirective(guard.content);
      if (directive) {
        guardDirectives.push(directive);
      } else {
        log.warn(`Skipping guard ${guard.id}: could not format content for prompt injection`);
      }
    }

    const hasPolicy = !!policyView;
    const hasGuards = guardDirectives.length > 0;

    if (!hasPolicy && !hasGuards) {
      log.debug("No policies or guards available; passing through context");
      return { prependContext: ctx.prependContext };
    }

    const blocks: string[] = [];

    if (hasPolicy) {
      log.info("Injecting compiled policy view into prependContext");
      blocks.push(
        "--- EasyClaw Policy ---\n" + policyView + "\n--- End Policy ---",
      );
    }

    if (hasGuards) {
      log.info(`Injecting ${guardDirectives.length} guard directive(s) into prependContext`);
      blocks.push(
        "--- EasyClaw Guards (MUST enforce) ---\n" +
          guardDirectives.join("\n") +
          "\n--- End Guards ---",
      );
    }

    const injected = blocks.join("\n") + "\n";

    return {
      prependContext:
        injected + (ctx.prependContext ? "\n" + ctx.prependContext : ""),
    };
  };
}
