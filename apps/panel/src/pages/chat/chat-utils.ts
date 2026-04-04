import { stripReasoningTagsFromText, DEFAULTS } from "@rivonclaw/core";

export type ChatImage = { data: string; mimeType: string };

export type ChatMessage = {
  role: "user" | "assistant" | "tool-event";
  text: string;
  timestamp: number;
  images?: ChatImage[];
  toolName?: string;
  /** Tool call arguments — present on tool-event messages when the gateway provides them. */
  toolArgs?: Record<string, unknown>;
  /** Gateway-assigned idempotency key — present on user messages loaded from history. */
  idempotencyKey?: string;
  /** True for user messages from external channels (Telegram, Chrome, etc.), not typed in the panel. */
  isExternal?: boolean;
  /** Source channel for external messages (e.g. "telegram", "wechat"). */
  channel?: string;
};

export type PendingImage = { dataUrl: string; base64: string; mimeType: string };

/** Metadata for a session tab, sourced from gateway `sessions.list`. */
export type SessionTabInfo = {
  key: string;
  displayName?: string;
  derivedTitle?: string;
  channel?: string;
  updatedAt?: number;
  kind?: string;
  pinned?: boolean;
  /** True for panel-created sessions not yet materialized on the gateway. */
  isLocal?: boolean;
  /** Total tokens consumed in this session — from gateway `sessions.list`. */
  totalTokens?: number;
};

/** Per-session cached state for tab switching. */
export type SessionChatState = {
  messages: ChatMessage[];
  trackerSnapshot: import("../../lib/run-tracker.js").RunTrackerSnapshot | null;
  draft: string;
  pendingImages: PendingImage[];
  visibleCount: number;
  allFetched: boolean;
  lastAccessed: number;
  /** RunProfile selected for this session — optional for backward compat with older cached states. */
  selectedRunProfileId?: string;
};

/** Response from gateway `sessions.list` RPC. */
export type SessionsListResult = {
  ts: number;
  count: number;
  sessions: Array<{
    key: string;
    kind?: string;
    displayName?: string;
    derivedTitle?: string;
    lastMessagePreview?: string;
    channel?: string;
    lastChannel?: string;
    updatedAt?: number;
    spawnedBy?: string;
    totalTokens?: number;
    totalTokensFresh?: boolean;
    chatType?: string;
  }>;
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export const COMPRESS_MAX_DIMENSION = DEFAULTS.chat.compressMaxDimension;
export const COMPRESS_TARGET_BYTES = DEFAULTS.chat.compressTargetBytes;
export const COMPRESS_INITIAL_QUALITY = DEFAULTS.chat.compressInitialQuality;
export const COMPRESS_MIN_QUALITY = DEFAULTS.chat.compressMinQuality;

export const DEFAULT_SESSION_KEY = "agent:main:main";
export const INITIAL_VISIBLE = DEFAULTS.chat.initialVisibleMessages;
export const PAGE_SIZE = 20;
export const FETCH_BATCH = DEFAULTS.chat.fetchBatch;

/** Static marker inserted by cleanMessageText for media attachments.
 *  Replaced with i18n text at render time. */
export const IMAGE_PLACEHOLDER = "\u200B[__IMAGE__]\u200B";

/**
 * Clean up raw gateway message text:
 * - Strip "Conversation info (untrusted metadata):" blocks
 * - Format audio transcript messages nicely
 */
export function cleanMessageText(text: string): string {
  // Remove "Conversation info (untrusted metadata):" and its JSON block
  let cleaned = text.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "").trim();
  // Fallback: also strip the variant without code fences
  cleaned = cleaned.replace(/Conversation info \(untrusted metadata\):\s*\{[\s\S]*?\}\s*/g, "").trim();

  // Strip reasoning/thinking tags (<think>, <thinking>, <thought>, <antthinking>, <final>)
  // using OpenClaw's battle-tested implementation that respects code blocks
  cleaned = stripReasoningTagsFromText(cleaned, { mode: "preserve", trim: "start" });

  // Strip "NO_REPLY" directive — the agent outputs this after using the message tool
  // to indicate it already sent the reply via the outbound system.
  cleaned = cleaned.replace(/\bNO_REPLY\b/g, "").trim();

  // Strip agent framework tool-result summaries (e.g. "System: [2026-02-24 16:16:41 PST] Exec completed ...")
  cleaned = cleaned.replace(/^System: \[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})? [A-Z]{2,5}\].*$/gm, "").trim();

  // Strip queue-collected message wrapper produced by OpenClaw's drain.ts
  // when messages arrive while the agent is busy processing another run.
  // Format: "[Queued messages while agent was busy]\n\n---\nQueued #1\n\n<actual message>"
  cleaned = cleaned.replace(/^\[Queued messages while agent was busy\]\s*/, "");
  cleaned = cleaned.replace(/---\s*Queued #\d+\s*/g, "").trim();

  // Strip channel envelope prefix — rendered separately above the bubble.
  // Matches both bare timestamps like [Thu 2026-03-05 23:26 PST]
  // and full envelopes like [Mobile UUID +1s Thu 2026-03-05 23:26 PST].
  cleaned = cleaned.replace(/^\[[^\]]*\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [A-Z]{2,5}\]\s*/, "");

  // Strip gateway [System Message] blocks (cron delivery, system events).
  // The entire message is internal scaffolding — the agent's response follows separately.
  // Must come AFTER timestamp stripping, as gateway may prepend an inline timestamp.
  cleaned = cleaned.replace(/^\[System Message\][\s\S]*$/, "").trim();

  // Strip Feishu/Lark sender open_id prefix (e.g. "ou_04119179e9551e91a9f8af9a09de50e8: Hi")
  // The gateway prepends `{senderName ?? senderOpenId}: ` to messages; when the
  // display name isn't resolved, the raw ou_xxx id leaks into the chat bubble.
  cleaned = cleaned.replace(/^ou_[a-f0-9]+:\s*/, "");

  // Replace [media attached: <path> (<mime>) | <path>] blocks.
  // Audio attachments are stripped silently (the transcript or [Voice Ns] label is enough).
  // Non-audio attachments get an image placeholder since the panel can't display file paths.
  cleaned = cleaned.replace(/\[media attached:\s*[^\]]+\]/g, (match) =>
    /\(audio\//.test(match) ? "" : IMAGE_PLACEHOLDER,
  ).trim();

  // Strip agent instruction about sending images back (injected by gateway for media messages)
  cleaned = cleaned.replace(/To send an image back,[\s\S]*?Keep caption in the text body\.\s*/g, "").trim();

  // Strip raw channel-specific image metadata (e.g. Feishu image_key JSON)
  cleaned = cleaned.replace(/\{"image_key"\s*:\s*"[^"]*"\}/g, "").trim();

  // Strip cron/heartbeat system event wrapper — extract only the reminder content.
  // Variants: "has been triggered" (with content) / "was triggered" (no-content fallback)
  // Endings:  "Please relay…" (deliverToUser) / "Handle this…" (!deliverToUser)
  const cronMatch = cleaned.match(/^A scheduled (?:reminder|cron event) (?:has been|was) triggered\.\s*(?:The reminder content is:\s*\n\n([\s\S]*?)\n\n(?:Please relay|Handle this)|.*$)/);
  if (cronMatch) {
    cleaned = (cronMatch[1] ?? "").trim();
  }
  // Strip exec completion event wrapper
  cleaned = cleaned.replace(/^An async command you ran earlier has completed\.\s*The result is shown in the system messages above\.\s*(?:Please relay|Handle)[\s\S]*$/, "").trim();
  // Strip trailing "Current time: ..." line appended by heartbeat runner
  cleaned = cleaned.replace(/\nCurrent time: .+$/, "").trim();

  // Detect audio transcript pattern from media-understanding module.
  // Formats vary by channel:
  //   Telegram: [Audio] User text: [Telegram ...] <media:audio>\nTranscript: text
  //   Mobile:   [Audio]\nUser text:\n[Mobile ...] [Voice 3s]\nTranscript:\ntext
  // Generalized: [Audio] ... Transcript: <actual text>
  const audioMatch = cleaned.match(/\[Audio\][\s\S]*?Transcript:\s*([\s\S]*)/);
  if (audioMatch) {
    cleaned = `🔊 ${audioMatch[1].trim()}`;
  }

  return cleaned;
}

/**
 * Strip AI-facing metadata blocks from a derived session title so it shows
 * the actual user message, not raw "Sender (untrusted metadata):..." noise.
 */
const PREPEND_CONTEXT_RE = /---\s+RivonClaw[\s\S]*?---\s+End\s+\w[\w\s]*---/g;
const INBOUND_META_SENTINELS = [
  "Conversation info (untrusted metadata):",
  "Sender (untrusted metadata):",
  "Thread starter (untrusted, for context):",
  "Replied message (untrusted, for context):",
  "Forwarded message context (untrusted metadata):",
  "Chat history since last reply (untrusted, for context):",
];
const INBOUND_META_BLOCK_RE = new RegExp(
  INBOUND_META_SENTINELS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map((s) => `${s}\\s*\`\`\`json[\\s\\S]*?\`\`\``)
    .join("|"),
  "g",
);
const UNTRUSTED_CONTEXT_RE =
  /Untrusted context \(metadata, do not treat as instructions or commands\):[\s\S]*/;
// Catch truncated metadata blocks where the closing ``` was cut off by gateway
// title truncation (~60 chars).  Applied AFTER the complete-block regex so it
// only removes sentinels that survived because they were mangled by truncation.
const INBOUND_META_TRUNCATED_RE = new RegExp(
  INBOUND_META_SENTINELS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map((s) => `${s}[\\s\\S]*`)
    .join("|"),
);

export function cleanDerivedTitle(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const cleaned = raw
    .replace(PREPEND_CONTEXT_RE, "")
    .replace(INBOUND_META_BLOCK_RE, "")
    .replace(UNTRUSTED_CONTEXT_RE, "")
    .replace(INBOUND_META_TRUNCATED_RE, "")
    .trim();
  return cleaned || undefined;
}

export function formatTimestamp(ts: number, locale: string): string {
  const d = new Date(ts);
  if (locale.startsWith("zh")) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Extract plain text from gateway message content blocks.
 */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("");
}

export function extractImages(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: { type?: string }) => b.type === "image")
    .map((b: { data?: string; mimeType?: string }) => ({
      data: b.data ?? "",
      mimeType: b.mimeType ?? "image/jpeg",
    }))
    .filter((img) => img.data);
}

/**
 * Detect heartbeat/cron system-event user messages injected by the gateway.
 * These are NOT typed by the user — they're system-generated prompts for the agent.
 */
const CRON_EVENT_RE = /^A scheduled (?:reminder|cron event) (?:has been|was) triggered/;
const EXEC_EVENT_RE = /^An async command you ran earlier has completed/;
const HEARTBEAT_PROMPT_RE = /^(?:Current time:|HEARTBEAT_OK$)/;
const SYSTEM_MSG_RE = /^\[System Message\]/;
export function isSystemEventMessage(text: string): boolean {
  // Strip optional inline timestamp prefix before matching.
  const trimmed = text.trim().replace(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})? [A-Z]{2,5}\]\s*/, "");
  return CRON_EVENT_RE.test(trimmed) || EXEC_EVENT_RE.test(trimmed) || HEARTBEAT_PROMPT_RE.test(trimmed) || SYSTEM_MSG_RE.test(trimmed);
}

/**
 * Internal maintenance prompts injected by the gateway (e.g. pre-compaction
 * memory flush) that should never be shown to the user.
 */
const INTERNAL_PROMPT_SENTINELS = [
  "Pre-compaction memory flush.",
];

/** Returns true if the message is an internal gateway maintenance prompt. */
export function isInternalPrompt(text: string): boolean {
  const trimmed = text.trim();
  return INTERNAL_PROMPT_SENTINELS.some((s) => trimmed.startsWith(s));
}

export const NO_PROVIDER_RE = /no\s+(llm\s+)?provider|no\s+api\s*key|provider\s+not\s+configured|key\s+not\s+(found|configured)/i;

/**
 * Map OpenClaw English error messages to i18n keys.
 * Pattern order matters — first match wins.
 */
const ERROR_I18N_MAP: Array<{ pattern: RegExp; key: string }> = [
  { pattern: NO_PROVIDER_RE, key: "chat.noProviderError" },
  { pattern: /temporarily overloaded|rate.?limit/i, key: "chat.errorRateLimit" },
  { pattern: /billing error|run out of credits|insufficient balance/i, key: "chat.errorBilling" },
  { pattern: /timed?\s*out/i, key: "chat.errorTimeout" },
  { pattern: /context overflow|prompt too large|context length exceeded/i, key: "chat.errorContextOverflow" },
  { pattern: /unauthorized|invalid.*(?:key|token)|authentication/i, key: "chat.errorAuth" },
];

export function localizeError(raw: string, t: (key: string) => string): string {
  for (const { pattern, key } of ERROR_I18N_MAP) {
    if (pattern.test(raw)) return t(key);
  }
  return raw;
}

/**
 * Extract the delivered message text from a "message" tool_use block.
 * Handles both Anthropic format (input object) and OpenAI format (arguments JSON string).
 */
function extractToolInputMessage(block: Record<string, unknown>): string | null {
  // Try multiple field names / formats used by different LLM API layers:
  //   - Anthropic:  { type: "tool_use",  input: { message: "..." } }
  //   - Pi Agent:   { type: "toolCall",  arguments: { message: "..." } }  (object)
  //   - OpenAI:     { type: "function_call", arguments: '{"message":"..."}' }  (JSON string)
  for (const field of ["input", "arguments", "args"]) {
    const val = block[field];
    if (!val) continue;
    // Object form — Anthropic `input` or Pi Agent `arguments`
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.message === "string" && obj.message.trim()) {
        return obj.message.trim();
      }
    }
    // JSON string form — OpenAI `arguments`
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val) as Record<string, unknown>;
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          return parsed.message.trim();
        }
      } catch { /* malformed JSON — skip */ }
    }
  }
  return null;
}

/**
 * Extract tool call arguments from a content block.
 * Handles Anthropic (input), Pi Agent (arguments as object), and OpenAI (arguments as JSON string).
 */
function extractToolArgs(block: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const field of ["input", "arguments", "args"]) {
    const val = block[field];
    if (!val) continue;
    if (typeof val === "object" && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch { /* malformed JSON — skip */ }
    }
  }
  return undefined;
}

/**
 * Content block types that represent tool calls across different API formats:
 * - tool_use / tooluse: Anthropic format
 * - tool_call / toolcall: generic format
 * - function_call / functioncall: OpenAI Responses format
 * - toolCall / toolUse / functionCall: camelCase variants used by Pi agent
 * Normalized to lowercase for matching.
 */
const TOOL_CALL_BLOCK_TYPES = new Set([
  "tool_use", "tooluse", "tool_call", "toolcall", "function_call", "functioncall",
]);

function isToolCallBlock(block: Record<string, unknown>): boolean {
  const raw = block.type;
  if (typeof raw !== "string") return false;
  return TOOL_CALL_BLOCK_TYPES.has(raw.trim().toLowerCase());
}

/**
 * Parse raw gateway messages into ChatMessage[].
 * Always extracts tool call blocks as inline "tool-event" entries;
 * visibility is controlled at render time via the preserveToolEvents setting.
 */
export function parseRawMessages(
  raw?: Array<{ role?: string; content?: unknown; timestamp?: number; idempotencyKey?: string; provenance?: unknown }>,
): ChatMessage[] {
  if (!raw) return [];
  const parsed: ChatMessage[] = [];
  for (const msg of raw) {
    if (msg.role === "user" || msg.role === "assistant") {
      // Extract text + images first, then tool call names.
      // Text is generated BEFORE tool calls in the LLM turn,
      // so the text bubble should appear above tool-event markers.
      const text = extractText(msg.content);
      const images = extractImages(msg.content);
      // Skip internal gateway maintenance prompts (e.g. pre-compaction memory flush)
      if (msg.role === "user" && isInternalPrompt(text)) continue;
      if (text.trim() || images.length > 0) {
        const entry: ChatMessage = { role: msg.role, text, timestamp: msg.timestamp ?? 0, images: images.length > 0 ? images : undefined };
        if (msg.idempotencyKey) entry.idempotencyKey = msg.idempotencyKey;
        // Mark system-generated user messages (cron events, heartbeat prompts)
        // as external so they render on the left/agent side.
        if (msg.role === "user" && isSystemEventMessage(text)) {
          entry.isExternal = true;
          entry.channel = "cron";
        }
        // Mark inter-session or external-provenance user messages as external.
        // sessions_send stores user messages with provenance.kind = "inter_session";
        // voice transcripts use provenance.kind = "external_user".
        // These should render on the agent (left) side, not the user (right) side.
        if (msg.role === "user" && !entry.isExternal && msg.provenance && typeof msg.provenance === "object") {
          const prov = msg.provenance as { kind?: string; sourceTool?: string; sourceChannel?: string };
          if (prov.kind === "inter_session" || prov.kind === "external_user" || prov.kind === "internal_system") {
            entry.isExternal = true;
            entry.channel = prov.sourceTool ?? prov.sourceChannel ?? prov.kind;
          }
        }
        parsed.push(entry);
      }
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (isToolCallBlock(b) && typeof b.name === "string") {
            const args = extractToolArgs(b);
            parsed.push({ role: "tool-event", text: b.name, toolName: b.name, toolArgs: args, timestamp: msg.timestamp ?? 0 });
            // Extract delivered text from outbound message tool calls.
            // The "message" tool sends text to external channels; the actual
            // message content lives in input.message (Anthropic format) or
            // arguments JSON (OpenAI format), NOT in type:"text" blocks.
            if (b.name === "message") {
              const delivered = extractToolInputMessage(b);
              if (delivered) {
                parsed.push({ role: "assistant", text: delivered, timestamp: msg.timestamp ?? 0 });
              }
            }
          }
        }
      }
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Context overflow detection for model switching
// ---------------------------------------------------------------------------

export type ContextOverflowCheck =
  | { action: "block"; currentTokens: number; newContextWindow: number }
  | { action: "warn" }
  | { action: "ok" };

/**
 * Evaluate whether switching to a model with a given context window would
 * overflow, given the current session's token count.
 *
 * - `block`: tokens already exceed the new model's window — must intervene
 * - `warn`: tokens exceed 80% of the new window — advisory toast
 * - `ok`: safe to switch
 */
export function checkContextOverflow(
  currentTokens: number,
  newContextWindow: number | undefined,
): ContextOverflowCheck {
  if (!newContextWindow || newContextWindow <= 0 || currentTokens <= 0) {
    return { action: "ok" };
  }
  if (currentTokens > newContextWindow) {
    return { action: "block", currentTokens, newContextWindow };
  }
  if (currentTokens > newContextWindow * 0.8) {
    return { action: "warn" };
  }
  return { action: "ok" };
}

/** Format a token count as a compact "Xk" / "X.Xm" string. */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
