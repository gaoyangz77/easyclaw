export type GatewayState = "stopped" | "starting" | "running" | "stopping";

export interface GatewayLaunchOptions {
  /** Path to the openclaw.mjs entry file */
  entryPath: string;
  /** Path to the Node.js binary. Default: "node" from PATH */
  nodeBin?: string;
  /** Path to the OpenClaw config file */
  configPath?: string;
  /** Path to the OpenClaw state directory */
  stateDir?: string;
  /** Additional environment variables to pass to the gateway */
  env?: Record<string, string>;
  /** Maximum restart attempts before giving up (0 = unlimited). Default: 0 */
  maxRestarts?: number;
  /** Initial backoff delay in ms. Default: 1000 */
  initialBackoffMs?: number;
  /** Maximum backoff delay in ms. Default: 30000 */
  maxBackoffMs?: number;
  /** How long the process must run before backoff resets, in ms. Default: 60000 */
  healthyThresholdMs?: number;
}

export interface GatewayStatus {
  state: GatewayState;
  pid: number | null;
  restartCount: number;
  lastStartedAt: Date | null;
  lastError: string | null;
}

export interface GatewayEvents {
  started: [pid: number];
  ready: [];
  stopped: [code: number | null, signal: string | null];
  restarting: [attempt: number, delayMs: number];
  error: [error: Error];
}
