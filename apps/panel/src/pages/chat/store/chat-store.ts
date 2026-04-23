import { types, cast, type Instance } from "mobx-state-tree";
import { ChatSessionModel } from "./models/ChatSessionModel.js";
import { DEFAULT_SESSION_KEY, INITIAL_VISIBLE, isHiddenSession } from "../chat-utils.js";
import type { SessionTabInfo } from "../chat-utils.js";

// ---------------------------------------------------------------------------
// Store model
// ---------------------------------------------------------------------------

export const ChatStoreModel = types
  .model("ChatStore", {
    activeSessionKey: DEFAULT_SESSION_KEY,
    connectionState: types.optional(
      types.enumeration("ConnectionState", ["connecting", "connected", "disconnected"]),
      "connecting",
    ),
    agentName: types.maybeNull(types.string),
    sessions: types.map(ChatSessionModel),
    /** User-defined tab order persisted via appSettings (SQLite + SSE). Null = default sort. */
    customOrder: types.maybeNull(types.array(types.string)),
  })
  .views((self) => ({
    /** The currently active session model, or undefined if not yet created. */
    get activeSession() {
      return self.sessions.get(self.activeSessionKey);
    },

    /**
     * Ordered, filtered list of sessions for the tab bar.
     * Excludes archived sessions. Applies custom order or default sort.
     */
    get sessionList(): SessionTabInfo[] {
      const tabs: SessionTabInfo[] = [];
      for (const [, session] of self.sessions) {
        if (session.archived) continue;
        if (isHiddenSession(session.key)) continue;
        tabs.push({
          key: session.key,
          customTitle: session.customTitle ?? undefined,
          panelTitle: session.panelTitle ?? session.localTitle ?? undefined,
          displayName: session.displayName ?? undefined,
          derivedTitle: session.derivedTitle ?? undefined,
          channel: session.channel ?? undefined,
          updatedAt: session.updatedAt ?? undefined,
          kind: session.kind ?? undefined,
          pinned: session.pinned,
          isLocal: session.isLocal,
          totalTokens: session.totalTokens,
        });
      }

      const order = self.customOrder;
      if (order && order.length > 0) {
        const orderMap = new Map(order.map((key, i) => [key, i]));
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
      return tabs;
    },

    /** Set of session keys that have unread messages. */
    get unreadKeys(): Set<string> {
      const keys = new Set<string>();
      for (const [, session] of self.sessions) {
        if (session.unread) keys.add(session.key);
      }
      return keys;
    },
  }))
  .actions((self) => ({
    setActiveSessionKey(key: string) {
      self.activeSessionKey = key;
    },
    setConnectionState(state: "connecting" | "connected" | "disconnected") {
      self.connectionState = state;
    },
    setAgentName(name: string | null) {
      self.agentName = name;
    },

    /**
     * Get an existing session or create a new one with defaults.
     * Always returns the session model instance.
     */
    getOrCreateSession(key: string, defaults?: {
      displayName?: string | null;
      derivedTitle?: string | null;
      panelTitle?: string | null;
      channel?: string | null;
      updatedAt?: number | null;
      kind?: string | null;
      pinned?: boolean;
      isLocal?: boolean;
      totalTokens?: number;
    }): Instance<typeof ChatSessionModel> {
      let session = self.sessions.get(key);
      if (!session) {
        self.sessions.put({
          key,
          displayName: defaults?.displayName ?? null,
          derivedTitle: defaults?.derivedTitle ?? null,
          panelTitle: defaults?.panelTitle ?? null,
          channel: defaults?.channel ?? null,
          updatedAt: defaults?.updatedAt ?? null,
          kind: defaults?.kind ?? null,
          pinned: defaults?.pinned ?? false,
          isLocal: defaults?.isLocal ?? false,
          totalTokens: defaults?.totalTokens ?? 0,
          visibleCount: INITIAL_VISIBLE,
        });
        session = self.sessions.get(key)!;
      }
      return session;
    },

    removeSession(key: string) {
      self.sessions.delete(key);
    },

    /**
     * Bulk update from gateway sessions.list: reconcile the sessions map
     * with the authoritative list of tabs. Creates missing sessions,
     * updates metadata on existing ones, and removes sessions not in the
     * list (unless they're local or the active session).
     */
    setSessions(tabs: SessionTabInfo[]) {
      const tabKeys = new Set(tabs.map((t) => t.key));
      for (const tab of tabs) {
        const existing = self.sessions.get(tab.key);
        if (existing) {
          existing.updateMetadata({
            displayName: tab.displayName ?? null,
            derivedTitle: tab.derivedTitle ?? null,
            panelTitle: tab.panelTitle ?? null,
            channel: tab.channel ?? null,
            updatedAt: tab.updatedAt ?? null,
            kind: tab.kind ?? null,
            pinned: tab.pinned,
            totalTokens: tab.totalTokens,
            isLocal: tab.isLocal,
          });
        } else {
          self.sessions.put({
            key: tab.key,
            displayName: tab.displayName ?? null,
            derivedTitle: tab.derivedTitle ?? null,
            panelTitle: tab.panelTitle ?? null,
            channel: tab.channel ?? null,
            updatedAt: tab.updatedAt ?? null,
            kind: tab.kind ?? null,
            pinned: tab.pinned ?? false,
            isLocal: tab.isLocal ?? false,
            totalTokens: tab.totalTokens ?? 0,
            visibleCount: INITIAL_VISIBLE,
          });
        }
      }
      // Remove sessions not in the refreshed list, unless:
      // - It's the active session (user is looking at it)
      // - It's a local panel-created session (not yet on gateway)
      // - It has an active run (don't lose state mid-run)
      for (const [key, session] of self.sessions) {
        if (tabKeys.has(key)) continue;
        if (key === self.activeSessionKey) continue;
        if (session.isLocal) continue;
        if (session.archived) continue; // keep archived sessions
        if (session.runState.isActive) continue;
        self.sessions.delete(key);
      }
    },

    setCustomOrder(order: string[] | null) {
      self.customOrder = order ? cast(order) : null;
    },

    reorderSessions(fromIndex: number, toIndex: number) {
      if (fromIndex === toIndex) return;
      const list = self.sessionList;
      const keys = list.map((s) => s.key);
      const [moved] = keys.splice(fromIndex, 1);
      keys.splice(toIndex, 0, moved);
      self.customOrder = cast(keys);
    },
  }));

// ---------------------------------------------------------------------------
// Factory + type export
// ---------------------------------------------------------------------------

export type IChatStore = Instance<typeof ChatStoreModel>;

/** Create a fresh ChatStore instance (one per ChatStoreProvider mount). */
export function createChatStore(): IChatStore {
  return ChatStoreModel.create({
    activeSessionKey: DEFAULT_SESSION_KEY,
    sessions: {},
  });
}
