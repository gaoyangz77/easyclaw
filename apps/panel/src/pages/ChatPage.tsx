import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import { stripReasoningTagsFromText } from "@openclaw/reasoning-tags";
import { fetchGatewayInfo, fetchProviderKeys, trackEvent, fetchChatShowAgentEvents, fetchChatPreserveToolEvents } from "../api.js";
import { GatewayChatClient } from "../lib/gateway-client.js";
import type { GatewayEvent, GatewayHelloOk } from "../lib/gateway-client.js";
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — input file size limit before compression
const MAX_WS_PAYLOAD_BYTES = 400 * 1024; // client-side guard: keep well under gateway's 512KB WS frame limit
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
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

  // Detect audio transcript pattern:
  //   [Audio] User text: [Telegram ... ] <media:audio>\nTranscript: 实际文本
  const audioMatch = cleaned.match(/\[Audio\]\s*User text:\s*\[.*?\]\s*<media:audio>\s*Transcript:\s*([\s\S]*)/);
  if (audioMatch) {
    cleaned = `🔊 ${audioMatch[1].trim()}`;
  }

  return cleaned;
}

/**
 * Basic text formatter: code blocks, inline code, and line breaks.
 * No external dependencies.
 */
function formatMessage(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Split on fenced code blocks: ```...```
  const segments = text.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.startsWith("```") && seg.endsWith("```")) {
      // Code block — strip the fences
      const inner = seg.slice(3, -3);
      // Optional language hint on first line
      const nlIdx = inner.indexOf("\n");
      const code = nlIdx >= 0 ? inner.slice(nlIdx + 1) : inner;
      parts.push(<pre key={i}><code>{code}</code></pre>);
    } else {
      // Inline formatting: `code`, markdown images, and newlines
      const inlineParts = seg.split(/(`[^`]+`)/g);
      for (let j = 0; j < inlineParts.length; j++) {
        const ip = inlineParts[j];
        if (ip.startsWith("`") && ip.endsWith("`")) {
          parts.push(<code key={`${i}-${j}`}>{ip.slice(1, -1)}</code>);
        } else {
          // Split on markdown images: ![alt](url)
          const imgParts = ip.split(/(!\[[^\]]*\]\([^)]+\))/g);
          for (let m = 0; m < imgParts.length; m++) {
            const mp = imgParts[m];
            const imgMatch = mp.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            if (imgMatch) {
              parts.push(
                <img
                  key={`${i}-${j}-img${m}`}
                  src={imgMatch[2]}
                  alt={imgMatch[1]}
                  className="chat-bubble-img"
                />,
              );
            } else {
              // Convert newlines to <br>
              const lines = mp.split("\n");
              for (let k = 0; k < lines.length; k++) {
                if (k > 0) parts.push(<br key={`${i}-${j}-${m}-br${k}`} />);
                if (lines[k]) parts.push(lines[k]);
              }
            }
          }
        }
      }
    }
  }
  return parts;
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
      // Always extract tool call names from assistant content blocks
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (isToolCallBlock(b) && typeof b.name === "string") {
            parsed.push({ role: "tool-event", text: b.name, toolName: b.name, timestamp: msg.timestamp ?? 0 });
          }
        }
      }
      const text = extractText(msg.content);
      const images = extractImages(msg.content);
      if (!text.trim() && images.length === 0) continue;
      parsed.push({ role: msg.role, text, timestamp: msg.timestamp ?? 0, images: images.length > 0 ? images : undefined });
    }
  }
  return parsed;
}

export function ChatPage({ onAgentNameChange }: { onAgentNameChange?: (name: string | null) => void }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [agentName, setAgentName] = useState<string | null>(null);
  const [allFetched, setAllFetched] = useState(false);
  const [externalRunActive, setExternalRunActive] = useState(false);
  const [agentPhase, setAgentPhase] = useState<string | null>(null);
  const [showAgentEvents, setShowAgentEvents] = useState(true);
  const [preserveToolEvents, setPreserveToolEvents] = useState(false);
  const [chatExamplesExpanded, setChatExamplesExpanded] = useState(() => localStorage.getItem("chat-examples-collapsed") !== "1");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const clientRef = useRef<GatewayChatClient | null>(null);
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

  // Stable refs so event handler closures always see the latest state
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  const receivedDeltaRef = useRef(false);
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
      scrollToBottom();
    }
  }, [messages, streaming, runId, externalRunActive, scrollToBottom]);

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
    // Process agent events for processing-phase tracking
    if (evt.event === "agent") {
      const agentPayload = evt.payload as {
        runId?: string;
        stream?: string;
        sessionKey?: string;
        data?: Record<string, unknown>;
      } | undefined;
      if (!agentPayload) return;
      if (agentPayload.sessionKey && agentPayload.sessionKey !== sessionKeyRef.current) return;

      // Always track last agent stream for timeout refinement
      lastAgentStreamRef.current = agentPayload.stream ?? null;

      if (!runIdRef.current) return;

      const stream = agentPayload.stream;

      // Always record tool call events inline; visibility controlled at render time
      if (stream === "tool") {
        const phase = agentPayload.data?.phase;
        const name = agentPayload.data?.name as string | undefined;
        if (phase === "start" && name) {
          setMessages((prev) => [...prev, { role: "tool-event", text: name, toolName: name, timestamp: Date.now() }]);
        }
      }

      // Phase UI requires showAgentEvents
      if (!showAgentEventsRef.current) return;

      if (stream === "lifecycle") {
        const phase = agentPayload.data?.phase;
        if (phase === "start") setAgentPhase("processing");
        else if (phase === "end" || phase === "error") setAgentPhase(null);
      } else if (stream === "tool") {
        const phase = agentPayload.data?.phase;
        const name = agentPayload.data?.name as string | undefined;
        if (phase === "start" && name) {
          setAgentPhase(`tool:${name}`);
        } else if (phase === "result") {
          setAgentPhase("processing");
        }
      } else if (stream === "assistant") {
        // Don't overwrite an active tool phase — tool status is more informative
        setAgentPhase((prev) => (prev && prev.startsWith("tool:") ? prev : "generating"));
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

    const isOurRun = runIdRef.current && payload.runId === runIdRef.current;

    if (!isOurRun && runIdRef.current) {
      console.warn("[chat] runId mismatch — ours:", runIdRef.current, "received:", payload.runId, "state:", payload.state);
    }

    // Events from a different run on the same session (e.g. channel messages)
    if (!isOurRun) {
      if (payload.state === "delta") {
        // External run is actively streaming — show thinking indicator
        setExternalRunActive(true);
      } else if (payload.state === "error") {
        console.error("[chat] error event:", payload.errorMessage ?? "unknown error", "runId:", payload.runId);
        setExternalRunActive(false);
        // Surface error to user if we're waiting for a response
        if (runIdRef.current) {
          const raw = payload.errorMessage ?? t("chat.unknownError");
          const errText = localizeError(raw, t);
          setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
          setStreaming(null);
          setRunId(null);
        }
      } else if (payload.state === "final") {
        setExternalRunActive(false);
        // Another run finished on our session (channel message reply done) — reload history
        const client = clientRef.current;
        if (client) loadHistory(client);
      } else if (payload.state === "aborted") {
        setExternalRunActive(false);
      }
      return;
    }

    // Our own run — process normally
    switch (payload.state) {
      case "delta": {
        receivedDeltaRef.current = true;
        const text = extractText(payload.message?.content);
        if (text) setStreaming(text);
        break;
      }
      case "final": {
        const text = extractText(payload.message?.content);
        if (text) {
          setMessages((prev) => [...prev, { role: "assistant", text, timestamp: Date.now() }]);
        }
        if (sendTimeRef.current > 0) {
          trackEvent("chat.response_received", { durationMs: Date.now() - sendTimeRef.current });
          sendTimeRef.current = 0;
        }
        setStreaming(null);
        setRunId(null);
        setAgentPhase(null);
        lastAgentStreamRef.current = null;
        break;
      }
      case "error": {
        console.error("[chat] error event:", payload.errorMessage ?? "unknown error", "runId:", payload.runId);
        const raw = payload.errorMessage ?? t("chat.unknownError");
        const errText = localizeError(raw, t);
        setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
        setStreaming(null);
        setRunId(null);
        setAgentPhase(null);
        lastAgentStreamRef.current = null;
        break;
      }
      case "aborted": {
        // If there was partial streaming text, keep it as a message
        setStreaming((current) => {
          if (current) {
            setMessages((prev) => [...prev, { role: "assistant", text: current, timestamp: Date.now() }]);
          }
          return null;
        });
        setRunId(null);
        setAgentPhase(null);
        lastAgentStreamRef.current = null;
        break;
      }
    }
  }, [loadHistory, t]);

  // Timeout: if runId is set but no first delta arrives within 60s, show error.
  // Once the first delta is received, the timeout is cancelled and won't fire again.
  // The error message is refined based on what agent events were received.
  useEffect(() => {
    if (!runId) return;
    receivedDeltaRef.current = false;
    lastAgentStreamRef.current = null;
    const timer = setTimeout(() => {
      if (receivedDeltaRef.current) return; // already streaming — no timeout
      const lastStream = lastAgentStreamRef.current;
      let errorKey: string;
      if (!lastStream) {
        errorKey = "chat.timeoutNoEvents";
      } else if (lastStream === "tool") {
        errorKey = "chat.timeoutToolRunning";
      } else if (lastStream === "lifecycle" || lastStream === "assistant") {
        errorKey = "chat.timeoutWaitingForLLM";
      } else {
        errorKey = "chat.timeoutError";
      }
      console.error("[chat] response timeout — no delta within 60s for runId:", runId, "lastStream:", lastStream);
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `⚠ ${t(errorKey)}`,
        timestamp: Date.now(),
      }]);
      setStreaming(null);
      setRunId(null);
      setAgentPhase(null);
      lastAgentStreamRef.current = null;
    }, 60_000);
    return () => clearTimeout(timer);
  }, [runId]);

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
            // If streaming was in progress, save partial text
            setStreaming((current) => {
              if (current) {
                setMessages((prev) => [...prev, { role: "assistant", text: current, timestamp: Date.now() }]);
              }
              return null;
            });
            setRunId(null);
            setAgentPhase(null);
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
    };
  }, [loadHistory, handleEvent]);

  async function handleSend() {
    const text = draft.trim();
    const images = pendingImages;
    if ((!text && images.length === 0) || connectionState !== "connected" || !clientRef.current) return;

    // Pre-flight: check total payload size to avoid WebSocket frame limit
    if (images.length > 0) {
      const totalBase64Bytes = images.reduce((sum, img) => sum + img.base64.length, 0);
      if (totalBase64Bytes > MAX_WS_PAYLOAD_BYTES) {
        alert(t("chat.payloadTooLarge"));
        return;
      }
    }

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

    // Optimistic: show user message immediately (with images if any)
    const optimisticImages: ChatImage[] | undefined = images.length > 0
      ? images.map((img) => ({ data: img.base64, mimeType: img.mimeType }))
      : undefined;
    setMessages((prev) => [...prev, { role: "user", text, timestamp: Date.now(), images: optimisticImages }]);
    setDraft("");
    setPendingImages([]);
    setRunId(idempotencyKey);
    sendTimeRef.current = Date.now();
    trackEvent("chat.message_sent", { hasImage: images.length > 0 });

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Build RPC params.
    // When sending images without text, provide a placeholder so the agent
    // pipeline doesn't reject the request for missing text body.
    const params: Record<string, unknown> = {
      sessionKey: sessionKeyRef.current,
      message: text || (images.length > 0 ? t("chat.imageOnlyPlaceholder") : ""),
      idempotencyKey,
    };
    if (images.length > 0) {
      params.attachments = images.map((img) => ({
        type: "image",
        mimeType: img.mimeType,
        content: img.base64,
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
    if (!clientRef.current || !runIdRef.current) return;
    trackEvent("chat.generation_stopped");
    clientRef.current.request("chat.abort", {
      sessionKey: sessionKeyRef.current,
      runId: runIdRef.current,
    }).catch(() => {});
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

  function readFileAsBase64(file: File): Promise<PendingImage | null> {
    return new Promise((resolve) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        resolve(null);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        // If already small enough, use as-is
        if (base64.length <= COMPRESS_TARGET_BYTES) {
          resolve({ dataUrl, base64, mimeType: file.type });
          return;
        }
        // Compress large images
        resolve(await compressImage(dataUrl));
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(files: FileList | File[]) {
    const results: PendingImage[] = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        alert(t("chat.imageTypeError"));
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        alert(t("chat.imageTooLarge"));
        continue;
      }
      const img = await readFileAsBase64(file);
      if (img) results.push(img);
    }
    if (results.length > 0) {
      setPendingImages((prev) => [...prev, ...results]);
    }
  }

  function handleAttachClick() {
    fileInputRef.current?.click();
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
          {visibleMessages.map((msg, i) => msg.role === "tool-event" ? (
            preserveToolEvents ? (
              <div key={i} className="chat-tool-event">
                <span className="chat-tool-event-icon">&#9881;</span>
                {t("chat.toolEventLabel", { tool: msg.toolName })}
              </div>
            ) : null
          ) : (
            <div
              key={i}
              className={`chat-bubble ${msg.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
            >
              {msg.images && msg.images.length > 0 && (
                <div className="chat-bubble-images">
                  {msg.images.map((img, j) => (
                    <img
                      key={j}
                      src={`data:${img.mimeType};base64,${img.data}`}
                      alt=""
                      className="chat-bubble-img"
                    />
                  ))}
                </div>
              )}
              {msg.text && formatMessage(cleanMessageText(msg.text))}
            </div>
          ))}
          {((runId !== null && streaming === null) || (externalRunActive && runId === null)) && (
            <div className="chat-bubble chat-bubble-assistant chat-thinking">
              {agentPhase && showAgentEvents ? (
                <span className="chat-agent-phase">
                  {agentPhase.startsWith("tool:")
                    ? t("chat.phaseUsingTool", { tool: agentPhase.slice(5) })
                    : t(`chat.phase_${agentPhase}`)}
                </span>
              ) : null}
              <span className="chat-thinking-dots"><span /><span /><span /></span>
            </div>
          )}
          {streaming !== null && (
            <>
              {agentPhase && agentPhase.startsWith("tool:") && showAgentEvents && (
                <div className="chat-agent-phase-inline">
                  {t("chat.phaseUsingTool", { tool: agentPhase.slice(5) })}
                </div>
              )}
              <div className="chat-bubble chat-bubble-assistant chat-streaming-cursor">
                {formatMessage(cleanMessageText(streaming))}
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
          <button
            className="chat-attach-btn"
            onClick={handleAttachClick}
            title={t("chat.attach")}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
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
          {isStreaming ? (
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
    </div>
  );
}
