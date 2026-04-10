import { useTranslation } from "react-i18next";

interface DependenciesSectionProps {
  depsInstalling: boolean;
  handleInstallDeps: () => void;
}

export function DependenciesSection({ depsInstalling, handleInstallDeps }: DependenciesSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.deps.title")}</h3>
      <p className="text-secondary">
        {t("settings.deps.description")}
      </p>
      <div className="doctor-actions">
        <button
          className="btn btn-primary"
          onClick={handleInstallDeps}
          disabled={depsInstalling}
        >
          {t("settings.deps.installButton")}
        </button>
        {depsInstalling && (
          <span className="doctor-status">{t("settings.deps.statusRunning")}</span>
        )}
      </div>
    </div>
  );
}
