import { types } from "mobx-state-tree";
import { ChatRunStateModel } from "./ChatRunStateModel.js";
import { INITIAL_VISIBLE } from "../../chat-utils.js";
import type { ChatMessage, PendingImage } from "../../chat-utils.js";

/**
 * Per-session MST model — single source of truth for all session-scoped state.
 *
 * Ownership boundaries:
 *   - Session metadata (displayName, derivedTitle, customTitle, etc.): updated by controller from gateway + SQLite
 *   - Chat state (draft, messages, pendingImages, selectedRunProfileId): mutated by controller + ChatPage actions
 *   - Run state (runState): true source of truth for run lifecycle — phase transitions, streaming, flushed offsets
 *
 * NOT in this model (owned elsewhere):
 *   - Chat examples / prompt templates: feature-level settings (useChatExamples hook)
 *   - GatewayChatClient / EventSource / timers: controller-owned side effects
 *   - DOM scroll state: ChatPage local refs
 */
export const ChatSessionModel = types
  .model("ChatSession", {
    key: types.identifier,
    // Session metadata
    displayName: types.maybeNull(types.string),
    derivedTitle: types.maybeNull(types.string),
    channel: types.maybeNull(types.string),
    updatedAt: types.maybeNull(types.number),
    kind: types.maybeNull(types.string),
    pinned: false,
    archived: false,
    unread: false,
    isLocal: false,
    totalTokens: 0,

    // Per-session composer state
    draft: "",
    selectedRunProfileId: "",
    thinkingLevel: "",
    messages: types.array(types.frozen<ChatMessage>()),
    visibleCount: INITIAL_VISIBLE,
    allFetched: false,
    historyLoading: false,
    pendingImages: types.array(types.frozen<PendingImage>()),

    // Custom user-given title (null = use gateway derivedTitle)
    customTitle: types.maybeNull(types.string),

    // Per-session run state
    runState: types.optional(ChatRunStateModel, {}),
  })
  .actions((self) => ({
    setDraft(text: string) {
      self.draft = text;
    },
    setSelectedRunProfileId(id: string) {
      self.selectedRunProfileId = id;
    },
    setThinkingLevel(level: string) {
      self.thinkingLevel = level;
    },
    setMessages(msgs: ChatMessage[]) {
      self.messages.replace(msgs);
    },
    appendMessage(msg: ChatMessage) {
      self.messages.push(msg);
    },
    /**
     * Functional update: apply a transform to the current messages array.
     * Mirrors the React `setMessages(prev => ...)` pattern used throughout
     * the existing codebase.
     */
    updateMessages(fn: (prev: ChatMessage[]) => ChatMessage[]) {
      const next = fn([...self.messages]);
      self.messages.replace(next);
    },
    setVisibleCount(n: number) {
      self.visibleCount = n;
    },
    setAllFetched(v: boolean) {
      self.allFetched = v;
    },
    setHistoryLoading(v: boolean) {
      self.historyLoading = v;
    },
    setUnread(v: boolean) {
      self.unread = v;
    },
    setArchived(v: boolean) {
      self.archived = v;
    },
    setPinned(v: boolean) {
      self.pinned = v;
    },
    setDerivedTitle(t: string | null) {
      self.derivedTitle = t;
    },
    setIsLocal(v: boolean) {
      self.isLocal = v;
    },
    setTotalTokens(n: number) {
      self.totalTokens = n;
    },
    setChannel(c: string | null) {
      self.channel = c;
    },
    setDisplayName(n: string | null) {
      self.displayName = n;
    },
    setUpdatedAt(ts: number | null) {
      self.updatedAt = ts;
    },
    setKind(k: string | null) {
      self.kind = k;
    },
    setPendingImages(imgs: PendingImage[]) {
      self.pendingImages.replace(imgs);
    },
    clearPendingImages() {
      self.pendingImages.clear();
    },
    setCustomTitle(t: string | null) {
      self.customTitle = t;
    },
    /** Bulk metadata update from gateway sessions.list. */
    updateMetadata(fields: {
      displayName?: string | null;
      derivedTitle?: string | null;
      channel?: string | null;
      updatedAt?: number | null;
      kind?: string | null;
      pinned?: boolean;
      totalTokens?: number;
      isLocal?: boolean;
      customTitle?: string | null;
    }) {
      if (fields.displayName !== undefined) self.displayName = fields.displayName;
      if (fields.derivedTitle !== undefined) self.derivedTitle = fields.derivedTitle;
      if (fields.channel !== undefined) self.channel = fields.channel;
      if (fields.updatedAt !== undefined) self.updatedAt = fields.updatedAt;
      if (fields.kind !== undefined) self.kind = fields.kind;
      if (fields.pinned !== undefined) self.pinned = fields.pinned;
      if (fields.totalTokens !== undefined) self.totalTokens = fields.totalTokens;
      if (fields.isLocal !== undefined) self.isLocal = fields.isLocal;
      if (fields.customTitle !== undefined) self.customTitle = fields.customTitle;
    },
  }));
