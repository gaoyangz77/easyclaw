import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import { updateTelemetrySetting, trackEvent } from "../api/index.js";

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
      <p className="consent-description">
        {t("settings.telemetry.consent.description")}
      </p>

      <div className="consent-info-box">
        <strong>{t("settings.telemetry.consent.collectLabel")}</strong>{" "}
        {t("settings.telemetry.consent.items")}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        <button
          onClick={() => dismiss(false)}
          className="btn-ghost"
        >
          {t("settings.telemetry.consent.disagree")}
        </button>
        <button
          onClick={() => dismiss(true)}
          className="btn btn-primary"
          style={{ padding: "8px 24px", borderRadius: 6, fontSize: 14, fontWeight: 600 }}
        >
          {t("settings.telemetry.consent.agree")}
        </button>
      </div>
    </Modal>
  );
}
