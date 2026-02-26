import type { ReactNode } from "react";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: number;
  hideCloseButton?: boolean;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 600, hideCloseButton }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{ maxWidth: `${maxWidth}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          {!hideCloseButton && (
            <button
              onClick={onClose}
              className="modal-close-btn"
            >
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
