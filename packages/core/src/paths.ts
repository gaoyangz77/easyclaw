import { join } from "node:path";
import { homedir } from "node:os";

/** Resolve the EasyClaw home directory. Defaults to ~/.easyclaw. */
export function resolveEasyClawHome(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.EASYCLAW_HOME?.trim() || join(homedir(), ".easyclaw");
}

/** Resolve the SQLite database path. */
export function resolveDbPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.EASYCLAW_DB_PATH?.trim() || join(resolveEasyClawHome(env), "db.sqlite");
}

/** Resolve the log directory. */
export function resolveLogDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveEasyClawHome(env), "logs");
}

/** Resolve the secrets directory. */
export function resolveSecretsDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.EASYCLAW_SECRETS_DIR?.trim() || join(resolveEasyClawHome(env), "secrets");
}

/** Resolve the OpenClaw state directory. */
export function resolveOpenClawStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.OPENCLAW_STATE_DIR?.trim() || join(resolveEasyClawHome(env), "openclaw");
}

/** Resolve the OpenClaw config file path. */
export function resolveOpenClawConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.OPENCLAW_CONFIG_PATH?.trim() || join(resolveOpenClawStateDir(env), "openclaw.json");
}

/** Resolve the media base directory (under OpenClaw state). */
export function resolveMediaDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveOpenClawStateDir(env), "media");
}

/** Resolve the Chrome CDP wrapper data directory. */
export function resolveCdpDataDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveEasyClawHome(env), "chrome-cdp");
}

/** Resolve the update-installing marker file path. */
export function resolveUpdateMarkerPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveEasyClawHome(env), "update-installing");
}

/** Resolve the proxy router config file path. */
export function resolveProxyRouterConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveOpenClawStateDir(env), "proxy-router.json");
}

/** Resolve the user-installed skills directory. */
export function resolveUserSkillsDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveOpenClawStateDir(env), "skills");
}
