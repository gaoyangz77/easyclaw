import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { SessionTabInfo } from "./chat-utils.js";
import { DEFAULT_SESSION_KEY } from "./chat-utils.js";
import type { ChatSessionMeta } from "../../api/chat-sessions.js";
import { fetchChatSessions, deleteChatSession } from "../../api/chat-sessions.js";

/** Minimal gateway session info for merging into archived dropdown. */
export type GatewaySessionInfo = {
  key: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
};

export type SessionTabBarProps = {
  sessions: SessionTabInfo[];
  activeSessionKey: string;
  unreadKeys: Set<string>;
  onSwitchSession: (key: string) => void;
  onNewChat: () => void;
  onArchiveSession: (key: string) => void;
  onRenameSession: (key: string, title: string | null) => void;
  onRestoreSession: (key: string) => void;
  onReorderSession: (fromIndex: number, toIndex: number) => void;
  /** Optional: fetch gateway sessions for content-level search in archived dropdown. */
  fetchGatewaySessions?: () => Promise<GatewaySessionInfo[]>;
};

/** Abbreviate a raw session key for display: take the last segment. */
function abbreviateKey(key: string): string {
  const parts = key.split(":");
  return parts[parts.length - 1] ?? key;
}

/** Derive the display label for a session tab. */
function tabLabel(session: SessionTabInfo, t: (key: string) => string): string {
  if (session.key === DEFAULT_SESSION_KEY) return t("chat.sessionMain");
  if (session.isLocal) return t("chat.newSessionTitle");
  if (session.derivedTitle) return session.derivedTitle;
  if (session.displayName) return session.displayName;
  const abbr = abbreviateKey(session.key);
  return abbr || t("chat.sessionUntitled");
}

/** Known channel ids for i18n key mapping. */
const KNOWN_CHANNELS = new Set([
  "telegram", "feishu", "lark", "wecom", "wechat", "whatsapp",
  "discord", "slack", "signal", "imessage", "webchat", "line",
  "googlechat", "matrix", "msteams", "mattermost",
]);

/** Capitalize first letter for building i18n keys like "channelTelegram". */
function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact channel badge shown on session tabs. */
function ChannelBadge({ channel }: { channel: string }) {
  const { t } = useTranslation();
  const key = channel.toLowerCase();
  const isKnown = KNOWN_CHANNELS.has(key);
  const shortLabel = isKnown
    ? t(`chat.channel${capitalizeFirst(key)}`)
    : channel.slice(0, 2).toUpperCase();
  const tooltip = isKnown
    ? t(`chat.channelTooltip${capitalizeFirst(key)}`)
    : channel;
  return (
    <span className="chat-tab-channel-badge" title={tooltip}>
      {shortLabel}
    </span>
  );
}

/** Inline SVG pin icon — small, subtle, no emoji. */
function PinIcon() {
  return (
    <svg className="chat-tab-pin-icon" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.828 1.172a2 2 0 0 1 2.828 0L14.828 3.343a2 2 0 0 1 0 2.828l-2.121 2.122L11 12l-3-3-4.243 4.243M6 10l-2.707 2.707" />
      <path d="M7.05 4.929L11.07 8.95" />
    </svg>
  );
}

/** Inline rename input that appears on double-click. */
function InlineRenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = inputRef.current?.value.trim() ?? "";
      onConfirm(val || initialValue);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  function handleBlur() {
    const val = inputRef.current?.value.trim() ?? "";
    onConfirm(val || initialValue);
  }

  return (
    <input
      ref={inputRef}
      className="chat-tab-rename-input"
      defaultValue={initialValue}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      maxLength={60}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

/** Format a timestamp for display in the archived list. */
function formatArchivedTime(ts: number, locale: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return locale.startsWith("zh")
      ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
      : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (diffDays === 1) {
    return locale.startsWith("zh") ? "昨天" : "Yesterday";
  }
  if (diffDays < 7) {
    return locale.startsWith("zh") ? `${diffDays}天前` : `${diffDays}d ago`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  if (locale.startsWith("zh")) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Merged archived item: SQLite metadata + optional gateway data. */
type ArchivedItem = ChatSessionMeta & {
  derivedTitle?: string;
  lastMessagePreview?: string;
};

/** Swipeable archived item — swipe left to reveal delete button.
 *  Supports both pointer drag and Mac trackpad two-finger horizontal scroll. */
function SwipeableArchivedItem({
  item,
  onRestore,
  onDelete,
  onClose,
}: {
  item: ArchivedItem;
  onRestore: (key: string) => void;
  onDelete: (key: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [offsetX, setOffsetX] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerIdRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const DELETE_THRESHOLD = 60;
  const DRAG_START_THRESHOLD = 5;

  /** Snap to open or closed with transition. */
  function snapOffset() {
    setSnapping(true);
    setOffsetX((prev) => (prev < -DELETE_THRESHOLD / 2 ? -DELETE_THRESHOLD : 0));
    // Remove transition class after animation completes
    setTimeout(() => setSnapping(false), 220);
  }

  // --- Pointer drag (mouse click-drag / touch) ---
  function handlePointerDown(e: React.PointerEvent) {
    startXRef.current = e.clientX;
    draggingRef.current = false;
    pointerIdRef.current = e.pointerId;
    targetRef.current = e.currentTarget as HTMLElement;
    setSnapping(false);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (pointerIdRef.current == null) return;
    const dx = e.clientX - startXRef.current;
    if (!draggingRef.current) {
      if (Math.abs(dx) < DRAG_START_THRESHOLD) return;
      draggingRef.current = true;
      targetRef.current?.setPointerCapture(e.pointerId);
    }
    setOffsetX(Math.max(-DELETE_THRESHOLD, Math.min(0, dx)));
  }

  function handlePointerUp() {
    pointerIdRef.current = null;
    targetRef.current = null;
    if (draggingRef.current) {
      draggingRef.current = false;
      snapOffset();
    }
  }

  // --- Trackpad two-finger horizontal scroll (wheel) ---
  // Directly map deltaX to offset for smooth 1:1 trackpad feel.
  function handleWheel(e: React.WheelEvent) {
    if (e.deltaX === 0) return;
    e.stopPropagation();
    setSnapping(false);

    setOffsetX((prev) => {
      const next = prev - e.deltaX;
      return Math.max(-DELETE_THRESHOLD, Math.min(0, next));
    });

    // After scrolling momentum stops, snap to open or closed
    clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(snapOffset, 200);
  }

  useEffect(() => () => clearTimeout(wheelTimerRef.current), []);

  const displayTitle = item.customTitle || item.derivedTitle || abbreviateKey(item.key);
  const revealed = offsetX <= -DELETE_THRESHOLD / 2;

  return (
    <div className="chat-archived-swipe-wrap">
      <div
        className={`chat-archived-swipe-content${snapping ? " snapping" : ""}`}
        style={{ transform: `translateX(${offsetX}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <button
          className="chat-archived-item"
          onClick={() => {
            if (!revealed) {
              onRestore(item.key);
              onClose();
            }
          }}
          title={item.key}
        >
          <span className="chat-archived-item-title">
            {displayTitle}
          </span>
          {item.lastMessagePreview && (
            <span className="chat-archived-item-preview">
              {item.lastMessagePreview}
            </span>
          )}
          <span className="chat-archived-item-meta">
            {item.archivedAt
              ? `${t("chat.archivedAt")} ${formatArchivedTime(item.archivedAt, i18n.language)}`
              : abbreviateKey(item.key)}
            {item.customTitle && item.derivedTitle ? ` · ${item.derivedTitle}` : ""}
            {(item.customTitle || item.derivedTitle) ? ` · ${abbreviateKey(item.key)}` : ""}
          </span>
        </button>
      </div>
      <button
        className="chat-archived-delete-btn"
        onClick={() => onDelete(item.key)}
        title={t("chat.deleteSession")}
      >
        {t("chat.deleteSession")}
      </button>
    </div>
  );
}

/** Archived sessions dropdown with search and click-to-restore. */
function ArchivedDropdown({
  onRestore,
  onClose,
  fetchGatewaySessions,
}: {
  onRestore: (key: string) => void;
  onClose: () => void;
  fetchGatewaySessions?: () => Promise<GatewaySessionInfo[]>;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Fetch both SQLite metadata and gateway session data in parallel
    const sqliteP = fetchChatSessions({ archived: true });
    const gatewayP = fetchGatewaySessions?.() ?? Promise.resolve([]);

    Promise.all([sqliteP, gatewayP])
      .then(([rows, gatewaySessions]) => {
        // Build a lookup from gateway data
        const gwMap = new Map<string, GatewaySessionInfo>();
        for (const gs of gatewaySessions) gwMap.set(gs.key, gs);

        // Merge: archived sessions from SQLite enriched with gateway data
        const archived: ArchivedItem[] = rows
          .filter((r) => r.archivedAt != null)
          .map((r) => {
            const gw = gwMap.get(r.key);
            return {
              ...r,
              derivedTitle: gw?.derivedTitle,
              lastMessagePreview: gw?.lastMessagePreview,
            };
          })
          .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
        setItems(archived);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [fetchGatewaySessions]);

  // Auto-focus search input on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleDelete = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
    deleteChatSession(key).catch(() => {});
  }, []);

  const lowerQuery = query.toLowerCase();
  const filtered = query
    ? items.filter((item) => {
        const title = item.customTitle || "";
        const derived = item.derivedTitle || "";
        const preview = item.lastMessagePreview || "";
        const key = item.key;
        return (
          title.toLowerCase().includes(lowerQuery) ||
          derived.toLowerCase().includes(lowerQuery) ||
          preview.toLowerCase().includes(lowerQuery) ||
          key.toLowerCase().includes(lowerQuery)
        );
      })
    : items;

  return (
    <div className="chat-archived-dropdown" ref={dropdownRef}>
      <div className="chat-archived-header">{t("chat.archivedSessions")}</div>
      <div className="chat-archived-search">
        <input
          ref={searchRef}
          type="text"
          placeholder={t("chat.searchArchived")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {loading ? (
        <div className="chat-archived-empty">{t("common.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="chat-archived-empty">
          {query ? t("chat.noSearchResults") : t("chat.noArchivedSessions")}
        </div>
      ) : (
        <div className="chat-archived-list">
          {filtered.map((item) => (
            <SwipeableArchivedItem
              key={item.key}
              item={item}
              onRestore={onRestore}
              onDelete={handleDelete}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Compute the drop index based on pointer position and tab rects. */
function computeDropIndex(pointerX: number, rects: DOMRect[]): number {
  let bestIndex = 1;
  let bestDist = Infinity;
  for (let i = 1; i < rects.length; i++) {
    const center = rects[i].left + rects[i].width / 2;
    const dist = Math.abs(pointerX - center);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return Math.max(1, bestIndex);
}

const DRAG_THRESHOLD = 5;

export function SessionTabBar({
  sessions, activeSessionKey, unreadKeys,
  onSwitchSession, onNewChat, onArchiveSession, onRenameSession, onRestoreSession,
  onReorderSession, fetchGatewaySessions,
}: SessionTabBarProps) {
  const { t } = useTranslation();
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Drag-to-reorder state
  const [dragState, setDragState] = useState<{
    dragIndex: number;
    currentIndex: number;
    offsetX: number;
  } | null>(null);
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    index: number;
    button: HTMLElement;
  } | null>(null);
  const tabRectsRef = useRef<DOMRect[]>([]);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const newBtnRectRef = useRef<DOMRect | null>(null);
  const justDraggedRef = useRef(false);
  // Synchronous mirrors so pointer handlers don't depend on async React state
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<{ dragIndex: number; currentIndex: number } | null>(null);

  // Scroll the active tab into view when it changes
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeSessionKey]);

  const handleDoubleClick = useCallback((key: string) => {
    if (key === DEFAULT_SESSION_KEY) return;
    setRenamingKey(key);
  }, []);

  const handleRenameConfirm = useCallback((key: string, oldLabel: string, newValue: string) => {
    setRenamingKey(null);
    if (newValue !== oldLabel) {
      onRenameSession(key, newValue);
    }
  }, [onRenameSession]);

  const handleRenameCancel = useCallback(() => {
    setRenamingKey(null);
  }, []);

  // --- Drag-to-reorder pointer handlers ---
  const handleTabPointerDown = useCallback((e: React.PointerEvent, index: number) => {
    // Main tab (index 0) cannot be dragged; skip during rename
    if (index === 0 || renamingKey === sessions[index]?.key) return;
    dragStartRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      index,
      button: e.currentTarget as HTMLElement,
    };
  }, [renamingKey, sessions]);

  const handleTabPointerMove = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!start || e.pointerId !== start.pointerId) return;

    const dx = e.clientX - start.startX;

    if (!isDraggingRef.current) {
      // Not yet dragging — check threshold
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      // Set flag synchronously to prevent re-entering this branch
      isDraggingRef.current = true;
      // Initiate drag: snapshot tab rects and + button rect
      const container = scrollContainerRef.current;
      if (!container) return;
      const tabs = container.querySelectorAll(".chat-session-tab");
      tabRectsRef.current = Array.from(tabs).map((el) => el.getBoundingClientRect());
      newBtnRectRef.current = newBtnRef.current?.getBoundingClientRect() ?? null;
      // Capture on the button element (not e.target which may be a child)
      start.button.setPointerCapture(e.pointerId);
      dragStateRef.current = { dragIndex: start.index, currentIndex: start.index };
      setDragState({ dragIndex: start.index, currentIndex: start.index, offsetX: dx });
    } else {
      // Active drag — update offset and compute drop position
      const dropIndex = computeDropIndex(e.clientX, tabRectsRef.current);
      dragStateRef.current = { dragIndex: start.index, currentIndex: dropIndex };
      setDragState({ dragIndex: start.index, currentIndex: dropIndex, offsetX: dx });
    }
  }, []);

  const handleTabPointerUp = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!start || e.pointerId !== start.pointerId) { dragStartRef.current = null; return; }

    if (isDraggingRef.current) {
      const ds = dragStateRef.current;
      // Commit reorder
      if (ds && ds.dragIndex !== ds.currentIndex) {
        onReorderSession(ds.dragIndex, ds.currentIndex);
        justDraggedRef.current = true;
        requestAnimationFrame(() => { justDraggedRef.current = false; });
      }
      setDragState(null);
      dragStateRef.current = null;
      isDraggingRef.current = false;
      try { start.button.releasePointerCapture(e.pointerId); } catch {}
    }
    dragStartRef.current = null;
  }, [onReorderSession]);

  const handleTabPointerCancel = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (isDraggingRef.current) {
      setDragState(null);
      dragStateRef.current = null;
      isDraggingRef.current = false;
      try { start?.button.releasePointerCapture(e.pointerId); } catch {}
    }
  }, []);

  if (sessions.length === 0) return null;

  return (
    <div className="chat-session-tabs">
      <div className="chat-session-tabs-scroll" ref={scrollContainerRef}>
        {sessions.map((session, index) => {
          const isActive = session.key === activeSessionKey;
          const isUnread = unreadKeys.has(session.key);
          const isMain = session.key === DEFAULT_SESSION_KEY;
          const isRenaming = renamingKey === session.key;
          const label = tabLabel(session, t);
          const isDragging = dragState?.dragIndex === index;

          // Compute visual shift for non-dragged tabs during drag
          let shiftX = 0;
          if (dragState && !isDragging) {
            const { dragIndex, currentIndex } = dragState;
            if (dragIndex < currentIndex && index > dragIndex && index <= currentIndex) {
              shiftX = -(tabRectsRef.current[dragIndex]?.width ?? 0);
            } else if (dragIndex > currentIndex && index >= currentIndex && index < dragIndex) {
              shiftX = tabRectsRef.current[dragIndex]?.width ?? 0;
            }
          }

          const classes = [
            "chat-session-tab",
            isActive ? "chat-session-tab-active" : "",
            isUnread ? "chat-session-tab-unread" : "",
            session.pinned ? "chat-session-tab-pinned" : "",
            isDragging ? "chat-session-tab-dragging" : "",
            (!isDragging && shiftX !== 0) ? "chat-session-tab-shifting" : "",
          ].filter(Boolean).join(" ");

          const dragTransform = isDragging
            ? `translateX(${dragState!.offsetX}px)`
            : shiftX !== 0 ? `translateX(${shiftX}px)` : undefined;

          return (
            <button
              key={session.key}
              ref={isActive ? activeTabRef : undefined}
              className={classes}
              style={dragTransform ? { transform: dragTransform } : undefined}
              onClick={() => { if (!justDraggedRef.current) onSwitchSession(session.key); }}
              onDoubleClick={() => handleDoubleClick(session.key)}
              onPointerDown={(e) => handleTabPointerDown(e, index)}
              onPointerMove={handleTabPointerMove}
              onPointerUp={handleTabPointerUp}
              onPointerCancel={handleTabPointerCancel}
              title={session.key}
            >
              {session.pinned && <PinIcon />}
              {session.channel && !isMain && <ChannelBadge channel={session.channel} />}
              {isRenaming ? (
                <InlineRenameInput
                  initialValue={label}
                  onConfirm={(v) => handleRenameConfirm(session.key, label, v)}
                  onCancel={handleRenameCancel}
                />
              ) : (
                <span className="chat-session-tab-label">{label}</span>
              )}
              {!isMain && !isRenaming && (
                <span
                  className="chat-session-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveSession(session.key);
                  }}
                  title={t("chat.archiveSession")}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
        {(() => {
          // Compute + button shift during drag to stay after the rightmost visual tab
          let newBtnShift = 0;
          if (dragState) {
            const { dragIndex, currentIndex, offsetX } = dragState;
            const lastIndex = sessions.length - 1;
            // Shift with the last tab to fill the gap left by the dragged tab
            if (lastIndex !== dragIndex) {
              if (dragIndex < currentIndex && lastIndex > dragIndex && lastIndex <= currentIndex) {
                newBtnShift = -(tabRectsRef.current[dragIndex]?.width ?? 0);
              } else if (dragIndex > currentIndex && lastIndex >= currentIndex && lastIndex < dragIndex) {
                newBtnShift = tabRectsRef.current[dragIndex]?.width ?? 0;
              }
            }
            // If the dragged tab's visual right edge goes past the + button, push + further
            const dragRect = tabRectsRef.current[dragIndex];
            const btnRect = newBtnRectRef.current;
            if (dragRect && btnRect) {
              const dragVisualRight = dragRect.right + offsetX;
              const plusVisualLeft = btnRect.left + newBtnShift;
              if (dragVisualRight > plusVisualLeft) {
                newBtnShift += dragVisualRight - plusVisualLeft;
              }
            }
          }
          return (
            <button
              className="chat-session-tab-new-btn"
              onClick={onNewChat}
              title={t("chat.newSession")}
              ref={newBtnRef}
              style={newBtnShift !== 0 ? { transform: `translateX(${newBtnShift}px)` } : undefined}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M7 2v10M2 7h10" />
              </svg>
            </button>
          );
        })()}
      </div>

      <div className="chat-session-tabs-actions">
        <div className="chat-archived-trigger-wrap">
          <button
            className="chat-session-tab-action-btn"
            onClick={() => setShowArchived((v) => !v)}
            title={t("chat.archivedSessions")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="12" height="4" rx="1" />
              <path d="M2 5v7a1 1 0 001 1h8a1 1 0 001-1V5" />
              <path d="M5.5 8h3" />
            </svg>
          </button>
          {showArchived && (
            <ArchivedDropdown
              onRestore={onRestoreSession}
              onClose={() => setShowArchived(false)}
              fetchGatewaySessions={fetchGatewaySessions}
            />
          )}
        </div>
      </div>
    </div>
  );
}
