import { createLogger } from "@easyclaw/logger";
import { GatewayRpcClient, resolveOpenClawStateDir } from "@easyclaw/gateway";
import type { Storage } from "@easyclaw/storage";
import { join } from "node:path";
import WebSocket from "ws";
import type { WeComRelayState, WeComConnParams, SttManager, WeComRelayDeps } from "./wecom/wecom-types.js";
import { WECOM_RECONNECT_MIN_MS, WECOM_RECONNECT_MAX_MS } from "./wecom/wecom-types.js";
import { handleInbound, handleChatEvent, type WeComHandlerContext } from "./wecom/message-handlers.js";

export type { WeComRelayState, WeComConnParams, SttManager, WeComRelayDeps };

const log = createLogger("wecom-relay");

export function createWeComRelay(deps: WeComRelayDeps) {
  // --- State ---
  let relayState: WeComRelayState | null = null;
  const userIdCaseMap = new Map<string, string>();
  const runIdMap = new Map<string, string>();

  let relayWs: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = WECOM_RECONNECT_MIN_MS;
  let intentionalClose = false;
  let gatewayRpc: GatewayRpcClient | null = null;

  let sttManager: SttManager | null = null;
  let storageRef: Storage | null = null;
  let connParams: WeComConnParams | null = null;

  /** Build handler context from current closure state. */
  function buildCtx(): WeComHandlerContext {
    return {
      relayWs, gatewayRpc, sttManager, storageRef, connParams,
      userIdCaseMap, runIdMap,
      pushChatSSE: deps.pushChatSSE,
    };
  }

  // --- Internal Functions ---

  function doConnect(): void {
    if (!connParams) return;
    const { relayUrl, authToken, gatewayId } = connParams;

    const ws = new WebSocket(relayUrl);
    relayWs = ws;

    ws.on("open", () => {
      log.info("WeCom relay: connected, sending hello");
      reconnectDelay = WECOM_RECONNECT_MIN_MS;
      ws.send(JSON.stringify({
        type: "hello",
        gateway_id: gatewayId,
        auth_token: authToken,
      }));
    });

    ws.on("message", (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString("utf-8"));

        if (frame.type === "ack" && frame.id === "hello") {
          log.info("WeCom relay: authenticated — persistent connection active");
          if (relayState) relayState.connected = true;
          return;
        }

        if (frame.type === "binding_resolved") {
          log.info(`WeCom relay: binding resolved for ${frame.external_user_id}`);
          if (relayState) {
            relayState.externalUserId = frame.external_user_id;
          }
          storageRef?.settings.set("wecom-external-user-id", frame.external_user_id);
          return;
        }

        if (frame.type === "binding_cleared") {
          log.info("WeCom relay: binding cleared (no active binding for this gateway)");
          if (relayState) {
            relayState.externalUserId = undefined;
          }
          storageRef?.settings.delete("wecom-external-user-id");
          return;
        }

        if (frame.type === "inbound") {
          handleInbound(frame, buildCtx());
          return;
        }

        if (frame.type === "error") {
          log.error(`WeCom relay error: ${frame.message}`);
          return;
        }
      } catch (err) {
        log.error("WeCom relay: parse error:", err);
      }
    });

    ws.on("close", () => {
      log.info("WeCom relay: disconnected");
      relayWs = null;
      if (relayState && !intentionalClose) {
        relayState.connected = false;
      }
      if (!intentionalClose) {
        scheduleReconnect();
      }
    });

    ws.on("error", (err: Error) => {
      log.error(`WeCom relay: WS error: ${err.message}`);
    });

    ws.on("ping", (data: Buffer) => {
      ws.pong(data);
    });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    log.info(`WeCom relay: reconnecting in ${reconnectDelay}ms...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, WECOM_RECONNECT_MAX_MS);
      doConnect();
    }, reconnectDelay);
  }

  // --- Public API ---

  function start(params: WeComConnParams): void {
    stop();
    intentionalClose = false;
    connParams = params;

    gatewayRpc = new GatewayRpcClient({
      url: params.gatewayWsUrl,
      token: params.gatewayToken,
      deviceIdentityPath: join(resolveOpenClawStateDir(), "identity", "device.json"),
      onEvent: (evt) => {
        if (evt.event === "chat") {
          handleChatEvent(evt.payload, buildCtx()).catch((err) => log.error("WeCom: chat event handler error:", err));
        }
        if (evt.event === "agent") {
          const p = evt.payload as Record<string, unknown> | undefined;
          if (p?.stream === "tool") {
            const data = p.data as Record<string, unknown> | undefined;
            deps.pushChatSSE("tool", {
              runId: p.runId,
              phase: data?.phase,
              toolName: data?.name,
            });
          }
        }
      },
    });
    gatewayRpc.start().catch((err) => {
      log.error("WeCom: gateway RPC start failed:", err);
    });

    doConnect();
  }

  function stop(): void {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (relayWs) {
      relayWs.close();
      relayWs = null;
    }
    if (gatewayRpc) {
      gatewayRpc.stop();
      gatewayRpc = null;
    }
  }

  return {
    start,
    stop,
    getState: () => relayState,
    setState: (s: WeComRelayState | null) => { relayState = s; },
    getWs: () => relayWs,
    getGatewayRpc: () => gatewayRpc,
    getConnParams: () => connParams,
    initRefs: (opts: { storage?: Storage; sttMgr?: SttManager }) => {
      if (opts.storage) storageRef = opts.storage;
      if (opts.sttMgr) sttManager = opts.sttMgr;
    },
  };
}
