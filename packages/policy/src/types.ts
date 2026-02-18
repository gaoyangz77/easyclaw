/** Context passed to before_agent_start hook. */
export interface AgentStartContext {
  /** Current prepended context (may be empty). */
  prependContext: string;
}

/** Result from before_agent_start hook. */
export interface AgentStartResult {
  /** Updated prepend context. */
  prependContext: string;
}

/** Context passed to before_tool_call hook. */
export interface ToolCallContext {
  /** Name of the tool being called. */
  toolName: string;
  /** Parameters for the tool call. */
  params: Record<string, unknown>;
}

/** Result from before_tool_call hook. */
export interface ToolCallResult {
  /** If true, the tool call is blocked. */
  block?: boolean;
  /** Reason for blocking (shown to user/agent). */
  blockReason?: string;
  /** Modified parameters (if allowed but adjusted). */
  params?: Record<string, unknown>;
}

/** A policy provider supplies the compiled policy view. */
export interface PolicyProvider {
  getCompiledPolicyView(): string;
}

/** A guard provider supplies active guard artifacts for evaluation. */
export interface GuardProvider {
  getActiveGuards(): Array<{
    id: string;
    ruleId: string;
    content: string;
  }>;
}

/** OpenClaw plugin registration API. */
export interface OpenClawPluginAPI {
  registerHook(
    hookName: "before_agent_start",
    handler: (ctx: AgentStartContext) => AgentStartResult,
  ): void;
  registerHook(
    hookName: "before_tool_call",
    handler: (ctx: ToolCallContext) => ToolCallResult,
  ): void;
}
