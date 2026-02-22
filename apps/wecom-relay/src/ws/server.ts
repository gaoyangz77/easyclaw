import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { createLogger } from "@easyclaw/logger";
import type { Config } from "../config.js";
import { ConnectionRegistry } from "./registry.js";
import { decodeFrame, encodeFrame } from "./protocol.js";
import { startHeartbeat } from "./heartbeat.js";
import { handleOutboundReply, handleOutboundImageReply } from "../relay/outbound.js";
import { getBindingStore } from "../index.js";
import { getAccessToken } from "../wecom/access-token.js";
import { getContactWayUrl, endCustomerSession } from "../wecom/send-message.js";
import type { HelloFrame, ReplyFrame, ImageReplyFrame, CreateBindingFrame, UnbindAllFrame } from "../types.js";

const log = createLogger("ws:server");

/** Singleton connection registry, exported for use by relay modules */
export const registry = new ConnectionRegistry();

/**
 * Create and start the WebSocket server for gateway connections.
 */
export function createWSServer(config: Config): WebSocketServer {
  const wss = new WebSocketServer({ port: config.WS_PORT });

  log.info(`WebSocket server listening on port ${config.WS_PORT}`);

  wss.on("connection", (ws: WebSocket) => {
    let gatewayId: string | null = null;
    let authenticated = false;

    // Expect hello frame within 5 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        log.warn("Connection did not authenticate within timeout");
        ws.close(4001, "Authentication timeout");
      }
    }, 5000);

    ws.on("message", (data: Buffer) => {
      try {
        const frame = decodeFrame(data.toString("utf-8"));

        if (!authenticated) {
          if (frame.type !== "cs_hello") {
            ws.send(encodeFrame({ type: "cs_error", message: "Expected cs_hello frame" }));
            ws.close(4002, "Expected cs_hello frame");
            return;
          }

          const hello = frame as HelloFrame;

          if (hello.auth_token !== config.RELAY_AUTH_SECRET) {
            ws.send(encodeFrame({ type: "cs_error", message: "Authentication failed" }));
            ws.close(4003, "Authentication failed");
            return;
          }

          clearTimeout(authTimeout);
          authenticated = true;
          gatewayId = hello.gateway_id;

          registry.register(gatewayId, ws);
          startHeartbeat(ws, gatewayId);

          ws.send(encodeFrame({ type: "cs_ack", id: "cs_hello" }));
          log.info(`Gateway authenticated: ${gatewayId}`);

          // Notify about existing bindings (handles reconnect / app restart)
          const store = getBindingStore();
          const boundUsers = store.listByGateway(gatewayId);
          if (boundUsers.length > 0) {
            for (const userId of boundUsers) {
              ws.send(encodeFrame({
                type: "cs_binding_resolved",
                platform: "wecom",
                customer_id: userId,
                gateway_id: gatewayId,
              }));
            }
            log.info(`Existing binding(s) for gateway ${gatewayId}: ${boundUsers.length} user(s)`);
          } else {
            ws.send(encodeFrame({
              type: "cs_binding_cleared",
              gateway_id: gatewayId,
            }));
            log.info(`No bindings for gateway ${gatewayId}, sent cs_binding_cleared`);
          }
          return;
        }

        // Handle authenticated frames
        if (frame.type === "cs_reply") {
          const reply = frame as ReplyFrame;
          handleOutboundReply(reply, config).catch((err) => {
            log.error(`Error handling reply from ${gatewayId}:`, err);
            ws.send(encodeFrame({ type: "cs_error", message: "Failed to send reply" }));
          });
          return;
        }

        if (frame.type === "cs_image_reply") {
          const imageReply = frame as ImageReplyFrame;
          handleOutboundImageReply(imageReply, config).catch((err) => {
            log.error(`Error handling image reply from ${gatewayId}:`, err);
            ws.send(encodeFrame({ type: "cs_error", message: "Failed to send image reply" }));
          });
          return;
        }

        if (frame.type === "cs_create_binding") {
          const cbFrame = frame as CreateBindingFrame;
          if (cbFrame.gateway_id !== gatewayId) {
            ws.send(encodeFrame({ type: "cs_error", message: "gateway_id mismatch" }));
            return;
          }
          const store = getBindingStore();
          const token = randomBytes(4).toString("hex");
          store.createPendingBinding(token, gatewayId!);

          // Call WeCom API to get contact way URL (async)
          (async () => {
            try {
              const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);
              const baseUrl = await getContactWayUrl(accessToken, config.WECOM_OPEN_KFID);
              const sep = baseUrl.includes("?") ? "&" : "?";
              const customerServiceUrl = `${baseUrl}${sep}scene_param=${encodeURIComponent(token)}`;
              ws.send(encodeFrame({
                type: "cs_create_binding_ack",
                token,
                customer_service_url: customerServiceUrl,
              }));
              log.info(`Created pending binding for gateway ${gatewayId}, token: ${token}, url: ${customerServiceUrl}`);
            } catch (err) {
              log.error(`Failed to create contact way: ${err}`);
              ws.send(encodeFrame({ type: "cs_error", message: "Failed to create customer service link" }));
            }
          })();
          return;
        }

        if (frame.type === "cs_unbind_all") {
          const ubFrame = frame as UnbindAllFrame;
          if (ubFrame.gateway_id !== gatewayId) {
            ws.send(encodeFrame({ type: "cs_error", message: "gateway_id mismatch" }));
            return;
          }
          const store = getBindingStore();

          // End WeCom sessions before unbinding so scene_param works on rebind
          (async () => {
            try {
              const users = store.listByGateway(gatewayId!);
              if (users.length > 0) {
                const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);
                await Promise.allSettled(
                  users.map(uid => endCustomerSession(accessToken, config.WECOM_OPEN_KFID, uid)),
                );
                log.info(`Ended ${users.length} session(s) for gateway ${gatewayId}`);
              }
            } catch (err) {
              log.warn(`Failed to end sessions for gateway ${gatewayId}:`, err);
            }

            const count = store.unbindByGateway(gatewayId!);
            ws.send(encodeFrame({ type: "cs_ack", id: "cs_unbind_all" }));
            log.info(`Unbound all (${count}) users for gateway ${gatewayId}`);
          })();
          return;
        }

        log.warn(`Unexpected frame type from ${gatewayId}: ${frame.type}`);
      } catch (err) {
        log.error("Error processing WebSocket message:", err);
        ws.send(encodeFrame({ type: "cs_error", message: "Invalid frame" }));
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      if (gatewayId) {
        log.info(`Gateway disconnected: ${gatewayId}`);
      }
    });

    ws.on("error", (err) => {
      log.error(`WebSocket error for ${gatewayId ?? "unauthenticated"}:`, err);
    });
  });

  return wss;
}
