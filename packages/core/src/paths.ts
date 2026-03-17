import { join } from "node:path";
import { homedir } from "node:os";

/** Resolve the RivonClaw home directory. Defaults to ~/.rivonclaw. */
export function resolveRivonClawHome(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.RIVONCLAW_HOME?.trim() || join(homedir(), ".rivonclaw");
}

/** Resolve the SQLite database path. */
export function resolveDbPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.RIVONCLAW_DB_PATH?.trim() || join(resolveRivonClawHome(env), "db.sqlite");
}

/** Resolve the log directory. */
export function resolveLogDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveRivonClawHome(env), "logs");
}

/** Resolve the secrets directory. */
export function resolveSecretsDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.RIVONCLAW_SECRETS_DIR?.trim() || join(resolveRivonClawHome(env), "secrets");
}

/** Resolve the OpenClaw state directory. */
export function resolveOpenClawStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.OPENCLAW_STATE_DIR?.trim() || join(resolveRivonClawHome(env), "openclaw");
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
  return join(resolveRivonClawHome(env), "chrome-cdp");
}

/** Resolve the update-installing marker file path. */
export function resolveUpdateMarkerPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveRivonClawHome(env), "update-installing");
}

/** Resolve the proxy router config file path. */
export function resolveProxyRouterConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveOpenClawStateDir(env), "proxy-router.json");
}

/** Resolve the heartbeat file path used for single-instance stale detection. */
export function resolveHeartbeatPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveRivonClawHome(env), "heartbeat.json");
}

/** Resolve the user-installed skills directory. */
export function resolveUserSkillsDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveOpenClawStateDir(env), "skills");
}
