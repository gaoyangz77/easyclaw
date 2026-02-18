/**
 * Simplified WebSocket client for connecting to the OpenClaw gateway from
 * the EasyClaw panel (browser).  Handles the challenge-response handshake,
 * JSON-RPC request/response, event streaming, and auto-reconnect.
 *
 * Compared to OpenClaw's GatewayBrowserClient this version skips device
 * identity / IndexedDB / crypto.subtle — the panel is always on localhost
 * so simple token auth is sufficient.
 */

export type GatewayEvent = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  features?: { methods?: string[]; events?: string[] };
  snapshot?: {
    sessionDefaults?: {
      mainSessionKey?: string;
      defaultAgentId?: string;
    };
    [key: string]: unknown;
  };
};

export type GatewayChatClientOptions = {
  url: string;
  token?: string;
  onConnected?: (hello: GatewayHelloOk) => void;
  onDisconnected?: () => void;
  onEvent?: (evt: GatewayEvent) => void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export class GatewayChatClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connectNonce: string | null = null;
  private connectSent = false;
  private backoffMs = 800;

  constructor(private opts: GatewayChatClientOptions) {}

  start(): void {
    this.closed = false;
    this.doConnect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.flushPending(new Error("client stopped"));
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = crypto.randomUUID();
    const frame = { type: "req", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  // --- internal ---

  private doConnect(): void {
    if (this.closed) return;
    this.connectSent = false;
    this.connectNonce = null;

    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));

    ws.addEventListener("close", () => {
      this.ws = null;
      this.flushPending(new Error("gateway disconnected"));
      this.opts.onDisconnected?.();
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close handler will fire
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    setTimeout(() => this.doConnect(), delay);
  }

  private sendConnect(): void {
    if (this.connectSent || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.connectSent = true;

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "webchat-ui",
        version: "1.0.0",
        platform: navigator.platform ?? "web",
        mode: "webchat",
      },
      role: "operator",
      scopes: ["operator.admin"],
      caps: ["tool-events"],
      auth: this.opts.token ? { token: this.opts.token } : undefined,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    this.request<GatewayHelloOk>("connect", params)
      .then((hello) => {
        this.backoffMs = 800;
        this.opts.onConnected?.(hello);
      })
      .catch(() => {
        this.ws?.close();
      });
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: string };

    if (frame.type === "event") {
      const evt = parsed as GatewayEvent;
      // Gateway sends connect.challenge first — respond with connect request
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: string } | undefined;
        if (payload?.nonce) {
          this.connectNonce = payload.nonce;
          this.sendConnect();
        }
        return;
      }
      this.opts.onEvent?.(evt);
      return;
    }

    if (frame.type === "res") {
      const res = parsed as { id: string; ok: boolean; payload?: unknown; error?: { message?: string } };
      const pending = this.pending.get(res.id);
      if (!pending) return;
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(new Error(res.error?.message ?? "request failed"));
      }
    }
  }

  private flushPending(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }
}
