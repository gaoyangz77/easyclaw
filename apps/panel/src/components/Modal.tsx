import type { ReactNode } from "react";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: number;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 600 }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: "24px",
          maxWidth,
          width: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#202124" }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "none",
              fontSize: 24,
              color: "#666",
              cursor: "pointer",
              padding: "0 8px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
