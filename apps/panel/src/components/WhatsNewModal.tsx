import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import type { ChangelogEntry } from "../api/index.js";

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
      hideCloseButton
    >
      {entry && (
        <>
          <div className="whats-new-version">
            v{entry.version} — {entry.date}
          </div>
          <ul className="whats-new-list">
            {changes.map((item, i) => (
              <li key={i} className="whats-new-item">
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
        >
          {isZh ? "知道了" : "Got it"}
        </button>
      </div>
    </Modal>
  );
}
