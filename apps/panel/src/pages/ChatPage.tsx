import { useState, useEffect, useLayoutEffect, useRef, useCallback, useReducer } from "react";
import { useTranslation } from "react-i18next";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import { stripReasoningTagsFromText } from "@openclaw/reasoning-tags";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// Gateway attachment limit is 5 MB (image-only for webchat)
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1000 * 1000;
import { fetchGatewayInfo, fetchProviderKeys, trackEvent, fetchChatShowAgentEvents, fetchChatPreserveToolEvents } from "../api.js";
import { configManager } from "../lib/config-manager.js";
import { Select } from "../components/Select.js";
import { GatewayChatClient } from "../lib/gateway-client.js";
import type { GatewayEvent, GatewayHelloOk } from "../lib/gateway-client.js";
import { RunTracker } from "../lib/run-tracker.js";
import { ChatEventBridge } from "../lib/chat-event-bridge.js";
import { Modal } from "../components/Modal.js";
import "./ChatPage.css";

type ChatImage = { data: string; mimeType: string };

type ChatMessage = {
  role: "user" | "assistant" | "tool-event";
  text: string;
  timestamp: number;
  images?: ChatImage[];
  toolName?: string;
};

type PendingImage = { dataUrl: string; base64: string; mimeType: string };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const COMPRESS_MAX_DIMENSION = 1280; // resize longest side to this
const COMPRESS_TARGET_BYTES = 300 * 1024; // target base64 size after compression
const COMPRESS_INITIAL_QUALITY = 0.85;
const COMPRESS_MIN_QUALITY = 0.4;

const DEFAULT_SESSION_KEY = "agent:main:main";
const INITIAL_VISIBLE = 50;
const PAGE_SIZE = 20;
const FETCH_BATCH = 200;

/**
 * Clean up raw gateway message text:
 * - Strip "Conversation info (untrusted metadata):" blocks
 * - Format audio transcript messages nicely
 */
function cleanMessageText(text: string): string {
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

function formatTimestamp(ts: number, locale: string): string {
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

/** Module-level constants to avoid re-creation on every render. */
const mdRemarkPlugins = [remarkGfm];
const mdComponents = {
  img: ({ alt, src }: { alt?: string; src?: string }) => (
    <img src={src} alt={alt ?? ""} className="chat-bubble-img" />
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

function MarkdownMessage({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={mdRemarkPlugins} components={mdComponents}>
      {text}
    </ReactMarkdown>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      className={`chat-bubble-copy${copied ? " chat-bubble-copy-done" : ""}`}
      onClick={handleCopy}
      data-tooltip={copied ? t("common.copied") : t("common.copy")}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

/**
 * Extract plain text from gateway message content blocks.
 */
const NO_PROVIDER_RE = /no\s+(llm\s+)?provider|no\s+api\s*key|provider\s+not\s+configured|key\s+not\s+(found|configured)/i;

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

function localizeError(raw: string, t: (key: string) => string): string {
  for (const { pattern, key } of ERROR_I18N_MAP) {
    if (pattern.test(raw)) return t(key);
  }
  return raw;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("");
}

function extractImages(content: unknown): ChatImage[] {
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
function parseRawMessages(
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

export function ChatPage({ onAgentNameChange }: { onAgentNameChange?: (name: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, _setStreaming] = useState<string | null>(null);
  const streamingRef = useRef<string | null>(null);
  /** Update both the streaming state (for UI) and the ref (for synchronous reads). */
  const setStreaming = useCallback((v: string | null | ((prev: string | null) => string | null)) => {
    if (typeof v === "function") {
      _setStreaming((prev) => {
        const next = v(prev);
        streamingRef.current = next;
        return next;
      });
    } else {
      streamingRef.current = v;
      _setStreaming(v);
    }
  }, []);
  const [runId, setRunId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [agentName, setAgentName] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<{ keyId: string; provider: string; model: string } | null>(null);
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  const [allFetched, setAllFetched] = useState(false);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const trackerRef = useRef(new RunTracker(forceUpdate));
  const [showAgentEvents, setShowAgentEvents] = useState(true);
  const [preserveToolEvents, setPreserveToolEvents] = useState(false);
  const [chatExamplesExpanded, setChatExamplesExpanded] = useState(() => localStorage.getItem("chat-examples-collapsed") !== "1");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const clientRef = useRef<GatewayChatClient | null>(null);
  const bridgeRef = useRef<ChatEventBridge | null>(null);
  const sessionKeyRef = useRef(DEFAULT_SESSION_KEY);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const fetchLimitRef = useRef(FETCH_BATCH);
  const isFetchingRef = useRef(false);
  const shouldInstantScrollRef = useRef(true);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filePathInputRef = useRef<HTMLInputElement>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Stable refs so event handler closures always see the latest state
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  const lastActivityRef = useRef<number>(0);
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  const allFetchedRef = useRef(allFetched);
  allFetchedRef.current = allFetched;
  const sendTimeRef = useRef<number>(0);
  const needsDisconnectErrorRef = useRef(false);
  const lastAgentStreamRef = useRef<string | null>(null);
  const showAgentEventsRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isLoadingMoreRef.current) return;
    if (shouldInstantScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      shouldInstantScrollRef.current = false;
    } else {
      // Only auto-scroll if the user is already near the bottom.
      // If they scrolled up to read earlier messages, don't yank them back.
      const el = messagesContainerRef.current;
      if (el) {
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom < 150) scrollToBottom();
      }
    }
  }, [messages, streaming, runId, scrollToBottom]);

  // Fetch more messages from gateway when user scrolled past all cached messages
  const fetchMore = useCallback(async () => {
    const client = clientRef.current;
    if (!client || allFetchedRef.current || isFetchingRef.current) return;
    isFetchingRef.current = true;
    const oldCount = messagesLengthRef.current;
    fetchLimitRef.current += FETCH_BATCH;

    try {
      const result = await client.request<{
        messages?: Array<{ role?: string; content?: unknown; timestamp?: number }>;
      }>("chat.history", {
        sessionKey: sessionKeyRef.current,
        limit: fetchLimitRef.current,
      });

      const parsed = parseRawMessages(result?.messages);

      if (parsed.length < fetchLimitRef.current || parsed.length <= oldCount) {
        setAllFetched(true);
      }

      if (parsed.length > oldCount) {
        prevScrollHeightRef.current = messagesContainerRef.current?.scrollHeight ?? 0;
        isLoadingMoreRef.current = true;
        setMessages(parsed);
        setVisibleCount(oldCount + PAGE_SIZE);
      }
    } catch {
      // Fetch failure is non-fatal
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Load older messages on scroll to top
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el || isLoadingMoreRef.current || isFetchingRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 150);
    if (el.scrollTop < 50) {
      // All cached messages visible — try fetching more from gateway
      if (visibleCountRef.current >= messagesLengthRef.current) {
        if (!allFetchedRef.current) {
          fetchMore();
        }
        return;
      }
      // Reveal more from cache
      prevScrollHeightRef.current = el.scrollHeight;
      setVisibleCount((prev) => {
        if (prev >= messagesLengthRef.current) return prev;
        isLoadingMoreRef.current = true;
        return Math.min(prev + PAGE_SIZE, messagesLengthRef.current);
      });
    }
  }, [fetchMore]);

  // Preserve scroll position after revealing older messages
  useLayoutEffect(() => {
    if (!isLoadingMoreRef.current) return;
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    }
    isLoadingMoreRef.current = false;
  }, [visibleCount]);

  // Load chat history once connected
  const loadHistory = useCallback(async (client: GatewayChatClient) => {
    fetchLimitRef.current = FETCH_BATCH;
    isFetchingRef.current = true;

    try {
      const result = await client.request<{
        messages?: Array<{ role?: string; content?: unknown; timestamp?: number }>;
      }>("chat.history", {
        sessionKey: sessionKeyRef.current,
        limit: FETCH_BATCH,
      });

      const parsed = parseRawMessages(result?.messages);
      // Guard: don't wipe existing messages if gateway returns empty on reconnect
      if (parsed.length === 0 && messagesLengthRef.current > 0) return;
      setAllFetched(parsed.length < FETCH_BATCH);
      shouldInstantScrollRef.current = true;
      setMessages(parsed);
      setVisibleCount(INITIAL_VISIBLE);
    } catch {
      // History load failure is non-fatal
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Handle chat events from gateway
  const handleEvent = useCallback((evt: GatewayEvent) => {
    const tracker = trackerRef.current;

    // Process agent events — dispatch to RunTracker for phase tracking
    if (evt.event === "agent") {
      const agentPayload = evt.payload as {
        runId?: string;
        stream?: string;
        sessionKey?: string;
        data?: Record<string, unknown>;
      } | undefined;
      if (!agentPayload) return;
      if (agentPayload.sessionKey && agentPayload.sessionKey !== sessionKeyRef.current) return;

      const agentRunId = agentPayload.runId;

      // Always track last agent stream for timeout refinement
      lastAgentStreamRef.current = agentPayload.stream ?? null;
      lastActivityRef.current = Date.now();

      // Only process events for tracked runs (replaces old runIdRef guard)
      if (!agentRunId || !tracker.isTracked(agentRunId)) return;

      const stream = agentPayload.stream;

      // Always record tool call events inline; visibility controlled at render time
      if (stream === "tool") {
        const phase = agentPayload.data?.phase;
        const name = agentPayload.data?.name as string | undefined;
        if (phase === "start" && name) {
          // Flush current streaming text into a committed assistant bubble
          // before adding the tool event.  Read from ref (synchronous) to
          // avoid React StrictMode double-invocation of state updaters.
          const flushedText = streamingRef.current;
          setStreaming(null);
          const toolEvt: ChatMessage = { role: "tool-event", text: name, toolName: name, timestamp: Date.now() };
          if (flushedText) {
            setMessages((prev) => [...prev, { role: "assistant", text: flushedText, timestamp: Date.now() }, toolEvt]);
          } else {
            setMessages((prev) => [...prev, toolEvt]);
          }
          tracker.dispatch({ type: "TOOL_START", runId: agentRunId, toolName: name });
        } else if (phase === "result") {
          tracker.dispatch({ type: "TOOL_RESULT", runId: agentRunId });
        }
      } else if (stream === "lifecycle") {
        const phase = agentPayload.data?.phase;
        if (phase === "start") tracker.dispatch({ type: "LIFECYCLE_START", runId: agentRunId });
        else if (phase === "end") tracker.dispatch({ type: "LIFECYCLE_END", runId: agentRunId });
        else if (phase === "error") tracker.dispatch({ type: "LIFECYCLE_ERROR", runId: agentRunId });
      } else if (stream === "assistant") {
        tracker.dispatch({ type: "ASSISTANT_STREAM", runId: agentRunId });
      }
      return;
    }

    if (evt.event !== "chat") return;

    const payload = evt.payload as {
      state?: string;
      runId?: string;
      sessionKey?: string;
      message?: { role?: string; content?: unknown; timestamp?: number };
      errorMessage?: string;
    } | undefined;

    if (!payload) return;

    // Filter by sessionKey — only process events for our session
    // (filters out rule compilation, OpenAI-compat endpoints, etc.)
    if (payload.sessionKey && payload.sessionKey !== sessionKeyRef.current) return;

    const chatRunId = payload.runId;
    const isOurLocalRun = runIdRef.current && chatRunId === runIdRef.current;
    const isTrackedRun = chatRunId ? tracker.isTracked(chatRunId) : false;

    // If not tracked and not our local run, this may be an external run
    // we haven't seen yet (e.g. SSE inbound event arrived late or not at all).
    // Track it so we handle its lifecycle properly.
    if (chatRunId && !isTrackedRun && !isOurLocalRun) {
      // Only track if it's on our session (delta/final/error from external channel)
      if (payload.state === "delta") {
        tracker.dispatch({
          type: "EXTERNAL_INBOUND",
          runId: chatRunId,
          sessionKey: payload.sessionKey ?? sessionKeyRef.current,
          channel: "unknown",
        });
      }
    }

    // Dispatch chat events to RunTracker
    if (chatRunId) {
      switch (payload.state) {
        case "delta": {
          lastActivityRef.current = Date.now();
          const text = extractText(payload.message?.content);
          if (text) {
            tracker.dispatch({ type: "CHAT_DELTA", runId: chatRunId, text });
          }
          break;
        }
        case "final":
          tracker.dispatch({ type: "CHAT_FINAL", runId: chatRunId });
          break;
        case "error":
          tracker.dispatch({ type: "CHAT_ERROR", runId: chatRunId });
          break;
        case "aborted":
          tracker.dispatch({ type: "CHAT_ABORTED", runId: chatRunId });
          break;
      }
    }

    // Local run — handle streaming text and messages
    if (isOurLocalRun) {
      switch (payload.state) {
        case "delta": {
          lastActivityRef.current = Date.now();
          const text = extractText(payload.message?.content);
          if (text) setStreaming(text);
          break;
        }
        case "final": {
          const finalText = extractText(payload.message?.content);
          if (finalText) {
            setMessages((prev) => [...prev, { role: "assistant", text: finalText, timestamp: Date.now() }]);
          }
          if (sendTimeRef.current > 0) {
            trackEvent("chat.response_received", { durationMs: Date.now() - sendTimeRef.current });
            sendTimeRef.current = 0;
          }
          setStreaming(null);
          setRunId(null);
          lastAgentStreamRef.current = null;
          tracker.cleanup();
          break;
        }
        case "error": {
          console.error("[chat] error event:", payload.errorMessage ?? "unknown error", "runId:", chatRunId);
          const raw = payload.errorMessage ?? t("chat.unknownError");
          const errText = localizeError(raw, t);
          setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
          setStreaming(null);
          setRunId(null);
          lastAgentStreamRef.current = null;
          tracker.cleanup();
          break;
        }
        case "aborted": {
          // If there was partial streaming text, keep it as a message.
          const abortedText = streamingRef.current;
          setStreaming(null);
          if (abortedText) {
            setMessages((prev) => [...prev, { role: "assistant", text: abortedText, timestamp: Date.now() }]);
          }
          setRunId(null);
          lastAgentStreamRef.current = null;
          tracker.cleanup();
          break;
        }
      }
    } else if (chatRunId) {
      // External run — handle completion
      if (payload.state === "error") {
        console.error("[chat] external run error:", payload.errorMessage ?? "unknown error", "runId:", chatRunId);
      }
      if (payload.state === "final") {
        // External run finished — reload history to show the full conversation
        const client = clientRef.current;
        if (client) loadHistory(client);
      }
      if (payload.state === "final" || payload.state === "error" || payload.state === "aborted") {
        tracker.cleanup();
      }
    }
  }, [loadHistory, t]);

  // Stall detection: periodically check if events have stopped arriving.
  // Unlike a one-shot timeout, this catches stalls that happen mid-run
  // (e.g. after a memory compaction delta, the LLM request fails silently).
  // Reset activity tracking refs when a new run starts.
  // Stall detection removed — the real-time agent phase indicator
  // (tool events, "waiting for LLM", etc.) gives users enough feedback.
  // The old 30s timeout would wrongly abort long-running tool calls
  // and blame slow LLM providers, which isn't actionable.
  useEffect(() => {
    if (!runId) return;
    lastActivityRef.current = Date.now();
    lastAgentStreamRef.current = null;
  }, [runId]);

  // Re-fetch chat display settings when changed in SettingsPage.
  // ChatPage stays mounted (display:none) so the init effect won't re-run.
  useEffect(() => {
    function onSettingsChanged() {
      Promise.all([
        fetchChatShowAgentEvents().catch(() => true),
        fetchChatPreserveToolEvents().catch(() => false),
      ]).then(([showEvents, preserveEvents]) => {
        showAgentEventsRef.current = showEvents;
        setShowAgentEvents(showEvents);
        setPreserveToolEvents(preserveEvents);
      });
      // Refresh model label in case provider/model changed
      refreshModelLabel();
    }
    window.addEventListener("chat-settings-changed", onSettingsChanged);
    return () => window.removeEventListener("chat-settings-changed", onSettingsChanged);
  }, []);

  function refreshModelLabel() {
    configManager.getActiveKey().then(async (info) => {
      if (info) {
        setActiveModel({ keyId: info.keyId, provider: info.provider, model: info.model });
        const models = await configManager.getModelsForProvider(info.provider);
        setModelOptions(models.map((m) => ({ value: m.id, label: m.name })));
      } else {
        setActiveModel(null);
        setModelOptions([]);
      }
    }).catch(() => { setActiveModel(null); setModelOptions([]); });
  }

  // Fetch active model info when connection state changes to connected
  useEffect(() => {
    if (connectionState === "connected") refreshModelLabel();
  }, [connectionState]);

  // Refresh model label when config changes (e.g. model switched from ProvidersPage)
  useEffect(() => {
    return configManager.onChange(() => refreshModelLabel());
  }, []);

  function refreshAgentName(client: GatewayChatClient, cancelled?: boolean) {
    client.request<{ name?: string }>("agent.identity.get", {
      sessionKey: sessionKeyRef.current,
    }).then((res) => {
      if (!cancelled && res?.name) {
        setAgentName(res.name);
        onAgentNameChange?.(res.name);
      }
    }).catch(() => {});
  }

  // Initialize connection
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [showEvents, preserveEvents] = await Promise.all([
          fetchChatShowAgentEvents().catch(() => false),
          fetchChatPreserveToolEvents().catch(() => false),
        ]);
        if (cancelled) return;
        showAgentEventsRef.current = showEvents;
        setShowAgentEvents(showEvents);
        setPreserveToolEvents(preserveEvents);

        const info = await fetchGatewayInfo();
        if (cancelled) return;

        const client = new GatewayChatClient({
          url: info.wsUrl,
          token: info.token,
          onConnected: (hello: GatewayHelloOk) => {
            if (cancelled) return;
            // Use session key from gateway snapshot if available
            const mainKey = hello.snapshot?.sessionDefaults?.mainSessionKey;
            if (mainKey) sessionKeyRef.current = mainKey;
            setConnectionState("connected");
            loadHistory(client).then(() => {
              // Show deferred disconnect error AFTER history is loaded,
              // otherwise loadHistory's setMessages would overwrite the error.
              if (needsDisconnectErrorRef.current) {
                needsDisconnectErrorRef.current = false;
                setMessages((prev) => [...prev, {
                  role: "assistant",
                  text: `⚠ ${t("chat.disconnectedError")}`,
                  timestamp: Date.now(),
                }]);
              }
            });
            // Fetch agent display name
            refreshAgentName(client, cancelled);
          },
          onDisconnected: () => {
            if (cancelled) return;
            setConnectionState("connecting");
            const wasWaiting = !!runIdRef.current;
            // If streaming was in progress, save partial text.
            const disconnectText = streamingRef.current;
            setStreaming(null);
            if (disconnectText) {
              setMessages((prev) => [...prev, { role: "assistant", text: disconnectText, timestamp: Date.now() }]);
            }
            setRunId(null);
            trackerRef.current.reset();
            lastAgentStreamRef.current = null;
            // Defer error display: auto-reconnect calls loadHistory which
            // overwrites messages. The ref is checked after loadHistory completes.
            if (wasWaiting) {
              needsDisconnectErrorRef.current = true;
            }
          },
          onEvent: handleEvent,
        });

        clientRef.current = client;
        client.start();

        // Connect SSE bridge for inbound messages and tool events (see ADR-022)
        // SSE endpoint is on the panel-server (same origin as the panel UI)
        const sseUrl = new URL("/api/chat/events", window.location.origin).href;
        const bridge = new ChatEventBridge(sseUrl, {
          onAction: (action) => {
            if (cancelled) return;
            trackerRef.current.dispatch(action);
          },
          onUserMessage: (msg) => {
            if (cancelled) return;
            setMessages((prev) => [...prev, {
              role: "user",
              text: msg.text,
              timestamp: msg.timestamp,
            }]);
          },
        });
        bridge.connect();
        bridgeRef.current = bridge;
      } catch {
        if (!cancelled) setConnectionState("disconnected");
      }
    }

    init();

    // Poll agent identity every 5 minutes so name changes show up without refresh
    const nameTimer = setInterval(() => {
      if (clientRef.current) refreshAgentName(clientRef.current);
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(nameTimer);
      clientRef.current?.stop();
      clientRef.current = null;
      bridgeRef.current?.disconnect();
      bridgeRef.current = null;
    };
  }, [loadHistory, handleEvent]);

  async function handleSend() {
    const text = draft.trim();
    const files = pendingImages;
    if ((!text && files.length === 0) || connectionState !== "connected" || !clientRef.current) return;

    // Pre-flight: check if any provider key is configured
    try {
      const keys = await fetchProviderKeys();
      if (keys.length === 0) {
        setMessages((prev) => [
          ...prev,
          { role: "user", text, timestamp: Date.now() },
          { role: "assistant", text: `⚠ ${t("chat.noProviderError")}`, timestamp: Date.now() },
        ]);
        setDraft("");
        setPendingImages([]);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        return;
      }
    } catch {
      // Check failed — proceed anyway, let gateway handle it
    }

    const idempotencyKey = crypto.randomUUID();

    // Optimistic: show user message immediately
    const optimisticImages: ChatImage[] | undefined = files.length > 0
      ? files.map((img) => ({ data: img.base64, mimeType: img.mimeType }))
      : undefined;
    setMessages((prev) => [...prev, { role: "user", text, timestamp: Date.now(), images: optimisticImages }]);
    setDraft("");
    setPendingImages([]);
    setRunId(idempotencyKey);
    trackerRef.current.dispatch({ type: "LOCAL_SEND", runId: idempotencyKey, sessionKey: sessionKeyRef.current });
    sendTimeRef.current = Date.now();
    trackEvent("chat.message_sent", { hasAttachment: files.length > 0 });

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Build RPC params — images sent as base64 attachments.
    const params: Record<string, unknown> = {
      sessionKey: sessionKeyRef.current,
      message: text || (files.length > 0 ? t("chat.imageOnlyPlaceholder") : ""),
      idempotencyKey,
    };
    if (files.length > 0) {
      params.attachments = files.map((f) => ({
        type: "image" as const,
        mimeType: f.mimeType,
        content: f.base64,
      }));
    }

    clientRef.current.request("chat.send", params).catch((err) => {
      // RPC-level failure — clear runId so UI doesn't get stuck in streaming mode
      const raw = (err as Error).message || t("chat.sendError");
      const errText = localizeError(raw, t);
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
      setStreaming(null);
      setRunId(null);
    });
  }

  function handleStop() {
    if (!clientRef.current) return;
    const view = trackerRef.current.getView();
    const targetRunId = runIdRef.current ?? view.abortTargetRunId;
    if (!targetRunId) return;
    trackEvent("chat.generation_stopped");
    clientRef.current.request("chat.abort", {
      sessionKey: sessionKeyRef.current,
      runId: targetRunId,
    }).catch(() => {});
    setMessages((prev) => [...prev, { role: "assistant", text: `⏹ ${t("chat.stopCommandFeedback")}`, timestamp: Date.now() }]);
  }

  function handleReset() {
    if (!clientRef.current || connectionState !== "connected") return;
    setShowResetConfirm(true);
  }

  function handleModelChange(newModel: string) {
    if (!activeModel || newModel === activeModel.model) return;
    configManager.switchModel(activeModel.keyId, newModel)
      .then(() => setActiveModel((prev) => prev ? { ...prev, model: newModel } : null))
      .catch((err) => {
        const errText = (err as Error).message || t("chat.unknownError");
        setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
      });
  }

  function confirmReset() {
    setShowResetConfirm(false);
    if (!clientRef.current) return;
    // Abort any active run first
    const view = trackerRef.current.getView();
    const targetRunId = runIdRef.current ?? view.abortTargetRunId;
    if (targetRunId) {
      clientRef.current.request("chat.abort", {
        sessionKey: sessionKeyRef.current,
        runId: targetRunId,
      }).catch(() => {});
    }
    // Reset session on gateway
    clientRef.current.request("sessions.reset", {
      key: sessionKeyRef.current,
    }).then(() => {
      setMessages([{ role: "assistant", text: `🔄 ${t("chat.resetCommandFeedback")}`, timestamp: Date.now() }]);
      setStreaming(null);
      setRunId(null);
      trackerRef.current.reset();
      lastAgentStreamRef.current = null;
    }).catch((err) => {
      const errText = (err as Error).message || t("chat.unknownError");
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleEmojiClick(emojiData: EmojiClickData) {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newDraft = draft.slice(0, start) + emojiData.emoji + draft.slice(end);
      setDraft(newDraft);
      // Restore cursor position after emoji insertion
      requestAnimationFrame(() => {
        const pos = start + emojiData.emoji.length;
        textarea.selectionStart = pos;
        textarea.selectionEnd = pos;
        textarea.focus();
      });
    } else {
      setDraft((prev) => prev + emojiData.emoji);
    }
    setShowEmojiPicker(false);
  }

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  /**
   * Compress an image using canvas: resize to max dimension and encode as JPEG.
   * Progressively lowers quality until the base64 output fits the target size.
   */
  function compressImage(dataUrl: string): Promise<PendingImage | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > COMPRESS_MAX_DIMENSION || height > COMPRESS_MAX_DIMENSION) {
          const scale = COMPRESS_MAX_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = "image/jpeg";
        let quality = COMPRESS_INITIAL_QUALITY;
        let resultDataUrl = canvas.toDataURL(mimeType, quality);
        let base64 = resultDataUrl.split(",")[1] ?? "";

        // Progressively reduce quality if over target
        while (base64.length > COMPRESS_TARGET_BYTES && quality > COMPRESS_MIN_QUALITY) {
          quality -= 0.1;
          resultDataUrl = canvas.toDataURL(mimeType, quality);
          base64 = resultDataUrl.split(",")[1] ?? "";
        }

        resolve({ dataUrl: resultDataUrl, base64, mimeType });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function readFileAsPending(file: File): Promise<PendingImage | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        if (base64.length > COMPRESS_TARGET_BYTES) {
          resolve(await compressImage(dataUrl));
          return;
        }
        resolve({ dataUrl, base64, mimeType: file.type });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(files: FileList | File[]) {
    const results: PendingImage[] = [];
    for (const file of Array.from(files)) {
      if (!IMAGE_TYPES.includes(file.type)) continue;
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        alert(t("chat.imageTooLarge"));
        continue;
      }
      const pending = await readFileAsPending(file);
      if (pending) results.push(pending);
    }
    if (results.length > 0) {
      setPendingImages((prev) => [...prev, ...results]);
    }
  }

  function handleAttachClick() {
    fileInputRef.current?.click();
  }

  function handleFilePathClick() {
    filePathInputRef.current?.click();
  }

  function handleFilePathChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return;
    const paths = Array.from(e.target.files).map((f) => (f as File & { path?: string }).path ?? f.name);
    const snippet = paths.join(" ");
    // Insert paths at cursor with surrounding spaces to avoid merging with existing text
    setDraft((prev) => {
      const before = prev.length > 0 && !prev.endsWith(" ") ? " " : "";
      return `${prev}${before}${snippet} `;
    });
    e.target.value = "";
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files);
      e.target.value = ""; // reset so same file can be re-selected
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.files;
    if (items && items.length > 0) {
      const imageFiles = Array.from(items).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFileSelect(imageFiles);
      }
    }
  }

  function removePendingImage(index: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }

  const visibleMessages = messages.slice(Math.max(0, messages.length - visibleCount));
  const showHistoryEnd = allFetched && visibleCount >= messages.length && messages.length > 0;
  const isStreaming = runId !== null;
  const statusKey =
    connectionState === "connected"
      ? "chat.connected"
      : connectionState === "connecting"
        ? "chat.connecting"
        : "chat.disconnected";

  return (
    <div className="chat-container">
      {messages.length === 0 && !streaming ? (
        <div className="chat-empty">
          <div>{t("chat.emptyState")}</div>
        </div>
      ) : (
        <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
          {showHistoryEnd && (
            <div className="chat-history-end">{t("chat.historyEnd")}</div>
          )}
          {visibleMessages.map((msg, i) => {
            if (msg.role === "tool-event") {
              return preserveToolEvents ? (
                <div key={i} className="chat-tool-event">
                  <span className="chat-tool-event-icon">&#9881;</span>
                  {t("chat.toolEventLabel", { tool: msg.toolName })}
                </div>
              ) : null;
            }
            const cleaned = cleanMessageText(msg.text);
            const hasImages = msg.images && msg.images.length > 0;
            // Skip empty bubbles (text stripped by cleanMessageText and no images)
            if (!cleaned && !hasImages) return null;
            return (
            <div key={i} className={`chat-bubble-wrap ${msg.role === "user" ? "chat-bubble-wrap-user" : "chat-bubble-wrap-assistant"}`}>
              {msg.timestamp > 0 && (
                <div className="chat-bubble-timestamp">{formatTimestamp(msg.timestamp, i18n.language)}</div>
              )}
            <div
              className={`chat-bubble ${msg.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
            >
              {hasImages && (
                <div className="chat-bubble-images">
                  {msg.images!.map((img, j) => (
                    <img
                      key={j}
                      src={`data:${img.mimeType};base64,${img.data}`}
                      alt=""
                      className="chat-bubble-img"
                    />
                  ))}
                </div>
              )}
              {cleaned && (msg.role === "assistant" ? <MarkdownMessage text={cleaned} /> : cleaned)}
              {msg.role === "assistant" && cleaned && <CopyButton text={cleaned} />}
            </div>
            </div>
            );
          })}
          {(() => {
            const view = trackerRef.current.getView();
            // Show the thinking bubble only when there's no streaming text.
            // When streaming text is visible, it IS the visual feedback —
            // showing both would cause duplicate/overlapping bubbles.
            const showThinking = streaming === null && (
              runId !== null || (view.isActive && view.displayPhase !== "done")
            );
            return showThinking ? (
              <div className="chat-bubble chat-bubble-assistant chat-thinking">
                {view.displayPhase && showAgentEvents ? (
                  <span className="chat-agent-phase">
                    {view.displayPhase === "tooling"
                      ? t("chat.phaseUsingTool", { tool: view.displayToolName ?? "" })
                      : t(`chat.phase_${view.displayPhase}`)}
                  </span>
                ) : null}
                <span className="chat-thinking-dots"><span /><span /><span /></span>
              </div>
            ) : null;
          })()}
          {streaming !== null && (
            <>
              {(() => {
                const view = trackerRef.current.getView();
                return view.displayPhase === "tooling" && showAgentEvents ? (
                  <div className="chat-agent-phase-inline">
                    {t("chat.phaseUsingTool", { tool: view.displayToolName ?? "" })}
                  </div>
                ) : null;
              })()}
              <div className="chat-bubble chat-bubble-assistant chat-streaming-cursor">
                <MarkdownMessage text={cleanMessageText(streaming)} />
              </div>
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
      {showScrollBtn && (
        <button className="chat-scroll-bottom" onClick={scrollToBottom}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      <div className="chat-examples">
        <button
          className="chat-examples-toggle"
          onClick={() => {
            const next = !chatExamplesExpanded;
            setChatExamplesExpanded(next);
            localStorage.setItem("chat-examples-collapsed", next ? "0" : "1");
          }}
        >
          <svg className={`chat-examples-chevron ${chatExamplesExpanded ? "chat-examples-chevron-down" : ""}`} width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4.5 10L8 6.5L11.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        {chatExamplesExpanded && (
          <>
          <div className="chat-examples-title">{t("chat.examplesTitle")}</div>
          <div className="chat-examples-grid">
            {(["example1", "example2", "example3", "example4", "example5", "example6"] as const).map((key) => (
              <button
                key={key}
                className="chat-example-card"
                onClick={() => { const text = t(`chat.${key}`); setDraft(text); setTimeout(() => { const el = textareaRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = text.length; } }, 0); }}
              >
                {t(`chat.${key}`)}
              </button>
            ))}
          </div>
          </>
        )}
      </div>

      <div className="chat-status">
        <span className={`chat-status-dot chat-status-dot-${connectionState}`} />
        <span>{agentName ? `${agentName} · ${t(statusKey)}` : t(statusKey)}</span>
        {connectionState === "connected" && activeModel && (
          <>
            <span className="chat-status-model">{t(`providers.label_${activeModel.provider}`, { defaultValue: activeModel.provider })}</span>
            <Select
              className="chat-model-select"
              value={activeModel.model}
              onChange={handleModelChange}
              options={modelOptions}
            />
          </>
        )}
        <span className="chat-status-spacer" />
        <button
          className="btn btn-sm btn-secondary"
          onClick={handleStop}
          disabled={!isStreaming && !trackerRef.current.getView().canAbort}
        >
          {t("chat.stopCommand")}
        </button>
        <button
          className="btn btn-sm btn-secondary"
          onClick={handleReset}
          disabled={connectionState !== "connected"}
        >
          {t("chat.resetCommand")}
        </button>
      </div>

      <div className="chat-input-area">
        {pendingImages.length > 0 && (
          <div className="chat-image-preview-strip">
            {pendingImages.map((img, i) => (
              <div key={i} className="chat-image-preview">
                <img src={img.dataUrl} alt="" />
                <button
                  className="chat-image-preview-remove"
                  onClick={() => removePendingImage(i)}
                  title={t("chat.removeImage")}
                  type="button"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("chat.placeholder")}
            rows={1}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={handleFileInputChange}
            style={{ display: "none" }}
          />
          <input
            ref={filePathInputRef}
            type="file"
            multiple
            onChange={handleFilePathChange}
            style={{ display: "none" }}
          />
          <button
            className="chat-attach-btn"
            onClick={handleFilePathClick}
            title={t("chat.attachFile")}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <button
            className="chat-attach-btn"
            onClick={handleAttachClick}
            title={t("chat.attachImage")}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <div className="chat-emoji-wrapper" ref={emojiPickerRef}>
            <button
              className="chat-emoji-btn"
              onClick={() => setShowEmojiPicker((v) => !v)}
              title={t("chat.emoji")}
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>
            {showEmojiPicker && (
              <div className="chat-emoji-picker">
                {/* @ts-expect-error emoji-picker-react types not fully compatible with React 19 */}
                <EmojiPicker onEmojiClick={handleEmojiClick} width={320} height={400} />
              </div>
            )}
          </div>
          {(isStreaming || trackerRef.current.getView().canAbort) ? (
            <button className="btn btn-danger" onClick={handleStop}>
              {t("chat.stop")}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={(!draft.trim() && pendingImages.length === 0) || connectionState !== "connected"}
            >
              {t("chat.send")}
            </button>
          )}
        </div>
      </div>
      <Modal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title={t("chat.resetCommand")}
        maxWidth={400}
      >
        <p>{t("chat.resetConfirm")}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setShowResetConfirm(false)}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-danger" onClick={confirmReset}>
            {t("chat.resetCommand")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
