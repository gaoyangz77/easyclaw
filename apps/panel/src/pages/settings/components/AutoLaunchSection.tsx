import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "./ToggleSwitch.js";

interface AutoLaunchSectionProps {
  autoLaunchEnabled: boolean;
  saving: boolean;
  settingsReady: boolean;
  handleToggleAutoLaunch: (enabled: boolean) => void;
}

export function AutoLaunchSection({ autoLaunchEnabled, saving, settingsReady, handleToggleAutoLaunch }: AutoLaunchSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.autoLaunch.title")}</h3>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("settings.autoLaunch.toggle")}</span>
          <ToggleSwitch checked={autoLaunchEnabled} onChange={handleToggleAutoLaunch} disabled={saving || !settingsReady} />
        </div>
        {t("settings.autoLaunch.hint") && (
          <div className="form-hint">
            {t("settings.autoLaunch.hint")}
          </div>
        )}
      </div>
    </div>
  );
}
