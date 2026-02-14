import { createLogger } from "@easyclaw/logger";

const log = createLogger("wecom:send-message");

const WECOM_API_BASE = "https://qyapi.weixin.qq.com";

/** WeCom text message has a 2048-byte limit */
const MAX_TEXT_BYTES = 2048;

interface SendMsgResponse {
  errcode: number;
  errmsg: string;
  msgid?: string;
}

/**
 * Send a text message to a WeCom customer service user.
 *
 * POST /cgi-bin/kf/send_msg?access_token=TOKEN
 *
 * Handles the 2048-byte text limit by truncating if necessary.
 */
export async function sendTextMessage(
  accessToken: string,
  toUser: string,
  openKfId: string,
  content: string,
): Promise<string | undefined> {
  const url = `${WECOM_API_BASE}/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`;

  // Truncate content if it exceeds the byte limit
  let truncated = content;
  const encoder = new TextEncoder();
  if (encoder.encode(content).length > MAX_TEXT_BYTES) {
    // Binary search for the right cutoff point
    let lo = 0;
    let hi = content.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (encoder.encode(content.slice(0, mid)).length <= MAX_TEXT_BYTES - 3) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    truncated = content.slice(0, lo) + "...";
    log.warn(`Message truncated from ${encoder.encode(content).length} to ${encoder.encode(truncated).length} bytes`);
  }

  const body = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "text",
    text: { content: truncated },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`send_msg request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as SendMsgResponse;

  if (data.errcode !== 0) {
    throw new Error(`send_msg API error: ${data.errcode} ${data.errmsg}`);
  }

  log.info(`Message sent to ${toUser}, msgid: ${data.msgid}`);
  return data.msgid;
}

/**
 * Upload a media file to WeCom and return its media_id.
 *
 * POST /cgi-bin/media/upload?access_token=TOKEN&type=TYPE
 *
 * The media_id is valid for 3 days.
 */
export async function uploadMedia(
  accessToken: string,
  data: Buffer,
  mime: string,
  type: "image" | "voice" | "video" | "file" = "image",
): Promise<string> {
  const url = `${WECOM_API_BASE}/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=${type}`;

  // Determine file extension from MIME
  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
  };
  const ext = extMap[mime] ?? "bin";
  const filename = `upload.${ext}`;

  // Build multipart/form-data manually
  const boundary = `----EasyClawBoundary${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, data, footer]);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!response.ok) {
    throw new Error(`media/upload request failed: HTTP ${response.status}`);
  }

  const result = (await response.json()) as { errcode: number; errmsg: string; media_id?: string };

  if (result.errcode !== 0 || !result.media_id) {
    throw new Error(`media/upload API error: ${result.errcode} ${result.errmsg}`);
  }

  log.info(`Media uploaded: ${result.media_id} (${data.length} bytes, ${mime})`);
  return result.media_id;
}

/**
 * Send an image message to a WeCom customer service user.
 *
 * POST /cgi-bin/kf/send_msg?access_token=TOKEN
 */
export async function sendImageMessage(
  accessToken: string,
  toUser: string,
  openKfId: string,
  mediaId: string,
): Promise<string | undefined> {
  const url = `${WECOM_API_BASE}/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`;

  const body = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "image",
    image: { media_id: mediaId },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`send_msg (image) request failed: HTTP ${response.status}`);
  }

  const result = (await response.json()) as SendMsgResponse;

  if (result.errcode !== 0) {
    throw new Error(`send_msg (image) API error: ${result.errcode} ${result.errmsg}`);
  }

  log.info(`Image sent to ${toUser}, msgid: ${result.msgid}`);
  return result.msgid;
}

/**
 * End a customer service session by transitioning to state 4 (ended).
 *
 * POST /cgi-bin/kf/service_state/trans?access_token=TOKEN
 *
 * This resets the session so the user can re-enter and trigger
 * a new enter_session event with scene_param on their next visit.
 */
export async function endCustomerSession(
  accessToken: string,
  openKfId: string,
  externalUserId: string,
): Promise<void> {
  const url = `${WECOM_API_BASE}/cgi-bin/kf/service_state/trans?access_token=${encodeURIComponent(accessToken)}`;

  const body = {
    open_kfid: openKfId,
    external_userid: externalUserId,
    service_state: 4,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    log.warn(`service_state/trans request failed for ${externalUserId}: HTTP ${response.status}`);
    return;
  }

  const data = (await response.json()) as { errcode: number; errmsg: string };

  if (data.errcode !== 0) {
    log.warn(`service_state/trans API error for ${externalUserId}: ${data.errcode} ${data.errmsg}`);
    return;
  }

  log.info(`Session ended for ${externalUserId}`);
}

/**
 * Get a customer service contact way URL with scene support.
 *
 * POST /cgi-bin/kf/add_contact_way
 *
 * Caches the result so the API is only called once per relay lifetime.
 * The scene is fixed to "bind"; per-request tokens are appended as scene_param.
 */
let cachedContactWayUrl: string | null = null;

export async function getContactWayUrl(
  accessToken: string,
  openKfId: string,
): Promise<string> {
  if (cachedContactWayUrl) return cachedContactWayUrl;

  const url = `${WECOM_API_BASE}/cgi-bin/kf/add_contact_way?access_token=${encodeURIComponent(accessToken)}`;

  const body = { open_kfid: openKfId, scene: "bind" };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`add_contact_way request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { errcode: number; errmsg: string; url?: string };

  if (data.errcode !== 0 || !data.url) {
    throw new Error(`add_contact_way API error: ${data.errcode} ${data.errmsg}`);
  }

  cachedContactWayUrl = data.url;
  log.info(`Contact way URL created: ${cachedContactWayUrl}`);
  return cachedContactWayUrl;
}
