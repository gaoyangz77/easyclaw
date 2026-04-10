import { useTranslation } from "react-i18next";
import type { OpenClawStateDirInfo } from "../../../api/index.js";

interface StateDirectorySectionProps {
  dataDirInfo: OpenClawStateDirInfo;
  dataDirRestartNeeded: boolean;
  saving: boolean;
  handleChangeDataDir: () => void;
  handleResetDataDir: () => void;
}

export function StateDirectorySection({ dataDirInfo, dataDirRestartNeeded, saving, handleChangeDataDir, handleResetDataDir }: StateDirectorySectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.dataDir.title")}</h3>

      <div>
        <div className="settings-toggle-label settings-toggle-label-static">
          <span>{t("settings.dataDir.label")}</span>
        </div>
        <div className="data-dir-display">
          <code className="data-dir-path">{dataDirInfo.override ?? dataDirInfo.effective}</code>
          {dataDirInfo.override && <span className="badge">{t("settings.dataDir.custom")}</span>}
          {!dataDirInfo.override && <span className="badge badge-muted">{t("settings.dataDir.default")}</span>}
        </div>
        <div className="form-hint">
          {t("settings.dataDir.hint")}
        </div>
      </div>

      <div className="data-dir-actions">
        <button className="btn btn-secondary" onClick={handleChangeDataDir} disabled={saving}>
          {t("settings.dataDir.change")}
        </button>
        {dataDirInfo.override && (
          <button className="btn btn-secondary" onClick={handleResetDataDir} disabled={saving}>
            {t("settings.dataDir.reset")}
          </button>
        )}
      </div>

      {dataDirRestartNeeded && (
        <div className="data-dir-restart-notice">
          {t("settings.dataDir.restartNotice")}
        </div>
      )}
    </div>
  );
}
