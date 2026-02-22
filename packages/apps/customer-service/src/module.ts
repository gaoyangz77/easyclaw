import WebSocket from "ws";
import type {
  CustomerServiceConfig,
  CustomerServiceStatus,
  CustomerServicePlatformStatus,
  CSHelloFrame,
  CSInboundFrame,
  CSReplyFrame,
  CSAckFrame,
  CSErrorFrame,
  CSBindingResolvedFrame,
  CSWSFrame,
} from "@easyclaw/core";

export interface CustomerServiceCallbacks {
  /** Called when an inbound customer message arrives. Returns the agent's reply text. */
  onInboundMessage(
    platform: string,
    customerId: string,
    msgType: string,
    content: string,
    mediaData?: string,
    mediaMime?: string,
  ): Promise<string>;
  /** Called when a customer is bound to this gateway. */
  onBindingResolved?(platform: string, customerId: string): void;
}

export interface CustomerServiceModule {
  /** Start connecting to the relay server. */
  start(config: CustomerServiceConfig): void;
  /** Stop the connection and clean up. */
  stop(): void;
  /** Get the current runtime status. */
  getStatus(): CustomerServiceStatus;
  /** Update the user-defined business prompt (used for the next agent call). */
  updateBusinessPrompt(prompt: string): void;
  /** Get the current business prompt. */
  getBusinessPrompt(): string;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function createCustomerServiceModule(callbacks: CustomerServiceCallbacks): CustomerServiceModule {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let intentionalClose = false;
  let connected = false;
  let config: CustomerServiceConfig | null = null;
  let businessPrompt = "";

  // Track per-platform bound customer counts
  const platformCustomers = new Map<string, Set<string>>();

  function getOrCreatePlatformSet(platform: string): Set<string> {
    let set = platformCustomers.get(platform);
    if (!set) {
      set = new Set();
      platformCustomers.set(platform, set);
    }
    return set;
  }

  function doConnect(): void {
    if (!config) return;

    const socket = new WebSocket(config.relayUrl);
    ws = socket;

    socket.on("open", () => {
      reconnectDelay = RECONNECT_MIN_MS;
      const hello: CSHelloFrame = {
        type: "cs_hello",
        gateway_id: config!.gatewayId,
        auth_token: config!.authToken,
      };
      socket.send(JSON.stringify(hello));
    });

    socket.on("message", (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString("utf-8")) as CSWSFrame;
        handleFrame(frame, socket);
      } catch {
        // Ignore unparseable frames
      }
    });

    socket.on("close", () => {
      ws = null;
      if (!intentionalClose) {
        connected = false;
        scheduleReconnect();
      }
    });

    socket.on("error", () => {
      // Error will be followed by close event — no extra handling needed
    });

    socket.on("ping", (payload: Buffer) => {
      socket.pong(payload);
    });
  }

  function handleFrame(frame: CSWSFrame, socket: WebSocket): void {
    switch (frame.type) {
      case "cs_ack":
        handleAck(frame);
        break;
      case "cs_error":
        handleError(frame);
        break;
      case "cs_inbound":
        handleInbound(frame, socket);
        break;
      case "cs_binding_resolved":
        handleBindingResolved(frame);
        break;
      default:
        // Ignore unknown frame types
        break;
    }
  }

  function handleAck(frame: CSAckFrame): void {
    if (frame.id === "cs_hello") {
      connected = true;
    }
    // Other acks are informational — no action needed
  }

  function handleError(frame: CSErrorFrame): void {
    // Log only; let errors surface naturally
    // The caller (bridge) can observe status via getStatus()
  }

  function handleInbound(frame: CSInboundFrame, socket: WebSocket): void {
    // Track this customer as bound to the platform
    getOrCreatePlatformSet(frame.platform).add(frame.customer_id);

    callbacks
      .onInboundMessage(
        frame.platform,
        frame.customer_id,
        frame.msg_type,
        frame.content,
        frame.media_data,
        frame.media_mime,
      )
      .then((replyText) => {
        if (!replyText || socket.readyState !== WebSocket.OPEN) return;
        const reply: CSReplyFrame = {
          type: "cs_reply",
          id: frame.id,
          platform: frame.platform,
          customer_id: frame.customer_id,
          content: replyText,
        };
        socket.send(JSON.stringify(reply));
      })
      .catch(() => {
        // If the callback fails, we cannot reply — nothing to do
      });
  }

  function handleBindingResolved(frame: CSBindingResolvedFrame): void {
    getOrCreatePlatformSet(frame.platform).add(frame.customer_id);
    callbacks.onBindingResolved?.(frame.platform, frame.customer_id);
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      doConnect();
    }, reconnectDelay);
  }

  function start(cfg: CustomerServiceConfig): void {
    stop();
    config = cfg;
    businessPrompt = cfg.businessPrompt;
    intentionalClose = false;
    connected = false;
    platformCustomers.clear();
    doConnect();
  }

  function stop(): void {
    intentionalClose = true;
    connected = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    reconnectDelay = RECONNECT_MIN_MS;
  }

  function getStatus(): CustomerServiceStatus {
    const platforms: CustomerServicePlatformStatus[] = [];
    for (const [platform, customers] of platformCustomers) {
      platforms.push({ platform, boundCustomers: customers.size });
    }
    return { connected, platforms };
  }

  function updateBusinessPrompt(prompt: string): void {
    businessPrompt = prompt;
  }

  function getBusinessPrompt(): string {
    return businessPrompt;
  }

  return {
    start,
    stop,
    getStatus,
    updateBusinessPrompt,
    getBusinessPrompt,
  };
}
