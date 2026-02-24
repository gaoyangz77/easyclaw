import { createLogger } from "@easyclaw/logger";
import type { GatewayRpcClient } from "@easyclaw/gateway";
import type { Storage } from "@easyclaw/storage";
import { randomUUID } from "node:crypto";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import { promises as fs } from "node:fs";
import WebSocket from "ws";
import { STT_SUPPORTED_FORMATS, convertAudioToMp3 } from "./audio-converter.js";
import type { SttManager, WeComConnParams } from "./wecom-types.js";

const log = createLogger("wecom-relay");

/** All closure refs needed by message handlers, passed as a context object. */
export interface WeComHandlerContext {
  relayWs: WebSocket | null;
  gatewayRpc: GatewayRpcClient | null;
  sttManager: SttManager | null;
  storageRef: Storage | null;
  connParams: WeComConnParams | null;
  userIdCaseMap: Map<string, string>;
  runIdMap: Map<string, string>;
  pushChatSSE: (event: string, data: unknown) => void;
}

export async function handleInbound(
  frame: {
    id: string;
    external_user_id: string;
    msg_type: string;
    content: string;
    timestamp: number;
    media_data?: string;
    media_mime?: string;
  },
  ctx: WeComHandlerContext,
): Promise<void> {
  if (!ctx.gatewayRpc || !ctx.gatewayRpc.isConnected()) {
    log.warn("WeCom: gateway RPC not connected, cannot forward message");
    return;
  }

  ctx.userIdCaseMap.set(frame.external_user_id.toLowerCase(), frame.external_user_id);
  log.info(`WeCom: forwarding ${frame.msg_type} from ${frame.external_user_id} to agent`);

  let message = frame.content;
  let attachments: Array<{ type: string; mimeType: string; content: string }> | undefined;

  // Transcribe voice messages using the STT manager
  if (frame.msg_type === "voice" && frame.media_data) {
    if (ctx.sttManager?.isEnabled()) {
      try {
        let audioBuffer: Buffer = Buffer.from(frame.media_data, "base64");
        let format = frame.media_mime?.split("/").pop()?.split(";")[0] ?? "amr";

        if (!STT_SUPPORTED_FORMATS.has(format.toLowerCase())) {
          log.info(`WeCom: converting ${format} → mp3 via ffmpeg`);
          const converted = await convertAudioToMp3(audioBuffer, format);
          audioBuffer = converted.data;
          format = converted.format;
        }

        log.info(`WeCom: transcribing voice (${audioBuffer.length} bytes, format=${format})`);
        const transcribed = await ctx.sttManager.transcribe(audioBuffer, format);
        if (transcribed) {
          message = `[语音消息] ${transcribed}`;
          log.info(`WeCom: voice transcribed: ${transcribed.substring(0, 80)}...`);
        } else {
          message = "[语音消息 - 转写失败]";
          log.warn("WeCom: voice transcription returned null");
        }
      } catch (err) {
        log.error("WeCom: voice transcription error:", err);
        const errMsg = err instanceof Error ? err.message : String(err);
        message = `[语音消息 - 转写失败] ${errMsg}`;
      }
    } else {
      log.warn("WeCom: STT not enabled, cannot transcribe voice message");
      message = "[语音消息 - 语音转文字服务未启用]";
    }
  }

  // Pass image data as attachments so the agent can see the image.
  if (frame.msg_type === "image" && frame.media_data && frame.media_mime) {
    const extMap: Record<string, string> = {
      "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
      "image/webp": ".webp", "image/bmp": ".bmp",
    };
    const ext = extMap[frame.media_mime] ?? ".jpg";
    const mediaDir = join(homedir(), ".easyclaw", "openclaw", "media", "inbound");
    const fileName = `wecom-${Date.now()}${ext}`;
    const filePath = join(mediaDir, fileName);
    try {
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.writeFile(filePath, Buffer.from(frame.media_data, "base64"));
      message = `用户发来了一张图片，请查看并回应。图片已保存至 ${filePath}`;
      log.info(`WeCom: saved inbound image to ${filePath}`);
    } catch (err) {
      log.error(`WeCom: failed to save inbound image: ${err}`);
      message = message || "[图片]";
    }
    attachments = [{
      type: "image",
      mimeType: frame.media_mime,
      content: frame.media_data,
    }];
  }

  try {
    const result = await ctx.gatewayRpc.request<{ runId?: string }>("agent", {
      sessionKey: "agent:main:main",
      channel: "wechat",
      message,
      attachments,
      idempotencyKey: frame.id,
    });
    if (result?.runId) {
      ctx.runIdMap.set(result.runId, frame.external_user_id);
      ctx.pushChatSSE("inbound", {
        runId: result.runId,
        sessionKey: "agent:main:main",
        channel: "wechat",
        message,
        timestamp: frame.timestamp,
      });
    }
  } catch (err) {
    log.error("WeCom: agent request failed:", err);
  }
}

export async function handleChatEvent(
  payload: unknown,
  ctx: WeComHandlerContext,
): Promise<void> {
  const p = payload as Record<string, unknown> | null;
  if (!p) return;

  const runId = p.runId as string | undefined;
  if (!runId || !ctx.runIdMap.has(runId)) return;

  const rawUserId = ctx.runIdMap.get(runId)!;
  const externalUserId = ctx.userIdCaseMap.get(rawUserId.toLowerCase()) ?? rawUserId;

  if (p.state === "error") {
    ctx.runIdMap.delete(runId);
    const errorMsg = (p.errorMessage as string) ?? "An error occurred";
    log.warn(`WeCom: agent error for ${externalUserId}: ${errorMsg}`);
    if (ctx.relayWs && ctx.relayWs.readyState === WebSocket.OPEN) {
      ctx.relayWs.send(JSON.stringify({
        type: "reply",
        id: randomUUID(),
        external_user_id: externalUserId,
        content: `⚠ ${errorMsg}`,
      }));
    }
    return;
  }

  if (p.state !== "final") return;

  ctx.runIdMap.delete(runId);
  const message = p.message as Record<string, unknown> | undefined;
  const content = message?.content;

  // Collect raw text from content blocks
  const rawTexts: string[] = [];
  if (Array.isArray(content)) {
    for (const c of content) {
      const block = c as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        rawTexts.push(block.text as string);
      }
    }
  }

  // Parse MEDIA: directives from text
  const MEDIA_RE = /\bMEDIA:\s*`?([^\n`]+)`?/gi;
  const mediaFiles: string[] = [];
  const cleanedTexts: string[] = [];

  for (const raw of rawTexts) {
    const lines = raw.split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      const match = MEDIA_RE.exec(line);
      MEDIA_RE.lastIndex = 0;
      if (match) {
        const filePath = match[1].replace(/^[`"']+/, "").replace(/[`"']+$/, "").trim();
        if (filePath.startsWith("/") && /\.\w{1,10}$/.test(filePath)) {
          mediaFiles.push(filePath);
          const cleaned = line.replace(MEDIA_RE, "").trim();
          MEDIA_RE.lastIndex = 0;
          if (cleaned) kept.push(cleaned);
          continue;
        }
      }
      kept.push(line);
    }
    const cleaned = kept.join("\n").trim();
    if (cleaned) cleanedTexts.push(cleaned);
  }

  // Fetch pending images queued by the plugin's sendMedia
  try {
    const result = await ctx.gatewayRpc?.request<{ images?: Array<{ to: string; mediaUrl: string; text: string }> }>(
      "wecom_get_pending_images",
    );
    if (result?.images?.length) {
      for (const img of result.images) {
        if (img.mediaUrl) mediaFiles.push(img.mediaUrl);
      }
      log.info(`WeCom: retrieved ${result.images.length} pending image(s) from plugin`);
    }
  } catch (err) {
    log.warn(`WeCom: failed to get pending images: ${err}`);
  }

  // Read media files from disk and prepare image payloads
  const images: Array<{ data: string; mimeType: string; savedName?: string }> = [];
  const outboundDir = join(homedir(), ".easyclaw", "openclaw", "media", "outbound");
  for (const filePath of mediaFiles) {
    try {
      const data = await fs.readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
        ".webp": "image/webp", ".bmp": "image/bmp",
      };
      const savedName = `wecom-${Date.now()}-${randomUUID().slice(0, 8)}${ext || ".png"}`;
      try {
        await fs.mkdir(outboundDir, { recursive: true });
        await fs.writeFile(join(outboundDir, savedName), data);
      } catch (saveErr) {
        log.warn(`WeCom: failed to save outbound image copy: ${saveErr}`);
      }
      images.push({
        data: data.toString("base64"),
        mimeType: mimeMap[ext] ?? "image/png",
        savedName,
      });
    } catch (err) {
      log.error(`WeCom: failed to read media file ${filePath}: ${err}`);
    }
  }

  if (ctx.relayWs && ctx.relayWs.readyState === WebSocket.OPEN) {
    const replyText = cleanedTexts.join("\n\n").replace(/\bNO_REPLY\b/g, "").trim();
    if (replyText) {
      ctx.relayWs.send(JSON.stringify({
        type: "reply",
        id: randomUUID(),
        external_user_id: externalUserId,
        content: replyText,
      }));
      log.info(`WeCom: reply sent to ${externalUserId} (${replyText.length} chars)`);
    }

    for (const img of images) {
      ctx.relayWs.send(JSON.stringify({
        type: "image_reply",
        id: randomUUID(),
        external_user_id: externalUserId,
        image_data: img.data,
        image_mime: img.mimeType,
      }));
      log.info(`WeCom: image reply sent to ${externalUserId} (${img.mimeType})`);
    }
  } else {
    log.warn(`WeCom: relay WS not open, cannot send reply to ${externalUserId}`);
  }

  // Inject image references into session transcript
  const imageRefs = images
    .filter((img) => img.savedName)
    .map((img) => `![📷](/api/media/outbound/${img.savedName})`);
  if (imageRefs.length > 0 && ctx.gatewayRpc) {
    try {
      await ctx.gatewayRpc.request("chat.inject", {
        sessionKey: "agent:main:main",
        message: imageRefs.join("\n"),
      });
      log.info(`WeCom: injected ${imageRefs.length} image ref(s) into chat transcript`);
    } catch (err) {
      log.warn(`WeCom: failed to inject image refs: ${err}`);
    }
  }
}
