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
import {
  parseFilePermissions,
  isPathAllowed,
  extractFilePaths,
  extractExecFilePaths,
} from "./validators.js";

// Tools that perform read-only file access
const READ_TOOLS = new Set(["read", "image"]);

// Tools that perform write file access
const WRITE_TOOLS = new Set(["write", "edit", "apply-patch", "apply_patch"]);

// Tools that can perform arbitrary file access (exec/bash can do both)
const EXEC_TOOLS = new Set(["exec", "process"]);

/**
 * Main plugin definition
 * Note: id, name, description, version are defined in openclaw.plugin.json manifest
 */
let log: { info: (msg: string) => void; debug?: (msg: string) => void };

export const plugin: OpenClawPluginDefinition = {
  activate(api: OpenClawPluginApi) {
    log = api.logger;
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

  // Determine access mode based on tool type
  const isRead = READ_TOOLS.has(toolName);
  const isWrite = WRITE_TOOLS.has(toolName);
  const isExec = EXEC_TOOLS.has(toolName);

  log?.info?.(`[file-perms] tool=${toolName} isRead=${isRead} isWrite=${isWrite} isExec=${isExec}`);

  if (!isRead && !isWrite && !isExec) {
    return; // Allow non-file tools to proceed
  }

  // Parse permissions from environment variable
  const permissionsEnv = process.env.EASYCLAW_FILE_PERMISSIONS;
  if (!permissionsEnv) {
    log?.info?.("[file-perms] No EASYCLAW_FILE_PERMISSIONS env var, allowing all");
    return;
  }

  const permissions = parseFilePermissions(permissionsEnv);
  log?.info?.(`[file-perms] Parsed permissions: read=[${permissions.read.join(", ")}] write=[${permissions.write.join(", ")}]`);

  // Extract file paths from tool parameters
  let filePaths = extractFilePaths(params);

  // For exec tools, also extract paths from the command string
  if (isExec) {
    filePaths = [...filePaths, ...extractExecFilePaths(params)];
  }

  log?.info?.(`[file-perms] Extracted paths: [${filePaths.join(", ")}]`);

  if (filePaths.length === 0) {
    return;
  }

  // Read tools and exec tools check both read+write paths (mode "read").
  // Only dedicated write tools (write/edit/apply-patch) require write permissions.
  const mode = isWrite ? "write" : "read";

  // Validate all file paths
  const deniedPaths: string[] = [];
  for (const filePath of filePaths) {
    const allowed = isPathAllowed(filePath, permissions, mode);
    log?.info?.(`[file-perms] isPathAllowed(${filePath}, ${mode}) = ${allowed}`);
    if (!allowed) {
      deniedPaths.push(filePath);
    }
  }

  // Block if any paths are denied
  if (deniedPaths.length > 0) {
    const reason = `File access denied by EasyClaw (中文名：爪爪). The following paths are not in the allowed permissions: ${deniedPaths.join(", ")}. Ask the user to update permissions in EasyClaw (中文名：爪爪) panel's Permissions page.`;
    log?.info?.(`[file-perms] BLOCKED: ${reason}`);
    return {
      block: true,
      blockReason: reason,
    };
  }

  log?.info?.("[file-perms] ALLOWED");
  return;
}

export default plugin;
