/**
 * ChatEventBridge — SSE client that connects to panel-server's
 * `GET /api/chat/events` endpoint and converts server-sent events
 * into RunTracker actions.
 *
 * Two event types are handled:
 *  - "inbound"  — an external user message arrived (e.g. WeChat)
 *  - "tool"     — an agent tool event forwarded from the gateway
 *
 * See ADR-022 for design rationale.
 */

import type { RunAction } from "./run-tracker.js";

// ---------------------------------------------------------------------------
// SSE payload types
// ---------------------------------------------------------------------------

export interface InboundSSEPayload {
  runId: string;
  sessionKey: string;
  channel: string;
  message: string;
  timestamp: number;
}

export interface ToolSSEPayload {
  runId: string;
  phase: "start" | "result";
  toolName?: string;
}

// ---------------------------------------------------------------------------
// ChatEventBridge
// ---------------------------------------------------------------------------

export type ChatEventBridgeCallbacks = {
  onAction: (action: RunAction) => void;
  onUserMessage: (msg: { text: string; timestamp: number; channel: string }) => void;
};

export class ChatEventBridge {
  private sse: EventSource | null = null;
  private url: string;
  private callbacks: ChatEventBridgeCallbacks;

  constructor(url: string, callbacks: ChatEventBridgeCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.sse) return;

    const sse = new EventSource(this.url);
    this.sse = sse;

    sse.addEventListener("inbound", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as InboundSSEPayload;
        this.callbacks.onUserMessage({
          text: data.message,
          timestamp: data.timestamp,
          channel: data.channel,
        });
        this.callbacks.onAction({
          type: "EXTERNAL_INBOUND",
          runId: data.runId,
          sessionKey: data.sessionKey,
          channel: data.channel,
        });
      } catch {
        // Malformed SSE data — ignore
      }
    });

    sse.addEventListener("tool", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ToolSSEPayload;
        if (data.phase === "start" && data.toolName) {
          this.callbacks.onAction({
            type: "TOOL_START",
            runId: data.runId,
            toolName: data.toolName,
          });
        } else if (data.phase === "result") {
          this.callbacks.onAction({
            type: "TOOL_RESULT",
            runId: data.runId,
          });
        }
      } catch {
        // Malformed SSE data — ignore
      }
    });

    // EventSource auto-reconnects on network errors. The "error" event
    // fires on both transient failures (auto-reconnect) and fatal failures
    // (server returns non-200). We don't need to do anything special here
    // because EventSource handles reconnection internally.
  }

  disconnect(): void {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
  }

  get connected(): boolean {
    return this.sse !== null && this.sse.readyState !== EventSource.CLOSED;
  }
}
