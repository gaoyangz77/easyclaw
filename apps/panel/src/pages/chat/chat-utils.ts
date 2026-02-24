import { stripReasoningTagsFromText } from "@openclaw/reasoning-tags";

export type ChatImage = { data: string; mimeType: string };

export type ChatMessage = {
  role: "user" | "assistant" | "tool-event";
  text: string;
  timestamp: number;
  images?: ChatImage[];
  toolName?: string;
};

export type PendingImage = { dataUrl: string; base64: string; mimeType: string };

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export const COMPRESS_MAX_DIMENSION = 1280; // resize longest side to this
export const COMPRESS_TARGET_BYTES = 300 * 1024; // target base64 size after compression
export const COMPRESS_INITIAL_QUALITY = 0.85;
export const COMPRESS_MIN_QUALITY = 0.4;

export const DEFAULT_SESSION_KEY = "agent:main:main";
export const INITIAL_VISIBLE = 50;
export const PAGE_SIZE = 20;
export const FETCH_BATCH = 200;

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

  // Strip inline timestamp — rendered separately above the bubble
  cleaned = cleaned.replace(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})? [A-Z]{2,5}\]\s*/, "");

  // Detect audio transcript pattern:
  //   [Audio] User text: [Telegram ... ] <media:audio>\nTranscript: 实际文本
  const audioMatch = cleaned.match(/\[Audio\]\s*User text:\s*\[.*?\]\s*<media:audio>\s*Transcript:\s*([\s\S]*)/);
  if (audioMatch) {
    cleaned = `🔊 ${audioMatch[1].trim()}`;
  }

  return cleaned;
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
  raw?: Array<{ role?: string; content?: unknown; timestamp?: number }>,
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
      if (text.trim() || images.length > 0) {
        parsed.push({ role: msg.role, text, timestamp: msg.timestamp ?? 0, images: images.length > 0 ? images : undefined });
      }
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (isToolCallBlock(b) && typeof b.name === "string") {
            parsed.push({ role: "tool-event", text: b.name, toolName: b.name, timestamp: msg.timestamp ?? 0 });
          }
        }
      }
    }
  }
  return parsed;
}
