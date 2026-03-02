import { useState, useEffect, useRef, useCallback } from "react";
import type { GatewayChatClient } from "../../lib/gateway-client.js";
import type { SessionTabInfo, SessionChatState, SessionsListResult } from "./chat-utils.js";
import { DEFAULT_SESSION_KEY, INITIAL_VISIBLE, FETCH_BATCH, parseRawMessages } from "./chat-utils.js";
import { restoreImages } from "../../lib/image-cache.js";
import { fetchChatSessions, updateChatSession } from "../../api/chat-sessions.js";
import type { ChatSessionMeta } from "../../api/chat-sessions.js";

const REFRESH_DEBOUNCE = 2000;
const MAX_CACHED_SESSIONS = 20;

/** Strip EasyClaw prependContext blocks from a derived title. */
const PREPEND_CONTEXT_RE = /---\s+EasyClaw[\s\S]*?---\s+End\s+\w[\w\s]*---/g;
function cleanDerivedTitle(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const cleaned = raw.replace(PREPEND_CONTEXT_RE, "").trim();
  return cleaned || undefined;
}

/**
 * Internal sessions created by EasyClaw subsystems (e.g. rule compilation
 * LLM calls via /v1/chat/completions with `user: "easyclaw-rule-compile"`).
 * The gateway generates session keys like `agent:main:openai-user:easyclaw-rule-compile`.
 */
function isInternalSession(key: string): boolean {
  return key.includes(":openai-user:easyclaw-");
}

/** Load custom tab order from localStorage. */
function loadCustomOrder(): string[] | null {
  try {
    const raw = localStorage.getItem("chat-tab-order");
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore invalid JSON */ }
  return null;
}

/** Save custom tab order to localStorage. */
function saveCustomOrder(order: string[] | null): void {
  try {
    if (order) localStorage.setItem("chat-tab-order", JSON.stringify(order));
    else localStorage.removeItem("chat-tab-order");
  } catch { /* quota exceeded or similar */ }
}

/** Generate a unique session key for a new panel-created chat. */
function generateSessionKey(): string {
  const id = crypto.randomUUID().slice(0, 8);
  return `agent:main:panel-${id}`;
}

export type UseSessionManagerOptions = {
  clientRef: React.RefObject<GatewayChatClient | null>;
  connected: boolean;
  /** Current messages state from ChatPage — used to snapshot into cache on switch. */
  getState: () => Omit<SessionChatState, "lastAccessed">;
  /** Restore state after switching sessions. */
  setState: (state: SessionChatState) => void;
};

export type UseSessionManagerReturn = {
  sessions: SessionTabInfo[];
  activeSessionKey: string;
  unreadKeys: Set<string>;
  switchSession: (key: string) => Promise<void>;
  markRead: (key: string) => void;
  markUnread: (key: string) => void;
  /** Called from ChatPage when the active session key changes externally (e.g. gateway hello). */
  setActiveSessionKey: (key: string) => void;
  /** Create a brand new chat tab and switch to it. */
  createNewChat: () => Promise<void>;
  /** Archive a session (hide from tab bar). */
  archiveSession: (key: string) => Promise<void>;
  /** Toggle pinned state. */
  togglePin: (key: string) => Promise<void>;
  /** Rename a session (custom title). */
  renameSession: (key: string, title: string | null) => Promise<void>;
  /** Restore an archived session (un-archive and switch to it). */
  restoreSession: (key: string) => Promise<void>;
  /** Reorder sessions by moving a tab from one index to another. */
  reorderSessions: (fromIndex: number, toIndex: number) => void;
  /** Trigger a debounced sessions.list refresh (event-driven, replaces polling). */
  refreshSessions: () => void;
};

export function useSessionManager(opts: UseSessionManagerOptions): UseSessionManagerReturn {
  const { clientRef, connected } = opts;
  const getStateRef = useRef(opts.getState);
  getStateRef.current = opts.getState;
  const setStateRef = useRef(opts.setState);
  setStateRef.current = opts.setState;

  const [sessions, setSessions] = useState<SessionTabInfo[]>([]);
  const [activeKey, setActiveKey] = useState(DEFAULT_SESSION_KEY);
  const [unreadKeys, setUnreadKeys] = useState<Set<string>>(new Set());

  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  // Per-session state cache (LRU)
  const cacheRef = useRef<Map<string, SessionChatState>>(new Map());

  // Panel-created sessions not yet materialized on the gateway.
  // These are merged with gateway results during poll so they don't disappear.
  const localSessionsRef = useRef<Map<string, SessionTabInfo>>(new Map());

  // User-defined tab order (persisted in localStorage). When non-null, overrides default sort.
  const customOrderRef = useRef<string[] | null>(loadCustomOrder());

  // Archived keys from SQLite — fetched once, then updated optimistically
  const archivedKeysRef = useRef<Set<string>>(new Set());
  // Chat session metadata from SQLite (for pinned/customTitle)
  const metaMapRef = useRef<Map<string, ChatSessionMeta>>(new Map());

  // Fetch archived keys + metadata from SQLite on mount
  useEffect(() => {
    fetchChatSessions().then((rows) => {
      const archived = new Set<string>();
      const metaMap = new Map<string, ChatSessionMeta>();
      for (const row of rows) {
        metaMap.set(row.key, row);
        if (row.archivedAt != null) archived.add(row.key);
      }
      archivedKeysRef.current = archived;
      metaMapRef.current = metaMap;
    }).catch(() => {});
  }, []);

  // Stable ref for the sessions fetch logic — callable from initial load and debounced refresh.
  const cancelledRef = useRef(false);
  const fetchSessionsListRef = useRef(async () => {
    const client = clientRef.current;
    if (!client || cancelledRef.current) return;
    try {
      const result = await client.request<SessionsListResult>("sessions.list", {
        includeDerivedTitles: true,
        includeLastMessage: false,
      });
      if (cancelledRef.current || !result?.sessions) return;

      const archived = archivedKeysRef.current;
      const meta = metaMapRef.current;

      // Filter out subagent sessions, archived sessions, and internal
      // API-created sessions (rule compilation, etc. via /v1/chat/completions).
      const filtered = result.sessions.filter(
        (s) => !s.spawnedBy && !archived.has(s.key) && !isInternalSession(s.key),
      );

      const tabs: SessionTabInfo[] = filtered.map((s) => {
        const m = meta.get(s.key);
        return {
          key: s.key,
          displayName: s.displayName,
          derivedTitle: m?.customTitle || cleanDerivedTitle(s.derivedTitle),
          channel: s.channel ?? s.lastChannel,
          updatedAt: s.updatedAt,
          kind: s.kind,
          pinned: m?.pinned,
        };
      });

      // Merge local (panel-only) sessions that haven't appeared on gateway yet.
      // Once a local session shows up in gateway results, remove it from localSessionsRef.
      const gatewayKeys = new Set(tabs.map((t) => t.key));
      for (const [lk] of localSessionsRef.current) {
        if (gatewayKeys.has(lk)) {
          localSessionsRef.current.delete(lk);
        }
      }
      for (const [, localTab] of localSessionsRef.current) {
        if (!archived.has(localTab.key)) {
          tabs.push(localTab);
        }
      }

      // Apply custom order if user has reordered tabs, otherwise default sort
      const customOrder = customOrderRef.current;
      if (customOrder && customOrder.length > 0) {
        const orderMap = new Map(customOrder.map((key, i) => [key, i]));
        tabs.sort((a, b) => {
          if (a.key === DEFAULT_SESSION_KEY) return -1;
          if (b.key === DEFAULT_SESSION_KEY) return 1;
          const oa = orderMap.get(a.key);
          const ob = orderMap.get(b.key);
          if (oa !== undefined && ob !== undefined) return oa - ob;
          if (oa !== undefined) return -1;
          if (ob !== undefined) return 1;
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
      } else {
        tabs.sort((a, b) => {
          const pa = a.pinned ? 1 : 0;
          const pb = b.pinned ? 1 : 0;
          if (pa !== pb) return pb - pa;
          if (a.key === DEFAULT_SESSION_KEY) return -1;
          if (b.key === DEFAULT_SESSION_KEY) return 1;
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
      }

      setSessions(tabs);
    } catch {
      // Fetch failure is non-fatal
    }
  });

  // Debounced refresh — event-driven triggers collapse into a single fetch
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshSessions = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchSessionsListRef.current();
    }, REFRESH_DEBOUNCE);
  }, []);

  // Fetch sessions once on connect (replaces 15s polling)
  useEffect(() => {
    if (!connected) return;
    cancelledRef.current = false;
    fetchSessionsListRef.current();
    return () => {
      cancelledRef.current = true;
      clearTimeout(refreshTimerRef.current);
    };
  }, [clientRef, connected]);

  const switchSession = useCallback(async (key: string) => {
    if (key === activeKeyRef.current) return;

    // 1. Snapshot current session state into cache
    const currentState = getStateRef.current();
    cacheRef.current.set(activeKeyRef.current, {
      ...currentState,
      lastAccessed: Date.now(),
    });

    // LRU eviction
    if (cacheRef.current.size > MAX_CACHED_SESSIONS) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of cacheRef.current) {
        if (k === key) continue; // don't evict the target
        if (v.lastAccessed < oldestTime) {
          oldestTime = v.lastAccessed;
          oldestKey = k;
        }
      }
      if (oldestKey) cacheRef.current.delete(oldestKey);
    }

    // 2. Update active key
    setActiveKey(key);
    activeKeyRef.current = key;

    // 3. Restore from cache or fetch
    const cached = cacheRef.current.get(key);
    if (cached) {
      cached.lastAccessed = Date.now();
      setStateRef.current(cached);
    } else {
      // Fetch from gateway
      const freshState: SessionChatState = {
        messages: [],
        streaming: null,
        runId: null,
        draft: "",
        pendingImages: [],
        visibleCount: INITIAL_VISIBLE,
        allFetched: false,
        lastAccessed: Date.now(),
      };

      const client = clientRef.current;
      if (client) {
        try {
          const result = await client.request<{
            messages?: Array<{ role?: string; content?: unknown; timestamp?: number }>;
          }>("chat.history", { sessionKey: key, limit: FETCH_BATCH });

          let parsed = parseRawMessages(result?.messages);
          parsed = await restoreImages(key, parsed).catch(() => parsed);
          freshState.messages = parsed;
          freshState.allFetched = parsed.length < FETCH_BATCH;
        } catch {
          // Fetch failure — start with empty
        }
      }

      cacheRef.current.set(key, freshState);
      setStateRef.current(freshState);
    }

    // Clear unread for the target
    setUnreadKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, [clientRef]);

  const createNewChat = useCallback(async () => {
    const newKey = generateSessionKey();

    // Snapshot current session
    const currentState = getStateRef.current();
    cacheRef.current.set(activeKeyRef.current, {
      ...currentState,
      lastAccessed: Date.now(),
    });

    // Switch to fresh empty state
    setActiveKey(newKey);
    activeKeyRef.current = newKey;

    const freshState: SessionChatState = {
      messages: [],
      streaming: null,
      runId: null,
      draft: "",
      pendingImages: [],
      visibleCount: INITIAL_VISIBLE,
      allFetched: true,
      lastAccessed: Date.now(),
    };
    cacheRef.current.set(newKey, freshState);
    setStateRef.current(freshState);

    // Track as local session — survives poll until materialized on gateway
    const localTab: SessionTabInfo = { key: newKey, updatedAt: Date.now(), isLocal: true };
    localSessionsRef.current.set(newKey, localTab);

    // Optimistically add to sessions list so tab appears immediately
    setSessions((prev) => {
      const next = [...prev, localTab];
      // Update custom order if it exists
      if (customOrderRef.current) {
        customOrderRef.current = next.map((s) => s.key);
        saveCustomOrder(customOrderRef.current);
      }
      return next;
    });
  }, []);

  const archiveSession = useCallback(async (key: string) => {
    // Don't archive the main session
    if (key === DEFAULT_SESSION_KEY) return;

    // Clean up local session tracking if it was panel-only
    const wasLocal = localSessionsRef.current.has(key);
    localSessionsRef.current.delete(key);

    // Optimistic: remove from sessions list and custom order
    archivedKeysRef.current = new Set([...archivedKeysRef.current, key]);
    setSessions((prev) => prev.filter((s) => s.key !== key));
    if (customOrderRef.current) {
      customOrderRef.current = customOrderRef.current.filter((k) => k !== key);
      saveCustomOrder(customOrderRef.current);
    }

    // If archiving the active session, switch to main
    if (activeKeyRef.current === key) {
      setActiveKey(DEFAULT_SESSION_KEY);
      activeKeyRef.current = DEFAULT_SESSION_KEY;
      // Restore main session from cache or empty
      const cached = cacheRef.current.get(DEFAULT_SESSION_KEY);
      if (cached) {
        cached.lastAccessed = Date.now();
        setStateRef.current(cached);
      } else {
        setStateRef.current({
          messages: [],
          streaming: null,
          runId: null,
          draft: "",
          pendingImages: [],
          visibleCount: INITIAL_VISIBLE,
          allFetched: false,
          lastAccessed: Date.now(),
        });
      }
    }

    // Only persist to SQLite if the session was materialized (not local-only)
    if (!wasLocal) {
      updateChatSession(key, { archivedAt: Date.now() }).catch(() => {
        // Revert on failure
        archivedKeysRef.current = new Set(
          [...archivedKeysRef.current].filter((k) => k !== key),
        );
      });
    }
  }, []);

  const togglePin = useCallback(async (key: string) => {
    const meta = metaMapRef.current.get(key);
    const newPinned = !meta?.pinned;

    // Optimistic update
    const updated = { ...meta, key, pinned: newPinned } as ChatSessionMeta;
    metaMapRef.current.set(key, updated);
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.key === key ? { ...s, pinned: newPinned } : s,
      );
      // Only re-sort if no custom order (user hasn't manually reordered)
      if (!customOrderRef.current) {
        next.sort((a, b) => {
          const pa = a.pinned ? 1 : 0;
          const pb = b.pinned ? 1 : 0;
          if (pa !== pb) return pb - pa;
          if (a.key === DEFAULT_SESSION_KEY) return -1;
          if (b.key === DEFAULT_SESSION_KEY) return 1;
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
      }
      return next;
    });

    updateChatSession(key, { pinned: newPinned }).catch(() => {});
  }, []);

  const renameSession = useCallback(async (key: string, title: string | null) => {
    // Optimistic update
    const meta = metaMapRef.current.get(key);
    const updated = { ...meta, key, customTitle: title } as ChatSessionMeta;
    metaMapRef.current.set(key, updated);
    setSessions((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, derivedTitle: title || s.derivedTitle } : s,
      ),
    );

    updateChatSession(key, { customTitle: title }).catch(() => {});
  }, []);

  const markRead = useCallback((key: string) => {
    setUnreadKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const markUnread = useCallback((key: string) => {
    // Don't mark active session as unread
    if (key === activeKeyRef.current) return;
    setUnreadKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const restoreSession = useCallback(async (key: string) => {
    // Remove from archived set
    archivedKeysRef.current = new Set(
      [...archivedKeysRef.current].filter((k) => k !== key),
    );

    // Optimistically add to sessions list so tab appears immediately
    const meta = metaMapRef.current.get(key);
    setSessions((prev) => {
      if (prev.some((s) => s.key === key)) return prev;
      return [...prev, {
        key,
        derivedTitle: meta?.customTitle || undefined,
        updatedAt: Date.now(),
      }];
    });

    // Persist un-archive to SQLite
    updateChatSession(key, { archivedAt: null }).catch(() => {
      // Revert on failure
      archivedKeysRef.current = new Set([...archivedKeysRef.current, key]);
    });

    // Switch to the restored session
    await switchSession(key);
  }, [switchSession]);

  const reorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setSessions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const order = next.map((s) => s.key);
      customOrderRef.current = order;
      saveCustomOrder(order);
      return next;
    });
  }, []);

  const setActiveSessionKey = useCallback((key: string) => {
    setActiveKey(key);
    activeKeyRef.current = key;
  }, []);

  return {
    sessions,
    activeSessionKey: activeKey,
    unreadKeys,
    switchSession,
    markRead,
    markUnread,
    setActiveSessionKey,
    createNewChat,
    archiveSession,
    togglePin,
    renameSession,
    restoreSession,
    reorderSessions,
    refreshSessions,
  };
}
