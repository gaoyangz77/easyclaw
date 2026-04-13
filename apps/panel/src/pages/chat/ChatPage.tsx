import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { observer } from "mobx-react-lite";
import { useRuntimeStatus } from "../../store/RuntimeStatusProvider.js";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import { Modal } from "../../components/modals/Modal.js";
import { ChatStoreProvider, useChatStore, useChatController } from "./ChatStoreProvider.js";
import { ChatPreferenceStoreProvider } from "./ChatPreferenceStoreProvider.js";
import { SessionTabBar } from "./SessionTabBar.js";
import { ChatInputArea } from "./ChatInputArea.js";
import { ChatMessageList } from "./components/ChatMessageList.js";
import { ChatStatusBar } from "./components/ChatStatusBar.js";
import { ChatExamples } from "./components/ChatExamples.js";
import { ChatResetModal } from "./components/ChatResetModal.js";
import { ChatContextOverflowModal } from "./components/ChatContextOverflowModal.js";
import { useChatExamples } from "./hooks/useChatExamples.js";
import { useChatModelControls } from "./hooks/useChatModelControls.js";
import type { GatewaySessionInfo } from "./SessionTabBar.js";
import { PAGE_SIZE } from "./chat-utils.js";
import "./ChatPage.css";

/**
 * Inner component that consumes the ChatStore + ChatGatewayController
 * and composes all sub-components. Wrapped with observer() for MobX reactivity.
 */
const ChatPageInner = observer(function ChatPageInner({
  onAgentNameChange,
}: {
  onAgentNameChange?: (name: string | null) => void;
}) {
  const { t } = useTranslation();
  const store = useChatStore();
  const controller = useChatController();
  const runtimeStatus = useRuntimeStatus();
  const entityStore = useEntityStore();
  const runProfiles = entityStore.allRunProfiles;

  // --- Wire translation + callbacks into controller (via effects, not render) ---
  useEffect(() => { controller.setTranslation(t); }, [controller, t]);
  useEffect(() => {
    controller.setOnAgentNameChange(onAgentNameChange ?? null);
  }, [controller, onAgentNameChange]);

  // Chat display settings
  const showAgentEvents = runtimeStatus.appSettings.chatShowAgentEvents;
  const preserveToolEvents = runtimeStatus.appSettings.chatPreserveToolEvents;
  const collapseMessages = runtimeStatus.appSettings.chatCollapseMessages;

  // --- Local UI state (not in store) ---
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Scroll refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);

  // --- Chat examples (feature-level settings, not session state) ---
  const examples = useChatExamples();

  // Active session is guaranteed by controller constructor (Change C)
  const session = store.activeSession!;

  // --- Read reactive state from store ---
  const messages = [...session.messages];
  const visibleCount = session.visibleCount;
  const allFetched = session.allFetched;
  const draft = session.draft;
  const selectedRunProfileId = session.selectedRunProfileId;
  const connectionState = store.connectionState;
  const agentName = store.agentName;
  const runState = session.runState;
  const runId = runState.localRunId;
  const streaming = runState.displayStreaming;
  const pendingImages = [...session.pendingImages];

  // --- Model controls ---
  const sessionKeyRef = useRef(store.activeSessionKey);
  sessionKeyRef.current = store.activeSessionKey;

  const modelControls = useChatModelControls({
    sessionKeyRef,
    connectionState,
    sessions: store.sessionList,
    activeSessionKey: store.activeSessionKey,
    onOverflowClear: () => controller.resetSessionForOverflow(store.activeSessionKey),
  });

  // --- Background history refresh on session switch ---
  const prevActiveKeyRef = useRef(store.activeSessionKey);
  useEffect(() => {
    const activeKey = store.activeSessionKey;
    if (activeKey === prevActiveKeyRef.current) return;
    prevActiveKeyRef.current = activeKey;
    if (!controller.gatewayClient || connectionState !== "connected") return;
    controller.loadHistory();
    modelControls.refreshModel(activeKey);
  }, [store.activeSessionKey, connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-scroll ---
  const stickyRef = useRef(true);
  const shouldInstantScrollRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
    stickyRef.current = true;
  }, []);

  // Sync scroll hints from controller
  useEffect(() => {
    if (controller.shouldInstantScroll) {
      shouldInstantScrollRef.current = true;
      controller.shouldInstantScroll = false;
    }
    if (controller.sticky) {
      stickyRef.current = true;
    }
  });

  // Scroll on new messages or streaming changes
  useEffect(() => {
    if (isLoadingMoreRef.current) return;
    if (shouldInstantScrollRef.current) {
      scrollToBottom();
      shouldInstantScrollRef.current = false;
    } else if (stickyRef.current) {
      scrollToBottom();
    }
  }, [messages.length, streaming, scrollToBottom]);

  // Preserve scroll position after revealing older messages
  useLayoutEffect(() => {
    if (!isLoadingMoreRef.current) return;
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    }
    isLoadingMoreRef.current = false;
  }, [visibleCount]);

  // Handle scroll for loading more / sticky tracking
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el || isLoadingMoreRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = distanceFromBottom < 30;
    setShowScrollBtn(distanceFromBottom > 150);
    if (el.scrollTop < 50) {
      if (visibleCount >= messages.length) {
        if (!allFetched) {
          controller.fetchMore();
        }
        return;
      }
      // Reveal more from cache
      prevScrollHeightRef.current = el.scrollHeight;
      const newCount = Math.min(visibleCount + PAGE_SIZE, messages.length);
      if (newCount > visibleCount) {
        isLoadingMoreRef.current = true;
        session.setVisibleCount(newCount);
      }
    }
  }, [visibleCount, messages.length, allFetched, controller, session]);

  // --- Handlers ---

  function handleSend() {
    controller.sendMessage(draft, session.thinkingLevel, entityStore);
  }

  function handleStop() {
    controller.stopRun();
  }

  function handleReset() {
    if (connectionState !== "connected" || !controller.gatewayClient) return;
    setShowResetConfirm(true);
  }

  function confirmReset() {
    setShowResetConfirm(false);
    controller.resetSession();
  }

  function handleRunProfileChange(profileId: string) {
    session.setSelectedRunProfileId(profileId);
    controller.pushRunProfileToScope(profileId, store.activeSessionKey, runProfiles);
  }

  const fetchGatewaySessions = useCallback(async (): Promise<GatewaySessionInfo[]> => {
    return controller.fetchGatewaySessions();
  }, [controller]);

  // --- Derived render state ---
  const visibleMessages = messages.slice(Math.max(0, messages.length - visibleCount));
  const showHistoryEnd = allFetched && visibleCount >= messages.length && messages.length > 0;
  const isStreaming = runId !== null;
  const totalTokens = session.totalTokens;
  const contextWindow = modelControls.activeModel?.contextWindow ?? null;

  return (
    <div className="chat-container">
      <SessionTabBar
        sessions={store.sessionList}
        activeSessionKey={store.activeSessionKey}
        unreadKeys={store.unreadKeys}
        onSwitchSession={(key) => controller.switchSession(key)}
        onNewChat={() => controller.createNewChat()}
        onArchiveSession={(key) => controller.archiveSession(key)}
        onRenameSession={(key, title) => controller.renameSession(key, title)}
        onRestoreSession={(key) => controller.restoreSession(key)}
        onReorderSession={(from, to) => controller.reorderSessions(from, to)}
        fetchGatewaySessions={fetchGatewaySessions}
      />
      {messages.length === 0 && !streaming ? (
        <div className="chat-empty">
          <div>{t("chat.emptyState")}</div>
        </div>
      ) : (
        <ChatMessageList
          visibleMessages={visibleMessages}
          streaming={streaming}
          runId={runId}
          externalPending={runState.externalPending}
          displayPhase={runState.displayPhase}
          displayToolName={runState.displayToolName}
          isRunActive={runState.isActive}
          showAgentEvents={showAgentEvents}
          preserveToolEvents={preserveToolEvents}
          collapseMessages={collapseMessages}
          showHistoryEnd={showHistoryEnd}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          onScroll={handleScroll}
        />
      )}
      {showScrollBtn && (
        <button className="chat-scroll-bottom" onClick={scrollToBottom}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      <ChatExamples
        chatExamplesExpanded={examples.chatExamplesExpanded}
        resolvedExamples={examples.resolvedExamples}
        overriddenKeys={new Set(Object.keys(examples.customExamples))}
        onToggleExpanded={examples.toggleExpanded}
        onSelectExample={(text) => session.setDraft(text)}
        onEditExample={(key, currentText) => {
          examples.beginEdit(key, currentText);
        }}
      />

      <ChatStatusBar
        connectionState={connectionState}
        agentName={agentName}
        activeModel={modelControls.activeModel}
        thinkingLevel={session.thinkingLevel}
        onThinkingLevelChange={(level) => session.setThinkingLevel(level)}
        totalTokens={totalTokens}
        contextWindow={contextWindow}
        selectedRunProfileId={selectedRunProfileId}
        onRunProfileChange={handleRunProfileChange}
        onKeyModelChange={modelControls.handleKeyModelChange}
        onReset={handleReset}
      />

      <ChatInputArea
        draft={draft}
        pendingImages={pendingImages}
        isStreaming={isStreaming}
        canAbort={runState.canAbort}
        connectionState={connectionState as "connecting" | "connected" | "disconnected"}
        hasProviderKeys={modelControls.hasProviderKeys}
        onDraftChange={(text) => session.setDraft(text)}
        onPendingImagesChange={(imgs) => session.setPendingImages(imgs)}
        onSend={handleSend}
        onStop={handleStop}
      />
      <ChatResetModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={confirmReset}
      />
      <ChatContextOverflowModal
        isOpen={modelControls.pendingModelSwitch !== null}
        pendingModelSwitch={modelControls.pendingModelSwitch}
        onClose={() => modelControls.setPendingModelSwitch(null)}
        onContinue={modelControls.handleOverflowContinue}
        onClear={modelControls.handleOverflowClear}
      />
      <Modal
        isOpen={examples.editingExample !== null}
        onClose={examples.cancelEdit}
        title={t("chat.editExample")}
        maxWidth={480}
      >
        {examples.editingExample && (
          <>
            <textarea
              className="chat-example-edit-textarea"
              value={examples.editingExampleDraft}
              onChange={(e) => examples.setEditingExampleDraft(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="modal-actions">
              {examples.customExamples[examples.editingExample] && (
                <button
                  className="btn btn-secondary"
                  onClick={() => examples.restoreDefault(examples.editingExample!)}
                >
                  {t("chat.restoreDefault")}
                </button>
              )}
              <button className="btn btn-secondary" onClick={examples.cancelEdit}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                disabled={!examples.editingExampleDraft.trim()}
                onClick={() => examples.saveExample(examples.editingExample!, examples.editingExampleDraft)}
              >
                {t("common.save")}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
});

/**
 * ChatPage — the exported component.
 * Wraps the inner content with ChatStoreProvider so the MST store and
 * controller are available to all descendants. Since ChatPage is keep-mounted,
 * the provider (and its controller) persists across route switches.
 */
export const ChatPage = function ChatPage({ onAgentNameChange }: { onAgentNameChange?: (name: string | null) => void }) {
  return (
    <ChatStoreProvider>
      <ChatPreferenceStoreProvider>
        <ChatPageInner onAgentNameChange={onAgentNameChange} />
      </ChatPreferenceStoreProvider>
    </ChatStoreProvider>
  );
};
