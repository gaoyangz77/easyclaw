import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "./ToggleSwitch.js";

interface ChatSettingsSectionProps {
  showAgentEvents: boolean;
  preserveToolEvents: boolean;
  collapseMessages: boolean;
  saving: boolean;
  settingsReady: boolean;
  handleToggleShowAgentEvents: (enabled: boolean) => void;
  handleTogglePreserveToolEvents: (enabled: boolean) => void;
  handleToggleCollapseMessages: (enabled: boolean) => void;
}

export function ChatSettingsSection({
  showAgentEvents,
  preserveToolEvents,
  collapseMessages,
  saving,
  settingsReady,
  handleToggleShowAgentEvents,
  handleTogglePreserveToolEvents,
  handleToggleCollapseMessages,
}: ChatSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.chat.title")}</h3>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("settings.chat.showAgentEvents")}</span>
          <ToggleSwitch checked={showAgentEvents} onChange={handleToggleShowAgentEvents} disabled={saving || !settingsReady} />
        </div>
        <div className="form-hint">
          {t("settings.chat.showAgentEventsHint")}
        </div>
      </div>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("settings.chat.preserveToolEvents")}</span>
          <ToggleSwitch checked={preserveToolEvents} onChange={handleTogglePreserveToolEvents} disabled={saving || !settingsReady} />
        </div>
        <div className="form-hint">
          {t("settings.chat.preserveToolEventsHint")}
        </div>
      </div>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("settings.chat.collapseMessages")}</span>
          <ToggleSwitch checked={collapseMessages} onChange={handleToggleCollapseMessages} disabled={saving || !settingsReady} />
        </div>
        <div className="form-hint">
          {t("settings.chat.collapseMessagesHint")}
        </div>
      </div>
    </div>
  );
}
