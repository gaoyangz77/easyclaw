import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "./ToggleSwitch.js";

interface TelemetrySectionProps {
  telemetryEnabled: boolean;
  saving: boolean;
  settingsReady: boolean;
  handleToggleTelemetry: (enabled: boolean) => void;
}

export function TelemetrySection({ telemetryEnabled, saving, settingsReady, handleToggleTelemetry }: TelemetrySectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.telemetry.title")}</h3>
      <p className="text-secondary">
        {t("settings.telemetry.description")}
      </p>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("settings.telemetry.toggle")}</span>
          <ToggleSwitch checked={telemetryEnabled} onChange={handleToggleTelemetry} disabled={saving || !settingsReady} />
        </div>
      </div>

      <hr className="section-divider" />

      <div className="telemetry-details">
        <h4>{t("settings.telemetry.whatWeCollect")}</h4>
        <ul className="settings-list">
          <li>{t("settings.telemetry.collect.appLifecycle")}</li>
          <li>{t("settings.telemetry.collect.featureUsage")}</li>
          <li>{t("settings.telemetry.collect.errors")}</li>
          <li>{t("settings.telemetry.collect.runtime")}</li>
        </ul>

        <h4>{t("settings.telemetry.whatWeDontCollect")}</h4>
        <ul className="settings-list">
          <li>{t("settings.telemetry.dontCollect.conversations")}</li>
          <li>{t("settings.telemetry.dontCollect.apiKeys")}</li>
          <li>{t("settings.telemetry.dontCollect.ruleText")}</li>
          <li>{t("settings.telemetry.dontCollect.personalInfo")}</li>
        </ul>
      </div>
    </div>
  );
}
