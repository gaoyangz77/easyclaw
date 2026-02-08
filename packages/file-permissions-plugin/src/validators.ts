/**
 * File permission validation utilities
 */

import { join, resolve, normalize } from "node:path";
import { homedir } from "node:os";

export interface FilePermissions {
  read: string[];
  write: string[];
}

/**
 * Parse EASYCLAW_FILE_PERMISSIONS environment variable
 * Format: "read:/path1:/path2,write:/path3:/path4"
 */
export function parseFilePermissions(permissionsEnv: string): FilePermissions {
  const permissions: FilePermissions = {
    read: [],
    write: [],
  };

  if (!permissionsEnv) {
    return permissions;
  }

  const parts = permissionsEnv.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const mode = trimmed.substring(0, colonIndex);
    const paths = trimmed.substring(colonIndex + 1);

    if (mode === "read" || mode === "write") {
      const pathList = paths.split(":").filter((p) => p.trim() !== "");
      permissions[mode].push(...pathList.map(expandPath));
    }
  }

  return permissions;
}

/**
 * Expand ~ to home directory and resolve to absolute path
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
