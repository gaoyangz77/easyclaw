import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createLogger } from "@easyclaw/logger";
import { resolveOpenClawConfigPath, readExistingConfig } from "./config-writer.js";

const log = createLogger("gateway:permissions");

export interface PermissionsConfig {
  readPaths: string[];
  writePaths: string[];
}

/**
 * Convert EasyClaw permissions (readPaths/writePaths) to OpenClaw Docker bind mounts.
 *
 * OpenClaw's sandbox uses Docker bind mounts with format: "host:container:mode"
 * - readPaths → mounted as :ro (read-only)
 * - writePaths → mounted as :rw (read-write)
 *
 * Container paths mirror host paths for simplicity (e.g., /home/user/docs → /home/user/docs)
 */
function permissionsToBinds(permissions: PermissionsConfig): string[] {
  const binds: string[] = [];

  // Add read-only binds
  for (const path of permissions.readPaths) {
    binds.push(`${path}:${path}:ro`);
  }

  // Add read-write binds (these override read-only if same path)
  for (const path of permissions.writePaths) {
    binds.push(`${path}:${path}:rw`);
  }

  // Deduplicate: if a path is in both readPaths and writePaths, keep only rw version
  const uniqueBinds = new Map<string, string>();
  for (const bind of binds) {
    const [hostPath] = bind.split(":");
    // Prefer rw over ro
    if (!uniqueBinds.has(hostPath) || bind.endsWith(":rw")) {
      uniqueBinds.set(hostPath, bind);
    }
  }

  return Array.from(uniqueBinds.values());
}

/**
 * Sync filesystem permissions to OpenClaw config by writing Docker bind mounts.
 *
 * Updates `agents.defaults.sandbox.docker.binds` in openclaw.json.
 * Also ensures workspaceAccess is set to "rw" to enable the bind mounts.
 *
 * @param permissions - EasyClaw permissions (readPaths/writePaths)
 * @param configPath - Optional path to openclaw.json (defaults to standard location)
 */
export function syncPermissions(
  permissions: PermissionsConfig,
  configPath?: string,
): void {
  const targetPath = configPath ?? resolveOpenClawConfigPath();

  if (!existsSync(targetPath)) {
    log.warn(`OpenClaw config not found at ${targetPath}, cannot sync permissions`);
    return;
  }

  const config = readExistingConfig(targetPath) as Record<string, unknown>;

  // Navigate to agents.defaults.sandbox.docker.binds
  const agents = (config.agents as Record<string, unknown>) ?? {};
  const defaults = (agents.defaults as Record<string, unknown>) ?? {};
  const sandbox = (defaults.sandbox as Record<string, unknown>) ?? {};
  const docker = (sandbox.docker as Record<string, unknown>) ?? {};

  // Convert permissions to binds
  const binds = permissionsToBinds(permissions);

  // Update config
  const updatedDocker = {
    ...docker,
    binds,
  };

  const updatedSandbox = {
    ...sandbox,
    docker: updatedDocker,
    // Ensure workspaceAccess is "rw" to allow bind mounts to work
    workspaceAccess: sandbox.workspaceAccess ?? "rw",
  };

  const updatedDefaults = {
    ...defaults,
    sandbox: updatedSandbox,
  };

  const updatedAgents = {
    ...agents,
    defaults: updatedDefaults,
  };

  config.agents = updatedAgents;

  // Write back to disk
  writeFileSync(targetPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  log.info(
    `Synced ${binds.length} filesystem permission(s) to ${targetPath}`,
  );
}

/**
 * Clear all filesystem permissions from OpenClaw config.
 * Removes the binds array from docker config.
 */
export function clearPermissions(configPath?: string): void {
  const targetPath = configPath ?? resolveOpenClawConfigPath();

  if (!existsSync(targetPath)) {
    log.warn(`OpenClaw config not found at ${targetPath}`);
    return;
  }

  const config = readExistingConfig(targetPath) as Record<string, unknown>;

  // Navigate to agents.defaults.sandbox.docker
  const agents = (config.agents as Record<string, unknown>) ?? {};
  const defaults = (agents.defaults as Record<string, unknown>) ?? {};
  const sandbox = (defaults.sandbox as Record<string, unknown>) ?? {};
  const docker = (sandbox.docker as Record<string, unknown>) ?? {};

  // Remove binds
  delete docker.binds;

  // Update config
  const updatedSandbox = {
    ...sandbox,
    docker: Object.keys(docker).length > 0 ? docker : undefined,
  };

  const updatedDefaults = {
    ...defaults,
    sandbox: Object.keys(updatedSandbox).length > 0 ? updatedSandbox : undefined,
  };

  const updatedAgents = {
    ...agents,
    defaults: Object.keys(updatedDefaults).length > 0 ? updatedDefaults : undefined,
  };

  if (Object.keys(updatedAgents).length > 0) {
    config.agents = updatedAgents;
  } else {
    delete config.agents;
  }

  writeFileSync(targetPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  log.info(`Cleared filesystem permissions from ${targetPath}`);
}
