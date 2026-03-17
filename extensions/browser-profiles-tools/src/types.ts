/**
 * Shared types for the browser-profiles-tools extension.
 *
 * Re-exports core types so the extension stays compatible with
 * @rivonclaw/core's canonical definitions.
 */

export type {
  BrowserProfilesDisclosureLevel,
  BrowserProfilesCapabilityBinding,
  AgentRunCapabilityContext,
} from "@rivonclaw/core";

export type {
  ToolScopeType,
  AgentRunToolContext,
} from "@rivonclaw/core";
