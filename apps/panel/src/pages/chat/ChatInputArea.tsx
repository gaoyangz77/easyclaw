import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import type { PendingImage } from "./chat-utils.js";
import { IMAGE_TYPES } from "./chat-utils.js";
import { readFileAsPending } from "./chat-image-utils.js";

// Gateway attachment limit is 5 MB (image-only for webchat)
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1000 * 1000;

export type ChatInputAreaProps = {
  draft: string;
  pendingImages: PendingImage[];
  isStreaming: boolean;
  canAbort: boolean;
  connectionState: "connecting" | "connected" | "disconnected";
  onDraftChange: (text: string) => void;
  onPendingImagesChange: (images: PendingImage[]) => void;
  onSend: () => void;
  onStop: () => void;
};

export function ChatInputArea({
  draft,
  pendingImages,
  isStreaming,
  canAbort,
  connectionState,
  onDraftChange,
  onPendingImagesChange,
  onSend,
  onStop,
}: ChatInputAreaProps) {
  const { t } = useTranslation();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filePathInputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onDraftChange(e.target.value);
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
      onDraftChange(newDraft);
      requestAnimationFrame(() => {
        const pos = start + emojiData.emoji.length;
        textarea.selectionStart = pos;
        textarea.selectionEnd = pos;
        textarea.focus();
      });
    } else {
      onDraftChange(draft + emojiData.emoji);
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

  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const results: PendingImage[] = [];
    for (const file of Array.from(files)) {
      if (!IMAGE_TYPES.includes(file.type)) continue;
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        alert(t("chat.imageTooLarge"));
        continue;
      }
      const pending = await readFileAsPending(file);
      if (pending) results.push(pending);
    }
    if (results.length > 0) {
      onPendingImagesChange([...pendingImages, ...results]);
    }
  }, [pendingImages, onPendingImagesChange, t]);

  function handleAttachClick() {
    fileInputRef.current?.click();
  }

  function handleFilePathClick() {
    filePathInputRef.current?.click();
  }

  function handleFilePathChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return;
    const paths = Array.from(e.target.files).map((f) => (f as File & { path?: string }).path ?? f.name);
    const snippet = paths.join(" ");
    onDraftChange(draft.length > 0 && !draft.endsWith(" ") ? `${draft} ${snippet} ` : `${draft}${snippet} `);
    e.target.value = "";
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files);
      e.target.value = "";
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
    onPendingImagesChange(pendingImages.filter((_, i) => i !== index));
  }

  /** Reset textarea height (called externally via ref after send). */
  const resetHeight = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  // Expose resetHeight and focus to parent
  // We use a simpler approach: parent calls onDraftChange("") which triggers re-render,
  // and we auto-reset height when draft becomes empty.
  useEffect(() => {
    if (draft === "" && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [draft]);

  return (
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
          className="sr-input"
        />
        <input
          ref={filePathInputRef}
          type="file"
          multiple
          onChange={handleFilePathChange}
          className="sr-input"
        />
        <button
          className="chat-attach-btn"
          onClick={handleFilePathClick}
          title={t("chat.attachFile")}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <button
          className="chat-attach-btn"
          onClick={handleAttachClick}
          title={t("chat.attachImage")}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
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
        {(isStreaming || canAbort) ? (
          <button className="btn btn-danger" onClick={onStop}>
            {t("chat.stop")}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={onSend}
            disabled={(!draft.trim() && pendingImages.length === 0) || connectionState !== "connected"}
          >
            {t("chat.send")}
          </button>
        )}
      </div>
    </div>
  );
}
