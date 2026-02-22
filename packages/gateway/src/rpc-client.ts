import { WebSocket } from "ws";
import { createLogger } from "@easyclaw/logger";
import {
  loadOrCreateDeviceIdentity,
  publicKeyToBase64Url,
  signPayload,
  buildDeviceAuthPayload,
  type DeviceIdentity,
} from "./device-identity.js";

const log = createLogger("gateway-rpc");

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  features?: { methods?: string[]; events?: string[] };
  snapshot?: unknown;
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
  };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timeout?: NodeJS.Timeout;
};

export interface GatewayRpcClientOptions {
  /** WebSocket URL (e.g. ws://127.0.0.1:3212) */
  url: string;
  /** Optional authentication token */
  token?: string;
  /** Path to persist device identity (Ed25519 keypair) for gateway auth */
  deviceIdentityPath?: string;
  /** Callback fired on successful connection */
  onConnect?: () => void;
  /** Callback fired when connection closes */
  onClose?: () => void;
  /** Callback fired on gateway events */
  onEvent?: (evt: GatewayEventFrame) => void;
  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean;
  /** Initial reconnect delay in ms (default: 1000). Doubles each attempt up to maxReconnectDelay. */
  reconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
}

/**
 * Node.js RPC client for communicating with OpenClaw gateway via WebSocket.
 * Based on OpenClaw's GatewayBrowserClient but adapted for Node.js (ws package).
 */
export class GatewayRpcClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private deviceIdentity: DeviceIdentity | null = null;

  constructor(private opts: GatewayRpcClientOptions) {
    if (opts.deviceIdentityPath) {
      this.deviceIdentity = loadOrCreateDeviceIdentity(opts.deviceIdentityPath);
    }
  }

  /**
   * Start the client and connect to the gateway.
   */
  async start(): Promise<void> {
    this.closed = false;
    this.reconnectAttempt = 0;
    try {
      await this.connect();
    } catch {
      // Initial connect failed — scheduleReconnect() was already called from the
      // close handler, so we don't throw; the client will keep retrying in the background.
    }
  }

  /**
   * Stop the client and close the connection.
   */
  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.flushPending(new Error("Gateway RPC client stopped"));
  }

  /**
   * Check if the client is connected.
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Send an RPC request to the gateway.
   * @param method - RPC method name (e.g. "channels.status")
   * @param params - Method parameters
   * @param timeoutMs - Request timeout in milliseconds (default: 30s)
   */
  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 30000
  ): Promise<T> {
    // Allow sending "connect" before fully connected (initial handshake)
    if (method !== "connect" && !this.isConnected()) {
      throw new Error("Gateway not connected");
    }

    // For connect, just check WebSocket is open
    if (method === "connect" && this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }

    const id = this.generateId();
    const frame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timeout,
      });

      try {
        this.ws?.send(JSON.stringify(frame));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  private async connect(): Promise<void> {
    if (this.closed) {
      return;
    }

    return new Promise((resolve, reject) => {
      log.info(`Connecting to gateway at ${this.opts.url}...`);

      this.ws = new WebSocket(this.opts.url);
      let settled = false;

      this.ws.on("open", () => {
        log.info("Gateway WebSocket opened");
        void this.sendConnect()
          .then(() => {
            this.connected = true;
            this.reconnectAttempt = 0;
            this.opts.onConnect?.();
            settled = true;
            resolve();
          })
          .catch((err) => {
            settled = true;
            reject(err);
          });
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", (code, reason) => {
        log.info(`Gateway WebSocket closed: ${code} ${reason.toString()}`);
        this.ws = null;
        this.connected = false;
        this.flushPending(new Error(`Gateway closed (${code}): ${reason.toString()}`));
        this.opts.onClose?.();
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        log.warn(`Gateway WebSocket error: ${(err as Error).message ?? err}`);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || (this.opts.autoReconnect === false)) {
      return;
    }

    const baseDelay = this.opts.reconnectDelay ?? 1000;
    const maxDelay = this.opts.maxReconnectDelay ?? 30000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempt), maxDelay);
    this.reconnectAttempt++;

    log.info(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        log.warn(`Reconnect failed: ${(err as Error).message ?? err}`);
        // connect() failure triggers ws close → scheduleReconnect() will be called again
      });
    }, delay);
  }

  private async sendConnect(): Promise<void> {
    const scopes = [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
    ];
    const clientId = "node-host";
    const clientMode = "ui";
    const role = "operator";

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: "1.0.0",
        platform: process.platform,
        mode: clientMode,
      },
      role,
      scopes,
      caps: ["tool-events"],
      auth: this.opts.token ? { token: this.opts.token } : undefined,
    };

    if (this.deviceIdentity) {
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayload({
        deviceId: this.deviceIdentity.deviceId,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs,
        token: this.opts.token ?? null,
      });
      params.device = {
        id: this.deviceIdentity.deviceId,
        publicKey: publicKeyToBase64Url(this.deviceIdentity.publicKeyPem),
        signature: signPayload(this.deviceIdentity.privateKeyPem, payload),
        signedAt: signedAtMs,
      };
    }

    const hello = await this.request<GatewayHelloOk>("connect", params, 10000);
    log.info("Gateway connection established", {
      protocol: hello.protocol,
      scopes: hello.auth?.scopes,
    });
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      log.warn("Failed to parse gateway message:", raw);
      return;
    }

    const frame = parsed as { type?: unknown };

    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      this.opts.onEvent?.(evt);
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }

      this.pending.delete(res.id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }

      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        const error = new Error(res.error?.message ?? "Request failed");
        (error as any).code = res.error?.code;
        (error as any).details = res.error?.details;
        pending.reject(error);
      }
      return;
    }
  }

  private flushPending(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timeout) {
        clearTimeout(p.timeout);
      }
      p.reject(err);
    }
    this.pending.clear();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
