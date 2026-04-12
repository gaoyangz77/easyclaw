import { createLogger } from "@rivonclaw/logger";
import { GatewayRpcClient } from "@rivonclaw/gateway";
import type { GatewayLauncher, GatewayEventFrame } from "@rivonclaw/gateway";
import { runtimeStatusStore } from "../app/store/runtime-status-store.js";

const log = createLogger("openclaw-connector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Policy governing what runtime action follows a config mutation. */
export type ConfigMutationPolicy =
  | "none"
  | "reload_config"
  | "reconnect_rpc"
  | "restart_process";

/** Dependencies for establishing an RPC connection. */
export interface RpcConnectionDeps {
  url: string;
  token?: string;
  deviceIdentityPath?: string;
}

/** Volatile dependencies injected after construction. */
export interface OpenClawConnectorDeps {
  /** Write current config to disk, returning the config file path. */
  writeConfig: () => string;
  /** Build the full gateway config options object. */
  buildConfig: () => Promise<unknown>;
  /** Build the gateway environment variables (secrets, proxy, etc.). */
  buildEnv: () => Promise<Record<string, string>>;
  /** Dispatch gateway event frames to Panel SSE / CS bridge. */
  eventDispatcher: (evt: GatewayEventFrame) => void;
}

/** Callback registered via onRpcConnected(). */
export type RpcConnectedCallback = () => void | Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIDECAR_PROBE_METHOD = "chat.history";
const SIDECAR_PROBE_PARAMS = { sessionKey: "probe", limit: 1 };
const SIDECAR_PROBE_MAX_ATTEMPTS = 10;
const SIDECAR_PROBE_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// OpenClawConnector
// ---------------------------------------------------------------------------

/**
 * Runtime/transport/lifecycle facade for the OpenClaw gateway process.
 *
 * Manages:
 * - Gateway process lifecycle (via GatewayLauncher events)
 * - RPC client lifecycle (connect / disconnect / reconnect)
 * - Sidecar readiness probing
 * - Unified `request()` facade for gateway RPC calls
 * - `applyConfigMutation()` for business models to trigger config-related
 *   runtime operations
 *
 * This class knows NOTHING about providers, channels, STT, settings UI
 * semantics, or any other business logic.  It is a pure runtime layer.
 *
 * Observable state (processState, rpcConnected, sidecarState, etc.) lives
 * on `runtimeStatusStore.openClawConnector` and flows to Panel via SSE patches.
 * The connector mutates those props through runtimeStatusStore actions.
 */
export class OpenClawConnector {
  // ── Volatile state (non-serializable, Desktop-only) ────────────────────

  private launcher: GatewayLauncher | null = null;
  private rpcClient: GatewayRpcClient | null = null;
  private deps: OpenClawConnectorDeps | null = null;
  private rpcConnectionDeps: RpcConnectionDeps | null = null;

  /** Callbacks fired when the RPC client connects (for CS bridge, tool catalog, etc.). */
  private rpcConnectedCallbacks: RpcConnectedCallback[] = [];

  /** Callbacks fired when the RPC client disconnects (for CS bridge teardown, etc.). */
  private rpcDisconnectedCallbacks: RpcConnectedCallback[] = [];

  // ── Initialization ─────────────────────────────────────────────────────

  /**
   * Bind the gateway launcher and wire up its lifecycle events.
   * Called once during gateway-runtime setup.
   */
  initLauncher(launcher: GatewayLauncher): void {
    this.launcher = launcher;

    launcher.on("started", (_pid: number) => {
      runtimeStatusStore.setConnectorProcessState("running");
    });

    launcher.on("ready", () => {
      // The launcher emits "ready" when the gateway process prints
      // "listening on".  At this point we can connect the RPC client.
      if (this.rpcConnectionDeps) {
        this.connectRpc(this.rpcConnectionDeps).catch((err) => {
          log.error("Failed to connect RPC after gateway ready:", err);
        });
      }
    });

    launcher.on("stopped", () => {
      runtimeStatusStore.setConnectorProcessState("stopped");
      this.disconnectRpc();
    });

    launcher.on("restarting", (attempt: number) => {
      runtimeStatusStore.setConnectorProcessState("starting");
      runtimeStatusStore.setConnectorRestartAttempt(attempt);
    });

    launcher.on("error", (error: Error) => {
      runtimeStatusStore.setConnectorLastError(error.message);
    });
  }

  /**
   * Inject volatile dependencies (config writers, event dispatcher).
   * Called once during gateway-runtime setup.
   */
  initDeps(deps: OpenClawConnectorDeps): void {
    this.deps = deps;
  }

  /**
   * Store the RPC connection parameters so connectRpc() can be called
   * when the gateway becomes ready.
   */
  setRpcConnectionDeps(rpcDeps: RpcConnectionDeps): void {
    this.rpcConnectionDeps = rpcDeps;
  }

  /**
   * Register a callback that fires every time the RPC client connects.
   * Business code (mobile sync, tool catalog, CS bridge) uses this to
   * perform post-connect initialization without the connector knowing
   * about their semantics.
   */
  onRpcConnected(callback: RpcConnectedCallback): void {
    this.rpcConnectedCallbacks.push(callback);
  }

  /**
   * Register a callback that fires every time the RPC client disconnects.
   * Business code (CS bridge teardown) uses this to clean up resources
   * when the gateway becomes unreachable.
   */
  onRpcDisconnected(callback: RpcConnectedCallback): void {
    this.rpcDisconnectedCallbacks.push(callback);
  }

  // ── Views ──────────────────────────────────────────────────────────────

  /**
   * Whether the full stack is ready: process running, RPC connected,
   * and sidecar confirmed ready.
   */
  get isReady(): boolean {
    const c = runtimeStatusStore.openClawConnector;
    return (
      c.processState === "running" &&
      c.rpcConnected &&
      c.sidecarState === "ready"
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Start the gateway process. */
  async start(): Promise<void> {
    if (!this.launcher) {
      throw new Error("OpenClawConnector: launcher not initialized (call initLauncher first)");
    }
    runtimeStatusStore.setConnectorProcessState("starting");
    await this.launcher.start();
  }

  /** Stop the gateway process and disconnect RPC. */
  async stop(): Promise<void> {
    if (!this.launcher) {
      throw new Error("OpenClawConnector: launcher not initialized (call initLauncher first)");
    }
    runtimeStatusStore.setConnectorProcessState("stopping");
    this.disconnectRpc();
    await this.launcher.stop();
  }

  /** Restart the gateway process. */
  async restart(reason?: string): Promise<void> {
    if (reason) {
      log.info(`Restarting gateway: ${reason}`);
    }
    await this.stop();
    await this.start();
  }

  // ── RPC Connection ─────────────────────────────────────────────────────

  /**
   * Create and start the RPC client.
   *
   * This sets up the onConnect / onClose / onEvent callbacks and stores
   * the client in volatile state.  Business code should register
   * onRpcConnected callbacks rather than reaching into this method.
   */
  async connectRpc(rpcDeps: RpcConnectionDeps): Promise<void> {
    // Tear down any existing client first
    if (this.rpcClient) {
      this.rpcClient.stop();
      this.rpcClient = null;
    }

    this.rpcConnectionDeps = rpcDeps;

    const client = new GatewayRpcClient({
      url: rpcDeps.url,
      token: rpcDeps.token,
      deviceIdentityPath: rpcDeps.deviceIdentityPath,
      onConnect: () => {
        log.info("RPC client connected");
        runtimeStatusStore.setConnectorRpcConnected(true);

        // Start sidecar probe
        this.probeSidecarReady().catch((err) => {
          log.error("Sidecar probe failed:", err);
        });

        // Fire registered callbacks (mobile sync, tool catalog, CS bridge, etc.)
        for (const cb of this.rpcConnectedCallbacks) {
          try {
            const result = cb();
            if (result && typeof (result as Promise<void>).catch === "function") {
              (result as Promise<void>).catch((err) =>
                log.error("onRpcConnected callback error:", err),
              );
            }
          } catch (err) {
            log.error("onRpcConnected callback error:", err);
          }
        }
      },
      onClose: () => {
        log.info("RPC client disconnected");
        runtimeStatusStore.setConnectorRpcConnected(false);
        runtimeStatusStore.setConnectorSidecarState("unknown");
        // If disconnectRpc() already nulled rpcClient and fired callbacks,
        // skip the duplicate fire. Only fire here for server-initiated closes.
        if (this.rpcClient) {
          this.rpcClient = null;
          this.fireRpcDisconnectedCallbacks();
        }
      },
      onEvent: (evt: GatewayEventFrame) => {
        this.deps?.eventDispatcher(evt);
      },
    });

    this.rpcClient = client;
    await client.start();
  }

  /** Disconnect the RPC client and reset volatile + observable state. */
  disconnectRpc(): void {
    const client = this.rpcClient;
    if (!client) return;
    // Null out before stop() so the onClose callback (triggered by
    // WebSocket close) sees rpcClient === null and skips its own fire.
    // This guarantees disconnect callbacks fire exactly once.
    this.rpcClient = null;
    client.stop();
    runtimeStatusStore.setConnectorRpcConnected(false);
    runtimeStatusStore.setConnectorSidecarState("unknown");
    this.fireRpcDisconnectedCallbacks();
  }

  // ── RPC Disconnect Callbacks ────────────────────────────────────────────

  /** Fire all registered disconnect callbacks. Best-effort: errors are logged. */
  private fireRpcDisconnectedCallbacks(): void {
    for (const cb of this.rpcDisconnectedCallbacks) {
      try {
        const result = cb();
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) =>
            log.error("onRpcDisconnected callback error:", err),
          );
        }
      } catch (err) {
        log.error("onRpcDisconnected callback error:", err);
      }
    }
  }

  // ── Sidecar Readiness ──────────────────────────────────────────────────

  /**
   * Probe the sidecar for readiness by sending a lightweight RPC call.
   * Retries up to SIDECAR_PROBE_MAX_ATTEMPTS with SIDECAR_PROBE_INTERVAL_MS delay.
   */
  async probeSidecarReady(): Promise<void> {
    runtimeStatusStore.setConnectorSidecarState("probing");

    for (let attempt = 1; attempt <= SIDECAR_PROBE_MAX_ATTEMPTS; attempt++) {
      try {
        await this.request(SIDECAR_PROBE_METHOD, SIDECAR_PROBE_PARAMS);
        runtimeStatusStore.setConnectorSidecarState("ready");
        log.info("Sidecar ready");
        return;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "UNAVAILABLE" || code === "NOT_FOUND") {
          log.debug(`Sidecar probe attempt ${attempt}/${SIDECAR_PROBE_MAX_ATTEMPTS} — not ready yet (${code})`);
          if (attempt < SIDECAR_PROBE_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, SIDECAR_PROBE_INTERVAL_MS));
            continue;
          }
        }
        // Non-retryable error or exhausted attempts
        runtimeStatusStore.setConnectorSidecarState("failed");
        log.error(`Sidecar probe failed after ${attempt} attempts:`, err);
        return;
      }
    }
  }

  // ── Unified RPC Facade ─────────────────────────────────────────────────

  /**
   * Return the connected RPC client or throw if not connected.
   * Callers should check `isReady` first for non-critical paths.
   */
  ensureRpcReady(): GatewayRpcClient {
    if (this.rpcClient?.isConnected()) {
      return this.rpcClient;
    }
    throw new Error("OpenClawConnector: RPC client not connected");
  }

  /**
   * Send an RPC request to the gateway.
   * Throws if the RPC client is not connected.
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const client = this.ensureRpcReady();
    return client.request<T>(method, params);
  }

  // ── Config Mutation ────────────────────────────────────────────────────

  /**
   * Execute a config mutation and apply the appropriate runtime action.
   *
   * Business models call this to write config changes and have the
   * connector handle the lifecycle consequences (reload, reconnect, restart).
   *
   * @param mutator  Async function that performs the config write.
   * @param policy   What runtime action to take after the mutation:
   *   - "none"            — No runtime action (e.g. key-only changes).
   *   - "reload_config"   — SIGUSR1 graceful reload (config-file-only changes).
   *   - "reconnect_rpc"   — Disconnect + reconnect RPC (no process restart).
   *   - "restart_process" — Full stop + start of the gateway process.
   */
  async applyConfigMutation(
    mutator: () => Promise<void> | void,
    policy: ConfigMutationPolicy,
  ): Promise<void> {
    // 1. Execute the mutator (business model writes config file)
    await mutator();

    // 2. Apply runtime action based on policy
    switch (policy) {
      case "none":
        break;

      case "reload_config":
        if (!this.launcher) {
          throw new Error("OpenClawConnector: launcher not initialized");
        }
        await this.launcher.reload();
        break;

      case "reconnect_rpc":
        this.disconnectRpc();
        if (this.rpcConnectionDeps) {
          await this.connectRpc(this.rpcConnectionDeps);
        }
        break;

      case "restart_process":
        await this.stop();
        await this.start();
        break;
    }
  }
}
