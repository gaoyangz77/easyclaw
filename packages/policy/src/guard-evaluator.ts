import { createLogger } from "@easyclaw/logger";
import type {
  GuardProvider,
  ToolCallContext,
  ToolCallResult,
} from "./types.js";

const log = createLogger("easyclaw:guard-evaluator");

/**
 * Parsed representation of a guard artifact's content.
 * Expected JSON format:
 * { "type": "guard", "condition": "...", "action": "block", "reason": "..." }
 */
interface ParsedGuard {
  type: string;
  condition: string;
  action: string;
  reason: string;
}

/**
 * Attempts to parse the JSON content of a guard artifact.
 * Returns null if the content is malformed or missing required fields.
 */
function parseGuardContent(content: string): ParsedGuard | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      "condition" in parsed &&
      "action" in parsed &&
      "reason" in parsed
    ) {
      const obj = parsed as Record<string, unknown>;
      if (
        typeof obj.type === "string" &&
        typeof obj.condition === "string" &&
        typeof obj.action === "string" &&
        typeof obj.reason === "string"
      ) {
        return obj as unknown as ParsedGuard;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Evaluates whether a guard condition matches the given tool call context.
 *
 * Supported condition formats:
 * - "tool:<name>" — matches if toolName equals <name>
 * - "tool:*" — matches any tool (catch-all)
 * - "path:<pattern>" — matches if any string param value starts with the
 *   prefix portion of the pattern (the part before any trailing "*")
 */
function matchesCondition(
  condition: string,
  ctx: ToolCallContext,
): boolean {
  if (condition.startsWith("tool:")) {
    const toolPattern = condition.slice("tool:".length);
    if (toolPattern === "*") {
      return true;
    }
    return ctx.toolName === toolPattern;
  }

  if (condition.startsWith("path:")) {
    const pathPattern = condition.slice("path:".length);
    // Derive the prefix: strip trailing "*" for glob-like matching
    const prefix = pathPattern.endsWith("*")
      ? pathPattern.slice(0, -1)
      : pathPattern;

    // Check if any string-valued parameter starts with the prefix
    for (const value of Object.values(ctx.params)) {
      if (typeof value === "string" && value.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  // Unknown condition format — does not match
  log.warn(`Unknown guard condition format: ${condition}`);
  return false;
}

/**
 * Creates a before_tool_call handler that evaluates active guard artifacts
 * against the incoming tool call. The first matching guard with action "block"
 * wins and blocks the call. If no guards match, the call is allowed.
 */
export function createGuardEvaluator(
  provider: GuardProvider,
): (ctx: ToolCallContext) => ToolCallResult {
  return function handleToolCall(ctx: ToolCallContext): ToolCallResult {
    const guards = provider.getActiveGuards();
    log.debug(
      `Evaluating ${guards.length} guard(s) for tool call: ${ctx.toolName}`,
    );

    for (const guard of guards) {
      const parsed = parseGuardContent(guard.content);
      if (!parsed) {
        log.warn(
          `Skipping guard ${guard.id} (rule ${guard.ruleId}): malformed content`,
        );
        continue;
      }

      if (matchesCondition(parsed.condition, ctx)) {
        if (parsed.action === "block") {
          log.info(
            `Guard ${guard.id} blocking tool call ${ctx.toolName}: ${parsed.reason}`,
          );
          return { block: true, blockReason: parsed.reason };
        }
        // Future: handle "modify" action here
      }
    }

    log.debug(`No guards matched for tool call: ${ctx.toolName}`);
    return {};
  };
}
