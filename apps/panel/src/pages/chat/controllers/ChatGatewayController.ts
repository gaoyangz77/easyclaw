/**
 * ChatGatewayController — domain controller that owns all side effects
 * for the Chat feature: WebSocket connection, SSE bridge, session management,
 * event handling, and run lifecycle.
 *
 * This is a plain TypeScript class (NOT an MST model).  It holds:
 *   - GatewayChatClient instance
 *   - ChatEventBridge instance
 *   - Timers (fallback, recently-completed TTL, watchdog, name refresh, session refresh debounce)
 *   - Sidecar readiness reaction disposer
 *   - Reference to the ChatStore singleton
 *
 * Run lifecycle state lives in ChatRunStateModel (MST, per-session).
 * The controller translates gateway/bridge events into MST action calls
 * and manages timers as side effects.
 */

import { reaction, when } from "mobx";
import type { TFunction } from "i18next";
import { formatError, DEFAULTS } from "@rivonclaw/core";

import { GatewayChatClient } from "../../../lib/gateway-client.js";
import type { GatewayEvent, GatewayHelloOk } from "../../../lib/gateway-client.js";
import { ChatEventBridge } from "../chat-event-bridge.js";
import type { ChatMirrorSSEPayload } from "../chat-event-bridge.js";
import { ACTIVE_PHASES, FINAL_FALLBACK_MS, MIRROR_FINAL_FALLBACK_MS, RECENTLY_COMPLETED_TTL_MS } from "../run-tracker.js";
import type { RunPhase } from "../run-tracker.js";
import { fetchGatewayInfo, trackEvent } from "../../../api/index.js";
import { fetchChatSessions, updateChatSession } from "../../../api/chat-sessions.js";
import type { ChatSessionMeta } from "../../../api/chat-sessions.js";
import { setRunProfileForScope } from "../../../api/tool-registry.js";
import { runtimeStatusStore } from "../../../store/runtime-status-store.js";
import { saveImages, clearImages, restoreImages } from "../image-cache.js";
import type { IChatStore } from "../store/chat-store.js";
import type { IChatRunState } from "../store/models/ChatRunStateModel.js";
import type { ChatMessage, SessionsListResult, ChatImage } from "../chat-utils.js";
import {
  DEFAULT_SESSION_KEY,
  INITIAL_VISIBLE,
  FETCH_BATCH,
  PAGE_SIZE,
  buildAutoSessionTitle,
  extractToolError,
  extractText,
  extractToolCallName,
  isPanelSessionKey,
  localizeError,
  mergeTerminalError,
  parseRawMessages,
  cleanDerivedTitle,
  isHiddenSession,
} from "../chat-utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFRESH_DEBOUNCE = DEFAULTS.chat.sessionRefreshDebounceMs;

/**
 * Read the user's custom session tab order from the MST-backed appSettings
 * (sourced from SQLite via SSE). Returns null when no custom order is set.
 */
function loadCustomOrder(): string[] | null {
  const raw = runtimeStatusStore.appSettings.chatTabOrder;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return null;
  }
}

/**
 * Persist the user's custom session tab order through the MST setter action
 * (which routes to Desktop -> SQLite -> SSE patch back). Pass null to clear.
 */
function saveCustomOrder(order: string[] | null): void {
  const value = order ? JSON.stringify(order) : "";
  runtimeStatusStore.appSettings.setChatTabOrder(value).catch(() => {});
}

function generateSessionKey(): string {
  const id = crypto.randomUUID().slice(0, 8);
  return `agent:main:panel-${id}`;
}

function findFirstPanelUserTitle(messages: ChatMessage[]): string | undefined {
  const firstUser = messages.find((msg) =>
    msg.role === "user" &&
    !msg.isExternal &&
    typeof msg.text === "string" &&
    msg.text.trim());
  return firstUser ? buildAutoSessionTitle(firstUser.text) : undefined;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ChatGatewayController {
  private store: IChatStore;
  private client: GatewayChatClient | null = null;
  private bridge: ChatEventBridge | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private nameRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  private sidecarDisposer: (() => void) | null = null;
  private rpcReadyDisposer: (() => void) | null = null;
  private initialConnectDone = false;
  private needsDisconnectError = false;
  private archivedKeys = new Set<string>();
  private metaMap = new Map<string, ChatSessionMeta>();
  private localSessions = new Map<string, { key: string; updatedAt: number; isLocal: boolean }>();
  private customOrder: string[] | null = null;
  private isFetching = false;
  private fetchLimit = FETCH_BATCH;
  private cancelled = false;
  private tFn: TFunction | null = null;
  private onAgentNameChange: ((name: string | null) => void) | null = null;
  // Timer maps — timers are side effects that don't belong in MST
  private finalFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lifecycleErrors = new Map<string, string>();
  /**
   * Panel-memory cache of terminal run errors that should survive message list
   * replacements (loadHistory/switchSession/fetchMore).  Keyed by sessionKey.
   * Cleared when a new run starts for the session or on session reset.
   */
  private terminalErrors = new Map<string, { runId: string; text: string; timestamp: number }>();
  private recentlyCompletedTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingStopNotices = new Set<string>();
  // Scroll hints — one-shot flags consumed by ChatPage on each render
  shouldInstantScroll = false;
  stickyHint = false;

  constructor(store: IChatStore) {
    this.store = store;
    this.customOrder = loadCustomOrder();
    if (this.customOrder) {
      store.setCustomOrder(this.customOrder);
    }
    // Ensure the default/active session exists before first render
    store.getOrCreateSession(store.activeSessionKey);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  setTranslation(t: TFunction): void {
    this.tFn = t;
  }

  setOnAgentNameChange(fn: ((name: string | null) => void) | null): void {
    this.onAgentNameChange = fn;
  }

  private t(key: string, opts?: Record<string, unknown>): string {
    if (this.tFn) return String(this.tFn(key, opts as never));
    return key;
  }

  async start(): Promise<void> {
    this.cancelled = false;

    // Load archived keys + metadata from SQLite
    try {
      const rows = await fetchChatSessions();
      for (const row of rows) {
        this.metaMap.set(row.key, row);
        if (row.archivedAt != null) this.archivedKeys.add(row.key);
      }
    } catch { /* non-fatal */ }

    // Prune stale image cache entries on start
    clearImages().catch(() => {});

    // Init connection
    await this.initConnection();

    // Start watchdog
    this.startWatchdog();
  }

  stop(): void {
    this.cancelled = true;
    this.stopWatchdog();
    if (this.nameRefreshTimer) {
      clearInterval(this.nameRefreshTimer);
      this.nameRefreshTimer = null;
    }
    clearTimeout(this.refreshDebounceTimer);
    this.rpcReadyDisposer?.();
    this.rpcReadyDisposer = null;
    this.sidecarDisposer?.();
    this.sidecarDisposer = null;
    this.client?.stop();
    this.client = null;
    this.bridge?.disconnect();
    this.bridge = null;
    this.initialConnectDone = false;
  }

  get gatewayClient(): GatewayChatClient | null {
    return this.client;
  }

  /** Get the run state model for the active session. */
  private get activeRunState(): IChatRunState {
    return this.store.getOrCreateSession(this.store.activeSessionKey).runState;
  }

  /** Get the run state model for a specific session (creating the session if needed). */
  private runStateFor(sessionKey: string): IChatRunState {
    return this.store.getOrCreateSession(sessionKey).runState;
  }

  private stopNoticeKey(sessionKey: string, runId: string): string {
    return `${sessionKey}:${runId}`;
  }

  private markPendingStopNotice(sessionKey: string, runId: string): void {
    this.pendingStopNotices.add(this.stopNoticeKey(sessionKey, runId));
  }

  private consumePendingStopNotice(sessionKey: string, runId: string): boolean {
    return this.pendingStopNotices.delete(this.stopNoticeKey(sessionKey, runId));
  }

  private clearPendingStopNotice(sessionKey: string, runId: string): void {
    this.pendingStopNotices.delete(this.stopNoticeKey(sessionKey, runId));
  }

  private persistPanelTitle(key: string, title: string): void {
    const nextMeta = { ...this.metaMap.get(key), key, panelTitle: title } as ChatSessionMeta;
    this.metaMap.set(key, nextMeta);
    updateChatSession(key, { panelTitle: title }).catch(() => {});
  }

  private ensurePanelSessionTitleFromHistory(sessionKey: string, sessionMessages: ChatMessage[]): void {
    if (!isPanelSessionKey(sessionKey)) return;
    const session = this.store.sessions.get(sessionKey);
    if (!session || session.customTitle || session.panelTitle) return;
    const title = findFirstPanelUserTitle(sessionMessages);
    if (!title) return;
    session.setPanelTitle(title);
    session.setLocalTitle(title);
    this.persistPanelTitle(sessionKey, title);
  }

  // ---------------------------------------------------------------------------
  // Connection (from useChatConnection)
  // ---------------------------------------------------------------------------

  private async initConnection(): Promise<void> {
    try {
      // Wait for Desktop RPC to connect before attempting the webchat WebSocket.
      // Without this gate the Panel blindly connects while the gateway is still
      // starting, accumulating exponential backoff (~9 s wasted on startup).
      const connector = runtimeStatusStore.openClawConnector;
      if (!connector.rpcConnected) {
        const cancel = when(
          () => connector.rpcConnected || this.cancelled,
        );
        this.rpcReadyDisposer = () => cancel.cancel();
        try { await cancel; } catch { return; } // cancelled via stop()
        finally { this.rpcReadyDisposer = null; }
        if (this.cancelled) return;
      }

      const info = await fetchGatewayInfo();
      if (this.cancelled) return;

      const client = new GatewayChatClient({
        url: info.wsUrl,
        token: info.token,
        onConnected: (hello: GatewayHelloOk) => {
          if (this.cancelled) return;

          const mainKey = hello.snapshot?.sessionDefaults?.mainSessionKey;
          if (mainKey && !this.initialConnectDone) {
            this.initialConnectDone = true;
            this.store.setActiveSessionKey(mainKey);
            // Ensure the main session exists in the store
            this.store.getOrCreateSession(mainKey);
          }
          this.store.setConnectionState("connected");

          // Gate history loading on sidecar readiness
          const onSidecarReady = () => {
            this.loadHistory().then(() => {
              if (this.needsDisconnectError) {
                this.needsDisconnectError = false;
                const session = this.store.activeSession;
                if (session) {
                  session.appendMessage({
                    role: "assistant",
                    text: `\u26A0 ${this.t("chat.disconnectedError")}`,
                    timestamp: Date.now(),
                  });
                }
              }
            }).catch(() => {});
          };

          const sidecar = runtimeStatusStore.openClawConnector.sidecarState;
          if (sidecar === "ready") {
            onSidecarReady();
          } else {
            const dispose = reaction(
              () => runtimeStatusStore.openClawConnector.sidecarState,
              (state, _prev, r) => {
                if (this.cancelled) { r.dispose(); return; }
                if (state === "ready") {
                  r.dispose();
                  onSidecarReady();
                }
              },
            );
            this.sidecarDisposer = dispose;
          }

          // Fetch agent display name
          this.refreshAgentName();

          // Fetch session list
          this.doFetchSessionsList();
        },
        onDisconnected: () => {
          if (this.cancelled) return;
          this.store.setConnectionState("connecting");

          const rs = this.activeRunState;
          const localId = rs.localRunId;
          const wasWaiting = !!localId;
          const disconnectText = localId ? (rs.getRun(localId)?.streaming ?? null) : null;
          this.resetAllRunStates();

          if (disconnectText) {
            const session = this.store.activeSession;
            if (session) {
              session.appendMessage({ role: "assistant", text: disconnectText, timestamp: Date.now() });
            }
          }
          if (wasWaiting) {
            this.needsDisconnectError = true;
          }
        },
        onEvent: (evt: GatewayEvent) => this.handleEvent(evt),
      });

      this.client = client;
      client.start();

      // Connect SSE bridge — now routed through the shared panelEventBus
      // singleton, so no URL is needed here.
      const bridge = new ChatEventBridge({
        onAction: (action) => {
          if (this.cancelled) return;
          const rs = this.activeRunState;
          if (action.type === "TOOL_START") rs.startTool(action.runId, action.toolName);
          else if (action.type === "TOOL_RESULT") rs.finishTool(action.runId);
        },
        onUserMessage: (msg) => {
          if (this.cancelled) return;
          if (msg.sessionKey !== this.store.activeSessionKey) {
            this.markUnread(msg.sessionKey);
            return;
          }
          const session = this.store.activeSession;
          if (session) {
            session.appendMessage({
              role: "user",
              text: msg.text,
              timestamp: msg.timestamp,
              isExternal: true,
              channel: msg.channel,
            });
            session.runState.setExternalPending(true);
          }
        },
        onSessionReset: (sessionKey: string) => {
          if (this.cancelled) return;
          if (sessionKey !== this.store.activeSessionKey) return;
          const session = this.store.activeSession;
          if (session) {
            session.setMessages([{
              role: "assistant",
              text: `\uD83D\uDD04 ${this.t("chat.resetCommandFeedback")}`,
              timestamp: Date.now(),
            }]);
          }
          clearImages(sessionKey).catch(() => {});
          this.terminalErrors.delete(sessionKey);
          this.clearTimersForSession(sessionKey);
          this.runStateFor(sessionKey).resetAll();
        },
        onMirrorEvent: (mirror: ChatMirrorSSEPayload) => {
          if (this.cancelled) return;
          // Hidden sessions (CS, internal API) — don't create tabs or track state
          if (isHiddenSession(mirror.sessionKey)) return;
          const isActiveMirror = mirror.sessionKey === this.store.activeSessionKey;
          const data = mirror.data as Record<string, unknown>;

          if (mirror.stream === "assistant") {
            const text = data.text as string | undefined;
            if (text) {
              if (isActiveMirror) {
                const session = this.store.activeSession;
                if (session?.runState.externalPending) {
                  session.runState.setExternalPending(false);
                }
              }
              this.handleEvent({
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
              const mirrorRs = this.runStateFor(mirror.sessionKey);
              mirrorRs.beginExternalRun(mirror.runId, mirror.sessionKey, "unknown", true);
              mirrorRs.markLifecycleStart(mirror.runId);
            } else if (phase === "end" || phase === "error") {
              if (isActiveMirror) {
                const session = this.store.activeSession;
                if (session?.runState.externalPending) {
                  session.runState.setExternalPending(false);
                }
              }
              this.handleEvent({
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
            const toolName = extractToolCallName(data);
            const toolPhase = data.phase as string | undefined;
            const toolArgs = data.args as Record<string, unknown> | undefined;
            this.handleEvent({
              type: "event",
              event: "agent",
              payload: {
                runId: mirror.runId,
                sessionKey: mirror.sessionKey,
                stream: "tool",
                data,
              },
            });
            if (toolName === "message" && toolPhase === "start" && toolArgs && isActiveMirror) {
              const msgText = (
                toolArgs.message ??
                toolArgs.caption ??
                toolArgs.text ??
                toolArgs.content
              ) as string | undefined;
              if (msgText) {
                const session = this.store.activeSession;
                if (session) {
                  session.appendMessage({ role: "assistant", text: msgText, timestamp: Date.now() });
                }
              }
            }
          }
        },
      });
      bridge.connect();
      this.bridge = bridge;

      // Poll agent identity every 5 minutes
      this.nameRefreshTimer = setInterval(() => {
        if (this.client) this.refreshAgentName();
      }, 5 * 60 * 1000);

    } catch {
      if (!this.cancelled) this.store.setConnectionState("disconnected");
    }
  }

  private refreshAgentName(): void {
    if (!this.client) return;
    this.client.request<{ name?: string }>("agent.identity.get", {
      sessionKey: this.store.activeSessionKey,
    }).then((res) => {
      if (!this.cancelled && res?.name) {
        this.store.setAgentName(res.name);
        this.onAgentNameChange?.(res.name);
      }
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Event handling (from useChatRunLifecycle)
  // ---------------------------------------------------------------------------

  private handleEvent(evt: GatewayEvent): void {
    const activeKey = this.store.activeSessionKey;
    const rs = this.activeRunState;

    // --- Agent events ---
    if (evt.event === "agent") {
      const agentPayload = evt.payload as {
        runId?: string;
        stream?: string;
        sessionKey?: string;
        data?: Record<string, unknown>;
      } | undefined;
      if (!agentPayload) return;
      const isBackground = agentPayload.sessionKey && agentPayload.sessionKey !== activeKey;

      if (isBackground) {
        // Hidden sessions (CS, internal API) — don't create tabs or track state
        if (isHiddenSession(agentPayload.sessionKey!)) return;
        this.markUnread(agentPayload.sessionKey!);
        if (!this.store.sessions.has(agentPayload.sessionKey!)) {
          this.refreshSessions();
        }
        const bgRs = this.runStateFor(agentPayload.sessionKey!);
        const bgRunId = agentPayload.runId;
        if (bgRunId && bgRs.isTracked(bgRunId)) {
          const stream = agentPayload.stream;
          if (stream === "tool") {
            const phase = agentPayload.data?.phase;
            const name = agentPayload.data ? extractToolCallName(agentPayload.data) : undefined;
            if (phase === "start" && name) bgRs.startTool(bgRunId, name);
            else if (phase === "result" || phase === "end" || phase === "error") bgRs.finishTool(bgRunId);
          } else if (stream === "lifecycle") {
            const phase = agentPayload.data?.phase;
            if (phase === "start") bgRs.markLifecycleStart(bgRunId);
            else if (phase === "end") this.startFallbackTimer(agentPayload.sessionKey!, bgRunId);
            else if (phase === "error") {
              const lcError = agentPayload.data?.error;
              if (typeof lcError === "string" && lcError) {
                this.lifecycleErrors.set(bgRunId, lcError);
              }
              this.startFallbackTimer(agentPayload.sessionKey!, bgRunId);
            }
          } else if (stream === "assistant") {
            bgRs.markAssistantStream(bgRunId);
          }
        }
        return;
      }

      const agentRunId = agentPayload.runId;
      if (!agentRunId || !rs.isTracked(agentRunId)) {
        if (agentPayload.stream === "tool" || agentPayload.stream === "lifecycle") {
          console.warn("[chat] agent event dropped: stream=%s phase=%s runId=%s tracked=%s localRunId=%s",
            agentPayload.stream, agentPayload.data?.phase, agentRunId,
            agentRunId ? rs.isTracked(agentRunId) : "no-id",
            rs.localRunId);
        }
        return;
      }

      const session = this.store.activeSession;
      if (session) {
        session.runState.setLastAgentStream(agentPayload.stream ?? null);
        session.runState.setLastActivity(Date.now());
      }

      const stream = agentPayload.stream;

      if (stream === "tool") {
        const phase = agentPayload.data?.phase;
        const name = agentPayload.data ? extractToolCallName(agentPayload.data) : undefined;
        if (phase === "start" && name) {
          const flushRun = rs.getRun(agentRunId);
          const rawStreaming = flushRun?.streaming ?? null;
          const currentOffset = flushRun?.flushedOffset ?? 0;
          const flushedText = rawStreaming && currentOffset > 0 ? rawStreaming.slice(currentOffset) : rawStreaming;
          const args = agentPayload.data?.args as Record<string, unknown> | undefined;
          if (session) {
            session.startToolEvent({
              runId: agentRunId,
              toolName: name,
              toolArgs: args,
              flushedText,
            });
            // History patch for throttle buffer recovery (first tool call only)
            if (this.client && currentOffset === 0 && flushedText) {
              const snap = flushedText;
              const runKey = agentRunId;
              const sessionKey = activeKey;
              this.client.request<{ messages?: Array<{ role?: string; content?: unknown; idempotencyKey?: string }> }>(
                "chat.history", { sessionKey, limit: 100 },
              ).then((res) => {
                if (!res?.messages) return;
                let anchor = -1;
                for (let i = 0; i < res.messages.length; i++) {
                  if ((res.messages[i] as { idempotencyKey?: string }).idempotencyKey === runKey) {
                    anchor = i;
                    break;
                  }
                }
                if (anchor === -1) return;
                for (let i = res.messages.length - 1; i > anchor; i--) {
                  if (res.messages[i].role !== "assistant") continue;
                  const full = extractText(res.messages[i].content);
                  if (full && full.length > snap.length) {
                    const sess = this.store.sessions.get(sessionKey);
                    if (sess) {
                      sess.updateMessages((prev) => {
                        const idx = prev.findLastIndex((msg) => msg.role === "assistant" && msg.text === snap);
                        if (idx === -1) return prev;
                        const patched = [...prev];
                        patched[idx] = { ...patched[idx], text: full };
                        return patched;
                      });
                    }
                    this.runStateFor(sessionKey).updateFlushedOffset(runKey, full.length);
                    break;
                  }
                }
              }).catch((err) => { console.warn("[chat] history patch failed:", err); });
            }
          }
          rs.startTool(agentRunId, name);
        } else if (phase === "result" || phase === "end") {
          const toolError = agentPayload.data ? extractToolError(agentPayload.data) : undefined;
          if (toolError) session?.settleToolEvent(agentRunId, "failed", toolError);
          else session?.completeToolEvent(agentRunId);
          rs.finishTool(agentRunId);
        } else if (phase === "error") {
          session?.settleToolEvent(agentRunId, "failed", agentPayload.data ? extractToolError(agentPayload.data) : undefined);
          rs.finishTool(agentRunId);
        }
      } else if (stream === "lifecycle") {
        const phase = agentPayload.data?.phase;
        if (phase === "start") rs.markLifecycleStart(agentRunId);
        else if (phase === "end") this.startFallbackTimer(activeKey, agentRunId);
        else if (phase === "error") {
          const lcError = agentPayload.data?.error;
          if (typeof lcError === "string" && lcError) {
            this.lifecycleErrors.set(agentRunId, lcError);
          }
          this.startFallbackTimer(activeKey, agentRunId);
        }
      } else if (stream === "assistant") {
        rs.markAssistantStream(agentRunId);
      }
      return;
    }

    // --- Heartbeat ---
    if (evt.event === "heartbeat") {
      const hbPayload = evt.payload as { status?: string } | undefined;
      const st = hbPayload?.status;
      if (st && st !== "failed") {
        setTimeout(() => {
          if (this.client) this.loadHistory();
        }, 600);
        this.refreshSessions();
      }
      return;
    }

    // --- Cron ---
    if (evt.event === "cron") {
      const cronPayload = evt.payload as { action?: string; status?: string } | undefined;
      if (cronPayload?.action === "finished" && cronPayload?.status === "ok") {
        setTimeout(() => {
          if (this.client) this.loadHistory();
        }, 300);
        this.refreshSessions();
      }
      return;
    }

    if (evt.event !== "chat") return;

    // --- Chat events ---
    const payload = evt.payload as {
      state?: string;
      runId?: string;
      sessionKey?: string;
      message?: { role?: string; content?: unknown; timestamp?: number };
      errorMessage?: string;
    } | undefined;

    if (!payload) return;

    // Background sessions
    if (payload.sessionKey && payload.sessionKey !== activeKey) {
      // Hidden sessions (CS, internal API) — don't create tabs or track state
      if (isHiddenSession(payload.sessionKey)) return;
      this.markUnread(payload.sessionKey);
      if (!this.store.sessions.has(payload.sessionKey)) {
        this.refreshSessions();
      }
      const bgRs = this.runStateFor(payload.sessionKey);
      const bgRunId = payload.runId;
      if (bgRunId) {
        switch (payload.state) {
          case "delta": {
            const text = extractText(payload.message?.content);
            if (text) bgRs.appendDelta(bgRunId, text);
            break;
          }
          case "final":
            this.clearFallbackTimer(bgRunId);
            bgRs.finalizeRun(bgRunId);
            this.markRunRecentlyCompleted(payload.sessionKey, bgRunId);
            break;
          case "error":
            this.clearFallbackTimer(bgRunId);
            this.lifecycleErrors.delete(bgRunId);
            bgRs.failRun(bgRunId);
            this.markRunRecentlyCompleted(payload.sessionKey, bgRunId);
            break;
          case "aborted":
            this.clearFallbackTimer(bgRunId);
            bgRs.abortRun(bgRunId);
            this.markRunRecentlyCompleted(payload.sessionKey, bgRunId);
            break;
        }
      }
      return;
    }

    const chatRunId = payload.runId;
    const isOurLocalRun = rs.localRunId && chatRunId === rs.localRunId;
    const isTrackedRun = chatRunId ? rs.isTracked(chatRunId) : false;

    if (chatRunId && !isTrackedRun && !isOurLocalRun && !rs.isRecentlyCompleted(chatRunId)) {
      if (payload.state === "delta") {
        rs.beginExternalRun(chatRunId, payload.sessionKey ?? activeKey, "unknown");
      }
    }

    // Dispatch to run state model
    if (chatRunId) {
      const session = this.store.activeSession;
      if (session) session.runState.setLastActivity(Date.now());
      const terminalRun = rs.getRun(chatRunId);
      const terminalWhileTooling = terminalRun?.phase === "tooling";
      switch (payload.state) {
        case "delta": {
          const text = extractText(payload.message?.content);
          if (text) rs.appendDelta(chatRunId, text);
          break;
        }
        case "final":
          this.clearFallbackTimer(chatRunId);
          if (terminalWhileTooling) {
            session?.completeToolEvent(chatRunId);
          }
          this.clearPendingStopNotice(activeKey, chatRunId);
          rs.finalizeRun(chatRunId);
          this.markRunRecentlyCompleted(activeKey, chatRunId);
          this.refreshSessions();
          break;
        case "error":
          this.clearFallbackTimer(chatRunId);
          if (terminalWhileTooling) {
            session?.settleToolEvent(chatRunId, "failed", payload.errorMessage);
          }
          this.clearPendingStopNotice(activeKey, chatRunId);
          this.lifecycleErrors.delete(chatRunId);
          rs.failRun(chatRunId);
          this.markRunRecentlyCompleted(activeKey, chatRunId);
          break;
        case "aborted":
          this.clearFallbackTimer(chatRunId);
          if (terminalWhileTooling) {
            session?.settleToolEvent(chatRunId, "failed", this.t("chat.stopCommandFeedback"));
          }
          rs.abortRun(chatRunId);
          this.markRunRecentlyCompleted(activeKey, chatRunId);
          break;
      }
    }

    // Local run — handle streaming text and messages
    const session = this.store.activeSession;
    if (isOurLocalRun && session) {
      switch (payload.state) {
        case "delta": {
          // Streaming text tracked via appendDelta above
          break;
        }
        case "final": {
          // Read run snapshot BEFORE cleanup (run is now in terminal "done" phase)
          const localRun = rs.getRun(chatRunId!);
          const flushedOffset = localRun?.flushedOffset ?? 0;
          const finalText = extractText(payload.message?.content);
          if (finalText) {
            const newText = flushedOffset > 0 ? finalText.slice(flushedOffset) : finalText;
            if (newText.trim()) {
              session.appendMessage({ role: "assistant", text: newText, timestamp: Date.now() });
            }
          } else if (!localRun?.streaming) {
            session.appendMessage({
              role: "assistant",
              text: `\u26A0 ${this.t("chat.errorTimeout")}`,
              timestamp: Date.now(),
            });
          }
          if (session.runState.sendStartedAt > 0) {
            trackEvent("chat.response_received", { durationMs: Date.now() - session.runState.sendStartedAt });
            session.runState.setSendStartedAt(0);
          }
          session.runState.setLastAgentStream(null);
          if (session.runState.externalPending) {
            session.runState.setExternalPending(false);
          }
          this.cleanupTerminalRuns(activeKey);
          break;
        }
        case "error": {
          console.error("[chat] error event:", payload.errorMessage ?? "unknown error", "runId:", chatRunId);
          const raw = payload.errorMessage ?? this.t("chat.unknownError");
          const errText = localizeError(raw, this.tFn!);
          const renderedText = `\u26A0 ${errText}`;
          const errorTs = Date.now();
          session.appendMessage({ role: "assistant", text: renderedText, timestamp: errorTs });
          this.terminalErrors.set(activeKey, { runId: chatRunId!, text: renderedText, timestamp: errorTs });
          session.runState.setLastAgentStream(null);
          if (session.runState.externalPending) {
            session.runState.setExternalPending(false);
          }
          this.cleanupTerminalRuns(activeKey);
          break;
        }
        case "aborted": {
          // Read run snapshot BEFORE cleanup
          const abortedRun = rs.getRun(chatRunId!);
          const abortedRaw = abortedRun?.streaming ?? null;
          const abortedOffset = abortedRun?.flushedOffset ?? 0;
          const abortedText = abortedRaw && abortedOffset > 0 ? abortedRaw.slice(abortedOffset) : abortedRaw;
          if (abortedText?.trim()) {
            session.appendMessage({ role: "assistant", text: abortedText, timestamp: Date.now() });
          }
          if (this.consumePendingStopNotice(activeKey, chatRunId!)) {
            session.appendMessage({
              role: "assistant",
              text: `\u23F9 ${this.t("chat.stopCommandFeedback")}`,
              timestamp: Date.now(),
            });
          }
          session.runState.setLastAgentStream(null);
          if (session.runState.externalPending) {
            session.runState.setExternalPending(false);
          }
          this.cleanupTerminalRuns(activeKey);
          break;
        }
      }
    } else if (chatRunId && session) {
      // External run
      if (payload.state === "error") {
        console.error("[chat] external run error:", payload.errorMessage ?? "unknown error", "runId:", chatRunId);
      }
      if (payload.state === "final") {
        // Read run snapshot BEFORE cleanup
        const extRun = chatRunId ? rs.getRun(chatRunId) : null;
        const extFlushedOffset = extRun?.flushedOffset ?? 0;
        const finalText = extractText(payload.message?.content);
        if (finalText) {
          const extNewText = extFlushedOffset > 0 ? finalText.slice(extFlushedOffset) : finalText;
          if (extNewText.trim()) {
            session.appendMessage({ role: "assistant", text: extNewText, timestamp: Date.now() });
          }
        }
        this.loadHistory();
      }
      if (payload.state === "aborted" && this.consumePendingStopNotice(activeKey, chatRunId)) {
        session.appendMessage({
          role: "assistant",
          text: `\u23F9 ${this.t("chat.stopCommandFeedback")}`,
          timestamp: Date.now(),
        });
      }
      if (payload.state === "final" || payload.state === "error" || payload.state === "aborted") {
        if (payload.state !== "aborted") {
          this.clearPendingStopNotice(activeKey, chatRunId);
        }
        this.cleanupTerminalRuns(activeKey);
        if (session.runState.externalPending) {
          session.runState.setExternalPending(false);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Timer management (side effects that don't belong in MST)
  // ---------------------------------------------------------------------------

  /**
   * Start a fallback timer for a run after LIFECYCLE_END/LIFECYCLE_ERROR.
   * If CHAT_FINAL does not arrive in time, force-transition to done.
   *
   * For mirror-final runs (non-webchat channels), the terminal event arrives
   * via mirror SSE as a synthetic chat.final.  These get a longer timeout
   * (MIRROR_FINAL_FALLBACK_MS = 60s) because mirror SSE can be significantly
   * slower than the WS agent broadcast.  The longer timer still provides a
   * fallback for background sessions where the watchdog (active-session-only)
   * cannot reach.
   *
   * For local runs, the standard FINAL_FALLBACK_MS (5s) applies — chat.final
   * should arrive promptly via the gateway WS chat stream.
   */
  private startFallbackTimer(sessionKey: string, runId: string): void {
    const targetRs = this.runStateFor(sessionKey);
    const run = targetRs.getRun(runId);
    if (!run || !ACTIVE_PHASES.has(run.phase as RunPhase)) return;
    const timeoutMs = run.expectsMirrorFinal ? MIRROR_FINAL_FALLBACK_MS : FINAL_FALLBACK_MS;
    this.clearFallbackTimer(runId);
    const timer = setTimeout(() => {
      this.finalFallbackTimers.delete(runId);
      const targetRs = this.runStateFor(sessionKey);
      const run = targetRs.getRun(runId);

      // Synthesize terminal message so the user sees why the run ended
      const session = this.store.sessions.get(sessionKey);
      if (session && run && ACTIVE_PHASES.has(run.phase as RunPhase)) {
        const lifecycleError = this.lifecycleErrors.get(runId);
        this.lifecycleErrors.delete(runId);
        if (run.phase === "tooling") {
          if (lifecycleError) session.settleToolEvent(runId, "failed", lifecycleError);
          else session.completeToolEvent(runId);
        }
        // Flush any partial streaming text
        const rawStreaming = run.streaming ?? null;
        const offset = run.flushedOffset ?? 0;
        const partialText = rawStreaming && offset > 0 ? rawStreaming.slice(offset) : rawStreaming;
        if (partialText?.trim()) {
          session.appendMessage({ role: "assistant", text: partialText, timestamp: Date.now() });
        }
        const errorText = lifecycleError
          ? localizeError(lifecycleError, this.tFn!)
          : this.t("chat.stalledError");
        const renderedText = `\u26A0 ${errorText}`;
        const errorTs = Date.now();
        session.appendMessage({ role: "assistant", text: renderedText, timestamp: errorTs });
        // Cache so the error survives loadHistory/switchSession message replacement
        if (lifecycleError) {
          this.terminalErrors.set(sessionKey, { runId, text: renderedText, timestamp: errorTs });
        }
      }

      targetRs.forceDone(runId);
      this.markRunRecentlyCompleted(sessionKey, runId);
    }, timeoutMs);
    this.finalFallbackTimers.set(runId, timer);
  }

  /** Clear a pending fallback timer for a specific run. */
  private clearFallbackTimer(runId: string): void {
    const timer = this.finalFallbackTimers.get(runId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.finalFallbackTimers.delete(runId);
    }
  }

  /** Clear all pending fallback timers. */
  private clearAllFallbackTimers(): void {
    for (const timer of this.finalFallbackTimers.values()) {
      clearTimeout(timer);
    }
    this.finalFallbackTimers.clear();
    this.lifecycleErrors.clear();
    this.terminalErrors.clear();
  }

  /**
   * Mark a run as recently completed and start a TTL timer to clear it.
   * Recently-completed tracking prevents phantom runs from late-arriving deltas.
   */
  private markRunRecentlyCompleted(sessionKey: string, runId: string): void {
    const targetRs = this.runStateFor(sessionKey);
    targetRs.markRecentlyCompleted(runId);
    // Clear any existing TTL timer for this runId to reset the TTL
    const existing = this.recentlyCompletedTimers.get(runId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.recentlyCompletedTimers.delete(runId);
      // Session may have been removed, guard the call
      const sess = this.store.sessions.get(sessionKey);
      if (sess) sess.runState.clearRecentlyCompleted(runId);
    }, RECENTLY_COMPLETED_TTL_MS);
    this.recentlyCompletedTimers.set(runId, timer);
  }

  /** Remove terminal-state runs from a session and mark them as recently completed. */
  private cleanupTerminalRuns(sessionKey: string): void {
    const targetRs = this.runStateFor(sessionKey);
    const removedIds = targetRs.cleanupTerminalRuns();
    for (const id of removedIds) {
      this.clearFallbackTimer(id);
      this.markRunRecentlyCompleted(sessionKey, id);
    }
  }

  /** Clear all timers and reset all session run states. */
  private resetAllRunStates(): void {
    this.clearAllFallbackTimers();
    for (const timer of this.recentlyCompletedTimers.values()) {
      clearTimeout(timer);
    }
    this.recentlyCompletedTimers.clear();
    for (const [, session] of this.store.sessions) {
      session.runState.resetAll();
    }
  }

  /** Clear timers for a specific session's runs. */
  private clearTimersForSession(sessionKey: string): void {
    const targetRs = this.runStateFor(sessionKey);
    // Clear fallback timers for any runs in this session
    for (const [runId] of targetRs.runs) {
      this.clearFallbackTimer(runId);
      const rcTimer = this.recentlyCompletedTimers.get(runId);
      if (rcTimer !== undefined) {
        clearTimeout(rcTimer);
        this.recentlyCompletedTimers.delete(runId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Watchdog (from useChatRunLifecycle)
  // ---------------------------------------------------------------------------

  private startWatchdog(): void {
    const WATCHDOG_INTERVAL = 30_000;
    const WATCHDOG_TIMEOUT = 5 * 60_000;
    this.watchdogTimer = setInterval(() => {
      const session = this.store.activeSession;
      if (!session) return;
      const stuck = session.runState.isActive || session.runState.externalPending;
      if (stuck && Date.now() - session.runState.lastActivityAt > WATCHDOG_TIMEOUT) {
        console.warn("[chat] watchdog: no events for 5 min -- force-resetting run state");

        // Synthesize terminal message before resetting
        const localId = session.runState.localRunId;
        if (localId) {
          const run = session.runState.getRun(localId);
          if (run && ACTIVE_PHASES.has(run.phase as RunPhase)) {
            // Flush partial streaming
            const rawStreaming = run.streaming ?? null;
            const offset = run.flushedOffset ?? 0;
            const partialText = rawStreaming && offset > 0 ? rawStreaming.slice(offset) : rawStreaming;
            if (partialText?.trim()) {
              session.appendMessage({ role: "assistant", text: partialText, timestamp: Date.now() });
            }
            session.appendMessage({
              role: "assistant",
              text: `\u26A0 ${this.t("chat.watchdogError")}`,
              timestamp: Date.now(),
            });
          }
        } else if (session.runState.externalPending || session.runState.isActive) {
          // External run was stuck
          session.appendMessage({
            role: "assistant",
            text: `\u26A0 ${this.t("chat.watchdogError")}`,
            timestamp: Date.now(),
          });
        }

        this.clearTimersForSession(this.store.activeSessionKey);
        session.runState.resetAll();
        session.runState.setLastAgentStream(null);
      }
    }, WATCHDOG_INTERVAL);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Session management (from useSessionManager)
  // ---------------------------------------------------------------------------

  async switchSession(key: string): Promise<void> {
    if (key === this.store.activeSessionKey) return;

    // Update active key
    this.store.setActiveSessionKey(key);
    trackEvent("chat.session_switched");

    // Ensure the target session exists
    this.store.getOrCreateSession(key);

    const session = this.store.sessions.get(key)!;

    // If no messages loaded yet, fetch from gateway
    if (session.messages.length === 0 && !session.allFetched) {
      const client = this.client;
      if (client) {
        try {
          const result = await client.request<{
            messages?: Array<{ role?: string; content?: unknown; timestamp?: number; idempotencyKey?: string }>;
          }>("chat.history", { sessionKey: key, limit: FETCH_BATCH });

          let parsed = parseRawMessages(result?.messages);
          parsed = await restoreImages(key, parsed).catch(() => parsed);
          this.ensurePanelSessionTitleFromHistory(key, parsed);
          const merged = mergeTerminalError(parsed, this.terminalErrors.get(key));
          session.setMessages(merged);
          session.setAllFetched(parsed.length < FETCH_BATCH);
        } catch {
          // Fetch failure — start with empty
        }
      }
    }

    // Clear unread
    session.setUnread(false);

    // Reset scroll state
    this.shouldInstantScroll = true;
    this.stickyHint = true;
  }

  async createNewChat(): Promise<void> {
    const newKey = generateSessionKey();
    trackEvent("chat.session_created");

    // Create session in store
    this.store.getOrCreateSession(newKey, {
      updatedAt: Date.now(),
      isLocal: true,
    });
    const session = this.store.sessions.get(newKey)!;
    session.setAllFetched(true);

    // Track as local session
    this.localSessions.set(newKey, { key: newKey, updatedAt: Date.now(), isLocal: true });

    // Switch to it
    this.store.setActiveSessionKey(newKey);

    // Update custom order
    if (this.customOrder) {
      const list = this.store.sessionList;
      this.customOrder = list.map((s) => s.key);
      saveCustomOrder(this.customOrder);
      this.store.setCustomOrder(this.customOrder);
    }

    // Reset scroll state
    this.shouldInstantScroll = true;
    this.stickyHint = true;
  }

  async archiveSession(key: string): Promise<void> {
    if (key === DEFAULT_SESSION_KEY) return;
    trackEvent("chat.session_archived");

    const wasLocal = this.localSessions.has(key);
    this.localSessions.delete(key);

    // Mark archived in store
    const session = this.store.sessions.get(key);
    if (session) {
      session.setArchived(true);
    }
    this.archivedKeys.add(key);

    // Update custom order
    if (this.customOrder) {
      this.customOrder = this.customOrder.filter((k) => k !== key);
      saveCustomOrder(this.customOrder);
      this.store.setCustomOrder(this.customOrder);
    }

    // If archiving the active session, switch to main
    if (this.store.activeSessionKey === key) {
      this.store.setActiveSessionKey(DEFAULT_SESSION_KEY);
      this.store.getOrCreateSession(DEFAULT_SESSION_KEY);
      this.shouldInstantScroll = true;
      this.stickyHint = true;
      // Load history for main if not loaded
      const mainSession = this.store.sessions.get(DEFAULT_SESSION_KEY);
      if (mainSession && mainSession.messages.length === 0 && !mainSession.allFetched && this.client) {
        this.loadHistory();
      }
    }

    // Persist to SQLite if materialized
    if (!wasLocal) {
      updateChatSession(key, { archivedAt: Date.now() }).catch(() => {
        // Revert on failure
        this.archivedKeys.delete(key);
        if (session) session.setArchived(false);
      });
    }
  }

  async restoreSession(key: string): Promise<void> {
    trackEvent("chat.session_restored");
    this.archivedKeys.delete(key);

    const session = this.store.sessions.get(key);
    if (session) {
      session.setArchived(false);
    } else {
      const meta = this.metaMap.get(key);
      this.store.getOrCreateSession(key, {
        derivedTitle: meta?.customTitle ?? null,
        updatedAt: Date.now(),
      });
    }

    updateChatSession(key, { archivedAt: null }).catch(() => {
      this.archivedKeys.add(key);
      const s = this.store.sessions.get(key);
      if (s) s.setArchived(true);
    });

    await this.switchSession(key);
  }

  async renameSession(key: string, title: string | null): Promise<void> {
    const meta = this.metaMap.get(key);
    const updated = { ...meta, key, customTitle: title } as ChatSessionMeta;
    this.metaMap.set(key, updated);

    const session = this.store.sessions.get(key);
    if (session) {
      session.setCustomTitle(title);
    }

    updateChatSession(key, { customTitle: title }).catch(() => {});
  }

  async togglePin(key: string): Promise<void> {
    const meta = this.metaMap.get(key);
    const newPinned = !meta?.pinned;

    const updated = { ...meta, key, pinned: newPinned } as ChatSessionMeta;
    this.metaMap.set(key, updated);

    const session = this.store.sessions.get(key);
    if (session) {
      session.setPinned(newPinned);
    }

    updateChatSession(key, { pinned: newPinned }).catch(() => {});
  }

  reorderSessions(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    this.store.reorderSessions(fromIndex, toIndex);
    const list = this.store.sessionList;
    this.customOrder = list.map((s) => s.key);
    saveCustomOrder(this.customOrder);
  }

  refreshSessions(): void {
    clearTimeout(this.refreshDebounceTimer);
    this.refreshDebounceTimer = setTimeout(() => {
      this.doFetchSessionsList();
    }, REFRESH_DEBOUNCE);
  }

  private async doFetchSessionsList(): Promise<void> {
    const client = this.client;
    if (!client || this.cancelled) return;
    try {
      const result = await client.request<SessionsListResult>("sessions.list", {
        includeDerivedTitles: true,
        includeLastMessage: false,
      });
      if (this.cancelled || !result?.sessions) return;

      const archived = this.archivedKeys;
      const meta = this.metaMap;

      const filtered = result.sessions.filter(
        (s) => !s.spawnedBy && !archived.has(s.key) && !isHiddenSession(s.key),
      );

      const tabs = filtered.map((s) => {
        const m = meta.get(s.key);
        return {
          key: s.key,
          customTitle: m?.customTitle,
          panelTitle: m?.panelTitle,
          displayName: s.displayName,
          derivedTitle: cleanDerivedTitle(s.derivedTitle),
          channel: s.channel ?? s.lastChannel,
          updatedAt: s.updatedAt,
          kind: s.kind,
          pinned: m?.pinned,
          totalTokens: s.totalTokensFresh !== false ? s.totalTokens : undefined,
        } as {
          key: string;
          customTitle?: string;
          panelTitle?: string;
          displayName?: string;
          derivedTitle?: string;
          channel?: string;
          updatedAt?: number;
          kind?: string;
          pinned?: boolean;
          totalTokens?: number;
          isLocal?: boolean;
        };
      });

      // Merge local sessions
      const gatewayKeys = new Set(tabs.map((t) => t.key));
      for (const [lk] of this.localSessions) {
        if (gatewayKeys.has(lk)) {
          this.localSessions.delete(lk);
        }
      }
      for (const [, localTab] of this.localSessions) {
        if (!archived.has(localTab.key)) {
          tabs.push({ ...localTab });
        }
      }

      this.store.setSessions(tabs);
    } catch {
      // Non-fatal
    }
  }

  async fetchGatewaySessions(): Promise<Array<{ key: string; derivedTitle?: string; lastMessagePreview?: string }>> {
    const client = this.client;
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
  }

  markUnread(key: string): void {
    if (key === this.store.activeSessionKey) return;
    // Hidden sessions (CS, internal API) should never appear in the tab list
    if (isHiddenSession(key)) return;
    // Auto-restore archived sessions when they receive new messages
    if (this.archivedKeys.has(key)) {
      this.archivedKeys.delete(key);
      const session = this.store.sessions.get(key);
      if (session) session.setArchived(false);
      updateChatSession(key, { archivedAt: null }).catch(() => {});
    }
    // Ensure session exists then mark unread
    const session = this.store.getOrCreateSession(key);
    session.setUnread(true);
    // If the session is new (wasn't in our list), refresh to get metadata
    this.refreshSessions();
  }

  // ---------------------------------------------------------------------------
  // Chat operations (from ChatPage handlers)
  // ---------------------------------------------------------------------------

  sendMessage(
    text: string,
    thinkingLevel: string,
    entityStore: { providerKeys: Array<{ id: string }> },
  ): void {
    const trimmedText = text.trim();
    const session = this.store.activeSession;
    const pendingImages = [...(session?.pendingImages ?? [])];
    if (!session || (!trimmedText && pendingImages.length === 0)) return;
    if (this.store.connectionState !== "connected" || !this.client) return;

    // Pre-flight: check provider keys
    if (entityStore.providerKeys.length === 0) {
      session.updateMessages((prev) => [
        ...prev,
        { role: "user", text: trimmedText, timestamp: Date.now() },
        { role: "assistant", text: `\u26A0 ${this.t("chat.noProviderError")}`, timestamp: Date.now() },
      ]);
      session.setDraft("");
      return;
    }

    const idempotencyKey = crypto.randomUUID();
    const activeKey = this.store.activeSessionKey;

    // Optimistic: show user message immediately
    const optimisticImages: ChatImage[] | undefined = pendingImages.length > 0
      ? pendingImages.map((img) => ({ data: img.base64, mimeType: img.mimeType }))
      : undefined;
    const sentAt = Date.now();
    session.appendMessage({
      role: "user",
      text: trimmedText,
      timestamp: sentAt,
      images: optimisticImages,
      idempotencyKey,
    });
    if (optimisticImages) {
      saveImages(activeKey, idempotencyKey, sentAt, optimisticImages).catch(() => {});
    }
    // Panel sessions own their tab titles; seed one from the first user message.
    if (!session.customTitle && !session.panelTitle && !session.localTitle && isPanelSessionKey(activeKey) && trimmedText) {
      const autoTitle = buildAutoSessionTitle(trimmedText);
      if (autoTitle) {
        session.setLocalTitle(autoTitle);
        session.setPanelTitle(autoTitle);
        this.persistPanelTitle(activeKey, autoTitle);
      }
    }
    this.shouldInstantScroll = true;
    this.stickyHint = true;
    session.setDraft("");
    session.clearPendingImages();

    const sendRs = this.activeRunState;
    this.terminalErrors.delete(activeKey);
    sendRs.beginLocalRun(idempotencyKey, activeKey);

    session.runState.setLastActivity(Date.now());
    session.runState.setLastAgentStream(null);
    session.runState.setSendStartedAt(Date.now());
    trackEvent("chat.message_sent", { hasAttachment: pendingImages.length > 0 });

    // Build RPC params
    const params: Record<string, unknown> = {
      sessionKey: activeKey,
      message: trimmedText || (pendingImages.length > 0 ? this.t("chat.imageOnlyPlaceholder") : ""),
      idempotencyKey,
    };
    if (pendingImages.length > 0) {
      params.attachments = pendingImages.map((f) => ({
        type: "image" as const,
        mimeType: f.mimeType,
        content: f.base64,
      }));
    }
    if (thinkingLevel) params.thinking = thinkingLevel;

    this.client.request("chat.send", params, 300_000).catch((err) => {
      const raw = formatError(err) || this.t("chat.sendError");
      const errText = localizeError(raw, this.tFn!);
      session.appendMessage({ role: "assistant", text: `\u26A0 ${errText}`, timestamp: Date.now() });
      sendRs.failRun(idempotencyKey);
      this.markRunRecentlyCompleted(activeKey, idempotencyKey);
      this.cleanupTerminalRuns(activeKey);
    });

    this.refreshSessions();
  }

  stopRun(): void {
    if (!this.client) return;
    const activeKey = this.store.activeSessionKey;
    const stopRs = this.activeRunState;
    const targetRunId = stopRs.abortTargetRunId;
    if (!targetRunId) return;
    trackEvent("chat.generation_stopped");
    this.markPendingStopNotice(activeKey, targetRunId);
    this.client.request("chat.abort", {
      sessionKey: activeKey,
      runId: targetRunId,
    }).catch(() => {});
  }

  resetSession(): void {
    if (!this.client || this.store.connectionState !== "connected") return;
    const activeKey = this.store.activeSessionKey;
    const resetRs = this.activeRunState;

    // Abort any active run first
    const targetRunId = resetRs.abortTargetRunId;
    if (targetRunId) {
      this.client.request("chat.abort", {
        sessionKey: activeKey,
        runId: targetRunId,
      }).catch(() => {});
    }

    this.client.request("sessions.reset", { key: activeKey }).then(() => {
      const session = this.store.activeSession;
      if (session) {
        session.setMessages([{
          role: "assistant",
          text: `\uD83D\uDD04 ${this.t("chat.resetCommandFeedback")}`,
          timestamp: Date.now(),
        }]);
      }
      clearImages(activeKey).catch(() => {});
      this.terminalErrors.delete(activeKey);
      this.clearTimersForSession(activeKey);
      this.activeRunState.resetAll();
      const sess = this.store.activeSession;
      if (sess) sess.runState.setLastAgentStream(null);
    }).catch((err) => {
      const errText = formatError(err) || this.t("chat.unknownError");
      const session = this.store.activeSession;
      if (session) {
        session.appendMessage({ role: "assistant", text: `\u26A0 ${errText}`, timestamp: Date.now() });
      }
    });
  }

  resetSessionForOverflow(sessionKey: string): void {
    if (!this.client || this.store.connectionState !== "connected") return;
    this.client.request("sessions.reset", { key: sessionKey }).then(() => {
      const session = this.store.sessions.get(sessionKey);
      if (session) {
        session.setMessages([]);
      }
      clearImages(sessionKey).catch(() => {});
      this.terminalErrors.delete(sessionKey);
      this.clearTimersForSession(sessionKey);
      this.runStateFor(sessionKey).resetAll();
      const sess = this.store.sessions.get(sessionKey);
      if (sess) {
        sess.runState.setLastAgentStream(null);
        sess.runState.setExternalPending(false);
      }
    }).catch((err) => {
      const errText = formatError(err) || this.t("chat.unknownError");
      const session = this.store.sessions.get(sessionKey);
      if (session) {
        session.appendMessage({ role: "assistant", text: `\u26A0 ${errText}`, timestamp: Date.now() });
      }
    });
  }

  pushRunProfileToScope(profileId: string, scopeKey: string, runProfiles: Array<{ id: string }>): void {
    if (!profileId || !runProfiles.find((p) => p.id === profileId)) {
      setRunProfileForScope(scopeKey, null).catch(() => {});
      return;
    }
    setRunProfileForScope(scopeKey, profileId).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Transcript (from useChatTranscript)
  // ---------------------------------------------------------------------------

  async loadHistory(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const activeKey = this.store.activeSessionKey;
    const session = this.store.getOrCreateSession(activeKey);
    this.fetchLimit = FETCH_BATCH;
    this.isFetching = true;

    try {
      const result = await client.request<{
        messages?: Array<{ role?: string; content?: unknown; timestamp?: number; idempotencyKey?: string }>;
      }>("chat.history", { sessionKey: activeKey, limit: FETCH_BATCH });

      let parsed = parseRawMessages(result?.messages);
      // Guard: don't wipe existing messages if gateway returns empty on reconnect
      if (parsed.length === 0 && session.messages.length > 0) return;
      parsed = await restoreImages(activeKey, parsed).catch(() => parsed);
      this.ensurePanelSessionTitleFromHistory(activeKey, parsed);
      session.setAllFetched(parsed.length < FETCH_BATCH);
      this.shouldInstantScroll = true;
      this.stickyHint = true;
      const merged = mergeTerminalError(parsed, this.terminalErrors.get(activeKey));
      session.setMessages(merged);
      session.setVisibleCount(INITIAL_VISIBLE);
    } catch {
      // Non-fatal
    } finally {
      this.isFetching = false;
    }
  }

  async fetchMore(): Promise<void> {
    const client = this.client;
    const session = this.store.activeSession;
    if (!client || !session || session.allFetched || this.isFetching) return;
    this.isFetching = true;
    const oldCount = session.messages.length;
    this.fetchLimit += FETCH_BATCH;

    try {
      const result = await client.request<{
        messages?: Array<{ role?: string; content?: unknown; timestamp?: number; idempotencyKey?: string }>;
      }>("chat.history", {
        sessionKey: this.store.activeSessionKey,
        limit: this.fetchLimit,
      });

      let parsed = parseRawMessages(result?.messages);
      parsed = await restoreImages(this.store.activeSessionKey, parsed).catch(() => parsed);
      this.ensurePanelSessionTitleFromHistory(this.store.activeSessionKey, parsed);

      if (parsed.length < this.fetchLimit || parsed.length <= oldCount) {
        session.setAllFetched(true);
      }

      if (parsed.length > oldCount) {
        const merged = mergeTerminalError(parsed, this.terminalErrors.get(this.store.activeSessionKey));
        session.setMessages(merged);
        session.setVisibleCount(oldCount + PAGE_SIZE);
      }
    } catch {
      // Non-fatal
    } finally {
      this.isFetching = false;
    }
  }
}
