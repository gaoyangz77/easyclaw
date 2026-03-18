import { useState, useEffect, useLayoutEffect, useRef, useCallback, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { fetchGatewayInfo, fetchProviderKeys, trackEvent, fetchChatShowAgentEvents, fetchChatPreserveToolEvents, fetchChatCollapseMessages } from "../api/index.js";
import { formatError } from "@rivonclaw/core";
import { configManager } from "../lib/config-manager.js";
import { Select } from "../components/inputs/Select.js";
import { GatewayChatClient } from "../lib/gateway-client.js";
import type { ChatMessage, ChatImage, PendingImage } from "./chat/chat-utils.js";
import { INITIAL_VISIBLE, PAGE_SIZE, FETCH_BATCH, IMAGE_PLACEHOLDER, cleanMessageText, formatTimestamp, extractText, localizeError, parseRawMessages } from "./chat/chat-utils.js";
import type { SessionsListResult } from "./chat/chat-utils.js";
import { MarkdownMessage, CopyButton, CollapsibleContent, ToolArgsDisplay } from "./chat/ChatMessage.js";
import type { GatewayEvent, GatewayHelloOk } from "../lib/gateway-client.js";
import { RunTracker } from "../lib/run-tracker.js";
import { ChatEventBridge } from "../lib/chat-event-bridge.js";
import { saveImages, restoreImages, clearImages } from "../lib/image-cache.js";
import { Modal } from "../components/modals/Modal.js";
import { useSessionManager } from "./chat/useSessionManager.js";
import { SessionTabBar } from "./chat/SessionTabBar.js";
import type { GatewaySessionInfo } from "./chat/SessionTabBar.js";
import { ChatInputArea } from "./chat/ChatInputArea.js";
import { ToolSelector } from "../components/inputs/ToolSelector.js";
import { useToolRegistry } from "../providers/ToolRegistryProvider.js";
import "./chat/ChatPage.css";

export function ChatPage({ onAgentNameChange }: { onAgentNameChange?: (name: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [agentName, setAgentName] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<{ keyId: string; provider: string; model: string } | null>(null);
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  const [hasProviderKeys, setHasProviderKeys] = useState(true);
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [allFetched, setAllFetched] = useState(false);
  const [renderTick, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const trackerRef = useRef(new RunTracker(forceUpdate));

  // Derive run lifecycle state from tracker (single source of truth)
  const view = trackerRef.current.getView();
  const runId = view.localRunId;
  // Use displayStreaming (covers both local and external runs) so the streaming
  // cursor appears for external-channel runs (mobile, Telegram, etc.), not just
  // for messages typed in the panel.
  //
  // TODO(future): This only shows a generic streaming cursor for external runs.
  // Message tool deliveries (agent explicitly sending messages to the user) are
  // invisible until chat.final triggers loadHistory. To show them in real time,
  // register an `after_tool_call` plugin hook that intercepts toolName==="message",
  // then broadcast a `chat` event with state==="delivery" to all WS clients.
  // The hook needs a captured `broadcast` ref from GatewayRequestContext — see
  // mobile-chat-channel/openclaw-plugin.mjs L190 for the existing pattern.
  const streaming = view.displayStreaming;
  const [showAgentEvents, setShowAgentEvents] = useState(true);
  const [preserveToolEvents, setPreserveToolEvents] = useState(false);
  const [collapseMessages, setCollapseMessages] = useState(true);
  const [chatExamplesExpanded, setChatExamplesExpanded] = useState(() => localStorage.getItem("chat-examples-collapsed") !== "1");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const clientRef = useRef<GatewayChatClient | null>(null);
  const bridgeRef = useRef<ChatEventBridge | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const fetchLimitRef = useRef(FETCH_BATCH);
  const isFetchingRef = useRef(false);
  const shouldInstantScrollRef = useRef(true);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showToolSelector, setShowToolSelector] = useState(false);
  const { hasTools } = useToolRegistry();
  const toolsWrapperRef = useRef<HTMLDivElement>(null);
  const [externalPending, setExternalPending] = useState(false);
  const externalPendingRef = useRef(false);

  // Session manager — polls sessions.list and handles switching + caching
  const sessionManager = useSessionManager({
    clientRef,
    connected: connectionState === "connected",
    getState: () => ({
      messages,
      trackerSnapshot: trackerRef.current.serialize(),
      draft,
      pendingImages,
      visibleCount,
      allFetched,
    }),
    setState: (state) => {
      setMessages(state.messages);
      setDraft(state.draft);
      setPendingImages(state.pendingImages);
      setVisibleCount(state.visibleCount);
      setAllFetched(state.allFetched);
      shouldInstantScrollRef.current = true; stickyRef.current = true;
      fetchLimitRef.current = FETCH_BATCH;
      isFetchingRef.current = false;
      setExternalPending(false); externalPendingRef.current = false;
      if (state.trackerSnapshot) {
        trackerRef.current.restore(state.trackerSnapshot);
      } else {
        trackerRef.current.reset();
      }
    },
  });

  // Keep a ref to the active session key for synchronous reads in event handlers
  const sessionKeyRef = useRef(sessionManager.activeSessionKey);
  sessionKeyRef.current = sessionManager.activeSessionKey;

  // Stable refs so handleEvent doesn't depend on the sessionManager object
  // (which is recreated every render and would cause a connect/disconnect loop).
  const markUnreadRef = useRef(sessionManager.markUnread);
  markUnreadRef.current = sessionManager.markUnread;
  const refreshSessionsRef = useRef(sessionManager.refreshSessions);
  refreshSessionsRef.current = sessionManager.refreshSessions;
  const sessionKeysRef = useRef<Set<string>>(new Set());
  sessionKeysRef.current = new Set(sessionManager.sessions.map((s) => s.key));

  const lastActivityRef = useRef<number>(0);
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  const allFetchedRef = useRef(allFetched);
  allFetchedRef.current = allFetched;
  const sendTimeRef = useRef<number>(0);
  const needsDisconnectErrorRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  const lastAgentStreamRef = useRef<string | null>(null);
  const showAgentEventsRef = useRef(true);

  // "Sticky to bottom" — an explicit pinned state drives auto-scroll.
  // • User scrolls up → unpin (handled in handleScroll).
  // • User scrolls back to bottom / sends a message → re-pin.
  // • Content changes while pinned → synchronous scrollTop assignment.
  const stickyRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
    stickyRef.current = true;
  }, []);

  useEffect(() => {
    if (isLoadingMoreRef.current) return;
    if (shouldInstantScrollRef.current) {
      scrollToBottom();
      shouldInstantScrollRef.current = false;
    } else if (stickyRef.current) {
      scrollToBottom();
    }
  }, [messages, renderTick, scrollToBottom]);

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

      let parsed = parseRawMessages(result?.messages);
      parsed = await restoreImages(sessionKeyRef.current, parsed).catch(() => parsed);

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

  // Load older messages on scroll to top; track sticky state.
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el || isLoadingMoreRef.current || isFetchingRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = distanceFromBottom < 30;
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

  // Prune stale image cache entries (older than 30 days) on mount
  useEffect(() => { clearImages().catch(() => { }); }, []);

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

      let parsed = parseRawMessages(result?.messages);
      // Guard: don't wipe existing messages if gateway returns empty on reconnect
      if (parsed.length === 0 && messagesLengthRef.current > 0) return;
      parsed = await restoreImages(sessionKeyRef.current, parsed).catch(() => parsed);
      setAllFetched(parsed.length < FETCH_BATCH);
      shouldInstantScrollRef.current = true; stickyRef.current = true;
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
      lastActivityRef.current = Date.now();
      const agentPayload = evt.payload as {
        runId?: string;
        stream?: string;
        sessionKey?: string;
        data?: Record<string, unknown>;
      } | undefined;
      if (!agentPayload) return;
      // Events for background sessions: mark tab as unread, don't process
      if (agentPayload.sessionKey && agentPayload.sessionKey !== sessionKeyRef.current) {
        markUnreadRef.current(agentPayload.sessionKey);
        // New session detected — refresh session list so a tab appears
        if (!sessionKeysRef.current.has(agentPayload.sessionKey)) {
          refreshSessionsRef.current();
        }
        return;
      }

      const agentRunId = agentPayload.runId;

      // Always track last agent stream for timeout refinement
      lastAgentStreamRef.current = agentPayload.stream ?? null;
      lastActivityRef.current = Date.now();

      // Only process events for tracked runs (replaces old runIdRef guard)
      if (!agentRunId || !tracker.isTracked(agentRunId)) {
        // DEBUG: log dropped agent events to diagnose missing tool_start flush
        if (agentPayload.stream === "tool" || agentPayload.stream === "lifecycle") {
          console.warn("[chat] agent event dropped: stream=%s phase=%s runId=%s tracked=%s localRunId=%s",
            agentPayload.stream, agentPayload.data?.phase, agentRunId,
            agentRunId ? tracker.isTracked(agentRunId) : "no-id",
            tracker.getLocalRunId());
        }
        return;
      }

      const stream = agentPayload.stream;

      // Always record tool call events inline; visibility controlled at render time
      if (stream === "tool") {
        const phase = agentPayload.data?.phase;
        const name = agentPayload.data?.name as string | undefined;
        if (phase === "start" && name) {
          // Flush current streaming text into a committed assistant bubble
          // before adding the tool event.  Read from tracker (single source of truth)
          // BEFORE dispatching TOOL_START which clears run.streaming.
          const flushedText = tracker.getRun(agentRunId)?.streaming ?? null;
          // DEBUG: log tool_start flush state
          console.info("[chat] tool_start: tool=%s flushedText=%s runId=%s",
            name, flushedText ? `"${flushedText.slice(0, 40)}..." (${flushedText.length}ch)` : "null", agentRunId);
          const args = agentPayload.data?.args as Record<string, unknown> | undefined;
          const toolEvt: ChatMessage = { role: "tool-event", text: name, toolName: name, toolArgs: args, timestamp: Date.now() };
          if (flushedText) {
            setMessages((prev) => [...prev, { role: "assistant", text: flushedText, timestamp: Date.now() }, toolEvt]);
            // The gateway throttles deltas at 150 ms.  The last few characters
            // before a tool_use may still be in the throttle buffer, never sent.
            // Fetch stored history (which has the complete text) and patch the
            // truncated bubble.  Use the run's idempotencyKey to precisely locate
            // the user message, then find the last assistant message after it.
            const client = clientRef.current;
            if (client) {
              const snap = flushedText;
              const runKey = agentRunId; // equals idempotencyKey for local runs
              client.request<{ messages?: Array<{ role?: string; content?: unknown; idempotencyKey?: string }> }>(
                "chat.history", { sessionKey: sessionKeyRef.current, limit: 100 },
              ).then((res) => {
                if (!res?.messages) return;
                // Find the user message by idempotencyKey, then scan backward
                // from the end of the array for the last assistant message.
                let anchor = -1;
                for (let i = 0; i < res.messages.length; i++) {
                  if ((res.messages[i] as { idempotencyKey?: string }).idempotencyKey === runKey) {
                    anchor = i;
                    break;
                  }
                }
                if (anchor === -1) return; // run not yet in history
                // The last assistant message after the anchor is the one we need.
                for (let i = res.messages.length - 1; i > anchor; i--) {
                  if (res.messages[i].role !== "assistant") continue;
                  const full = extractText(res.messages[i].content);
                  if (full && full.length > snap.length) {
                    setMessages((prev) => {
                      const idx = prev.findLastIndex((msg) => msg.role === "assistant" && msg.text === snap);
                      if (idx === -1) return prev;
                      const patched = [...prev];
                      patched[idx] = { ...patched[idx], text: full };
                      return patched;
                    });
                    break;
                  }
                }
              }).catch((err) => { console.warn("[chat] history patch failed — truncated text remains:", err); });
            }
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

    // Heartbeat-triggered agent runs (including main-session cron jobs) bypass
    // the chat event pipeline — they call getReplyFromConfig directly and store
    // the result in the session file without emitting chat delta/final events.
    // Reload history when a heartbeat produces meaningful output so cron results
    // and other heartbeat-driven responses appear in the chat in real time.
    //
    // We delay the reload slightly because the heartbeat event fires before the
    // transcript is guaranteed to be flushed to disk.  The cron "finished" event
    // below serves as a more reliable (later) fallback.
    if (evt.event === "heartbeat") {
      const hbPayload = evt.payload as { status?: string } | undefined;
      const st = hbPayload?.status;
      // "sent" = delivered to channel, "ok-token"/"ok-empty" = agent ran but
      // no external channel, "skipped" with reason might still mean the agent
      // ran for panel-only users.  Reload on any non-failed status.
      if (st && st !== "failed") {
        setTimeout(() => {
          const client = clientRef.current;
          if (client) loadHistory(client);
        }, 600);
        // Heartbeat may create new sessions — refresh tab list
        refreshSessionsRef.current();
      }
      return;
    }

    // Cron "finished" event — a more reliable signal that the agent run is
    // complete and the transcript is persisted.  Fires after the heartbeat
    // event, so the assistant's response should be in the session file by now.
    if (evt.event === "cron") {
      const cronPayload = evt.payload as { action?: string; status?: string } | undefined;
      if (cronPayload?.action === "finished" && cronPayload?.status === "ok") {
        setTimeout(() => {
          const client = clientRef.current;
          if (client) loadHistory(client);
        }, 300);
        // Cron may create new sessions — refresh tab list
        refreshSessionsRef.current();
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

    // Filter by sessionKey — only process events for our active session.
    // Events for other sessions mark their tab as unread.
    if (payload.sessionKey && payload.sessionKey !== sessionKeyRef.current) {
      markUnreadRef.current(payload.sessionKey);
      // New session detected — refresh session list so a tab appears
      if (!sessionKeysRef.current.has(payload.sessionKey)) {
        refreshSessionsRef.current();
      }
      return;
    }

    const chatRunId = payload.runId;
    const isOurLocalRun = tracker.getLocalRunId() && chatRunId === tracker.getLocalRunId();
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
      lastActivityRef.current = Date.now();
      switch (payload.state) {
        case "delta": {
          const text = extractText(payload.message?.content);
          if (text) {
            tracker.dispatch({ type: "CHAT_DELTA", runId: chatRunId, text });
          }
          break;
        }
        case "final":
          tracker.dispatch({ type: "CHAT_FINAL", runId: chatRunId });
          // Refresh sessions to pick up derived titles after completion
          refreshSessionsRef.current();
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
          // Streaming text is tracked by CHAT_DELTA dispatch above — no separate state needed.
          break;
        }
        case "final": {
          // DEBUG: log final event state
          const localStreaming = tracker.getRun(chatRunId!)?.streaming;
          console.info("[chat] final: runId=%s streaming=%s",
            chatRunId, localStreaming ? `"${localStreaming.slice(0, 40)}..."` : "null");
          const finalText = extractText(payload.message?.content);
          if (finalText) {
            setMessages((prev) => [...prev, { role: "assistant", text: finalText, timestamp: Date.now() }]);
          }
          if (sendTimeRef.current > 0) {
            trackEvent("chat.response_received", { durationMs: Date.now() - sendTimeRef.current });
            sendTimeRef.current = 0;
          }
          lastAgentStreamRef.current = null;
          tracker.cleanup();
          break;
        }
        case "error": {
          console.error("[chat] error event:", payload.errorMessage ?? "unknown error", "runId:", chatRunId);
          const raw = payload.errorMessage ?? tRef.current("chat.unknownError");
          const errText = localizeError(raw, tRef.current);
          setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
          lastAgentStreamRef.current = null;
          tracker.cleanup();
          break;
        }
        case "aborted": {
          // If there was partial streaming text, keep it as a message.
          // Read from tracker BEFORE cleanup (which removes the run).
          const abortedText = tracker.getRun(chatRunId!)?.streaming ?? null;
          if (abortedText) {
            setMessages((prev) => [...prev, { role: "assistant", text: abortedText, timestamp: Date.now() }]);
          }
          lastAgentStreamRef.current = null;
          tracker.cleanup();
          break;
        }
      }
    } else if (chatRunId) {
      // External run — handle completion.
      //
      // TODO(future): During external runs, the panel only receives chat events
      // (streaming deltas) and lifecycle events — NOT tool events (they are only
      // sent to registered WS recipients, i.e. the client that initiated the run).
      // This means message-tool deliveries are invisible until chat.final, when
      // loadHistory fetches the full transcript and extractToolInputMessage()
      // recovers the delivered text from tool_use blocks.
      //
      // Proper fix: add an `after_tool_call` plugin hook in rivonclaw-tools that
      // intercepts toolName==="message" and broadcasts a chat event with
      // state==="delivery" to ALL connected clients (not just registered ones).
      // Then handle state==="delivery" here to append the message in real time.
      if (payload.state === "error") {
        console.error("[chat] external run error:", payload.errorMessage ?? "unknown error", "runId:", chatRunId);
      }
      if (payload.state === "final") {
        // Immediately commit the final text so the user sees it without waiting
        // for loadHistory. The subsequent loadHistory will replace all messages
        // with the canonical transcript, but this avoids a visible gap.
        const finalText = extractText(payload.message?.content);
        if (finalText) {
          setMessages((prev) => [...prev, { role: "assistant", text: finalText, timestamp: Date.now() }]);
        }
        // DEBUG: log external final that triggers history reload
        console.info("[chat] external final → reloading history: runId=%s localRunId=%s",
          chatRunId, tracker.getLocalRunId());
        // External run finished — reload history to show the full conversation
        const client = clientRef.current;
        if (client) loadHistory(client);
      }
      if (payload.state === "final" || payload.state === "error" || payload.state === "aborted") {
        tracker.cleanup();
        // Clear externalPending so the thinking bubble disappears even if
        // the SSE mirror lifecycle-end event is late or missing.
        if (externalPendingRef.current) {
          setExternalPending(false); externalPendingRef.current = false;
        }
      }
    }
  }, [loadHistory]);

  // Watchdog: if no gateway events arrive for 5 minutes while a run
  // appears active, force-reset to clear a permanently stuck indicator.
  // Active runs always produce periodic events (tool, delta, lifecycle),
  // so 5 min of silence means the run is genuinely stuck or the gateway
  // crashed.  This replaces the old 30s stall timer which was too aggressive.
  useEffect(() => {
    const WATCHDOG_INTERVAL = 30_000;   // check every 30s
    const WATCHDOG_TIMEOUT = 5 * 60_000; // 5 minutes of silence
    const timer = setInterval(() => {
      const tracker = trackerRef.current;
      const view = tracker.getView();
      const stuck = view.isActive || externalPendingRef.current;
      if (stuck && Date.now() - lastActivityRef.current > WATCHDOG_TIMEOUT) {
        console.warn("[chat] watchdog: no events for 5 min — force-resetting run state");
        tracker.reset();
        lastAgentStreamRef.current = null;
        if (externalPendingRef.current) {
          setExternalPending(false); externalPendingRef.current = false;
        }
      }
    }, WATCHDOG_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // Re-fetch chat display settings when changed in SettingsPage.
  // ChatPage stays mounted (display:none) so the init effect won't re-run.
  useEffect(() => {
    function onSettingsChanged() {
      Promise.all([
        fetchChatShowAgentEvents().catch(() => true),
        fetchChatPreserveToolEvents().catch(() => false),
        fetchChatCollapseMessages().catch(() => true),
      ]).then(([showEvents, preserveEvents, collapse]) => {
        showAgentEventsRef.current = showEvents;
        setShowAgentEvents(showEvents);
        setPreserveToolEvents(preserveEvents);
        setCollapseMessages(collapse);
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
        setHasProviderKeys(true);
        const models = await configManager.getModelsForProvider(info.provider);
        setModelOptions(models.map((m) => ({ value: m.id, label: m.name })));
      } else {
        setActiveModel(null);
        setModelOptions([]);
        // Check if any provider keys exist at all
        fetchProviderKeys().then((keys) => setHasProviderKeys(keys.length > 0)).catch(() => { });
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
    }).catch(() => { });
  }

  // Initialize connection
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [showEvents, preserveEvents, collapse] = await Promise.all([
          fetchChatShowAgentEvents().catch(() => false),
          fetchChatPreserveToolEvents().catch(() => false),
          fetchChatCollapseMessages().catch(() => true),
        ]);
        if (cancelled) return;
        showAgentEventsRef.current = showEvents;
        setShowAgentEvents(showEvents);
        setPreserveToolEvents(preserveEvents);
        setCollapseMessages(collapse);

        const info = await fetchGatewayInfo();
        if (cancelled) return;

        const client = new GatewayChatClient({
          url: info.wsUrl,
          token: info.token,
          onConnected: (hello: GatewayHelloOk) => {
            if (cancelled) return;
            // Use session key from gateway snapshot ONLY on initial connect.
            // On reconnects (e.g. CDP mode switch, keepalive timeout) the user
            // may be viewing a different tab — overriding it would cause
            // session data mixing.
            const mainKey = hello.snapshot?.sessionDefaults?.mainSessionKey;
            if (mainKey && !initialConnectDoneRef.current) {
              initialConnectDoneRef.current = true;
              sessionManager.setActiveSessionKey(mainKey);
            }
            setConnectionState("connected");
            loadHistory(client).then(() => {
              // Show deferred disconnect error AFTER history is loaded,
              // otherwise loadHistory's setMessages would overwrite the error.
              if (needsDisconnectErrorRef.current) {
                needsDisconnectErrorRef.current = false;
                setMessages((prev) => [...prev, {
                  role: "assistant",
                  text: `⚠ ${tRef.current("chat.disconnectedError")}`,
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
            const localId = trackerRef.current.getLocalRunId();
            const wasWaiting = !!localId;
            // If streaming was in progress, save partial text.
            const disconnectText = localId ? (trackerRef.current.getRun(localId)?.streaming ?? null) : null;
            trackerRef.current.reset();
            if (disconnectText) {
              setMessages((prev) => [...prev, { role: "assistant", text: disconnectText, timestamp: Date.now() }]);
            }
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
            // Only append to the currently viewed session
            if (msg.sessionKey !== sessionKeyRef.current) {
              markUnreadRef.current(msg.sessionKey);
              return;
            }
            setMessages((prev) => [...prev, {
              role: "user",
              text: msg.text,
              timestamp: msg.timestamp,
              isExternal: true,
              channel: msg.channel,
            }]);
            setExternalPending(true); externalPendingRef.current = true;
          },
          onSessionReset: (sessionKey) => {
            if (cancelled) return;
            if (sessionKey !== sessionKeyRef.current) return;
            setMessages([{ role: "assistant", text: `🔄 ${tRef.current("chat.resetCommandFeedback")}`, timestamp: Date.now() }]);
            clearImages(sessionKeyRef.current).catch(() => { });
            trackerRef.current.reset();
            lastAgentStreamRef.current = null;
            setExternalPending(false); externalPendingRef.current = false;
          },
          onMirrorEvent: (mirror) => {
            if (cancelled) return;
            const data = mirror.data as Record<string, unknown>;

            if (mirror.stream === "assistant") {
              // Raw agent event data: { text: "accumulated", delta: "incremental" }
              // Convert to chat event format expected by handleEvent for "chat" events
              const text = data.text as string | undefined;
              if (text) {
                // Clear externalPending now — streaming text provides visual feedback
                // via the streaming bubble, so the thinking bubble is no longer needed.
                if (externalPendingRef.current && mirror.sessionKey === sessionKeyRef.current) {
                  setExternalPending(false); externalPendingRef.current = false;
                }
                handleEvent({
                  type: "event",
                  event: "chat",
                  payload: {
                    runId: mirror.runId,
                    sessionKey: mirror.sessionKey,
                    state: "delta",
                    message: {
                      role: "assistant",
                      content: [{ type: "text", text }],
                      timestamp: Date.now(),
                    },
                  },
                });
              }
            } else if (mirror.stream === "lifecycle") {
              const phase = data.phase as string | undefined;
              if (phase === "start") {
                // Register the external run in the tracker so view.isActive
                // becomes true and the thinking bubble stays visible even if
                // externalPending gets cleared before streaming text arrives.
                if (mirror.sessionKey === sessionKeyRef.current) {
                  trackerRef.current.dispatch({
                    type: "EXTERNAL_INBOUND",
                    runId: mirror.runId,
                    sessionKey: mirror.sessionKey,
                    channel: "unknown",
                  });
                  trackerRef.current.dispatch({ type: "LIFECYCLE_START", runId: mirror.runId });
                }
              } else if (phase === "end" || phase === "error") {
                // Clear externalPending — run is done
                if (externalPendingRef.current && mirror.sessionKey === sessionKeyRef.current) {
                  setExternalPending(false); externalPendingRef.current = false;
                }
                // Lifecycle end/error → chat final/error so run completes properly
                handleEvent({
                  type: "event",
                  event: "chat",
                  payload: {
                    runId: mirror.runId,
                    sessionKey: mirror.sessionKey,
                    state: phase === "error" ? "error" : "final",
                    ...(phase === "error" ? { errorMessage: data.error } : {}),
                  },
                });
              }
            } else if (mirror.stream === "tool") {
              // Extract delivered message text from Message tool calls
              const toolName = data.name as string | undefined;
              const toolPhase = data.phase as string | undefined;
              const toolArgs = data.args as Record<string, unknown> | undefined;
              // Forward tool event first — handleEvent's agent path flushes
              // streaming text on tool_start, so ordering is preserved.
              handleEvent({
                type: "event",
                event: "agent",
                payload: {
                  runId: mirror.runId,
                  sessionKey: mirror.sessionKey,
                  stream: "tool",
                  data,
                },
              });
              // Then extract delivered message text from Message tool calls
              if (toolName === "message" && toolPhase === "start" && toolArgs) {
                const msgText = (toolArgs.message ?? toolArgs.text ?? toolArgs.content) as string | undefined;
                if (msgText && mirror.sessionKey === sessionKeyRef.current) {
                  setMessages((prev) => [...prev, { role: "assistant", text: msgText, timestamp: Date.now() }]);
                }
              }
            }
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
      initialConnectDoneRef.current = false;
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
    const sentAt = Date.now();
    setMessages((prev) => [...prev, { role: "user", text, timestamp: sentAt, images: optimisticImages, idempotencyKey }]);
    if (optimisticImages) {
      saveImages(sessionKeyRef.current, idempotencyKey, sentAt, optimisticImages).catch(() => { });
    }
    shouldInstantScrollRef.current = true; stickyRef.current = true;
    setDraft("");
    setPendingImages([]);
    trackerRef.current.dispatch({ type: "LOCAL_SEND", runId: idempotencyKey, sessionKey: sessionKeyRef.current });
    lastActivityRef.current = Date.now();
    lastAgentStreamRef.current = null;
    sendTimeRef.current = Date.now();
    trackEvent("chat.message_sent", { hasAttachment: files.length > 0 });

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
    if (thinkingLevel) params.thinking = thinkingLevel;

    clientRef.current.request("chat.send", params).catch((err) => {
      // RPC-level failure — transition run to error so UI doesn't get stuck
      const raw = formatError(err) || t("chat.sendError");
      const errText = localizeError(raw, t);
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
      trackerRef.current.dispatch({ type: "CHAT_ERROR", runId: idempotencyKey });
      trackerRef.current.cleanup();
    });

    // Refresh session tabs so the tab bar appears on first message
    refreshSessionsRef.current();
  }

  function handleStop() {
    if (!clientRef.current) return;
    const targetRunId = trackerRef.current.getView().abortTargetRunId;
    if (!targetRunId) return;
    trackEvent("chat.generation_stopped");
    clientRef.current.request("chat.abort", {
      sessionKey: sessionKeyRef.current,
      runId: targetRunId,
    }).catch(() => { });
    setMessages((prev) => [...prev, { role: "assistant", text: `⏹ ${t("chat.stopCommandFeedback")}`, timestamp: Date.now() }]);
  }

  function handleReset() {
    if (!clientRef.current || connectionState !== "connected") return;
    setShowResetConfirm(true);
  }

  function handleModelChange(newModel: string) {
    if (!activeModel || newModel === activeModel.model) return;
    trackEvent("chat.model_switched", { provider: activeModel.provider, model: newModel });
    configManager.switchModel(activeModel.keyId, newModel)
      .then(() => setActiveModel((prev) => prev ? { ...prev, model: newModel } : null))
      .catch((err) => {
        const errText = formatError(err) || t("chat.unknownError");
        setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
      });
  }

  function confirmReset() {
    setShowResetConfirm(false);
    if (!clientRef.current) return;
    // Abort any active run first
    const targetRunId = trackerRef.current.getView().abortTargetRunId;
    if (targetRunId) {
      clientRef.current.request("chat.abort", {
        sessionKey: sessionKeyRef.current,
        runId: targetRunId,
      }).catch(() => { });
    }
    // Reset session on gateway
    clientRef.current.request("sessions.reset", {
      key: sessionKeyRef.current,
    }).then(() => {
      setMessages([{ role: "assistant", text: `🔄 ${t("chat.resetCommandFeedback")}`, timestamp: Date.now() }]);
      clearImages(sessionKeyRef.current).catch(() => { });
      trackerRef.current.reset();
      lastAgentStreamRef.current = null;
    }).catch((err) => {
      const errText = formatError(err) || t("chat.unknownError");
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${errText}`, timestamp: Date.now() }]);
    });
  }

  // Fetch gateway sessions with previews for archived dropdown content search
  const fetchGatewaySessions = useCallback(async (): Promise<GatewaySessionInfo[]> => {
    const client = clientRef.current;
    if (!client) return [];
    try {
      const result = await client.request<SessionsListResult>("sessions.list", {
        includeDerivedTitles: true,
        includeLastMessage: true,
      });
      if (!result?.sessions) return [];
      return result.sessions.map((s) => ({
        key: s.key,
        derivedTitle: s.derivedTitle,
        lastMessagePreview: s.lastMessagePreview,
      }));
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!showToolSelector) return;
    function handleClickOutside(e: MouseEvent) {
      if (toolsWrapperRef.current && !toolsWrapperRef.current.contains(e.target as Node)) {
        setShowToolSelector(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showToolSelector]);

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
      <SessionTabBar
        sessions={sessionManager.sessions}
        activeSessionKey={sessionManager.activeSessionKey}
        unreadKeys={sessionManager.unreadKeys}
        onSwitchSession={sessionManager.switchSession}
        onNewChat={sessionManager.createNewChat}
        onArchiveSession={sessionManager.archiveSession}
        onRenameSession={sessionManager.renameSession}
        onRestoreSession={sessionManager.restoreSession}
        onReorderSession={sessionManager.reorderSessions}
        fetchGatewaySessions={fetchGatewaySessions}
      />
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
                  <div className="chat-tool-event-header">
                    <span className="chat-tool-event-icon">&#9881;</span>
                    {t("chat.toolEventLabel", { tool: msg.toolName })}
                    {msg.toolArgs && Object.keys(msg.toolArgs).length > 0 && (
                      <ToolArgsDisplay args={msg.toolArgs} />
                    )}
                  </div>
                </div>
              ) : null;
            }
            const cleaned = cleanMessageText(msg.text).replaceAll(IMAGE_PLACEHOLDER, t("chat.imageAttachment"));
            const hasImages = msg.images && msg.images.length > 0;
            // Skip empty bubbles (text stripped by cleanMessageText and no images)
            if (!cleaned && !hasImages) return null;
            // User messages always align right (both local and external).
            // External assistant messages go left with a distinct visual style.
            const isUserRole = msg.role === "user";
            const wrapClass = isUserRole ? "chat-bubble-wrap-user" : "chat-bubble-wrap-assistant";
            const bubbleClass = isUserRole ? "chat-bubble-user" : msg.isExternal ? "chat-bubble-external" : "chat-bubble-assistant";
            return (
              <div key={i} className={`chat-bubble-wrap ${wrapClass}`}>
                {msg.timestamp > 0 && (
                  <div className="chat-bubble-timestamp">
                    {msg.channel ? `${msg.channel} · ` : ""}{formatTimestamp(msg.timestamp, i18n.language)}
                  </div>
                )}
                <div
                  className={`chat-bubble ${bubbleClass}`}
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
                  {cleaned && (msg.role === "assistant"
                    ? <CollapsibleContent defaultCollapsed={collapseMessages}><MarkdownMessage text={cleaned} /></CollapsibleContent>
                    : cleaned)}
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
              runId !== null || externalPending || (view.isActive && view.displayPhase !== "done")
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
              <div className="chat-bubble-wrap chat-bubble-wrap-assistant">
                <div className="chat-bubble chat-bubble-assistant chat-streaming-cursor">
                  <MarkdownMessage text={cleanMessageText(streaming).replaceAll(IMAGE_PLACEHOLDER, t("chat.imageAttachment"))} />
                </div>
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
          <svg className={`chat-examples-chevron ${chatExamplesExpanded ? "chat-examples-chevron-down" : ""}`} width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4.5 10L8 6.5L11.5 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {chatExamplesExpanded && (
          <>
            <div className="chat-examples-title">{t("chat.examplesTitle")}</div>
            <div className="chat-examples-grid">
              {(["example1", "example2", "example3", "example4", "example5", "example6"] as const).map((key) => (
                <button
                  key={key}
                  className="chat-example-card"
                  onClick={() => setDraft(t(`chat.${key}`))}
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
        {connectionState === "connected" && (
          <Select
            className="chat-thinking-select"
            value={thinkingLevel}
            onChange={setThinkingLevel}
            options={[
              { value: "", label: t("chat.thinkingNone") },
              { value: "low", label: t("chat.thinkingLow") },
              { value: "medium", label: t("chat.thinkingMedium") },
              { value: "high", label: t("chat.thinkingHigh") },
            ]}
          />
        )}
        <span className="chat-status-spacer" />
        {hasTools && (
          <div className="chat-tools-wrapper" ref={toolsWrapperRef}>
            <button
              className={`chat-tools-toggle${showToolSelector ? " chat-tools-toggle-active" : ""}`}
              onClick={() => setShowToolSelector((v) => !v)}
            >
              <span className="chat-tools-toggle-icon">&#9881;</span>
              {t("tools.selector.title")}
            </button>
            {showToolSelector && (
              <div className="chat-tools-popover">
                <ToolSelector
                  scopeType="chat_session"
                  scopeKey={sessionManager.activeSessionKey}
                />
              </div>
            )}
          </div>
        )}
        <button
          className="btn btn-sm btn-secondary"
          onClick={handleReset}
          disabled={connectionState !== "connected"}
          title={t("chat.resetTooltip")}
        >
          {t("chat.resetCommand")}
        </button>
      </div>

      <ChatInputArea
        draft={draft}
        pendingImages={pendingImages}
        isStreaming={isStreaming}
        canAbort={trackerRef.current.getView().canAbort}
        connectionState={connectionState}
        hasProviderKeys={hasProviderKeys}
        onDraftChange={setDraft}
        onPendingImagesChange={setPendingImages}
        onSend={handleSend}
        onStop={handleStop}
      />
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
