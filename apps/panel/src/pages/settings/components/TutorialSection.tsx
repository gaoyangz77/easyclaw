import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "./ToggleSwitch.js";

interface TutorialSectionProps {
  tutorialEnabled: boolean;
  handleToggleTutorial: (enabled: boolean) => void;
}

export function TutorialSection({ tutorialEnabled, handleToggleTutorial }: TutorialSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("tutorial.settings.toggle")}</h3>

      <div className="settings-toggle-card">
        <div className="settings-toggle-label">
          <span>{t("tutorial.settings.toggle")}</span>
          <ToggleSwitch checked={tutorialEnabled} onChange={handleToggleTutorial} />
        </div>
        <div className="form-hint">
          {t("tutorial.settings.hint")}
        </div>
      </div>
    </div>
  );
}
