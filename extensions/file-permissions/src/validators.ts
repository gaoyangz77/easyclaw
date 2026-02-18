/**
 * File permission validation utilities
 */

import { join, resolve, normalize } from "node:path";
import { homedir } from "node:os";

export interface FilePermissions {
  fullAccess: boolean;
  read: string[];
  write: string[];
}

/**
 * Parse EASYCLAW_FILE_PERMISSIONS environment variable.
 *
 * Accepts two formats:
 * - JSON: {"readPaths":[...],"writePaths":[...],"workspacePath":"..."}
 * - Legacy colon-delimited: "read:/path1:/path2,write:/path3:/path4"
 */
export function parseFilePermissions(permissionsEnv: string): FilePermissions {
  const permissions: FilePermissions = {
    fullAccess: false,
    read: [],
    write: [],
  };

  if (!permissionsEnv) {
    return permissions;
  }

  // Try JSON format first (produced by buildFilePermissionsEnv in secret-injector)
  const trimmed = permissionsEnv.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      // Full access mode — skip all path checks
      if (parsed.fullAccess === true) {
        permissions.fullAccess = true;
      }
      // workspacePath is OpenClaw's own state directory — always grant
      // read+write so the agent can access memory/workspace files even
      // before the user configures additional permissions.
      if (typeof parsed.workspacePath === "string" && parsed.workspacePath.trim()) {
        permissions.write.push(expandPath(parsed.workspacePath));
      }
      if (Array.isArray(parsed.readPaths)) {
        permissions.read.push(...parsed.readPaths.map(expandPath));
      }
      if (Array.isArray(parsed.writePaths)) {
        permissions.write.push(...parsed.writePaths.map(expandPath));
      }
      return permissions;
    } catch {
      // Fall through to legacy format
    }
  }

  // Legacy colon-delimited format: "read:/path1:/path2,write:/path3:/path4"
  const parts = permissionsEnv.split(",");
  for (const part of parts) {
    const partTrimmed = part.trim();
    if (!partTrimmed) continue;

    const colonIndex = partTrimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const mode = partTrimmed.substring(0, colonIndex);
    const paths = partTrimmed.substring(colonIndex + 1);

    if (mode === "read" || mode === "write") {
      const pathList = paths.split(":").filter((p) => p.trim() !== "");
      permissions[mode].push(...pathList.map(expandPath));
    }
  }

  return permissions;
}

/**
 * Expand ~ to home directory and resolve to absolute path.
 */
function expandPath(path: string): string {
  let expanded = path;
  if (expanded.startsWith("~/")) {
    expanded = join(homedir(), expanded.slice(2));
  } else if (expanded === "~") {
    expanded = homedir();
  }
  return normalize(resolve(expanded));
}

/**
 * Check if a file path is allowed based on permissions
 */
export function isPathAllowed(
  filePath: string,
  permissions: FilePermissions,
  mode: "read" | "write" = "write",
): boolean {
  // Full access mode — allow everything
  if (permissions.fullAccess) {
    return true;
  }

  const absolutePath = expandPath(filePath);
  const allowedPaths = mode === "read" ? permissions.read : permissions.write;

  // Check if path is under any allowed directory
  for (const allowedPath of allowedPaths) {
    if (isPathUnder(absolutePath, allowedPath)) {
      return true;
    }
  }

  // Also check write paths if we're checking read access
  // (write permissions imply read permissions)
  if (mode === "read") {
    for (const allowedPath of permissions.write) {
      if (isPathUnder(absolutePath, allowedPath)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a path is under a parent directory
 */
function isPathUnder(childPath: string, parentPath: string): boolean {
  const normalizedChild = normalize(resolve(childPath));
  const normalizedParent = normalize(resolve(parentPath));

  // Exact match
  if (normalizedChild === normalizedParent) {
    return true;
  }

  // Check if child is under parent
  const relative = normalizedChild.substring(normalizedParent.length);
  return (
    normalizedChild.startsWith(normalizedParent) &&
    (relative.startsWith("/") || relative.startsWith("\\"))
  );
}

/**
 * Extract file paths from tool parameters
 */
export function extractFilePaths(params: Record<string, unknown>): string[] {
  const paths: string[] = [];

  // Common parameter names for file paths
  const pathParams = ["path", "file_path", "filePath", "cwd", "out", "output"];

  for (const key of pathParams) {
    const value = params[key];
    if (typeof value === "string" && value.trim() !== "") {
      paths.push(value);
    }
  }

  return paths;
}

/**
 * Extract file paths from exec/bash command strings.
 * Looks for absolute paths and ~-prefixed paths in the command text.
 */
export function extractExecFilePaths(params: Record<string, unknown>): string[] {
  const command =
    typeof params.command === "string"
      ? params.command
      : typeof params.cmd === "string"
        ? params.cmd
        : null;

  if (!command) return [];

  const paths: string[] = [];

  // Match absolute paths (/...) and tilde paths (~/...)
  // Handles quoted paths and unquoted paths with escaped spaces
  const pathRegex = /(?:"([~/][^"]*?)"|'([~/][^']*?)'|((?:~\/|\/)(?:\\ |[^\s;|&><`$(){}])*))/g;

  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(command)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (raw) {
      // Unescape backslash-escaped spaces
      paths.push(raw.replace(/\\ /g, " "));
    }
  }

  return paths;
}
