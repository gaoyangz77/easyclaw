import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { DoctorStatus } from "../settings-types.js";

interface DiagnosticsSectionProps {
  doctorStatus: DoctorStatus;
  doctorOutput: string[];
  doctorExitCode: number | null;
  doctorOutputRef: RefObject<HTMLPreElement | null>;
  runDoctor: (fix: boolean) => void;
}

export function DiagnosticsSection({ doctorStatus, doctorOutput, doctorExitCode, doctorOutputRef, runDoctor }: DiagnosticsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="section-card">
      <h3>{t("settings.diagnostics.title")}</h3>
      <p className="text-secondary">
        {t("settings.diagnostics.description")}
      </p>

      {doctorOutput.length > 0 && (
        <pre ref={doctorOutputRef} className="doctor-output">
          {doctorOutput.join("\n")}
        </pre>
      )}

      <div className="doctor-actions">
        <button
          className="btn btn-primary"
          onClick={() => runDoctor(false)}
          disabled={doctorStatus === "running"}
        >
          {t("settings.diagnostics.runButton")}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => runDoctor(true)}
          disabled={doctorStatus === "running"}
        >
          {t("settings.diagnostics.fixButton")}
        </button>
        {doctorStatus === "running" && (
          <span className="doctor-status">{t("settings.diagnostics.statusRunning")}</span>
        )}
        {doctorStatus === "done" && (
          <span className="doctor-status doctor-status-success">
            {t("settings.diagnostics.statusDone")}
            {doctorExitCode !== null && ` (${t("settings.diagnostics.statusExitCode", { code: doctorExitCode })})`}
          </span>
        )}
        {doctorStatus === "error" && (
          <span className="doctor-status doctor-status-error">
            {t("settings.diagnostics.statusError")}
            {doctorExitCode !== null && ` (${t("settings.diagnostics.statusExitCode", { code: doctorExitCode })})`}
          </span>
        )}
      </div>
    </div>
  );
}
