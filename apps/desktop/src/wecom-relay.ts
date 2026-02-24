import { createLogger } from "@easyclaw/logger";
import { GatewayRpcClient, resolveOpenClawStateDir } from "@easyclaw/gateway";
import type { Storage } from "@easyclaw/storage";
import { randomUUID } from "node:crypto";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import WebSocket from "ws";

const log = createLogger("wecom-relay");

/** Audio formats natively supported by STT providers (Groq Whisper). */
const STT_SUPPORTED_FORMATS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);

/**
 * Convert audio to MP3 using ffmpeg (piped via stdin/stdout).
 * Throws if ffmpeg is unavailable — callers should surface the error.
 */
function convertAudioToMp3(input: Buffer, inputFormat: string): Promise<{ data: Buffer; format: string }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      "ffmpeg",
      ["-i", "pipe:0", "-f", inputFormat, "-f", "mp3", "-ac", "1", "-ar", "16000", "pipe:1"],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 15_000 },
      (err, stdout) => {
        if (err) {
          const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
          if (isNotFound) {
            reject(new Error(
              "ffmpeg not found. Voice messages in AMR format require ffmpeg for conversion.\n" +
              "  macOS:   brew install ffmpeg\n" +
              "  Windows: winget install ffmpeg   (or download from https://ffmpeg.org/download.html)\n" +
              "  Linux:   sudo apt install ffmpeg",
            ));
            return;
          }
          reject(new Error(`ffmpeg conversion failed: ${err.message}`));
          return;
        }
        if (!stdout || stdout.length === 0) {
          reject(new Error("ffmpeg produced empty output"));
          return;
        }
        resolve({ data: stdout as unknown as Buffer, format: "mp3" });
      },
    );
    proc.stdin?.end(input);
  });
}

export interface WeComRelayState {
  relayUrl: string;
  authToken: string;
  connected: boolean;
  externalUserId?: string;
  bindingToken?: string;
  customerServiceUrl?: string;
}

export interface WeComConnParams {
  relayUrl: string;
  authToken: string;
  gatewayId: string;
  gatewayWsUrl: string;
  gatewayToken?: string;
}

interface SttManager {
  transcribe(audio: Buffer, format: string): Promise<string | null>;
  isEnabled(): boolean;
}

export interface WeComRelayDeps {
  pushChatSSE: (event: string, data: unknown) => void;
}

const WECOM_RECONNECT_MIN_MS = 1_000;
const WECOM_RECONNECT_MAX_MS = 30_000;

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
          handleInbound(frame);
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

  async function handleInbound(frame: {
    id: string;
    external_user_id: string;
    msg_type: string;
    content: string;
    timestamp: number;
    media_data?: string;
    media_mime?: string;
  }): Promise<void> {
    if (!gatewayRpc || !gatewayRpc.isConnected()) {
      log.warn("WeCom: gateway RPC not connected, cannot forward message");
      return;
    }

    userIdCaseMap.set(frame.external_user_id.toLowerCase(), frame.external_user_id);
    log.info(`WeCom: forwarding ${frame.msg_type} from ${frame.external_user_id} to agent`);

    let message = frame.content;
    let attachments: Array<{ type: string; mimeType: string; content: string }> | undefined;

    // Transcribe voice messages using the STT manager
    if (frame.msg_type === "voice" && frame.media_data) {
      if (sttManager?.isEnabled()) {
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
          const transcribed = await sttManager.transcribe(audioBuffer, format);
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
      const result = await gatewayRpc.request<{ runId?: string }>("agent", {
        sessionKey: "agent:main:main",
        channel: "wechat",
        message,
        attachments,
        idempotencyKey: frame.id,
      });
      if (result?.runId) {
        runIdMap.set(result.runId, frame.external_user_id);
        deps.pushChatSSE("inbound", {
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

  async function handleChatEvent(payload: unknown): Promise<void> {
    const p = payload as Record<string, unknown> | null;
    if (!p) return;

    const runId = p.runId as string | undefined;
    if (!runId || !runIdMap.has(runId)) return;

    const rawUserId = runIdMap.get(runId)!;
    const externalUserId = userIdCaseMap.get(rawUserId.toLowerCase()) ?? rawUserId;

    if (p.state === "error") {
      runIdMap.delete(runId);
      const errorMsg = (p.errorMessage as string) ?? "An error occurred";
      log.warn(`WeCom: agent error for ${externalUserId}: ${errorMsg}`);
      if (relayWs && relayWs.readyState === WebSocket.OPEN) {
        relayWs.send(JSON.stringify({
          type: "reply",
          id: randomUUID(),
          external_user_id: externalUserId,
          content: `⚠ ${errorMsg}`,
        }));
      }
      return;
    }

    if (p.state !== "final") return;

    runIdMap.delete(runId);
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
      const result = await gatewayRpc?.request<{ images?: Array<{ to: string; mediaUrl: string; text: string }> }>(
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

    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
      const replyText = cleanedTexts.join("\n\n").replace(/\bNO_REPLY\b/g, "").trim();
      if (replyText) {
        relayWs.send(JSON.stringify({
          type: "reply",
          id: randomUUID(),
          external_user_id: externalUserId,
          content: replyText,
        }));
        log.info(`WeCom: reply sent to ${externalUserId} (${replyText.length} chars)`);
      }

      for (const img of images) {
        relayWs.send(JSON.stringify({
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
    if (imageRefs.length > 0 && gatewayRpc) {
      try {
        await gatewayRpc.request("chat.inject", {
          sessionKey: "agent:main:main",
          message: imageRefs.join("\n"),
        });
        log.info(`WeCom: injected ${imageRefs.length} image ref(s) into chat transcript`);
      } catch (err) {
        log.warn(`WeCom: failed to inject image refs: ${err}`);
      }
    }
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
          handleChatEvent(evt.payload).catch((err) => log.error("WeCom: chat event handler error:", err));
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
