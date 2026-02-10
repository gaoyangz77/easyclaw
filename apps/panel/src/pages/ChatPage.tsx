import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fetchGatewayInfo } from "../api.js";
import { GatewayChatClient } from "../lib/gateway-client.js";
import type { GatewayEvent, GatewayHelloOk } from "../lib/gateway-client.js";
import "./ChatPage.css";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

const DEFAULT_SESSION_KEY = "agent:main:main";
const INITIAL_VISIBLE = 50;
const PAGE_SIZE = 20;
const FETCH_BATCH = 200;

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
      // Inline formatting: `code` and newlines
      const inlineParts = seg.split(/(`[^`]+`)/g);
      for (let j = 0; j < inlineParts.length; j++) {
        const ip = inlineParts[j];
        if (ip.startsWith("`") && ip.endsWith("`")) {
          parts.push(<code key={`${i}-${j}`}>{ip.slice(1, -1)}</code>);
        } else {
          // Convert newlines to <br>
          const lines = ip.split("\n");
          for (let k = 0; k < lines.length; k++) {
            if (k > 0) parts.push(<br key={`${i}-${j}-br${k}`} />);
            if (lines[k]) parts.push(lines[k]);
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
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("");
}

/**
 * Parse raw gateway messages into ChatMessage[], filtering out tool-only entries.
 */
function parseRawMessages(
  raw?: Array<{ role?: string; content?: unknown; timestamp?: number }>,
): ChatMessage[] {
  if (!raw) return [];
  const parsed: ChatMessage[] = [];
  for (const msg of raw) {
    if (msg.role === "user" || msg.role === "assistant") {
      const text = extractText(msg.content);
      if (!text.trim()) continue;
      parsed.push({ role: msg.role, text, timestamp: msg.timestamp ?? 0 });
    }
  }
  return parsed;
}

export function ChatPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [agentName, setAgentName] = useState<string | null>(null);
  const [allFetched, setAllFetched] = useState(false);
  const [externalRunActive, setExternalRunActive] = useState(false);
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

  // Stable refs so event handler closures always see the latest state
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  const allFetchedRef = useRef(allFetched);
  allFetchedRef.current = allFetched;

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
          const errText = payload.errorMessage ?? "An error occurred.";
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
        const text = extractText(payload.message?.content);
        if (text) setStreaming(text);
        break;
      }
      case "final": {
        const text = extractText(payload.message?.content);
        if (text) {
          setMessages((prev) => [...prev, { role: "assistant", text, timestamp: Date.now() }]);
        }
        setStreaming(null);
        setRunId(null);
        break;
      }
      case "error": {
        console.error("[chat] error event:", payload.errorMessage ?? "unknown error", "runId:", payload.runId);
        const errText = payload.errorMessage ?? "An error occurred.";
        setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
        setStreaming(null);
        setRunId(null);
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
        break;
      }
    }
  }, [loadHistory]);

  // Timeout: if runId is set but no response arrives within 60s, show error
  useEffect(() => {
    if (!runId) return;
    const timer = setTimeout(() => {
      console.error("[chat] response timeout — no event received within 60s for runId:", runId);
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "⚠ Request timed out. The model may be unavailable or the model ID may be incorrect.",
        timestamp: Date.now(),
      }]);
      setStreaming(null);
      setRunId(null);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [runId]);

  // Initialize connection
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
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
            loadHistory(client);
            // Fetch agent display name
            client.request<{ name?: string }>("agent.identity.get", {
              sessionKey: sessionKeyRef.current,
            }).then((res) => {
              if (!cancelled && res?.name) setAgentName(res.name);
            }).catch(() => {});
          },
          onDisconnected: () => {
            if (!cancelled) setConnectionState("connecting");
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

    return () => {
      cancelled = true;
      clientRef.current?.stop();
      clientRef.current = null;
    };
  }, [loadHistory, handleEvent]);

  function handleSend() {
    const text = draft.trim();
    if (!text || connectionState !== "connected" || !clientRef.current) return;

    const idempotencyKey = crypto.randomUUID();

    // Optimistic: show user message immediately
    setMessages((prev) => [...prev, { role: "user", text, timestamp: Date.now() }]);
    setDraft("");
    setRunId(idempotencyKey);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    clientRef.current.request("chat.send", {
      sessionKey: sessionKeyRef.current,
      message: text,
      idempotencyKey,
    }).catch((err) => {
      // RPC-level failure — clear runId so UI doesn't get stuck in streaming mode
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${(err as Error).message || "Failed to send message."}`, timestamp: Date.now() }]);
      setStreaming(null);
      setRunId(null);
    });
  }

  function handleStop() {
    if (!clientRef.current || !runIdRef.current) return;
    clientRef.current.request("chat.abort", {
      sessionKey: sessionKeyRef.current,
      runId: runIdRef.current,
    }).catch(() => {});
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
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
          {agentName && <div className="chat-empty-agent">{agentName}</div>}
          <div>{t("chat.emptyState")}</div>
        </div>
      ) : (
        <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
          {showHistoryEnd && (
            <div className="chat-history-end">{t("chat.historyEnd")}</div>
          )}
          {visibleMessages.map((msg, i) => (
            <div
              key={i}
              className={`chat-bubble ${msg.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
            >
              {formatMessage(msg.text)}
            </div>
          ))}
          {((runId !== null && streaming === null) || (externalRunActive && runId === null)) && (
            <div className="chat-bubble chat-bubble-assistant chat-thinking">
              <span className="chat-thinking-dots"><span /><span /><span /></span>
            </div>
          )}
          {streaming !== null && (
            <div className="chat-bubble chat-bubble-assistant chat-streaming-cursor">
              {formatMessage(streaming)}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      <div className="chat-status">
        <span className={`chat-status-dot chat-status-dot-${connectionState}`} />
        <span>{agentName ? `${agentName} · ${t(statusKey)}` : t(statusKey)}</span>
      </div>

      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={t("chat.placeholder")}
          rows={1}
        />
        {isStreaming ? (
          <button className="btn btn-danger" onClick={handleStop}>
            {t("chat.stop")}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={!draft.trim() || connectionState !== "connected"}
          >
            {t("chat.send")}
          </button>
        )}
      </div>
    </div>
  );
}
