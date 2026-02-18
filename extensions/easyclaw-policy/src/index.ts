import { createLogger } from "@easyclaw/logger";
import { createPolicyInjector } from "@easyclaw/policy";
import type {
  GuardProvider,
  OpenClawPluginAPI,
  PolicyProvider,
} from "@easyclaw/policy";

const log = createLogger("easyclaw:plugin");

/** Options for creating the EasyClaw OpenClaw plugin. */
export interface EasyClawPluginOptions {
  policyProvider: PolicyProvider;
  guardProvider: GuardProvider;
}

/**
 * Creates the EasyClaw plugin that registers with the OpenClaw gateway.
 * It wires the policy injector (before_agent_start) which injects both
 * policy fragments and guard directives into the agent's system prompt.
 *
 * Guard enforcement via before_tool_call is intentionally disabled —
 * the current pattern matcher is too limited (only tool:/path: prefixes)
 * and risks false positives. Guards are instead injected as prompt-level
 * directives until a proper condition DSL is implemented.
 */
export function createEasyClawPlugin(options: EasyClawPluginOptions) {
  return {
    name: "easyclaw" as const,

    register(api: OpenClawPluginAPI): void {
      const policyHandler = createPolicyInjector(options.policyProvider, options.guardProvider);

      api.registerHook("before_agent_start", policyHandler);

      log.info("EasyClaw plugin registered");
    },
  };
}
