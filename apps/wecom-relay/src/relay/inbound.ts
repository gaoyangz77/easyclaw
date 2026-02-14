import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { Config } from "../config.js";
import type { WeComMessage, InboundFrame, BindingResolvedFrame } from "../types.js";
import { registry } from "../ws/server.js";
import { encodeFrame } from "../ws/protocol.js";
import { getBindingStore } from "../index.js";
import { getAccessToken } from "../wecom/access-token.js";
import { downloadMedia } from "../wecom/download-media.js";
import { sendTextMessage } from "../wecom/send-message.js";

const log = createLogger("relay:inbound");

const BINDING_SUCCESS_MSG: Record<string, string> = {
  zh: "绑定成功！以后你就可以直接在微信里联系我啦！你负责诗和远方，我负责给你打理好电脑！",
  en: "You're all set! From now on, just message me here on WeChat — you focus on the big picture, and I'll keep your computer in tip-top shape!",
};

/**
 * Handle inbound messages from WeCom sync_msg.
 *
 * For each message:
 * 1. If it's a text message matching a pending binding token, execute binding flow.
 * 2. Otherwise, look up the external_userid → gateway_id binding.
 * 3. Find the gateway's WebSocket connection and forward the message.
 */
export async function handleInboundMessages(
  messages: WeComMessage[],
  config: Config,
): Promise<void> {
  const store = getBindingStore();

  for (const msg of messages) {
    // Handle event messages for scene-based auto-binding
    if (msg.msgtype === "event") {
      log.info(`Event: type=${msg.event_type}, user=${msg.external_userid}`);
      if (msg.event_type === "enter_session" && msg.scene_param) {
        const sceneGatewayId = store.resolvePendingBinding(msg.scene_param);
        if (sceneGatewayId) {
          store.bind(msg.external_userid, sceneGatewayId);
          try {
            const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);
            await sendTextMessage(
              accessToken,
              msg.external_userid,
              config.WECOM_OPEN_KFID,
              BINDING_SUCCESS_MSG[config.LOCALE] ?? BINDING_SUCCESS_MSG.zh,
            );
          } catch (err) {
            log.error(`Failed to send binding confirmation: ${err}`);
          }
          log.info(`Scene binding: ${msg.external_userid} → ${sceneGatewayId} (scene_param=${msg.scene_param})`);

          // Notify the gateway that binding was resolved
          const gwWs = registry.get(sceneGatewayId);
          if (gwWs) {
            gwWs.send(encodeFrame({
              type: "binding_resolved",
              external_user_id: msg.external_userid,
              gateway_id: sceneGatewayId,
            }));
          }
        } else {
          log.info(`enter_session with unknown/expired scene_param: ${msg.scene_param} from ${msg.external_userid}`);
        }
      }
      continue;
    }

    // Only process customer messages (origin 3 = customer)
    if ("origin" in msg && msg.origin !== 3) continue;

    const externalUserId = msg.external_userid;

    // Check for binding token in text messages
    if (msg.msgtype === "text") {
      const text = msg.text.trim();
      const gatewayId = store.resolvePendingBinding(text);

      if (gatewayId) {
        // Execute binding: associate this external user with the gateway
        store.bind(externalUserId, gatewayId);

        const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);
        await sendTextMessage(
          accessToken,
          externalUserId,
          config.WECOM_OPEN_KFID,
          BINDING_SUCCESS_MSG[config.LOCALE] ?? BINDING_SUCCESS_MSG.zh,
        );

        log.info(`Binding completed: ${externalUserId} → ${gatewayId}`);

        // Notify the gateway that binding was resolved
        const gwWs = registry.get(gatewayId);
        if (gwWs) {
          gwWs.send(encodeFrame({
            type: "binding_resolved",
            external_user_id: externalUserId,
            gateway_id: gatewayId,
          }));
        }
        continue;
      }
    }

    // Look up binding
    const gatewayId = store.lookup(externalUserId);
    if (!gatewayId) {
      log.warn(`No binding found for external_userid: ${externalUserId}`);
      continue;
    }

    // Find gateway connection
    const ws = registry.get(gatewayId);
    if (!ws) {
      log.warn(`Gateway ${gatewayId} not connected for user ${externalUserId}`);
      continue;
    }

    // Build and send inbound frame
    let content: string;
    let msgType: string;
    let mediaData: string | undefined;
    let mediaMime: string | undefined;

    switch (msg.msgtype) {
      case "text":
        content = msg.text;
        msgType = "text";
        break;
      case "image":
        content = "";
        msgType = "image";
        try {
          const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);
          const media = await downloadMedia(accessToken, msg.media_id);
          mediaData = media.data.toString("base64");
          mediaMime = media.contentType;
        } catch (err) {
          log.error(`Failed to download image media ${msg.media_id}: ${err}`);
          content = "[图片 - 下载失败]";
        }
        break;
      case "voice":
        content = msg.media_id;
        msgType = "voice";
        try {
          const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);
          const media = await downloadMedia(accessToken, msg.media_id);
          mediaData = media.data.toString("base64");
          mediaMime = media.contentType;
          content = ""; // Clear media_id from content; the audio data is in media_data
        } catch (err) {
          log.error(`Failed to download voice media ${msg.media_id}: ${err}`);
          // Fall back: content stays as media_id, no media_data
        }
        break;
      default:
        content = "";
        msgType = "unknown";
    }

    const frame: InboundFrame = {
      type: "inbound",
      id: randomUUID(),
      external_user_id: externalUserId,
      msg_type: msgType,
      content,
      timestamp: msg.send_time,
      media_data: mediaData,
      media_mime: mediaMime,
    };

    ws.send(encodeFrame(frame));
    log.info(`Forwarded ${msgType} message to gateway ${gatewayId} for user ${externalUserId}`);
  }
}
