import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../chat-utils.js";
import { cleanMessageText, IMAGE_PLACEHOLDER, IMAGE_EXPIRED_PLACEHOLDER, formatTimestamp } from "../chat-utils.js";
import { MarkdownMessage, CopyButton, CollapsibleContent, ToolArgsDisplay } from "../ChatMessage.js";

export interface ChatMessageListProps {
  visibleMessages: ChatMessage[];
  streaming: string | null;
  runId: string | null;
  externalPending: boolean;
  /** Display phase from RunTracker view (via store). */
  displayPhase: string | null;
  /** Tool name when displayPhase === "tooling". */
  displayToolName: string | null;
  /** Whether any run is active. */
  isRunActive: boolean;
  showAgentEvents: boolean;
  preserveToolEvents: boolean;
  collapseMessages: boolean;
  showHistoryEnd: boolean;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export function ChatMessageList({
  visibleMessages,
  streaming,
  runId,
  externalPending,
  displayPhase,
  displayToolName,
  isRunActive,
  showAgentEvents,
  preserveToolEvents,
  collapseMessages,
  showHistoryEnd,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
}: ChatMessageListProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="chat-messages" ref={messagesContainerRef} onScroll={onScroll}>
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
        const cleaned = cleanMessageText(msg.text)
          .replaceAll(IMAGE_PLACEHOLDER, t("chat.imageAttachment"))
          .replaceAll(IMAGE_EXPIRED_PLACEHOLDER, t("chat.imageExpired"));
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
        // Show the thinking bubble only when there's no streaming text.
        // When streaming text is visible, it IS the visual feedback --
        // showing both would cause duplicate/overlapping bubbles.
        const showThinking = streaming === null && (
          runId !== null || externalPending || (isRunActive && displayPhase !== "done")
        );
        return showThinking ? (
          <div className="chat-bubble chat-bubble-assistant chat-thinking">
            {displayPhase && showAgentEvents ? (
              <span className="chat-agent-phase">
                {displayPhase === "tooling"
                  ? t("chat.phaseUsingTool", { tool: displayToolName ?? "" })
                  : t(`chat.phase_${displayPhase}`)}
              </span>
            ) : null}
            <span className="chat-thinking-dots"><span /><span /><span /></span>
          </div>
        ) : null;
      })()}
      {streaming !== null && (
        <>
          {displayPhase === "tooling" && showAgentEvents ? (
            <div className="chat-agent-phase-inline">
              {t("chat.phaseUsingTool", { tool: displayToolName ?? "" })}
            </div>
          ) : null}
          <div className="chat-bubble-wrap chat-bubble-wrap-assistant">
            <div className="chat-bubble chat-bubble-assistant chat-streaming-cursor">
              <MarkdownMessage text={cleanMessageText(streaming).replaceAll(IMAGE_PLACEHOLDER, t("chat.imageAttachment")).replaceAll(IMAGE_EXPIRED_PLACEHOLDER, t("chat.imageExpired"))} />
            </div>
          </div>
        </>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
