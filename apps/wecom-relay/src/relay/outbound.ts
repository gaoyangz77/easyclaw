import { createLogger } from "@easyclaw/logger";
import type { Config } from "../config.js";
import type { ReplyFrame, ImageReplyFrame } from "../types.js";
import { getAccessToken } from "../wecom/access-token.js";
import { sendTextMessage, uploadMedia, sendImageMessage } from "../wecom/send-message.js";

const log = createLogger("relay:outbound");

/**
 * Handle outbound reply from a gateway (received via WebSocket).
 * Sends the reply content to the WeCom user via the Customer Service API.
 */
export async function handleOutboundReply(
  reply: ReplyFrame,
  config: Config,
): Promise<void> {
  log.info(`Sending reply to ${reply.external_user_id}, frame id: ${reply.id}`);

  const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);

  await sendTextMessage(
    accessToken,
    reply.external_user_id,
    config.WECOM_OPEN_KFID,
    reply.content,
  );

  log.info(`Reply sent to ${reply.external_user_id}`);
}

/**
 * Handle outbound image reply from a gateway.
 * Uploads the image to WeCom and sends it to the user.
 */
export async function handleOutboundImageReply(
  reply: ImageReplyFrame,
  config: Config,
): Promise<void> {
  log.info(`Sending image reply to ${reply.external_user_id}, frame id: ${reply.id}`);

  const accessToken = await getAccessToken(config.WECOM_CORPID, config.WECOM_APP_SECRET);
  const imageBuffer = Buffer.from(reply.image_data, "base64");
  const mediaId = await uploadMedia(accessToken, imageBuffer, reply.image_mime);

  await sendImageMessage(
    accessToken,
    reply.external_user_id,
    config.WECOM_OPEN_KFID,
    mediaId,
  );

  log.info(`Image reply sent to ${reply.external_user_id}`);
}
