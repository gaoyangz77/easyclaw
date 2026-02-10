import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import type { ChangelogEntry } from "../api.js";

export function WhatsNewModal({
  isOpen,
  onClose,
  entries,
  currentVersion,
}: {
  isOpen: boolean;
  onClose: () => void;
  entries: ChangelogEntry[];
  currentVersion: string;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language === "zh";

  // Find the entry matching the current version
  const entry = entries.find((e) => e.version === currentVersion);
  const changes = entry ? (isZh ? entry.zh : entry.en) : [];

  function handleClose() {
    localStorage.setItem("whatsNew.lastSeenVersion", currentVersion);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isZh ? "更新内容" : "What's New"}
      maxWidth={480}
    >
      {entry && (
        <>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>
            v{entry.version} — {entry.date}
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {changes.map((item, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.7, color: "#333" }}>
                {item}
              </li>
            ))}
          </ul>
        </>
      )}
      <div style={{ marginTop: 20, textAlign: "right" }}>
        <button
          className="btn btn-primary"
          onClick={handleClose}
          style={{ minWidth: 80 }}
        >
          {isZh ? "知道了" : "Got it"}
        </button>
      </div>
    </Modal>
  );
}
