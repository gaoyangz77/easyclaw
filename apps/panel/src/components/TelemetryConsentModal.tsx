import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import { updateTelemetrySetting, trackEvent } from "../api.js";

export function TelemetryConsentModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  function dismiss(enabled: boolean) {
    updateTelemetrySetting(enabled).catch(() => {});
    trackEvent("telemetry.toggled", { enabled });
    localStorage.setItem("telemetry.consentShown", "1");
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("settings.telemetry.consent.title")}
      maxWidth={420}
    >
      <p style={{ color: "#5f6368", lineHeight: 1.7, margin: "0 0 16px" }}>
        {t("settings.telemetry.consent.description")}
      </p>

      <div
        style={{
          padding: "10px 14px",
          backgroundColor: "#f8f9fa",
          borderRadius: 6,
          marginBottom: 24,
          fontSize: 13,
          color: "#555",
          lineHeight: 1.6,
        }}
      >
        <strong>{t("settings.telemetry.consent.collectLabel")}</strong>{" "}
        {t("settings.telemetry.consent.items")}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        <button
          onClick={() => dismiss(false)}
          style={{
            padding: "6px 14px",
            border: "none",
            background: "none",
            color: "#999",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {t("settings.telemetry.consent.disagree")}
        </button>
        <button
          onClick={() => dismiss(true)}
          className="btn btn-primary"
          style={{
            padding: "8px 24px",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {t("settings.telemetry.consent.agree")}
        </button>
      </div>
    </Modal>
  );
}
