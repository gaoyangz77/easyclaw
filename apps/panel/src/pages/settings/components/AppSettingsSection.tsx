import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "./ToggleSwitch.js";

interface AppSettingsSectionProps {
  accentColor: string;
  privacyMode: boolean;
  showAgentName: boolean;
  saving: boolean;
  settingsReady: boolean;
  handleAccentColorChange: (color: string) => void;
  handleTogglePrivacyMode: (enabled: boolean) => void;
  handleToggleShowAgentName: (enabled: boolean) => void;
}

export function AppSettingsSection({
  accentColor,
  privacyMode,
  showAgentName,
  saving,
  settingsReady,
  handleAccentColorChange,
  handleTogglePrivacyMode,
  handleToggleShowAgentName,
}: AppSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.app.title")}</h3>

      <div>
        <label className="form-label-block">
          {t("settings.app.accentColor")}
        </label>
        <div className="accent-color-picker">
          <button
            className={`accent-color-swatch accent-color-swatch-blue${accentColor === "blue" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("blue")}
            title={t("settings.app.accentBlue")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-orange${accentColor === "orange" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("orange")}
            title={t("settings.app.accentOrange")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-emerald${accentColor === "emerald" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("emerald")}
            title={t("settings.app.accentEmerald")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-rose${accentColor === "rose" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("rose")}
            title={t("settings.app.accentRose")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-violet${accentColor === "violet" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("violet")}
            title={t("settings.app.accentViolet")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-gold${accentColor === "gold" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("gold")}
            title={t("settings.app.accentGold")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-crimson${accentColor === "crimson" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("crimson")}
            title={t("settings.app.accentCrimson")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-tiffany${accentColor === "tiffany" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("tiffany")}
            title={t("settings.app.accentTiffany")}
          />
          <button
            className={`accent-color-swatch accent-color-swatch-gray${accentColor === "gray" ? " accent-color-swatch-active" : ""}`}
            onClick={() => handleAccentColorChange("gray")}
            title={t("settings.app.accentGray")}
          />
        </div>
      </div>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("settings.app.privacyMode")}</span>
          <ToggleSwitch checked={privacyMode} onChange={handleTogglePrivacyMode} disabled={saving || !settingsReady} />
        </div>
        <div className="form-hint">
          {t("settings.app.privacyModeHint")}
        </div>
      </div>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("settings.app.showAgentName")}</span>
          <ToggleSwitch checked={showAgentName} onChange={handleToggleShowAgentName} />
        </div>
        <div className="form-hint">
          {t("settings.app.showAgentNameHint")}
        </div>
      </div>
    </div>
  );
}
