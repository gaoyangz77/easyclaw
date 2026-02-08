/**
 * EasyClaw File Permissions Plugin
 *
 * Enforces file access permissions via OpenClaw's before_tool_call hook.
 * This plugin validates file paths against EASYCLAW_FILE_PERMISSIONS environment variable
 * and blocks unauthorized file operations.
 */

import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
  PluginHookBeforeToolCallResult,
} from "@mariozechner/openclaw/plugin-sdk";
import { parseFilePermissions, isPathAllowed, extractFilePaths } from "./validators.js";

// Tools that perform file access operations
const FILE_ACCESS_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "exec",
  "apply-patch",
  "image",
  "process",
]);

/**
 * Main plugin definition
 * Note: id, name, description, version are defined in openclaw.plugin.json manifest
 */
export const plugin: OpenClawPluginDefinition = {
  activate(api: OpenClawPluginApi) {
    api.logger.info("Activating EasyClaw file permissions plugin");

    // Register the before_tool_call hook
    api.on("before_tool_call", handleBeforeToolCall, { priority: 100 });

    api.logger.info("File permissions hook registered");
  },
};

/**
 * Hook handler for before_tool_call
 */
async function handleBeforeToolCall(
  event: PluginHookBeforeToolCallEvent,
  ctx: PluginHookToolContext,
): Promise<PluginHookBeforeToolCallResult | void> {
  const { toolName, params } = event;

  // Only check file access tools
  if (!FILE_ACCESS_TOOLS.has(toolName)) {
    return; // Allow non-file tools to proceed
  }

  // Parse permissions from environment variable
  const permissionsEnv = process.env.EASYCLAW_FILE_PERMISSIONS;
  if (!permissionsEnv) {
    // No permissions set - allow all access (backwards compatible)
    return;
  }

  const permissions = parseFilePermissions(permissionsEnv);

  // Extract file paths from tool parameters
  const filePaths = extractFilePaths(params);

  if (filePaths.length === 0) {
    // No file paths to validate
    return;
  }

  // Validate all file paths
  const deniedPaths: string[] = [];
  for (const filePath of filePaths) {
    if (!isPathAllowed(filePath, permissions)) {
      deniedPaths.push(filePath);
    }
  }

  // Block if any paths are denied
  if (deniedPaths.length > 0) {
    const reason = `File access denied. The following paths are not in the allowed permissions: ${deniedPaths.join(", ")}`;
    return {
      block: true,
      blockReason: reason,
    };
  }

  // All paths are allowed
  return;
}

export default plugin;
