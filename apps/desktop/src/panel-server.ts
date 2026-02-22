import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, resolve, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";
import type { ArtifactStatus, ArtifactType, LLMProvider } from "@easyclaw/core";
import { getProviderMeta, getDefaultModelForProvider, providerSecretKey, parseProxyUrl, reconstructProxyUrl } from "@easyclaw/core";
import { readFullModelCatalog, resolveOpenClawConfigPath, readExistingConfig, resolveOpenClawStateDir, GatewayRpcClient, writeChannelAccount, removeChannelAccount, syncPermissions } from "@easyclaw/gateway";
import { loadCostUsageSummary, discoverAllSessions, loadSessionCostSummary } from "../../../vendor/openclaw/src/infra/session-cost-usage.js";
import type { CostUsageSummary, SessionCostSummary } from "../../../vendor/openclaw/src/infra/session-cost-usage.js";
import type { ChannelsStatusSnapshot } from "@easyclaw/core";
import { removeSkillFile } from "@easyclaw/rules";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import AdmZip from "adm-zip";
import WebSocket from "ws";
import { UsageSnapshotEngine } from "./usage-snapshot-engine.js";
import type { ModelUsageTotals } from "./usage-snapshot-engine.js";
import { UsageQueryService } from "./usage-query-service.js";
import { initCSBridge, startCS, stopCS, getCSStatus, updateCSConfig, restoreCS } from "./customer-service-bridge.js";

const log = createLogger("panel-server");

/** Directory where user-installed skills are stored. */
const USER_SKILLS_DIR = join(homedir(), ".easyclaw", "openclaw", "skills");

/**
 * Invalidate the cached skills snapshot in the gateway session store.
 *
 * The gateway's `agentCommand` only rebuilds the skills snapshot for new sessions
 * (`isNewSession || !sessionEntry?.skillsSnapshot`).  After installing or deleting
 * a skill we need the agent to pick up the change immediately, so we clear
 * `skillsSnapshot` from every session entry.  The next message will trigger a
 * fresh snapshot build that includes the updated skill set.
 */
function invalidateSkillsSnapshot(): void {
  try {
    const stateDir = resolveOpenClawStateDir();
    const storePath = join(stateDir, "agents", "main", "sessions", "sessions.json");
    if (!existsSync(storePath)) return;
    const store = JSON.parse(readFileSync(storePath, "utf-8")) as Record<string, Record<string, unknown>>;
    let changed = false;
    for (const entry of Object.values(store)) {
      if (entry.skillsSnapshot) {
        delete entry.skillsSnapshot;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
      log.info("Cleared cached skillsSnapshot from session store");
    }
  } catch (err) {
    log.warn("Failed to invalidate skills snapshot:", err);
  }
}

/** Supported formats that Groq Whisper accepts directly (no conversion needed). */
const STT_SUPPORTED_FORMATS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);

/**
 * Convert audio to MP3 using ffmpeg (piped via stdin/stdout).
 * Returns the converted buffer and "mp3" format string.
 * Falls back to the original buffer if ffmpeg is unavailable.
 */
function convertAudioToMp3(input: Buffer, inputFormat: string): Promise<{ data: Buffer; format: string }> {
  return new Promise((resolve) => {
    const proc = execFile(
      "ffmpeg",
      ["-i", `pipe:0`, "-f", inputFormat, "-f", "mp3", "-ac", "1", "-ar", "16000", "pipe:1"],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 15_000 },
      (err, stdout) => {
        if (err || !stdout || stdout.length === 0) {
          log.warn(`ffmpeg conversion failed (${err?.message ?? "empty output"}), trying raw`);
          resolve({ data: input, format: inputFormat });
          return;
        }
        resolve({ data: stdout as unknown as Buffer, format: "mp3" });
      },
    );
    proc.stdin?.end(input);
  });
}

/**
 * Fetch through local proxy router so GFW-blocked APIs (Telegram, LINE, etc.)
 * can reach their targets via the system proxy.
 */
async function proxiedFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const { ProxyAgent } = await import("undici");
  // Cast dispatcher to any: undici's ProxyAgent extends undici.Dispatcher but
  // Node's built-in RequestInit expects undici-types.Dispatcher — structurally
  // equivalent but TS sees them as incompatible due to duplicate type packages.
  return fetch(url, { ...init, dispatcher: new ProxyAgent("http://127.0.0.1:9999") as any });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// --- Usage Types and Helpers ---

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  recordCount: number;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>;
  byProvider: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>;
}

interface UsageFilter {
  since?: string;
  until?: string;
  model?: string;
  provider?: string;
}

// WeCom relay state (in-memory, reset on app restart)
let wecomRelayState: {
  relayUrl: string;
  authToken: string;
  connected: boolean;
  externalUserId?: string;
  bindingToken?: string;
  customerServiceUrl?: string;
} | null = null;

// Map lowercased external_user_id → original case.
// OpenClaw lowercases session keys internally, so we need to recover
// the original WeCom external_userid (which is case-sensitive) for replies.
const wecomUserIdCaseMap = new Map<string, string>();

// Map runId → externalUserId for routing agent replies back to WeCom users.
const wecomRunIdMap = new Map<string, string>();

// === WeCom Relay Persistent Connection ===
// Maintains a long-lived WS to the relay server so that messages from
// WeCom users are forwarded to the local AI agent and replies flow back.

const WECOM_RECONNECT_MIN_MS = 1_000;
const WECOM_RECONNECT_MAX_MS = 30_000;

let wecomRelayWs: WebSocket | null = null;
let wecomReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wecomReconnectDelay = WECOM_RECONNECT_MIN_MS;
let wecomIntentionalClose = false;
let wecomGatewayRpc: GatewayRpcClient | null = null;

// STT manager reference for voice transcription (set during startPanelServer)
let wecomSttManager: { transcribe(audio: Buffer, format: string): Promise<string | null>; isEnabled(): boolean } | null = null;

// Storage reference for WeCom relay handlers (set during startPanelServer)
let wecomStorageRef: Storage | null = null;

// Cached connection params for reconnects
let wecomConnParams: {
  relayUrl: string;
  authToken: string;
  gatewayId: string;
  gatewayWsUrl: string;
  gatewayToken?: string;
} | null = null;

// === Chat Event SSE Bridge ===
// Push inbound messages and tool events to the Chat Page via Server-Sent Events.
// See ADR-022 for design rationale.

const chatEventSSEClients = new Set<ServerResponse>();

function pushChatSSE(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of chatEventSSEClients) {
    res.write(msg);
  }
}

/**
 * Start a persistent connection to the WeCom relay and a dedicated
 * gateway RPC client for forwarding messages to the AI agent.
 */
function startWeComRelay(params: {
  relayUrl: string;
  authToken: string;
  gatewayId: string;
  gatewayWsUrl: string;
  gatewayToken?: string;
}): void {
  stopWeComRelay();
  wecomIntentionalClose = false;
  wecomConnParams = params;

  // Dedicated gateway RPC client with onEvent to capture AI replies
  wecomGatewayRpc = new GatewayRpcClient({
    url: params.gatewayWsUrl,
    token: params.gatewayToken,
    deviceIdentityPath: join(resolveOpenClawStateDir(), "identity", "device.json"),
    onEvent: (evt) => {
      if (evt.event === "chat") {
        handleWeComChatEvent(evt.payload).catch((err) => log.error("WeCom: chat event handler error:", err));
      }
      // Forward tool events to Chat Page via SSE (see ADR-022)
      if (evt.event === "agent") {
        const p = evt.payload as Record<string, unknown> | undefined;
        if (p?.stream === "tool") {
          const data = p.data as Record<string, unknown> | undefined;
          pushChatSSE("tool", {
            runId: p.runId,
            phase: data?.phase,
            toolName: data?.name,
          });
        }
      }
    },
  });
  wecomGatewayRpc.start().catch((err) => {
    log.error("WeCom: gateway RPC start failed:", err);
  });

  // Persistent WS to relay
  doConnectWeComRelay();
}

/** Tear down all WeCom relay resources. */
function stopWeComRelay(): void {
  wecomIntentionalClose = true;
  if (wecomReconnectTimer) {
    clearTimeout(wecomReconnectTimer);
    wecomReconnectTimer = null;
  }
  if (wecomRelayWs) {
    wecomRelayWs.close();
    wecomRelayWs = null;
  }
  if (wecomGatewayRpc) {
    wecomGatewayRpc.stop();
    wecomGatewayRpc = null;
  }
}

function doConnectWeComRelay(): void {
  if (!wecomConnParams) return;
  const { relayUrl, authToken, gatewayId } = wecomConnParams;

  const ws = new WebSocket(relayUrl);
  wecomRelayWs = ws;

  ws.on("open", () => {
    log.info("WeCom relay: connected, sending hello");
    wecomReconnectDelay = WECOM_RECONNECT_MIN_MS;
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
        if (wecomRelayState) wecomRelayState.connected = true;
        return;
      }

      if (frame.type === "binding_resolved") {
        log.info(`WeCom relay: binding resolved for ${frame.external_user_id}`);
        if (wecomRelayState) {
          wecomRelayState.externalUserId = frame.external_user_id;
        }
        wecomStorageRef?.settings.set("wecom-external-user-id", frame.external_user_id);
        return;
      }

      if (frame.type === "binding_cleared") {
        log.info("WeCom relay: binding cleared (no active binding for this gateway)");
        if (wecomRelayState) {
          wecomRelayState.externalUserId = undefined;
        }
        wecomStorageRef?.settings.delete("wecom-external-user-id");
        return;
      }

      if (frame.type === "inbound") {
        handleWeComInbound(frame);
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
    wecomRelayWs = null;
    if (wecomRelayState && !wecomIntentionalClose) {
      wecomRelayState.connected = false;
    }
    if (!wecomIntentionalClose) {
      scheduleWeComReconnect();
    }
  });

  ws.on("error", (err: Error) => {
    log.error(`WeCom relay: WS error: ${err.message}`);
  });

  ws.on("ping", (data: Buffer) => {
    ws.pong(data);
  });
}

function scheduleWeComReconnect(): void {
  if (wecomReconnectTimer) clearTimeout(wecomReconnectTimer);
  log.info(`WeCom relay: reconnecting in ${wecomReconnectDelay}ms...`);
  wecomReconnectTimer = setTimeout(() => {
    wecomReconnectTimer = null;
    wecomReconnectDelay = Math.min(wecomReconnectDelay * 2, WECOM_RECONNECT_MAX_MS);
    doConnectWeComRelay();
  }, wecomReconnectDelay);
}

/** Forward an inbound WeCom message to the local AI agent via gateway RPC. */
async function handleWeComInbound(frame: {
  id: string;
  external_user_id: string;
  msg_type: string;
  content: string;
  timestamp: number;
  media_data?: string;
  media_mime?: string;
}): Promise<void> {
  if (!wecomGatewayRpc || !wecomGatewayRpc.isConnected()) {
    log.warn("WeCom: gateway RPC not connected, cannot forward message");
    return;
  }

  wecomUserIdCaseMap.set(frame.external_user_id.toLowerCase(), frame.external_user_id);
  log.info(`WeCom: forwarding ${frame.msg_type} from ${frame.external_user_id} to agent`);

  let message = frame.content;
  let attachments: Array<{ type: string; mimeType: string; content: string }> | undefined;

  // Transcribe voice messages using the STT manager
  if (frame.msg_type === "voice" && frame.media_data) {
    if (wecomSttManager?.isEnabled()) {
      try {
        let audioBuffer: Buffer = Buffer.from(frame.media_data, "base64");
        // WeCom voice is AMR format; extract format hint from MIME or default to "amr"
        let format = frame.media_mime?.split("/").pop()?.split(";")[0] ?? "amr";

        // Convert unsupported formats (e.g. AMR) to MP3 via ffmpeg
        if (!STT_SUPPORTED_FORMATS.has(format.toLowerCase())) {
          log.info(`WeCom: converting ${format} → mp3 via ffmpeg`);
          const converted = await convertAudioToMp3(audioBuffer, format);
          audioBuffer = converted.data;
          format = converted.format;
        }

        log.info(`WeCom: transcribing voice (${audioBuffer.length} bytes, format=${format})`);
        const transcribed = await wecomSttManager.transcribe(audioBuffer, format);
        if (transcribed) {
          message = transcribed;
          log.info(`WeCom: voice transcribed: ${transcribed.substring(0, 80)}...`);
        } else {
          message = "[语音消息 - 转写失败]";
          log.warn("WeCom: voice transcription returned null");
        }
      } catch (err) {
        log.error("WeCom: voice transcription error:", err);
        message = "[语音消息 - 转写失败]";
      }
    } else {
      log.warn("WeCom: STT not enabled, cannot transcribe voice message");
      message = "[语音消息 - 语音转文字服务未启用]";
    }
  }

  // Pass image data as attachments so the agent can see the image.
  // Also save to disk so the agent can reference the file path later (e.g. to send it back).
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
    const result = await wecomGatewayRpc.request<{ runId?: string }>("agent", {
      sessionKey: "agent:main:main",
      channel: "wechat",
      message,
      attachments,
      idempotencyKey: frame.id,
    });
    if (result?.runId) {
      wecomRunIdMap.set(result.runId, frame.external_user_id);
      pushChatSSE("inbound", {
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

/** Handle a gateway 'chat' event — extract the AI reply and send it back to WeCom. */
async function handleWeComChatEvent(payload: unknown): Promise<void> {
  const p = payload as Record<string, unknown> | null;
  if (!p) return;

  const runId = p.runId as string | undefined;
  if (!runId || !wecomRunIdMap.has(runId)) return;

  const rawUserId = wecomRunIdMap.get(runId)!;
  const externalUserId = wecomUserIdCaseMap.get(rawUserId.toLowerCase()) ?? rawUserId;

  if (p.state === "error") {
    wecomRunIdMap.delete(runId);
    const errorMsg = (p.errorMessage as string) ?? "An error occurred";
    log.warn(`WeCom: agent error for ${externalUserId}: ${errorMsg}`);
    if (wecomRelayWs && wecomRelayWs.readyState === WebSocket.OPEN) {
      wecomRelayWs.send(JSON.stringify({
        type: "reply",
        id: randomUUID(),
        external_user_id: externalUserId,
        content: `⚠ ${errorMsg}`,
      }));
    }
    return;
  }

  if (p.state !== "final") return;

  wecomRunIdMap.delete(runId);
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

  // Parse MEDIA: directives from text (fallback path when agent outputs MEDIA: in text)
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

  // Fetch pending images queued by the plugin's sendMedia (primary path).
  // The plugin stores outbound images in memory; we retrieve them via a
  // custom gateway RPC method: wecom_get_pending_images.
  try {
    const result = await wecomGatewayRpc?.request<{ images?: Array<{ to: string; mediaUrl: string; text: string }> }>(
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
      // Save a copy to outbound dir so it's accessible via /api/media/
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

  if (wecomRelayWs && wecomRelayWs.readyState === WebSocket.OPEN) {
    // Send text reply (with MEDIA: directives and NO_REPLY stripped)
    const replyText = cleanedTexts.join("\n\n").replace(/\bNO_REPLY\b/g, "").trim();
    if (replyText) {
      wecomRelayWs.send(JSON.stringify({
        type: "reply",
        id: randomUUID(),
        external_user_id: externalUserId,
        content: replyText,
      }));
      log.info(`WeCom: reply sent to ${externalUserId} (${replyText.length} chars)`);
    }

    // Send image replies
    for (const img of images) {
      wecomRelayWs.send(JSON.stringify({
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

  // Inject image references into session transcript so ChatPage can display them.
  // Uses chat.inject to write a markdown image reference that ChatPage renders.
  const imageRefs = images
    .filter((img) => img.savedName)
    .map((img) => `![📷](/api/media/outbound/${img.savedName})`);
  if (imageRefs.length > 0 && wecomGatewayRpc) {
    try {
      await wecomGatewayRpc.request("chat.inject", {
        sessionKey: "agent:main:main",
        message: imageRefs.join("\n"),
      });
      log.info(`WeCom: injected ${imageRefs.length} image ref(s) into chat transcript`);
    } catch (err) {
      log.warn(`WeCom: failed to inject image refs: ${err}`);
    }
  }
}

// Simple cache with TTL for usage data
const usageCache = new Map<string, { data: UsageSummary; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds (matching OpenClaw's cache)

function getCachedUsage(cacheKey: string): UsageSummary | null {
  const cached = usageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  usageCache.delete(cacheKey);
  return null;
}

function setCachedUsage(cacheKey: string, data: UsageSummary): void {
  usageCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- Pairing Store Helpers ---

interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

interface PairingStore {
  version: number;
  requests: PairingRequest[];
}

interface AllowFromStore {
  version: number;
  allowFrom: string[];
}

function resolvePairingPath(channelId: string): string {
  const stateDir = resolveOpenClawStateDir();
  return join(stateDir, "credentials", `${channelId}-pairing.json`);
}

function resolveAllowFromPath(channelId: string): string {
  const stateDir = resolveOpenClawStateDir();
  return join(stateDir, "credentials", `${channelId}-allowFrom.json`);
}

async function readPairingRequests(channelId: string): Promise<PairingRequest[]> {
  try {
    const filePath = resolvePairingPath(channelId);
    const content = await fs.readFile(filePath, "utf-8");
    const data: PairingStore = JSON.parse(content);
    return Array.isArray(data.requests) ? data.requests : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writePairingRequests(channelId: string, requests: PairingRequest[]): Promise<void> {
  const filePath = resolvePairingPath(channelId);
  const data: PairingStore = { version: 1, requests };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function readAllowFromList(channelId: string): Promise<string[]> {
  try {
    const filePath = resolveAllowFromPath(channelId);
    const content = await fs.readFile(filePath, "utf-8");
    const data: AllowFromStore = JSON.parse(content);
    return Array.isArray(data.allowFrom) ? data.allowFrom : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAllowFromList(channelId: string, allowFrom: string[]): Promise<void> {
  const filePath = resolveAllowFromPath(channelId);
  const data: AllowFromStore = { version: 1, allowFrom };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function transformToUsageSummary(
  costSummary: CostUsageSummary,
  sessionSummaries: SessionCostSummary[]
): UsageSummary {
  // Aggregate byModel and byProvider from session summaries
  const byModelMap = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>();

  const byProviderMap = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    count: number;
  }>();

  for (const session of sessionSummaries) {
    if (!session.modelUsage) continue;

    for (const modelUsage of session.modelUsage) {
      const model = modelUsage.model || "unknown";
      const provider = modelUsage.provider || "unknown";

      // Aggregate by model
      const modelKey = `${provider}/${model}`;
      const modelEntry = byModelMap.get(modelKey) || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        count: 0,
      };
      modelEntry.inputTokens += modelUsage.totals.input;
      modelEntry.outputTokens += modelUsage.totals.output;
      modelEntry.totalTokens += modelUsage.totals.totalTokens;
      modelEntry.estimatedCostUsd += modelUsage.totals.totalCost;
      modelEntry.count += modelUsage.count;
      byModelMap.set(modelKey, modelEntry);

      // Aggregate by provider
      const providerEntry = byProviderMap.get(provider) || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        count: 0,
      };
      providerEntry.inputTokens += modelUsage.totals.input;
      providerEntry.outputTokens += modelUsage.totals.output;
      providerEntry.totalTokens += modelUsage.totals.totalTokens;
      providerEntry.estimatedCostUsd += modelUsage.totals.totalCost;
      providerEntry.count += modelUsage.count;
      byProviderMap.set(provider, providerEntry);
    }
  }

  return {
    totalInputTokens: costSummary.totals.input,
    totalOutputTokens: costSummary.totals.output,
    totalTokens: costSummary.totals.totalTokens,
    totalEstimatedCostUsd: costSummary.totals.totalCost,
    recordCount: costSummary.daily.length,
    byModel: Object.fromEntries(byModelMap),
    byProvider: Object.fromEntries(byProviderMap),
  };
}

function emptyUsageSummary(): UsageSummary {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalEstimatedCostUsd: 0,
    recordCount: 0,
    byModel: {},
    byProvider: {},
  };
}

// --- Channel Message Senders ---

/** Detect system locale: "zh" for Chinese systems, "en" for everything else. */
function getSystemLocale(): "zh" | "en" {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

const PAIRING_MESSAGES = {
  zh: [
    "💡 [EasyClaw] 您的配对请求已收到。",
    "",
    "请前往管理面板 → 通道，选择要配对的通道并点击「白名单」完成配对。",
  ].join("\n"),
  en: [
    "💡 [EasyClaw] Your pairing request has been received.",
    "",
    "Please go to the panel → Channels, find the channel you want to match and click the \"Whitelist\" button.",
  ].join("\n"),
};

const APPROVAL_MESSAGES = {
  zh: "✅ [EasyClaw] 您的访问已获批准！现在可以开始和我对话了。",
  en: "✅ [EasyClaw] Your access has been approved! You can start chatting now.",
};

/**
 * Read the first account config for a channel from the OpenClaw config.
 * Returns { accountId, config } or null.
 */
function resolveFirstChannelAccount(channelId: string): { accountId: string; config: Record<string, unknown> } | null {
  try {
    const configPath = resolveOpenClawConfigPath();
    const fullConfig = readExistingConfig(configPath);
    const channels = (fullConfig.channels ?? {}) as Record<string, unknown>;
    const channel = (channels[channelId] ?? {}) as Record<string, unknown>;
    const accounts = (channel.accounts ?? {}) as Record<string, Record<string, unknown>>;
    for (const [accountId, config] of Object.entries(accounts)) {
      if (config && typeof config === "object") {
        return { accountId, config };
      }
    }
  } catch (err) {
    log.error(`Failed to resolve ${channelId} account config:`, err);
  }
  return null;
}

// Telegram: POST https://api.telegram.org/bot{token}/sendMessage
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("telegram");
  const botToken = account?.config.botToken;
  if (!botToken || typeof botToken !== "string") {
    log.error("Telegram: no bot token found");
    return false;
  }
  try {
    const res = await proxiedFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Telegram sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Telegram sendMessage error:", err);
    return false;
  }
}

// Feishu: Get tenant_access_token, then POST to /im/v1/messages
const feishuTokenCache: { token?: string; expiresAt?: number } = {};

async function getFeishuTenantToken(appId: string, appSecret: string, domain: string): Promise<string | null> {
  if (feishuTokenCache.token && feishuTokenCache.expiresAt && Date.now() < feishuTokenCache.expiresAt) {
    return feishuTokenCache.token;
  }
  const host = domain === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  try {
    const res = await fetch(`https://${host}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { tenant_access_token?: string; expire?: number };
    if (!data.tenant_access_token) return null;
    feishuTokenCache.token = data.tenant_access_token;
    feishuTokenCache.expiresAt = Date.now() + ((data.expire ?? 7200) - 60) * 1000;
    return data.tenant_access_token;
  } catch (err) {
    log.error("Feishu tenant token error:", err);
    return null;
  }
}

async function sendFeishuMessage(chatId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("feishu");
  if (!account) return false;
  const appId = account.config.appId as string;
  const appSecret = account.config.appSecret as string;
  const domain = (account.config.domain as string) ?? "feishu";
  if (!appId || !appSecret) {
    log.error("Feishu: missing appId or appSecret");
    return false;
  }
  const token = await getFeishuTenantToken(appId, appSecret, domain);
  if (!token) return false;
  const host = domain === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  try {
    const res = await fetch(`https://${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Feishu sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Feishu sendMessage error:", err);
    return false;
  }
}

// LINE: POST https://api.line.me/v2/bot/message/push
async function sendLineMessage(chatId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("line");
  const token = account?.config.channelAccessToken;
  if (!token || typeof token !== "string") {
    log.error("LINE: no channel access token found");
    return false;
  }
  try {
    const res = await proxiedFetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: chatId,
        messages: [{ type: "text", text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`LINE sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("LINE sendMessage error:", err);
    return false;
  }
}

// Mattermost: Create DM channel, then POST message
async function sendMattermostMessage(userId: string, text: string): Promise<boolean> {
  const account = resolveFirstChannelAccount("mattermost");
  const botToken = account?.config.botToken as string | undefined;
  const baseUrl = account?.config.baseUrl as string | undefined;
  if (!botToken || !baseUrl) {
    log.error("Mattermost: missing botToken or baseUrl");
    return false;
  }
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${botToken}`,
  };
  try {
    // Get bot's own user ID
    const meRes = await fetch(`${baseUrl}/api/v4/users/me`, { headers });
    if (!meRes.ok) return false;
    const me = await meRes.json() as { id: string };

    // Create/get DM channel
    const dmRes = await fetch(`${baseUrl}/api/v4/channels/direct`, {
      method: "POST",
      headers,
      body: JSON.stringify([me.id, userId]),
    });
    if (!dmRes.ok) return false;
    const dm = await dmRes.json() as { id: string };

    // Post message
    const res = await fetch(`${baseUrl}/api/v4/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel_id: dm.id, message: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`Mattermost sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log.error("Mattermost sendMessage error:", err);
    return false;
  }
}

/**
 * Send a message to a user on the given channel.
 * Returns true if successfully sent, false otherwise.
 */
async function sendChannelMessage(channelId: string, userId: string, text: string): Promise<boolean> {
  switch (channelId) {
    case "telegram": return sendTelegramMessage(userId, text);
    case "feishu": return sendFeishuMessage(userId, text);
    case "line": return sendLineMessage(userId, text);
    case "mattermost": return sendMattermostMessage(userId, text);
    default:
      log.info(`Channel ${channelId}: message sending not supported yet`);
      return false;
  }
}

/**
 * Watch pairing request files for ALL channels and send follow-up messages
 * when new pairing requests are created by OpenClaw.
 */
function startPairingNotifier(): { stop: () => void } {
  const credentialsDir = join(resolveOpenClawStateDir(), "credentials");
  // Track known codes per channel to avoid duplicate notifications
  const knownCodes = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Initialize known codes from all existing pairing files
  async function initKnownCodes() {
    try {
      const files = await fs.readdir(credentialsDir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith("-pairing.json")) continue;
        try {
          const content = await fs.readFile(join(credentialsDir, file), "utf-8");
          const data = JSON.parse(content) as PairingStore;
          if (Array.isArray(data.requests)) {
            for (const req of data.requests) {
              if (req.code) knownCodes.add(req.code);
            }
          }
        } catch {
          // Ignore per-file errors
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  async function checkForNewRequests() {
    try {
      const files = await fs.readdir(credentialsDir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith("-pairing.json")) continue;
        const channelId = file.replace("-pairing.json", "");

        const content = await fs.readFile(join(credentialsDir, file), "utf-8").catch(() => "");
        if (!content) continue;

        const data = JSON.parse(content) as PairingStore;
        if (!Array.isArray(data.requests)) continue;

        for (const req of data.requests) {
          if (!req.code || knownCodes.has(req.code)) continue;
          knownCodes.add(req.code);

          const message = PAIRING_MESSAGES[getSystemLocale()];

          log.info(`Sending pairing follow-up to ${channelId} user ${req.id}`);
          sendChannelMessage(channelId, req.id, message);
        }
      }
    } catch (err) {
      log.error("Pairing notifier check failed:", err);
    }
  }

  // Initialize
  initKnownCodes();

  // Watch for file changes
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    fs.mkdir(credentialsDir, { recursive: true }).then(() => {
      try {
        watcher = watch(credentialsDir, (_eventType, filename) => {
          if (!filename?.endsWith("-pairing.json")) return;

          // Debounce rapid changes
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(checkForNewRequests, 500);
        });
        log.info("Pairing notifier watching:", credentialsDir);
      } catch (err) {
        log.error("Failed to start pairing file watcher:", err);
      }
    });
  } catch (err) {
    log.error("Failed to create credentials directory:", err);
  }

  return {
    stop: () => {
      if (watcher) watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}

export interface PanelServerOptions {
  /** Port to listen on. Default: 3210 */
  port?: number;
  /** Directory containing the built panel files. */
  panelDistDir: string;
  /** Storage instance for SQLite-backed persistence. */
  storage: Storage;
  /** Secret store for API keys (Keychain on macOS, encrypted file elsewhere). */
  secretStore: SecretStore;
  /** Gateway RPC client getter (returns null if gateway not connected) */
  getRpcClient?: () => GatewayRpcClient | null;
  /** Callback fired when a rule is created, updated, or deleted. */
  onRuleChange?: (action: "created" | "updated" | "deleted" | "channel-created" | "channel-deleted", ruleId: string) => void;
  /**
   * Callback fired when provider settings change.
   * @param hint.configOnly - true if only the config file changed (e.g. model switch).
   *   When true, the gateway can be reloaded via SIGUSR1 instead of a full restart.
   * @param hint.keyOnly - true if only an API key changed (add/activate/delete).
   *   When true, only auth-profiles.json needs syncing — no restart at all.
   */
  onProviderChange?: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => void;
  /** Callback to open a native file/directory picker dialog. Returns the selected path or null. */
  onOpenFileDialog?: () => Promise<string | null>;
  /** STT manager instance for voice transcription (optional). */
  sttManager?: {
    transcribe(audio: Buffer, format: string): Promise<string | null>;
    isEnabled(): boolean;
    getProvider(): string | null;
    initialize(): Promise<void>;
  };
  /** Callback fired when STT settings change. */
  onSttChange?: () => void;
  /** Callback fired when file permissions change. Requires gateway restart to apply env vars. */
  onPermissionsChange?: () => void;
  /** Callback fired when a channel account is created or updated. */
  onChannelConfigured?: (channelId: string) => void;
  /** Callback to initiate an OAuth flow for a provider (e.g. gemini). */
  onOAuthFlow?: (provider: string) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  /** Callback to acquire OAuth tokens (step 1: opens browser, returns token preview). */
  onOAuthAcquire?: (provider: string) => Promise<{ email?: string; tokenPreview: string; manualMode?: boolean; authUrl?: string }>;
  /** Callback to validate + save acquired OAuth tokens (step 2: validates through proxy, creates provider key). */
  onOAuthSave?: (provider: string, options: { proxyUrl?: string; label?: string; model?: string }) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  /** Callback to complete a manual OAuth flow (user pastes redirect URL). */
  onOAuthManualComplete?: (provider: string, callbackUrl: string) => Promise<{ email?: string; tokenPreview: string }>;
  /** Callback to track a telemetry event (relays to RemoteTelemetryClient in main process). */
  onTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  /** Override path to the vendored OpenClaw directory (for packaged app). */
  vendorDir?: string;
  /** Stable device identifier (SHA-256 hash of hardware fingerprint). */
  deviceId?: string;
  /** Getter for the latest update check result. */
  getUpdateResult?: () => {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    download?: { url: string; sha256: string; size: number };
    releaseNotes?: string;
    error?: string;
  } | null;
  /** Getter for gateway connection info (WebSocket URL + auth token). */
  getGatewayInfo?: () => { wsUrl: string; token?: string };
  /** Path to changelog.json file. */
  changelogPath?: string;
  /** Callback to start downloading an available update. */
  onUpdateDownload?: () => Promise<void>;
  /** Callback to cancel an in-progress update download. */
  onUpdateCancel?: () => void;
  /** Callback to install a downloaded update and restart the app. */
  onUpdateInstall?: () => Promise<void>;
  /** Getter for the current update download state (idle/downloading/ready/etc.). */
  getUpdateDownloadState?: () => { status: string; [key: string]: unknown };
}

/**
 * Parse the JSON body from an incoming HTTP request.
 */
function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Validate an API key by making a lightweight call to the provider's API.
 * Returns { valid: true } or { valid: false, error: "..." }.
 */
async function validateProviderApiKey(
  provider: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const meta = getProviderMeta(provider as LLMProvider);
  if (!meta) {
    return { valid: false, error: "Unknown provider" };
  }
  const baseUrl = meta.baseUrl;

  // OAuth-only providers (e.g. gemini) don't support API key validation
  if (meta.oauth) {
    return { valid: false, error: "This provider uses OAuth authentication and cannot be validated with an API key." };
  }

  // Amazon Bedrock uses AWS Sig v4 — skip validation
  if (provider === "amazon-bedrock") {
    return { valid: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  // Priority: per-key proxy > proxy router (system proxy) > direct
  // Per-key proxy is typically outside GFW and can reach the API directly.
  // If no per-key proxy, fall back to proxy router which handles system proxy / direct.
  const { ProxyAgent } = await import("undici");
  const dispatcher: any = new ProxyAgent(proxyUrl || "http://127.0.0.1:9999");

  try {
    let res: Response;

    if (provider === "anthropic" || provider === "claude") {
      const isOAuthToken = apiKey.startsWith("sk-ant-oat01-");
      log.info(`Validating Anthropic ${isOAuthToken ? "OAuth token" : "API key"}...`);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };

      if (isOAuthToken) {
        headers["Authorization"] = `Bearer ${apiKey}`;
        headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20";
        headers["user-agent"] = "claude-cli/2.1.2 (external, cli)";
        headers["x-app"] = "cli";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      } else {
        headers["x-api-key"] = apiKey;
      }

      const body: Record<string, unknown> = {
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      };

      if (isOAuthToken) {
        body.system = "You are Claude Code, Anthropic's official CLI for Claude.";
      }

      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    } else if (provider === "moonshot-coding") {
      // Kimi Coding uses Anthropic Messages API — validate via POST /v1/messages
      log.info(`Validating ${provider} API key via ${baseUrl}/v1/messages ...`);
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "kimi-for-coding",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    } else if (provider === "minimax" || provider === "minimax-cn" || provider === "minimax-coding") {
      // MiniMax doesn't support GET /models — validate via a minimal chat completion
      log.info(`Validating ${provider} API key via ${baseUrl}/chat/completions ...`);
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "MiniMax-M2",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    } else {
      // OpenAI-compatible providers: GET /models
      log.info(`Validating ${provider} API key via ${baseUrl}/models ...`);
      res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    }

    log.info(`Validation response: ${res.status} ${res.statusText}`);
    if (res.status === 401 || res.status === 403) {
      // Read response body to distinguish real auth errors from firewall blocks
      const body = await res.text().catch(() => "");
      log.info(`Validation response body: ${body.slice(0, 300)}`);

      // Anthropic returns {"type":"error","error":{"type":"authentication_error",...}}
      // OpenAI returns {"error":{"code":"invalid_api_key",...}}
      // A firewall 403 will have completely different content (HTML block page, etc.)
      const isRealAuthError =
        body.includes("authentication_error") ||
        body.includes("invalid_api_key") ||
        body.includes("invalid_x-api-key") ||
        body.includes("Incorrect API key") ||
        body.includes('"unauthorized"');

      if (isRealAuthError) {
        return { valid: false, error: "Invalid API key" };
      }

      // 403 from firewall/proxy — not a key issue, likely network restriction
      return { valid: false, error: `Provider returned ${res.status} — this may be a network issue (firewall/proxy). Response: ${body.slice(0, 200)}` };
    }

    // Any non-2xx response is suspicious — don't accept the key
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.info(`Validation non-2xx response: ${res.status} body: ${body.slice(0, 300)}`);
      return { valid: false, error: `Provider returned ${res.status}: ${body.slice(0, 200)}` };
    }

    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("API key validation failed:", msg);
    if (msg.includes("abort")) {
      return { valid: false, error: "Validation timed out — check your network connection" };
    }
    return { valid: false, error: `Network error: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sync the active key for a provider to the canonical secret store slot.
 * The gateway reads `{provider}-api-key` — this keeps it in sync with multi-key management.
 */
async function syncActiveKey(
  provider: string,
  storage: Storage,
  secretStore: SecretStore,
): Promise<void> {
  const activeKey = storage.providerKeys.getDefault(provider);
  const canonicalKey = providerSecretKey(provider as LLMProvider);
  if (activeKey) {
    const keyValue = await secretStore.get(`provider-key-${activeKey.id}`);
    if (keyValue) {
      await secretStore.set(canonicalKey, keyValue);
      log.info(`Synced active key for ${provider} (${activeKey.label}) to ${canonicalKey}`);
    } else if (activeKey.authType === "local") {
      // Local providers (e.g. Ollama) don't require an API key — use provider name as dummy
      await secretStore.set(canonicalKey, provider);
      log.info(`Synced dummy key for local provider ${provider} to ${canonicalKey}`);
    }
  } else {
    await secretStore.delete(canonicalKey);
    log.info(`No active key for ${provider}, removed ${canonicalKey}`);
  }
}

/**
 * Create and start a local HTTP server that serves the panel SPA
 * and provides REST API endpoints backed by real storage.
 *
 * Binds to 127.0.0.1 only for security (no external access).
 */
export function startPanelServer(options: PanelServerOptions): Server {
  const port = options.port ?? 3210;
  const distDir = resolve(options.panelDistDir);
  const { storage, secretStore, getRpcClient, onRuleChange, onProviderChange, onOpenFileDialog, sttManager, onSttChange, onPermissionsChange, onChannelConfigured, onOAuthFlow, onOAuthAcquire, onOAuthSave, onOAuthManualComplete, onTelemetryTrack, vendorDir, deviceId, getUpdateResult, getGatewayInfo, changelogPath, onUpdateDownload, onUpdateCancel, onUpdateInstall, getUpdateDownloadState } = options;

  // Store references so module-level WeCom handlers can access them
  wecomStorageRef = storage;
  if (sttManager) {
    wecomSttManager = sttManager;
  }

  // Initialize the customer service bridge
  initCSBridge({ storage, secretStore, getGatewayInfo, deviceId });

  // Read changelog.json once at startup (cached in closure)
  let changelogEntries: unknown[] = [];
  if (changelogPath && existsSync(changelogPath)) {
    try {
      changelogEntries = JSON.parse(readFileSync(changelogPath, "utf-8"));
    } catch (err) {
      log.warn("Failed to read changelog.json:", err);
    }
  }

  // Ensure vendor OpenClaw functions (loadCostUsageSummary, discoverAllSessions)
  // read from EasyClaw's state dir (~/.easyclaw/openclaw/) instead of ~/.openclaw/
  process.env.OPENCLAW_STATE_DIR = resolveOpenClawStateDir();

  // --- Per-Key/Model Usage Tracking (W15-C) ---
  const captureUsage = async (): Promise<Map<string, ModelUsageTotals>> => {
    const result = new Map<string, ModelUsageTotals>();
    try {
      const ocConfigPath = resolveOpenClawConfigPath();
      const ocConfig = readExistingConfig(ocConfigPath);
      const sessions = await discoverAllSessions({});
      for (const s of sessions) {
        const summary = await loadSessionCostSummary({ sessionFile: s.sessionFile, config: ocConfig });
        if (!summary?.modelUsage) continue;
        for (const mu of summary.modelUsage) {
          const key = `${mu.provider ?? "unknown"}/${mu.model ?? "unknown"}`;
          const existing = result.get(key);
          if (existing) {
            existing.inputTokens += mu.totals.input;
            existing.outputTokens += mu.totals.output;
            existing.cacheReadTokens += mu.totals.cacheRead;
            existing.cacheWriteTokens += mu.totals.cacheWrite;
            existing.totalCostUsd = (parseFloat(existing.totalCostUsd) + mu.totals.totalCost).toFixed(6);
          } else {
            result.set(key, {
              inputTokens: mu.totals.input,
              outputTokens: mu.totals.output,
              cacheReadTokens: mu.totals.cacheRead,
              cacheWriteTokens: mu.totals.cacheWrite,
              totalCostUsd: mu.totals.totalCost.toFixed(6),
            });
          }
        }
      }
    } catch (err) {
      log.error("Failed to capture current usage:", err);
    }
    return result;
  };

  const snapshotEngine = new UsageSnapshotEngine(storage, captureUsage);
  const queryService = new UsageQueryService(storage, captureUsage);

  // Reconcile usage snapshots for all active keys on startup
  const allActiveKeys = storage.providerKeys.getAll().filter((k) => k.isDefault);
  for (const key of allActiveKeys) {
    snapshotEngine.reconcileOnStartup(key.id, key.provider, key.model).catch((err) => {
      log.error(`Failed to reconcile usage for key ${key.id}:`, err);
    });
  }

  // Start pairing notifier to send follow-up messages to Telegram users
  const pairingNotifier = startPairingNotifier();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint for chat page real-time events (inbound messages + tool events)
    if (pathname === "/api/chat/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(":ok\n\n");
      chatEventSSEClients.add(res);
      req.on("close", () => chatEventSSEClients.delete(res));
      return;
    }

    // Serve media files from ~/.easyclaw/openclaw/media/
    if (pathname.startsWith("/api/media/") && req.method === "GET") {
      const mediaBase = join(homedir(), ".easyclaw", "openclaw", "media");
      const relPath = decodeURIComponent(pathname.replace("/api/media/", ""));
      const absPath = resolve(mediaBase, relPath);
      // Security: ensure resolved path is within mediaBase
      if (!absPath.startsWith(mediaBase + "/")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      try {
        const data = readFileSync(absPath);
        const ext = extname(absPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".gif": "image/gif",
          ".webp": "image/webp", ".bmp": "image/bmp",
        };
        res.writeHead(200, {
          "Content-Type": mimeMap[ext] ?? "application/octet-stream",
          "Cache-Control": "private, max-age=86400",
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // API routes
    if (pathname.startsWith("/api/")) {
      // Changelog endpoint (handled in closure to access changelogEntries)
      if (pathname === "/api/app/changelog" && req.method === "GET") {
        const result = getUpdateResult?.();
        sendJson(res, 200, {
          currentVersion: result?.currentVersion ?? null,
          entries: changelogEntries,
        });
        return;
      }

      // --- In-app update download/install endpoints ---

      if (pathname === "/api/app/update/download" && req.method === "POST") {
        if (!onUpdateDownload) {
          sendJson(res, 501, { error: "Not supported" });
          return;
        }
        // Fire-and-forget: respond immediately, errors are tracked in download state
        onUpdateDownload().catch(() => {});
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/app/update/cancel" && req.method === "POST") {
        onUpdateCancel?.();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/app/update/download-status" && req.method === "GET") {
        const state = getUpdateDownloadState?.() ?? { status: "idle" };
        sendJson(res, 200, state);
        return;
      }

      if (pathname === "/api/app/update/install" && req.method === "POST") {
        if (!onUpdateInstall) {
          sendJson(res, 501, { error: "Not supported" });
          return;
        }
        onUpdateInstall()
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: msg });
          });
        return;
      }

      try {
        await handleApiRoute(req, res, url, pathname, storage, secretStore, getRpcClient, onRuleChange, onProviderChange, onOpenFileDialog, sttManager, onSttChange, onPermissionsChange, onChannelConfigured, onOAuthFlow, onOAuthAcquire, onOAuthSave, onOAuthManualComplete, onTelemetryTrack, vendorDir, deviceId, getUpdateResult, getGatewayInfo, snapshotEngine, queryService);
      } catch (err) {
        log.error("API error:", err);
        sendJson(res, 500, { error: "Internal server error" });
      }
      return;
    }

    // Static file serving for panel SPA
    serveStatic(res, distDir, pathname);
  });

  server.listen(port, "127.0.0.1", () => {
    log.info("Panel server listening on http://127.0.0.1:" + port);
  });

  server.on("close", () => pairingNotifier.stop());

  // Restore WeCom relay connection from persisted credentials
  const savedRelayUrl = storage.settings.get("wecom-relay-url");
  if (savedRelayUrl) {
    secretStore.get("wecom-auth-token").then((savedAuthToken) => {
      if (!savedAuthToken) return;
      const gwId = deviceId ?? randomUUID();
      const savedExternalUserId = storage.settings.get("wecom-external-user-id") as string | undefined;
      wecomRelayState = {
        relayUrl: savedRelayUrl,
        authToken: savedAuthToken,
        connected: false,
        externalUserId: savedExternalUserId,
      };
      const gwInfo = getGatewayInfo?.();
      startWeComRelay({
        relayUrl: savedRelayUrl,
        authToken: savedAuthToken,
        gatewayId: gwId,
        gatewayWsUrl: gwInfo?.wsUrl ?? "ws://127.0.0.1:28789",
        gatewayToken: gwInfo?.token,
      });
      log.info("WeCom relay: restored from saved credentials");
    }).catch((err) => {
      log.warn("WeCom relay: failed to restore saved credentials:", err);
    });
  }

  // Restore customer service module from persisted config
  restoreCS().catch((err) => {
    log.warn("CS: failed to restore from saved config:", err);
  });

  return server;
}

/**
 * Extract a route parameter from a pathname pattern like /api/rules/:id
 */
function extractIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  // Must be a single path segment (no slashes)
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest;
}

async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pathname: string,
  storage: Storage,
  secretStore: SecretStore,
  getRpcClient?: () => GatewayRpcClient | null,
  onRuleChange?: (action: "created" | "updated" | "deleted" | "channel-created" | "channel-deleted", ruleId: string) => void,
  onProviderChange?: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => void,
  onOpenFileDialog?: () => Promise<string | null>,
  sttManager?: {
    transcribe(audio: Buffer, format: string): Promise<string | null>;
    isEnabled(): boolean;
    getProvider(): string | null;
  },
  onSttChange?: () => void,
  onPermissionsChange?: () => void,
  onChannelConfigured?: (channelId: string) => void,
  onOAuthFlow?: (provider: string) => Promise<{ providerKeyId: string; email?: string; provider: string }>,
  onOAuthAcquire?: (provider: string) => Promise<{ email?: string; tokenPreview: string; manualMode?: boolean; authUrl?: string }>,
  onOAuthSave?: (provider: string, options: { proxyUrl?: string; label?: string; model?: string }) => Promise<{ providerKeyId: string; email?: string; provider: string }>,
  onOAuthManualComplete?: (provider: string, callbackUrl: string) => Promise<{ email?: string; tokenPreview: string }>,
  onTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void,
  vendorDir?: string,
  deviceId?: string,
  getUpdateResult?: () => {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    download?: { url: string; sha256: string; size: number };
    releaseNotes?: string;
  } | null,
  getGatewayInfo?: () => { wsUrl: string; token?: string },
  snapshotEngine?: UsageSnapshotEngine,
  queryService?: UsageQueryService,
): Promise<void> {
  // --- Status ---
  if (pathname === "/api/status" && req.method === "GET") {
    const ruleCount = storage.rules.getAll().length;
    const artifactCount = storage.artifacts.getAll().length;
    sendJson(res, 200, { status: "ok", ruleCount, artifactCount, deviceId: deviceId ?? null });
    return;
  }

  // --- Rules ---
  if (pathname === "/api/rules" && req.method === "GET") {
    const rules = storage.rules.getAll();
    const allArtifacts = storage.artifacts.getAll();

    // Build a map of ruleId -> latest artifact
    const artifactByRuleId = new Map<string, { status: ArtifactStatus; type: ArtifactType }>();
    for (const artifact of allArtifacts) {
      // Last artifact wins (they are ordered by compiled_at ASC, so last is most recent)
      artifactByRuleId.set(artifact.ruleId, {
        status: artifact.status,
        type: artifact.type,
      });
    }

    const enrichedRules = rules.map((rule) => {
      const artifact = artifactByRuleId.get(rule.id);
      return {
        ...rule,
        artifactStatus: artifact?.status,
        artifactType: artifact?.type,
      };
    });

    sendJson(res, 200, { rules: enrichedRules });
    return;
  }

  if (pathname === "/api/rules" && req.method === "POST") {
    const body = (await parseBody(req)) as { text?: string };
    if (!body.text || typeof body.text !== "string") {
      sendJson(res, 400, { error: "Missing required field: text" });
      return;
    }

    const id = randomUUID();
    const created = storage.rules.create({ id, text: body.text });
    onRuleChange?.("created", id);
    sendJson(res, 201, created);
    return;
  }

  // Rules with ID: PUT /api/rules/:id, DELETE /api/rules/:id
  const ruleId = extractIdFromPath(pathname, "/api/rules/");
  if (ruleId) {
    if (req.method === "PUT") {
      const body = (await parseBody(req)) as { text?: string };
      if (!body.text || typeof body.text !== "string") {
        sendJson(res, 400, { error: "Missing required field: text" });
        return;
      }

      const updated = storage.rules.update(ruleId, { text: body.text });
      if (!updated) {
        sendJson(res, 404, { error: "Rule not found" });
        return;
      }

      onRuleChange?.("updated", ruleId);
      sendJson(res, 200, updated);
      return;
    }

    if (req.method === "DELETE") {
      // Clean up skill files BEFORE deleting artifacts from DB,
      // since we need the artifact's outputPath to locate the SKILL.md.
      const artifacts = storage.artifacts.getByRuleId(ruleId);
      for (const artifact of artifacts) {
        if (artifact.type === "action-bundle" && artifact.outputPath) {
          removeSkillFile(artifact.outputPath);
        }
      }

      storage.artifacts.deleteByRuleId(ruleId);
      const deleted = storage.rules.delete(ruleId);
      if (!deleted) {
        sendJson(res, 404, { error: "Rule not found" });
        return;
      }

      onRuleChange?.("deleted", ruleId);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  // --- Settings ---
  if (pathname === "/api/settings" && req.method === "GET") {
    const settings = storage.settings.getAll();
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      masked[key] = value;
    }

    // Report "configured" for the active provider if it has any key (never expose actual keys).
    // Keys may exist in: (a) legacy secret store entry "${provider}-api-key",
    // (b) provider_keys table (API key or OAuth).
    const provider = settings["llm-provider"];
    if (provider) {
      const secretKey = `${provider}-api-key`;
      const legacyKey = await secretStore.get(secretKey);
      const hasLegacyKey = legacyKey !== null && legacyKey !== "";
      const hasProviderKey = storage.providerKeys.getAll()
        .some((k) => k.provider === provider);
      if (hasLegacyKey || hasProviderKey) {
        masked[secretKey] = "configured";
      }
    }

    sendJson(res, 200, { settings: masked });
    return;
  }

  if (pathname === "/api/settings/validate-key" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string; apiKey?: string; proxyUrl?: string };
    if (!body.provider || !body.apiKey) {
      sendJson(res, 400, { valid: false, error: "Missing provider or apiKey" });
      return;
    }
    const result = await validateProviderApiKey(body.provider, body.apiKey, body.proxyUrl || undefined);
    sendJson(res, 200, result);
    return;
  }

  // --- Telemetry Settings ---
  if (pathname === "/api/settings/telemetry" && req.method === "GET") {
    const enabledStr = storage.settings.get("telemetry_enabled");
    const enabled = enabledStr !== "false";
    sendJson(res, 200, { enabled });
    return;
  }

  if (pathname === "/api/settings/telemetry" && req.method === "PUT") {
    const body = (await parseBody(req)) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      sendJson(res, 400, { error: "Missing required field: enabled (boolean)" });
      return;
    }
    storage.settings.set("telemetry_enabled", body.enabled ? "true" : "false");
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- Telemetry Event Tracking (panel → main process relay) ---
  if (pathname === "/api/telemetry/track" && req.method === "POST") {
    const PANEL_EVENT_ALLOWLIST = new Set([
      "onboarding.started",
      "onboarding.provider_saved",
      "onboarding.completed",
      "panel.page_viewed",
      "chat.message_sent",
      "chat.response_received",
      "chat.generation_stopped",
      "rule.preset_used",
      "telemetry.toggled",
    ]);
    const body = (await parseBody(req)) as { eventType?: string; metadata?: Record<string, unknown> };
    if (!body.eventType || !PANEL_EVENT_ALLOWLIST.has(body.eventType)) {
      res.writeHead(204);
      res.end();
      return;
    }
    onTelemetryTrack?.(body.eventType, body.metadata);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/api/settings" && req.method === "PUT") {
    const body = (await parseBody(req)) as Record<string, string>;
    let providerChanged = false;
    let sttChanged = false;
    let permissionsChanged = false;
    for (const [key, value] of Object.entries(body)) {
      if (typeof key === "string" && typeof value === "string") {
        if (key.endsWith("-api-key")) {
          // API keys go to the secure secret store (Keychain/encrypted file),
          // NOT SQLite — so they are available to buildGatewayEnv.
          if (value) {
            await secretStore.set(key, value);
          } else {
            await secretStore.delete(key);
          }
          providerChanged = true;
        } else {
          storage.settings.set(key, value);
          if (key === "llm-provider") {
            providerChanged = true;
          }
          if (key === "stt.enabled" || key === "stt.provider") {
            sttChanged = true;
          }
          if (key === "file-permissions-full-access") {
            permissionsChanged = true;
          }
        }
      }
    }
    sendJson(res, 200, { ok: true });
    if (providerChanged) {
      onProviderChange?.();
    }
    if (sttChanged) {
      onSttChange?.();
    }
    if (permissionsChanged) {
      onPermissionsChange?.();
    }
    return;
  }

  // --- Agent Settings (OpenClaw config: session-level settings) ---
  if (pathname === "/api/agent-settings" && req.method === "GET") {
    try {
      const configPath = resolveOpenClawConfigPath();
      const fullConfig = readExistingConfig(configPath);
      const sessionCfg = typeof fullConfig.session === "object" && fullConfig.session !== null
        ? (fullConfig.session as Record<string, unknown>)
        : {};
      sendJson(res, 200, {
        dmScope: (sessionCfg.dmScope as string) ?? "main",
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  if (pathname === "/api/agent-settings" && req.method === "PUT") {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const configPath = resolveOpenClawConfigPath();
      const fullConfig = readExistingConfig(configPath);
      const existingSession = typeof fullConfig.session === "object" && fullConfig.session !== null
        ? (fullConfig.session as Record<string, unknown>)
        : {};

      if (body.dmScope !== undefined) {
        existingSession.dmScope = body.dmScope;
      }

      fullConfig.session = existingSession;
      writeFileSync(configPath, JSON.stringify(fullConfig, null, 2) + "\n", "utf-8");

      // Notify gateway to reload config
      onProviderChange?.({ configOnly: true });

      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // --- STT Credentials Status ---
  if (pathname === "/api/stt/credentials" && req.method === "GET") {
    try {
      const hasGroqKey = !!(await secretStore.get("stt-groq-apikey"));
      const hasVolcengineAppKey = !!(await secretStore.get("stt-volcengine-appkey"));
      const hasVolcengineAccessKey = !!(await secretStore.get("stt-volcengine-accesskey"));

      sendJson(res, 200, {
        groq: hasGroqKey,
        volcengine: hasVolcengineAppKey && hasVolcengineAccessKey,
      });
      return;
    } catch (err) {
      log.error("Failed to check STT credentials", err);
      sendJson(res, 500, { error: "Failed to check credentials" });
      return;
    }
  }

  // --- STT Credentials ---
  if (pathname === "/api/stt/credentials" && req.method === "PUT") {
    const body = (await parseBody(req)) as {
      provider?: string;
      apiKey?: string;
      appKey?: string;
      accessKey?: string;
    };

    if (!body.provider) {
      sendJson(res, 400, { error: "Missing provider" });
      return;
    }

    try {
      if (body.provider === "groq") {
        if (!body.apiKey) {
          sendJson(res, 400, { error: "Missing apiKey for Groq provider" });
          return;
        }
        await secretStore.set("stt-groq-apikey", body.apiKey);
      } else if (body.provider === "volcengine") {
        if (!body.appKey || !body.accessKey) {
          sendJson(res, 400, { error: "Missing appKey or accessKey for Volcengine provider" });
          return;
        }
        await secretStore.set("stt-volcengine-appkey", body.appKey);
        await secretStore.set("stt-volcengine-accesskey", body.accessKey);
      } else {
        sendJson(res, 400, { error: "Unknown provider" });
        return;
      }

      sendJson(res, 200, { ok: true });
      // Reinitialize STT manager with new credentials
      onSttChange?.();
      onTelemetryTrack?.("stt.configured", { provider: body.provider });
      return;
    } catch (err) {
      log.error("Failed to save STT credentials", err);
      sendJson(res, 500, { error: "Failed to save credentials" });
      return;
    }
  }

  // --- STT Transcribe ---
  if (pathname === "/api/stt/transcribe" && req.method === "POST") {
    if (!sttManager || !sttManager.isEnabled()) {
      sendJson(res, 503, { error: "STT service not enabled or not configured" });
      return;
    }

    const body = (await parseBody(req)) as {
      audio?: string; // Base64-encoded audio
      format?: string; // Audio format (e.g., "wav", "mp3", "ogg")
    };

    if (!body.audio || !body.format) {
      sendJson(res, 400, { error: "Missing audio or format" });
      return;
    }

    try {
      // Decode base64 audio
      const audioBuffer = Buffer.from(body.audio, "base64");

      // Transcribe
      const text = await sttManager.transcribe(audioBuffer, body.format);

      if (text === null) {
        sendJson(res, 500, { error: "Transcription failed" });
        return;
      }

      sendJson(res, 200, {
        text,
        provider: sttManager.getProvider(),
      });
      return;
    } catch (err) {
      log.error("STT transcription error", err);
      sendJson(res, 500, { error: "Transcription failed: " + String(err) });
      return;
    }
  }

  // --- STT Status ---
  if (pathname === "/api/stt/status" && req.method === "GET") {
    const enabled = sttManager?.isEnabled() ?? false;
    const provider = sttManager?.getProvider() ?? null;
    sendJson(res, 200, { enabled, provider });
    return;
  }

  // --- Provider Keys ---
  if (pathname === "/api/provider-keys" && req.method === "GET") {
    const keys = storage.providerKeys.getAll();

    // Reconstruct full proxy URLs (base URL + credentials from keychain)
    const keysWithProxy = await Promise.all(
      keys.map(async (key) => {
        if (!key.proxyBaseUrl) {
          return key;
        }

        // Try to get credentials from keychain
        const credentials = await secretStore.get(`proxy-auth-${key.id}`);
        const proxyUrl = credentials ? reconstructProxyUrl(key.proxyBaseUrl, credentials) : key.proxyBaseUrl;

        return { ...key, proxyUrl };
      })
    );

    sendJson(res, 200, { keys: keysWithProxy });
    return;
  }

  if (pathname === "/api/provider-keys" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      provider?: string;
      label?: string;
      model?: string;
      apiKey?: string;
      proxyUrl?: string;
      authType?: "api_key" | "oauth" | "local";
      baseUrl?: string;
    };

    const isLocal = body.authType === "local";

    if (!body.provider) {
      sendJson(res, 400, { error: "Missing required field: provider" });
      return;
    }
    if (!isLocal && !body.apiKey) {
      sendJson(res, 400, { error: "Missing required field: apiKey" });
      return;
    }

    // For local providers: skip API key validation (key is optional)
    // For cloud providers: validate key before saving
    if (!isLocal) {
      const validation = await validateProviderApiKey(body.provider, body.apiKey!, body.proxyUrl || undefined);
      if (!validation.valid) {
        sendJson(res, 422, { error: validation.error || "Invalid API key" });
        return;
      }
    }

    const id = randomUUID();
    const model = body.model || getDefaultModelForProvider(body.provider as LLMProvider)?.modelId || "";
    const label = body.label || "Default";

    // Parse proxy URL if provided (Option B: smart split)
    let proxyBaseUrl: string | null = null;
    if (body.proxyUrl?.trim()) {
      try {
        const proxyConfig = parseProxyUrl(body.proxyUrl.trim());
        proxyBaseUrl = proxyConfig.baseUrl;

        // If proxy has authentication, store credentials in keychain
        if (proxyConfig.hasAuth && proxyConfig.credentials) {
          await secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
        }
      } catch (error) {
        sendJson(res, 400, { error: `Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
    }

    // Check if this is the first key for this provider
    const existingKeys = storage.providerKeys.getByProvider(body.provider);
    const isFirst = existingKeys.length === 0;

    const entry = storage.providerKeys.create({
      id,
      provider: body.provider,
      label,
      model,
      isDefault: isFirst,
      proxyBaseUrl,
      authType: body.authType ?? "api_key",
      baseUrl: isLocal ? (body.baseUrl || null) : null,
      createdAt: "",
      updatedAt: "",
    });

    // Store the actual key in secret store (optional for local providers)
    if (body.apiKey) {
      await secretStore.set(`provider-key-${id}`, body.apiKey);
    }

    // If first key for this provider, set as active provider
    if (isFirst) {
      const currentProvider = storage.settings.get("llm-provider");
      if (!currentProvider) {
        storage.settings.set("llm-provider", body.provider);
      }
    }

    // Sync the active key to canonical slot
    await syncActiveKey(body.provider, storage, secretStore);

    // First key for provider needs config update (default model), others just need auth profile sync
    onProviderChange?.(isFirst ? { configOnly: true } : { keyOnly: true });

    onTelemetryTrack?.("provider.key_added", { provider: body.provider, isFirst });

    sendJson(res, 201, entry);
    return;
  }

  // Provider key activate: POST /api/provider-keys/:id/activate
  if (pathname.startsWith("/api/provider-keys/") && pathname.endsWith("/activate") && req.method === "POST") {
    const id = pathname.slice("/api/provider-keys/".length, -"/activate".length);
    const entry = storage.providerKeys.getById(id);
    if (!entry) {
      sendJson(res, 404, { error: "Key not found" });
      return;
    }

    // Check if model changes (must compare BEFORE setDefault overwrites)
    const oldDefault = storage.providerKeys.getDefault(entry.provider);
    const modelChanged = oldDefault?.model !== entry.model;
    const activeProvider = storage.settings.get("llm-provider");

    // W15-C: Record deactivation of old key BEFORE switching
    if (oldDefault && snapshotEngine) {
      await snapshotEngine.recordDeactivation(oldDefault.id, oldDefault.provider, oldDefault.model);
    }
    // W15-C: Record activation snapshot for new key
    if (snapshotEngine) {
      await snapshotEngine.recordActivation(entry.id, entry.provider, entry.model);
    }

    storage.providerKeys.setDefault(id);
    // Always update llm-provider to match the activated key's provider.
    // Previously the panel made a separate updateSettings call, but if it
    // failed the setting could diverge from the actual default key.
    storage.settings.set("llm-provider", entry.provider);
    await syncActiveKey(entry.provider, storage, secretStore);

    // Provider or model changed → full restart to rewrite config
    // Same provider + same model (e.g. key rotation) → just sync auth profile
    const providerChanged = entry.provider !== activeProvider;
    if (providerChanged || modelChanged) {
      onProviderChange?.();
    } else {
      onProviderChange?.({ keyOnly: true });
    }

    onTelemetryTrack?.("provider.activated", { provider: entry.provider });

    sendJson(res, 200, { ok: true });
    return;
  }

  // Provider key with ID: PUT /api/provider-keys/:id, DELETE /api/provider-keys/:id
  if (pathname.startsWith("/api/provider-keys/")) {
    const id = pathname.slice("/api/provider-keys/".length);
    // Skip if contains slash (handled by activate above)
    if (!id.includes("/")) {
      if (req.method === "PUT") {
        const body = (await parseBody(req)) as { label?: string; model?: string; proxyUrl?: string; baseUrl?: string };
        const existing = storage.providerKeys.getById(id);
        if (!existing) {
          sendJson(res, 404, { error: "Key not found" });
          return;
        }

        // Handle proxy URL update if provided
        let proxyBaseUrl: string | null | undefined = undefined;
        if (body.proxyUrl !== undefined) {
          if (body.proxyUrl === "" || body.proxyUrl === null) {
            // Clear proxy
            proxyBaseUrl = null;
            await secretStore.delete(`proxy-auth-${id}`);
          } else {
            // Update proxy
            try {
              const proxyConfig = parseProxyUrl(body.proxyUrl.trim());
              proxyBaseUrl = proxyConfig.baseUrl;

              // Update or clear credentials in keychain
              if (proxyConfig.hasAuth && proxyConfig.credentials) {
                await secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
              } else {
                await secretStore.delete(`proxy-auth-${id}`);
              }
            } catch (error) {
              sendJson(res, 400, { error: `Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}` });
              return;
            }
          }
        }

        // W15-C: Record deactivation when model changes on active key (BEFORE update)
        const modelChanging = !!(body.model && body.model !== existing.model);
        if (modelChanging && existing.isDefault && snapshotEngine) {
          await snapshotEngine.recordDeactivation(existing.id, existing.provider, existing.model);
        }

        const updated = storage.providerKeys.update(id, {
          label: body.label,
          model: body.model,
          proxyBaseUrl,
          baseUrl: body.baseUrl,
        });

        // W15-C: Record activation for the new model (AFTER update)
        if (modelChanging && existing.isDefault && snapshotEngine && body.model) {
          await snapshotEngine.recordActivation(existing.id, existing.provider, body.model);
        }

        // If model or proxy changed on the active key of the active provider, trigger gateway update.
        // Model changes need a full restart (not configOnly) because the config file must be
        // rewritten with the new model before the gateway can pick it up.
        const activeProvider = storage.settings.get("llm-provider");
        const modelChanged = modelChanging;
        const proxyChanged = proxyBaseUrl !== undefined && proxyBaseUrl !== existing.proxyBaseUrl;
        if (existing.isDefault && existing.provider === activeProvider && (modelChanged || proxyChanged)) {
          onProviderChange?.();
        }

        sendJson(res, 200, updated);
        return;
      }

      if (req.method === "DELETE") {
        const existing = storage.providerKeys.getById(id);
        if (!existing) {
          sendJson(res, 404, { error: "Key not found" });
          return;
        }

        // Delete from DB and secret store
        storage.providerKeys.delete(id);
        await secretStore.delete(`provider-key-${id}`);
        // Also delete proxy credentials if they exist
        await secretStore.delete(`proxy-auth-${id}`);

        // If was default, promote next key for same provider
        let promotedModel: string | undefined;
        if (existing.isDefault) {
          const remaining = storage.providerKeys.getByProvider(existing.provider);
          if (remaining.length > 0) {
            storage.providerKeys.setDefault(remaining[0].id);
            promotedModel = remaining[0].model;
          }
        }

        // Sync active key (may have promoted a new default or removed the profile)
        await syncActiveKey(existing.provider, storage, secretStore);

        // If the promoted key has a different model (or last key removed), config needs updating
        const activeProvider = storage.settings.get("llm-provider");
        const modelChanged = existing.isDefault && existing.provider === activeProvider
          && promotedModel !== existing.model;
        onProviderChange?.(modelChanged ? { configOnly: true } : { keyOnly: true });

        sendJson(res, 200, { ok: true });
        return;
      }
    }
  }

  // --- Local Models ---

  if (pathname === "/api/local-models/detect" && req.method === "GET") {
    const { detectLocalServers } = await import("./local-model-detector.js");
    const servers = await detectLocalServers();
    sendJson(res, 200, { servers });
    return;
  }

  if (pathname === "/api/local-models/models" && req.method === "GET") {
    const baseUrl = url.searchParams.get("baseUrl");
    if (!baseUrl) {
      sendJson(res, 400, { error: "Missing required parameter: baseUrl" });
      return;
    }
    const { fetchOllamaModels } = await import("./local-model-fetcher.js");
    const models = await fetchOllamaModels(baseUrl);
    sendJson(res, 200, { models });
    return;
  }

  if (pathname === "/api/local-models/health" && req.method === "POST") {
    const body = (await parseBody(req)) as { baseUrl?: string };
    if (!body.baseUrl) {
      sendJson(res, 400, { error: "Missing required field: baseUrl" });
      return;
    }
    const { checkHealth } = await import("./local-model-fetcher.js");
    const result = await checkHealth(body.baseUrl);
    sendJson(res, 200, result);
    return;
  }

  // --- Model Catalog ---
  if (pathname === "/api/models" && req.method === "GET") {
    const catalog = await readFullModelCatalog(undefined, vendorDir);
    sendJson(res, 200, { models: catalog });
    return;
  }

  // --- App Update ---

  if (pathname === "/api/app/update" && req.method === "GET") {
    const result = getUpdateResult?.();
    sendJson(res, 200, {
      updateAvailable: result?.updateAvailable ?? false,
      currentVersion: result?.currentVersion ?? null,
      latestVersion: result?.latestVersion ?? null,
      downloadUrl: result?.download?.url ?? null,
      releaseNotes: result?.releaseNotes ?? null,
    });
    return;
  }

  // --- Gateway Info ---

  if (pathname === "/api/app/gateway-info" && req.method === "GET") {
    const info = getGatewayInfo?.();
    sendJson(res, 200, info ?? { wsUrl: "ws://127.0.0.1:28789" });
    return;
  }

  // --- Channels ---

  // GET /api/channels/status - Get real-time channel status from OpenClaw gateway
  if (pathname === "/api/channels/status" && req.method === "GET") {
    const rpcClient = getRpcClient?.();

    if (!rpcClient || !rpcClient.isConnected()) {
      sendJson(res, 503, {
        error: "Gateway not connected",
        snapshot: null
      });
      return;
    }

    try {
      const probe = url.searchParams.get("probe") === "true";
      const timeoutMs = 8000;

      const snapshot = await rpcClient.request<ChannelsStatusSnapshot>(
        "channels.status",
        { probe, timeoutMs },
        timeoutMs + 2000 // Add 2s buffer for request timeout
      );

      // Augment snapshot with dmPolicy from config (gateway doesn't include it)
      try {
        const configPath = resolveOpenClawConfigPath();
        const fullConfig = readExistingConfig(configPath);
        const channelsCfg = (fullConfig.channels ?? {}) as Record<string, Record<string, unknown>>;

        for (const [channelId, accounts] of Object.entries(snapshot.channelAccounts)) {
          const chCfg = channelsCfg[channelId] ?? {};
          const rootDmPolicy = chCfg.dmPolicy as string | undefined;
          const accountsCfg = (chCfg.accounts ?? {}) as Record<string, Record<string, unknown>>;

          for (const account of accounts) {
            if (!account.dmPolicy) {
              const acctCfg = accountsCfg[account.accountId];
              account.dmPolicy = (acctCfg?.dmPolicy as string) ?? rootDmPolicy ?? "pairing";
            }
          }
        }
      } catch {
        // Non-critical: if config read fails, snapshot still works without dmPolicy
      }

      sendJson(res, 200, { snapshot });
    } catch (err) {
      log.error("Failed to fetch channels status:", err);
      sendJson(res, 500, {
        error: String(err),
        snapshot: null
      });
    }
    return;
  }

  // POST /api/channels/accounts - Add new channel account
  if (pathname === "/api/channels/accounts" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelId?: string;
      accountId?: string;
      name?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
    };

    if (!body.channelId || !body.accountId) {
      sendJson(res, 400, { error: "Missing required fields: channelId, accountId" });
      return;
    }

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return;
    }

    try {
      const configPath = resolveOpenClawConfigPath();

      // Prepare the account config (including secrets)
      const accountConfig: Record<string, unknown> = {
        ...body.config,
        enabled: body.config.enabled ?? true,
      };

      // Add name if provided
      if (body.name) {
        accountConfig.name = body.name;
      }

      // Store secrets in both Keychain AND config file
      // OpenClaw reads secrets from config file, not Keychain
      if (body.secrets && typeof body.secrets === "object") {
        for (const [secretKey, secretValue] of Object.entries(body.secrets)) {
          if (secretValue) {
            // Store in Keychain for backup/UI display
            const storeKey = `channel-${body.channelId}-${body.accountId}-${secretKey}`;
            await secretStore.set(storeKey, secretValue);
            log.info(`Stored secret for ${body.channelId}/${body.accountId}: ${secretKey}`);

            // ALSO write to config file (OpenClaw expects secrets here)
            accountConfig[secretKey] = secretValue;
          }
        }
      }

      // Write the account config to OpenClaw config.json
      writeChannelAccount({
        configPath,
        channelId: body.channelId,
        accountId: body.accountId,
        config: accountConfig,
      });

      sendJson(res, 201, {
        ok: true,
        channelId: body.channelId,
        accountId: body.accountId,
      });

      // Notify gateway to reload config (config-only change, no env vars)
      onProviderChange?.({ configOnly: true });

      // Track channel configuration
      onChannelConfigured?.(body.channelId);
    } catch (err) {
      log.error("Failed to create channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // PUT /api/channels/accounts/:channelId/:accountId - Update channel account
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "PUT") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return;
    }

    const [channelId, accountId] = parts.map(decodeURIComponent);
    const body = (await parseBody(req)) as {
      name?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
    };

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return;
    }

    try {
      const configPath = resolveOpenClawConfigPath();

      // Read existing account config so we can merge (preserves secrets not re-sent)
      const existingFullConfig = readExistingConfig(configPath);
      const existingChannels = (existingFullConfig.channels ?? {}) as Record<string, unknown>;
      const existingChannel = (existingChannels[channelId] ?? {}) as Record<string, unknown>;
      const existingAccounts = (existingChannel.accounts ?? {}) as Record<string, unknown>;
      const existingAccountConfig = (existingAccounts[accountId] ?? {}) as Record<string, unknown>;

      // Merge: start with existing config, overlay new config on top
      const accountConfig: Record<string, unknown> = { ...existingAccountConfig, ...body.config };

      // Add name if provided
      if (body.name !== undefined) {
        accountConfig.name = body.name;
      }

      // Update secrets in both Keychain AND config file
      // OpenClaw reads secrets from config file, not Keychain
      if (body.secrets && typeof body.secrets === "object") {
        for (const [secretKey, secretValue] of Object.entries(body.secrets)) {
          const storeKey = `channel-${channelId}-${accountId}-${secretKey}`;
          if (secretValue) {
            // Update in Keychain
            await secretStore.set(storeKey, secretValue);
            log.info(`Updated secret for ${channelId}/${accountId}: ${secretKey}`);

            // ALSO write to config file (OpenClaw expects secrets here)
            accountConfig[secretKey] = secretValue;
          } else {
            // Empty value means delete the secret
            await secretStore.delete(storeKey);
            log.info(`Deleted secret for ${channelId}/${accountId}: ${secretKey}`);
            // Don't add to config when deleting
          }
        }
      }

      // Write the updated account config
      writeChannelAccount({
        configPath,
        channelId,
        accountId,
        config: accountConfig,
      });

      sendJson(res, 200, {
        ok: true,
        channelId,
        accountId,
      });

      // Notify gateway to reload config
      onProviderChange?.({ configOnly: true });

      // Track channel configuration
      onChannelConfigured?.(channelId);
    } catch (err) {
      log.error("Failed to update channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // DELETE /api/channels/accounts/:channelId/:accountId - Remove channel account
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return;
    }

    const [channelId, accountId] = parts.map(decodeURIComponent);

    try {
      const configPath = resolveOpenClawConfigPath();

      // Remove all secrets for this account
      const allSecretKeys = await secretStore.listKeys();
      const accountSecretPrefix = `channel-${channelId}-${accountId}-`;
      for (const key of allSecretKeys) {
        if (key.startsWith(accountSecretPrefix)) {
          await secretStore.delete(key);
          log.info(`Deleted secret: ${key}`);
        }
      }

      // Remove the account from config
      removeChannelAccount({
        configPath,
        channelId,
        accountId,
      });

      sendJson(res, 200, {
        ok: true,
        channelId,
        accountId,
      });

      // Notify gateway to reload config
      onProviderChange?.({ configOnly: true });
    } catch (err) {
      log.error("Failed to delete channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // GET /api/pairing/requests/:channelId - Get pending pairing requests
  if (pathname.startsWith("/api/pairing/requests/") && req.method === "GET") {
    const channelId = decodeURIComponent(pathname.slice("/api/pairing/requests/".length));
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return;
    }

    try {
      const requests = await readPairingRequests(channelId);
      sendJson(res, 200, { requests });
    } catch (err) {
      log.error(`Failed to list pairing requests for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // GET /api/pairing/allowlist/:channelId - Get current allowlist
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "GET") {
    const channelId = decodeURIComponent(pathname.slice("/api/pairing/allowlist/".length).split("/")[0]);
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return;
    }

    try {
      const allowlist = await readAllowFromList(channelId);
      sendJson(res, 200, { allowlist });
    } catch (err) {
      log.error(`Failed to read allowlist for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // POST /api/pairing/approve - Approve a pairing code
  if (pathname === "/api/pairing/approve" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelId?: string;
      code?: string;
      locale?: string;
    };

    if (!body.channelId || !body.code) {
      sendJson(res, 400, { error: "Missing required fields: channelId, code" });
      return;
    }

    try {
      const requests = await readPairingRequests(body.channelId);
      const codeUpper = body.code.trim().toUpperCase();
      const requestIndex = requests.findIndex(r => r.code.toUpperCase() === codeUpper);

      if (requestIndex < 0) {
        sendJson(res, 404, { error: "Pairing code not found or expired" });
        return;
      }

      const request = requests[requestIndex];

      // Remove from pending requests
      requests.splice(requestIndex, 1);
      await writePairingRequests(body.channelId, requests);

      // Add to allowlist
      const allowlist = await readAllowFromList(body.channelId);
      if (!allowlist.includes(request.id)) {
        allowlist.push(request.id);
        await writeAllowFromList(body.channelId, allowlist);
      }

      sendJson(res, 200, {
        ok: true,
        id: request.id,
        entry: request,
      });

      log.info(`Approved pairing for ${body.channelId}: ${request.id}`);

      // Send approval confirmation to the user via their channel
      const locale = (body.locale === "zh" ? "zh" : "en") as "zh" | "en";
      const confirmMsg = APPROVAL_MESSAGES[locale];
      sendChannelMessage(body.channelId, request.id, confirmMsg).then(ok => {
        if (ok) log.info(`Sent approval confirmation to ${body.channelId} user ${request.id}`);
      });
    } catch (err) {
      log.error("Failed to approve pairing:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // DELETE /api/pairing/allowlist/:channelId/:entry - Remove from allowlist
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/pairing/allowlist/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/pairing/allowlist/:channelId/:entry" });
      return;
    }

    const [channelId, entry] = parts.map(decodeURIComponent);

    try {
      const allowlist = await readAllowFromList(channelId);
      const filtered = allowlist.filter(e => e !== entry);
      const changed = filtered.length !== allowlist.length;

      if (changed) {
        await writeAllowFromList(channelId, filtered);
        log.info(`Removed from ${channelId} allowlist: ${entry}`);
      }

      sendJson(res, 200, {
        ok: true,
        changed,
        allowFrom: filtered,
      });
    } catch (err) {
      log.error("Failed to remove from allowlist:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  if (pathname === "/api/channels" && req.method === "GET") {
    const channels = storage.channels.getAll();
    sendJson(res, 200, { channels });
    return;
  }

  if (pathname === "/api/channels" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelType?: string;
      enabled?: boolean;
      accountId?: string;
      settings?: Record<string, unknown>;
    };
    const id = crypto.randomUUID();
    const channel = storage.channels.create({
      id,
      channelType: body.channelType ?? "",
      enabled: body.enabled ?? true,
      accountId: body.accountId ?? "",
      settings: body.settings ?? {},
    });
    onRuleChange?.("channel-created", id);
    sendJson(res, 201, channel);
    return;
  }

  if (pathname === "/api/channels/wecom/unbind" && req.method === "DELETE") {
    if (!wecomRelayState) {
      sendJson(res, 200, { ok: true }); // nothing to unbind
      return;
    }

    // Send unbind_all frame via the persistent WS if connected
    if (wecomRelayWs && wecomRelayWs.readyState === WebSocket.OPEN && wecomConnParams) {
      try {
        wecomRelayWs.send(JSON.stringify({
          type: "unbind_all",
          gateway_id: wecomConnParams.gatewayId,
        }));
        // Wait for relay to process the frame before closing
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        log.warn("WeCom unbind: failed to send unbind_all frame:", err);
      }
    }

    // Tear down persistent connection
    stopWeComRelay();
    wecomRelayState = null;

    // Clear persisted credentials
    storage.settings.delete("wecom-relay-url");
    storage.settings.delete("wecom-external-user-id");
    await secretStore.delete("wecom-auth-token");

    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname.startsWith("/api/channels/") && req.method === "DELETE") {
    const id = pathname.slice("/api/channels/".length);
    const deleted = storage.channels.delete(id);
    if (deleted) {
      onRuleChange?.("channel-deleted", id);
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 404, { error: "Channel not found" });
    }
    return;
  }

  // --- Permissions ---
  if (pathname === "/api/permissions" && req.method === "GET") {
    const permissions = storage.permissions.get();
    sendJson(res, 200, { permissions });
    return;
  }

  if (pathname === "/api/permissions" && req.method === "PUT") {
    const body = (await parseBody(req)) as { readPaths?: string[]; writePaths?: string[] };
    const permissions = storage.permissions.update({
      readPaths: body.readPaths ?? [],
      writePaths: body.writePaths ?? [],
    });

    // Sync permissions to OpenClaw config (docker bind mounts)
    try {
      syncPermissions(permissions);
      log.info("Synced filesystem permissions to OpenClaw config");

      // Trigger gateway restart for permissions change
      // Note: Permissions require environment variable update (EASYCLAW_FILE_PERMISSIONS),
      // which requires a full gateway restart to apply the updated env vars.
      onPermissionsChange?.();
      onTelemetryTrack?.("permissions.updated", {
        readCount: (body.readPaths ?? []).length,
        writeCount: (body.writePaths ?? []).length,
      });
    } catch (err) {
      log.error("Failed to sync permissions to OpenClaw:", err);
      // Still return success to the client since permissions were saved to SQLite
    }

    sendJson(res, 200, { permissions });
    return;
  }

  // --- Workspace Path ---
  if (pathname === "/api/workspace" && req.method === "GET") {
    // Return the OpenClaw state directory as the workspace path.
    // Cannot use process.cwd() because packaged macOS apps have cwd="/".
    const workspacePath = resolveOpenClawStateDir();
    sendJson(res, 200, { workspacePath });
    return;
  }

  // --- Usage ---
  if (pathname === "/api/usage" && req.method === "GET") {
    const filter: UsageFilter = {};
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");
    if (since) filter.since = since;
    if (until) filter.until = until;

    // Check cache first
    const cacheKey = `usage-${filter.since ?? "all"}-${filter.until ?? "all"}`;
    const cached = getCachedUsage(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    try {
      // Parse date filters to timestamps
      const startMs = filter.since ? new Date(filter.since).getTime() : undefined;
      const endMs = filter.until ? new Date(filter.until).getTime() : undefined;

      // Load OpenClaw config for cost estimation
      const configPath = resolveOpenClawConfigPath();
      const config = readExistingConfig(configPath);

      // Call OpenClaw's aggregation function for totals
      const costSummary = await loadCostUsageSummary({
        startMs,
        endMs,
        config,
        // agentId: undefined (scan all agents)
      });

      // Discover all sessions and load their summaries for byModel/byProvider breakdown
      const sessions = await discoverAllSessions({ startMs, endMs });
      const sessionSummaries: SessionCostSummary[] = [];

      for (const session of sessions) {
        const summary = await loadSessionCostSummary({
          sessionFile: session.sessionFile,
          config,
          startMs,
          endMs,
        });
        if (summary && summary.modelUsage) {
          sessionSummaries.push(summary);
        }
      }

      // Transform to frontend UsageSummary format with byModel/byProvider
      const summary = transformToUsageSummary(costSummary, sessionSummaries);

      // Cache the result
      setCachedUsage(cacheKey, summary);

      sendJson(res, 200, summary);
    } catch (error) {
      log.error("Failed to load usage data", error);
      sendJson(res, 200, emptyUsageSummary());
    }
    return;
  }

  // --- Per-Key/Model Usage (W15-C) ---
  if (pathname === "/api/key-usage" && req.method === "GET") {
    if (!queryService) {
      sendJson(res, 501, { error: "Per-key usage tracking not available" });
      return;
    }
    try {
      const windowStart = url.searchParams.get("windowStart");
      const windowEnd = url.searchParams.get("windowEnd");
      const results = await queryService.queryUsage({
        windowStart: windowStart ? Number(windowStart) : 0,
        windowEnd: windowEnd ? Number(windowEnd) : Date.now(),
        keyId: url.searchParams.get("keyId") ?? undefined,
        provider: url.searchParams.get("provider") ?? undefined,
        model: url.searchParams.get("model") ?? undefined,
      });
      sendJson(res, 200, results);
    } catch (err) {
      log.error("Failed to query key usage:", err);
      sendJson(res, 500, { error: "Failed to query key usage" });
    }
    return;
  }

  if (pathname === "/api/key-usage/active" && req.method === "GET") {
    try {
      const currentProvider = storage.settings.get("llm-provider");
      const activeKey = currentProvider
        ? storage.providerKeys.getDefault(currentProvider as string)
        : null;
      sendJson(res, 200, activeKey ? { keyId: activeKey.id, keyLabel: activeKey.label, provider: activeKey.provider, model: activeKey.model, authType: activeKey.authType ?? "api_key" } : null);
    } catch (err) {
      log.error("Failed to get active key:", err);
      sendJson(res, 500, { error: "Failed to get active key" });
    }
    return;
  }

  if (pathname === "/api/key-usage/timeseries" && req.method === "GET") {
    if (!queryService) {
      sendJson(res, 501, { error: "Per-key usage tracking not available" });
      return;
    }
    try {
      const windowStart = Number(url.searchParams.get("windowStart")) || 0;
      const windowEnd = Number(url.searchParams.get("windowEnd")) || Date.now();
      const buckets = queryService.queryTimeseries({ windowStart, windowEnd });
      sendJson(res, 200, buckets);
    } catch (err) {
      log.error("Failed to query key usage timeseries:", err);
      sendJson(res, 500, { error: "Failed to query key usage timeseries" });
    }
    return;
  }

  // --- OAuth Flow ---
  if (pathname === "/api/oauth/start" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string };
    if (!body.provider) {
      sendJson(res, 400, { error: "Missing required field: provider" });
      return;
    }
    // Prefer the new two-step flow (acquire only, no save)
    if (onOAuthAcquire) {
      try {
        const result = await onOAuthAcquire(body.provider);
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        log.error("OAuth acquire failed:", err);
        const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err), detail });
      }
      return;
    }
    // Fallback: old one-step flow
    if (!onOAuthFlow) {
      sendJson(res, 501, { error: "OAuth flow not available" });
      return;
    }
    try {
      const result = await onOAuthFlow(body.provider);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      log.error("OAuth flow failed:", err);
      const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err), detail });
    }
    return;
  }

  // OAuth save: validate acquired token + create provider key
  if (pathname === "/api/oauth/save" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string; proxyUrl?: string; label?: string; model?: string };
    if (!body.provider) {
      sendJson(res, 400, { error: "Missing required field: provider" });
      return;
    }
    if (!onOAuthSave) {
      sendJson(res, 501, { error: "OAuth save not available" });
      return;
    }
    try {
      const result = await onOAuthSave(body.provider, {
        proxyUrl: body.proxyUrl,
        label: body.label,
        model: body.model,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      log.error("OAuth save failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
      // Return 422 for validation errors (token invalid/expired)
      const status = message.includes("Invalid") || message.includes("expired") || message.includes("validation") ? 422 : 500;
      sendJson(res, status, { error: message, detail });
    }
    return;
  }

  // OAuth manual complete: user pastes the redirect URL from browser
  if (pathname === "/api/oauth/manual-complete" && req.method === "POST") {
    const body = (await parseBody(req)) as { provider?: string; callbackUrl?: string };
    if (!body.provider || !body.callbackUrl) {
      sendJson(res, 400, { error: "Missing required fields: provider, callbackUrl" });
      return;
    }
    if (!onOAuthManualComplete) {
      sendJson(res, 501, { error: "Manual OAuth complete not available" });
      return;
    }
    try {
      const result = await onOAuthManualComplete(body.provider, body.callbackUrl);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      log.error("OAuth manual complete failed:", err);
      const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined;
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err), detail });
    }
    return;
  }

  // --- WeCom Cloud Config (GraphQL proxy) ---
  if (pathname === "/api/wecom-config/save" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      corpId?: string;
      appSecret?: string;
      token?: string;
      encodingAesKey?: string;
      kfLinkId?: string;
      panelToken?: string;
      lang?: string;
    };
    const { corpId, appSecret, token: webhookToken, encodingAesKey, kfLinkId, panelToken, lang } = body;
    if (!corpId || !appSecret || !webhookToken || !encodingAesKey || !kfLinkId) {
      sendJson(res, 400, { error: "All 5 credential fields are required" });
      return;
    }
    // Use provided panelToken or fall back to stored one
    const authToken = panelToken || (await secretStore.get("cs-panel-token")) || "";
    if (!authToken) {
      sendJson(res, 400, { error: "Panel token is required. Please enter it in the configuration form." });
      return;
    }
    // Persist the panel token for future use
    if (panelToken) {
      await secretStore.set("cs-panel-token", panelToken);
    }
    const apiUrl = lang === "zh" ? "https://api-cn.easy-claw.com/graphql" : "https://api.easy-claw.com/graphql";
    try {
      const gqlRes = await proxiedFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `mutation saveWeComConfig($input: WeComConfigInput!) {
            saveWeComConfig(input: $input) {
              wecom { corpId appSecret token encodingAesKey openKfId kfLinkId }
            }
          }`,
          variables: {
            input: { corpId, appSecret, token: webhookToken, encodingAesKey, kfLinkId },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!gqlRes.ok) {
        sendJson(res, 502, { error: `GraphQL API returned ${gqlRes.status}` });
        return;
      }
      const json = (await gqlRes.json()) as { data?: { saveWeComConfig?: unknown }; errors?: Array<{ message: string }> };
      if (json.errors && json.errors.length > 0) {
        sendJson(res, 400, { error: json.errors[0].message });
        return;
      }
      // Persist the corpId locally so we can show config status
      storage.settings.set("wecom-cloud-corp-id", corpId);
      sendJson(res, 200, json.data?.saveWeComConfig ?? { wecom: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: msg });
    }
    return;
  }

  if (pathname === "/api/wecom-config/delete" && req.method === "POST") {
    const body = (await parseBody(req)) as { corpId?: string; panelToken?: string; lang?: string };
    const { corpId, panelToken, lang } = body;
    if (!corpId) {
      sendJson(res, 400, { error: "corpId is required for deletion" });
      return;
    }
    const authToken = panelToken || (await secretStore.get("cs-panel-token")) || "";
    if (!authToken) {
      sendJson(res, 400, { error: "Panel token is required" });
      return;
    }
    if (panelToken) {
      await secretStore.set("cs-panel-token", panelToken);
    }
    const apiUrl = lang === "zh" ? "https://api-cn.easy-claw.com/graphql" : "https://api.easy-claw.com/graphql";
    try {
      const gqlRes = await proxiedFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          query: `mutation deleteWeComConfig($corpId: String!) {
            deleteWeComConfig(corpId: $corpId) {
              wecom { corpId }
            }
          }`,
          variables: { corpId },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!gqlRes.ok) {
        sendJson(res, 502, { error: `GraphQL API returned ${gqlRes.status}` });
        return;
      }
      const json = (await gqlRes.json()) as { data?: { deleteWeComConfig?: unknown }; errors?: Array<{ message: string }> };
      if (json.errors && json.errors.length > 0) {
        sendJson(res, 400, { error: json.errors[0].message });
        return;
      }
      // Clear the locally persisted corpId
      storage.settings.delete("wecom-cloud-corp-id");
      sendJson(res, 200, json.data?.deleteWeComConfig ?? { wecom: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: msg });
    }
    return;
  }

  if (pathname === "/api/wecom-config/status" && req.method === "GET") {
    // Return stored panel token existence and last saved corpId
    const hasToken = !!(await secretStore.get("cs-panel-token"));
    const savedCorpId = storage.settings.get("wecom-cloud-corp-id") as string | undefined;
    sendJson(res, 200, { hasToken, corpId: savedCorpId ?? null });
    return;
  }

  // --- WeCom Channel ---
  if (pathname === "/api/channels/wecom/binding-status" && req.method === "GET") {
    if (!wecomRelayState) {
      sendJson(res, 200, { status: null });
      return;
    }
    // Compute status from clean state: connected (bool) + externalUserId (binding)
    const relayConnected = wecomRelayWs?.readyState === WebSocket.OPEN;
    const gatewayConnected = wecomGatewayRpc?.isConnected() ?? false;
    const { externalUserId, connected } = wecomRelayState;
    // status derivation:
    //   "bound"   = user has been bound (binding persists across reconnects)
    //   "active"  = relay connected, no user bound yet
    //   "error"   = relay was connected but dropped
    //   "pending" = relay connecting (initial state)
    const status = externalUserId
      ? "bound"
      : connected
        ? "active"
        : relayConnected
          ? "active"
          : "pending";
    sendJson(res, 200, {
      status,
      relayUrl: wecomRelayState.relayUrl,
      externalUserId: externalUserId ?? null,
      connected: connected || relayConnected,
      bindingToken: wecomRelayState.bindingToken ?? null,
      customerServiceUrl: wecomRelayState.customerServiceUrl ?? null,
      relayConnected,
      gatewayConnected,
    });
    return;
  }

  if (pathname === "/api/channels/wecom/bind" && req.method === "POST") {
    const body = (await parseBody(req)) as { relayUrl?: string; authToken?: string };
    const relayUrl = body.relayUrl?.trim();
    const authToken = body.authToken?.trim();

    if (!relayUrl || !authToken) {
      sendJson(res, 400, { error: "Missing relayUrl or authToken" });
      return;
    }

    const gwId = deviceId ?? randomUUID();

    try {
      const result = await new Promise<{ token: string; customerServiceUrl: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Connection to relay timed out"));
        }, 15_000);

        const ws = new WebSocket(relayUrl);

        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "hello", gateway_id: gwId, auth_token: authToken }));
        });

        ws.on("message", (data: Buffer) => {
          try {
            const frame = JSON.parse(data.toString("utf-8"));
            if (frame.type === "ack" && frame.id === "hello") {
              ws.send(JSON.stringify({ type: "create_binding", gateway_id: gwId }));
            } else if (frame.type === "create_binding_ack") {
              clearTimeout(timeout);
              resolve({ token: frame.token, customerServiceUrl: frame.customer_service_url });
              ws.close();
            } else if (frame.type === "error") {
              clearTimeout(timeout);
              reject(new Error(frame.message ?? "Relay error"));
              ws.close();
            }
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
            ws.close();
          }
        });

        ws.on("error", (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });

        ws.on("close", () => {
          clearTimeout(timeout);
        });
      });

      wecomRelayState = {
        relayUrl,
        authToken,
        connected: false,
        bindingToken: result.token,
        customerServiceUrl: result.customerServiceUrl,
      };

      // Persist credentials so the connection survives app restarts
      storage.settings.set("wecom-relay-url", relayUrl);
      await secretStore.set("wecom-auth-token", authToken);

      // Start persistent relay connection for message forwarding
      const gwInfo = getGatewayInfo?.();
      startWeComRelay({
        relayUrl,
        authToken,
        gatewayId: gwId,
        gatewayWsUrl: gwInfo?.wsUrl ?? "ws://127.0.0.1:28789",
        gatewayToken: gwInfo?.token,
      });

      sendJson(res, 200, {
        ok: true,
        bindingToken: result.token,
        customerServiceUrl: result.customerServiceUrl,
      });
    } catch (err) {
      log.error("WeCom bind failed:", err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- File Dialog ---
  if (pathname === "/api/file-dialog" && req.method === "POST") {
    if (!onOpenFileDialog) {
      sendJson(res, 501, { error: "File dialog not available" });
      return;
    }
    const selected = await onOpenFileDialog();
    sendJson(res, 200, { path: selected });
    return;
  }

  // --- Skills Marketplace ---
  if (pathname === "/api/skills/market" && req.method === "GET") {
    const query = url.searchParams.get("query") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const page = url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined;
    const pageSize = url.searchParams.get("pageSize") ? Number(url.searchParams.get("pageSize")) : undefined;
    const chinaAvailableParam = url.searchParams.get("chinaAvailable");
    const chinaAvailable = chinaAvailableParam === "true" ? true : chinaAvailableParam === "false" ? false : undefined;
    const lang = url.searchParams.get("lang") ?? "en";
    const apiUrl = lang === "zh" ? "https://api-cn.easy-claw.com/graphql" : "https://api.easy-claw.com/graphql";
    try {
      const gqlRes = await proxiedFetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($query: String, $category: String, $page: Int, $pageSize: Int, $chinaAvailable: Boolean) {
            skills(query: $query, category: $category, page: $page, pageSize: $pageSize, chinaAvailable: $chinaAvailable) {
              skills { slug name_en name_zh desc_en desc_zh author version tags labels chinaAvailable stars downloads }
              total page pageSize
            }
          }`,
          variables: { query, category, page, pageSize, chinaAvailable },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!gqlRes.ok) {
        sendJson(res, 502, { error: `GraphQL API returned ${gqlRes.status}` });
        return;
      }
      const json = (await gqlRes.json()) as { data?: { skills?: unknown } };
      sendJson(res, 200, json.data?.skills ?? { skills: [], total: 0, page: 1, pageSize: 20 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: msg });
    }
    return;
  }
  if (pathname === "/api/skills/bundled-slugs" && req.method === "GET") {
    const resolvedVendorDir = vendorDir ?? join(import.meta.dirname, "..", "..", "..", "vendor", "openclaw");
    const bundledSkillsDir = join(resolvedVendorDir, "skills");
    try {
      const entries = await fs.readdir(bundledSkillsDir);
      const slugs: string[] = [];
      for (const entry of entries) {
        const stat = await fs.stat(join(bundledSkillsDir, entry));
        if (stat.isDirectory()) slugs.push(entry);
      }
      sendJson(res, 200, { slugs });
    } catch {
      sendJson(res, 200, { slugs: [] });
    }
    return;
  }
  if (pathname === "/api/skills/installed" && req.method === "GET") {
    const skillsDir = USER_SKILLS_DIR;
    try {
      let entries: string[];
      try {
        entries = await fs.readdir(skillsDir);
      } catch {
        sendJson(res, 200, { skills: [] });
        return;
      }

      const skills: Array<{ slug: string; name?: string; description?: string; author?: string; version?: string }> = [];
      for (const entry of entries) {
        const entryPath = join(skillsDir, entry);
        const stat = await fs.stat(entryPath);
        if (!stat.isDirectory()) continue;

        // Read SKILL.md frontmatter
        let fmMeta: { name?: string; description?: string; author?: string; version?: string } = {};
        try {
          const content = await fs.readFile(join(entryPath, "SKILL.md"), "utf-8");
          fmMeta = parseSkillFrontmatter(content);
        } catch { /* SKILL.md missing or unreadable */ }

        // Read _meta.json (saved at install time) — preferred over SKILL.md for display
        let installMeta: { name?: string; description?: string; author?: string; version?: string } = {};
        try {
          installMeta = JSON.parse(await fs.readFile(join(entryPath, "_meta.json"), "utf-8"));
        } catch { /* _meta.json missing — skip */ }

        skills.push({
          slug: entry,
          name: installMeta.name || fmMeta.name,
          description: installMeta.description || fmMeta.description,
          author: installMeta.author || fmMeta.author,
          version: installMeta.version || fmMeta.version,
        });
      }
      sendJson(res, 200, { skills });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return;
  }
  if (pathname === "/api/skills/install" && req.method === "POST") {
    const body = (await parseBody(req)) as { slug?: string; lang?: string; meta?: { name?: string; description?: string; author?: string; version?: string } };
    if (!body.slug) {
      sendJson(res, 400, { error: "Missing required field: slug" });
      return;
    }
    if (body.slug.includes("..") || body.slug.includes("/") || body.slug.includes("\\")) {
      sendJson(res, 400, { error: "Invalid slug" });
      return;
    }

    const lang = body.lang ?? "en";
    const apiBase = lang === "zh"
      ? "https://api-cn.easy-claw.com"
      : "https://api.easy-claw.com";
    const downloadUrl = `${apiBase}/api/skills/${encodeURIComponent(body.slug)}/download`;

    try {
      const response = await proxiedFetch(downloadUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const errText = await response.text();
        sendJson(res, 200, { ok: false, error: `Server returned ${response.status}: ${errText}` });
        return;
      }

      // Download zip bundle and extract to skills directory
      const zipBuffer = Buffer.from(await response.arrayBuffer());

      const skillsDir = USER_SKILLS_DIR;
      const skillDir = join(skillsDir, body.slug);
      await fs.mkdir(skillDir, { recursive: true });

      // Extract zip using pure-JS library (no external CLI dependency)
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(skillDir, true);

      // Save install metadata (author, version, etc.) for display in installed list
      if (body.meta) {
        await fs.writeFile(join(skillDir, "_meta.json"), JSON.stringify(body.meta), "utf-8");
      }

      // Clear cached skills snapshot so the agent picks up the new skill immediately
      invalidateSkillsSnapshot();

      sendJson(res, 200, { ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 200, { ok: false, error: msg });
    }
    return;
  }
  if (pathname === "/api/skills/delete" && req.method === "POST") {
    const body = (await parseBody(req)) as { slug?: string };
    if (!body.slug) {
      sendJson(res, 400, { error: "Missing required field: slug" });
      return;
    }
    if (body.slug.includes("..") || body.slug.includes("/") || body.slug.includes("\\")) {
      sendJson(res, 400, { error: "Invalid slug" });
      return;
    }
    const skillsDir = USER_SKILLS_DIR;
    try {
      await fs.rm(join(skillsDir, body.slug), { recursive: true, force: true });
      // Clear cached skills snapshot so the agent stops listing the deleted skill
      invalidateSkillsSnapshot();
      sendJson(res, 200, { ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return;
  }
  if (pathname === "/api/skills/open-folder" && req.method === "POST") {
    const skillsDir = USER_SKILLS_DIR;
    await fs.mkdir(skillsDir, { recursive: true });
    const cmd = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "explorer"
      : "xdg-open";
    execFile(cmd, [skillsDir], (err) => {
      if (err) {
        sendJson(res, 500, { error: err.message });
      } else {
        sendJson(res, 200, { ok: true });
      }
    });
    return;
  }

  // --- Customer Service (W19-B3) ---
  if (pathname === "/api/customer-service/status" && req.method === "GET") {
    const status = getCSStatus();
    sendJson(res, 200, status);
    return;
  }
  if (pathname === "/api/customer-service/start" && req.method === "POST") {
    try {
      const body = await parseBody(req) as {
        businessPrompt?: string;
        platforms?: string[];
      };
      startCS({
        businessPrompt: body.businessPrompt ?? "",
        platforms: body.platforms ?? [],
      });
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return;
  }
  if (pathname === "/api/customer-service/stop" && req.method === "POST") {
    stopCS();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (pathname === "/api/customer-service/config" && req.method === "PUT") {
    try {
      const body = await parseBody(req) as {
        businessPrompt?: string;
        platforms?: string[];
      };
      updateCSConfig(body);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return;
  }
  if (pathname === "/api/customer-service/platforms" && req.method === "GET") {
    const status = getCSStatus();
    const platforms = (status?.platforms ?? []).map((p: { platform: string; boundCustomers: number }) => ({
      platform: p.platform,
      boundCustomers: p.boundCustomers,
    }));
    sendJson(res, 200, { platforms });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(
  res: ServerResponse,
  distDir: string,
  pathname: string,
): void {
  // Prevent directory traversal
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(distDir, safePath);

  // If the path doesn't point to an existing file, serve index.html (SPA fallback)
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  // Ensure the resolved path is within distDir (prevent traversal)
  const resolvedFile = resolve(filePath);
  const resolvedDist = resolve(distDir);
  if (!resolvedFile.startsWith(resolvedDist)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Extracts name, description, author, version from between --- delimiters.
 */
function parseSkillFrontmatter(content: string): { name?: string; description?: string; author?: string; version?: string } {
  const lines = content.split("\n");
  let fmStart = -1;
  let fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      if (fmStart === -1) {
        fmStart = i;
      } else {
        fmEnd = i;
        break;
      }
    }
  }
  if (fmStart === -1 || fmEnd === -1) return {};

  const result: { name?: string; description?: string; author?: string; version?: string } = {};
  for (let i = fmStart + 1; i < fmEnd; i++) {
    const line = lines[i]!;
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    const key = m[1]!.trim();
    const val = m[2]!.trim();
    if (key === "name") result.name = val;
    else if (key === "description") result.description = val;
    else if (key === "author") result.author = val;
    else if (key === "version") result.version = val;
  }
  return result;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
