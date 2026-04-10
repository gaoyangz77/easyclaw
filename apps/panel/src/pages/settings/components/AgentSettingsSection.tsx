import { useTranslation } from "react-i18next";
import { Select } from "../../../components/inputs/Select.js";
import { ToggleSwitch } from "./ToggleSwitch.js";
import { DM_SCOPE_OPTIONS } from "../settings-types.js";

interface AgentSettingsSectionProps {
  dmScope: string;
  saving: boolean;
  settingsReady: boolean;
  browserMode: "standalone" | "cdp";
  sessionStateCdpEnabled: boolean;
  handleDmScopeChange: (value: string) => void;
  handleBrowserModeChange: (value: string) => void;
  handleToggleSessionStateCdp: (enabled: boolean) => void;
}

export function AgentSettingsSection({
  dmScope,
  saving,
  settingsReady,
  browserMode,
  sessionStateCdpEnabled,
  handleDmScopeChange,
  handleBrowserModeChange,
  handleToggleSessionStateCdp,
}: AgentSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.agent.title")}</h3>

      <div>
        <label className="form-label-block">
          {t("settings.agent.dmScope")}
        </label>
        <Select
          value={dmScope}
          onChange={handleDmScopeChange}
          options={DM_SCOPE_OPTIONS.map(opt => ({
            value: opt.value,
            label: t(opt.labelKey),
          }))}
          disabled={saving}
        />
        <div className="form-hint">
          {t("settings.agent.dmScopeHint")}
        </div>
      </div>

      <div>
        <label className="form-label-block">
          {t("settings.browser.mode")}
        </label>
        <Select
          value={browserMode}
          onChange={handleBrowserModeChange}
          options={[
            { value: "standalone", label: t("settings.browser.modeStandalone"), description: t("settings.browser.modeStandaloneDesc") },
            { value: "cdp", label: t("settings.browser.modeCdp"), description: t("settings.browser.modeCdpDesc") },
          ]}
          disabled={saving || !settingsReady}
        />
        <div className="form-hint">
          {t("settings.browser.modeHint")}
        </div>
      </div>

      {browserMode === "cdp" && (
        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.browser.sessionStateCdp")}</span>
            <ToggleSwitch checked={sessionStateCdpEnabled} onChange={handleToggleSessionStateCdp} disabled={saving || !settingsReady} />
          </div>
          <div className="form-hint">
            {t("settings.browser.sessionStateCdpHint")}
          </div>
        </div>
      )}
    </div>
  );
}
