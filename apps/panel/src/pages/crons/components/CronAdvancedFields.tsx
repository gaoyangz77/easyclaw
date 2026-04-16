import { useTranslation } from "react-i18next";
import { Select } from "../../../components/inputs/Select.js";
import { RunProfileSelector } from "../../../components/inputs/RunProfileSelector.js";
import type { CronJobFormData, CronWakeMode } from "../cron-utils.js";
import { InfoTip } from "./InfoTip.js";

const WAKE_MODES: CronWakeMode[] = ["now", "next-heartbeat"];

interface CronAdvancedFieldsProps {
  form: CronJobFormData;
  onUpdate: <K extends keyof CronJobFormData>(key: K, value: CronJobFormData[K]) => void;
  selectedRunProfileId: string;
  onRunProfileChange: (profileId: string) => void;
}

export function CronAdvancedFields({ form, onUpdate, selectedRunProfileId, onRunProfileChange }: CronAdvancedFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="crons-advanced-content">
      <div className="crons-subsection-title">{t("crons.advancedOptions")}</div>
      <div className="crons-advanced-grid">
        {form.payloadKind === "agentTurn" && (
          <>
            {/* Model override — hidden for now, uncomment when needed
            <div className="form-group">
              <label className="form-label-block">
                {t("crons.fieldModel")}
                <InfoTip tooltipKey="tooltipModel" />
              </label>
              <input
                className="input-full"
                value={form.model}
                onChange={(e) => onUpdate("model", e.target.value)}
                placeholder={t("crons.fieldModel")}
              />
            </div>
            */}
            <div className="form-group">
              <label className="form-label-block">
                {t("crons.fieldThinking")}
                <InfoTip tooltipKey="tooltipThinking" />
              </label>
              <Select
                value={form.thinking}
                onChange={(v) => onUpdate("thinking", v)}
                options={[
                  { value: "", label: t("crons.thinkingNone") },
                  { value: "low", label: t("crons.thinkingLow") },
                  { value: "medium", label: t("crons.thinkingMedium") },
                  { value: "high", label: t("crons.thinkingHigh") },
                ]}
              />
            </div>
            <div className="form-group">
              <label className="form-label-block">
                {t("crons.fieldTimeout")}
                <InfoTip tooltipKey="tooltipTimeout" />
              </label>
              <input
                type="number"
                className="input-full"
                min={0}
                value={form.timeoutSeconds}
                onChange={(e) => onUpdate("timeoutSeconds", e.target.value)}
                placeholder="300"
              />
            </div>
          </>
        )}
        <div className="form-group">
          <label className="form-label-block">
            {t("crons.fieldWakeMode")}
            <InfoTip tooltipKey="tooltipWakeMode" />
          </label>
          <Select
            value={form.wakeMode}
            onChange={(v) => onUpdate("wakeMode", v as CronWakeMode)}
            options={WAKE_MODES.map((m) => ({
              value: m,
              label: t(`crons.wakeMode${m === "now" ? "Now" : "Heartbeat"}`),
            }))}
          />
        </div>
        <div className="form-group crons-form-span-2">
          <label className="form-label-block">{t("runProfileSelector.label")}</label>
          <div className="form-hint">{t("runProfileSelector.hint")}</div>
          <RunProfileSelector
            value={selectedRunProfileId}
            className="input-full"
            onChange={onRunProfileChange}
          />
        </div>
      </div>
    </div>
  );
}
