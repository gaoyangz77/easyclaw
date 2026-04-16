import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modals/Modal.js";
import { Select } from "../../components/inputs/Select.js";
import { observer } from "mobx-react-lite";
import type { CronJob, PayloadKind } from "./cron-utils.js";
import { useCronForm } from "./hooks/useCronForm.js";
import { CronScheduleFields } from "./components/CronScheduleFields.js";
import { CronDeliveryFields } from "./components/CronDeliveryFields.js";
import { CronAdvancedFields } from "./components/CronAdvancedFields.js";
import { InfoTip } from "./components/InfoTip.js";

interface CronJobFormProps {
  mode: "create" | "edit";
  initialData?: CronJob;
  onSubmit: (params: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

const PAYLOAD_KINDS: PayloadKind[] = ["agentTurn", "systemEvent"];

export const CronJobForm = observer(function CronJobForm({ mode, initialData, onSubmit, onCancel }: CronJobFormProps) {
  const { t } = useTranslation();
  const cronForm = useCronForm({ mode, initialData, onSubmit });
  const payloadLabel = cronForm.form.payloadKind === "agentTurn"
    ? t("crons.fieldMessage")
    : t("crons.fieldText");

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={mode === "create" ? t("crons.createTitle") : t("crons.editTitle")}
      maxWidth={1040}
    >
      <div className="crons-form-shell">
        {cronForm.submitError && <div className="error-alert">{cronForm.submitError}</div>}

        <div className="crons-form-grid">
          <section className="crons-form-card">
            <div className="crons-form-section-title">{t("crons.sectionBasics")}</div>
            <div className="crons-form-two-col">
              <div className="form-group crons-form-span-2">
                <label className="form-label-block">{t("crons.fieldName")} <span className="required">*</span></label>
                <input
                  className="input-full"
                  value={cronForm.form.name}
                  onChange={(e) => cronForm.update("name", e.target.value)}
                  placeholder={t("crons.fieldName")}
                />
                {cronForm.errors.name && <div className="crons-field-error">{t(`crons.${cronForm.errors.name}`)}</div>}
              </div>

              <div className="form-group">
                <label className="form-label-block">
                  {t("crons.fieldPayloadKind")} <span className="required">*</span>
                  <InfoTip tooltipKey="tooltipPayloadKind" />
                </label>
                <Select
                  value={cronForm.form.payloadKind}
                  onChange={(v) => cronForm.update("payloadKind", v as PayloadKind)}
                  options={PAYLOAD_KINDS.map((k) => ({
                    value: k,
                    label: t(`crons.payload${k.charAt(0).toUpperCase()}${k.slice(1)}`),
                  }))}
                />
                <div className="form-hint">
                  {cronForm.form.payloadKind === "agentTurn"
                    ? t("crons.sessionTargetIsolated")
                    : t("crons.sessionTargetMain")
                  }
                </div>
              </div>

              <div className="form-group">
                <label className="form-label-block">{t("crons.fieldDescription")}</label>
                <textarea
                  className="input-full textarea-resize-vertical"
                  rows={2}
                  value={cronForm.form.description}
                  onChange={(e) => cronForm.update("description", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="crons-form-card">
            <div className="crons-form-section-title">{t("crons.sectionDelivery")}</div>
            <CronDeliveryFields
              form={cronForm.form}
              errors={cronForm.errors}
              channelOptions={cronForm.channelOptions}
              recipientOptions={cronForm.recipientOptions}
              channelStatusLoading={cronForm.channelStatusLoading}
              onUpdate={cronForm.update}
              onChannelChange={cronForm.handleChannelChange}
            />
          </section>

          <section className="crons-form-card crons-form-card-span-2">
            <div className="crons-form-section-title">{t("crons.sectionPayload")}</div>
            {cronForm.form.payloadKind === "agentTurn" ? (
              <div className="form-group">
                <label className="form-label-block">
                  {payloadLabel} <span className="required">*</span>
                  <InfoTip tooltipKey="tooltipMessage" />
                </label>
                <textarea
                  className="input-full textarea-resize-vertical crons-prompt-textarea"
                  rows={8}
                  value={cronForm.form.message}
                  onChange={(e) => cronForm.update("message", e.target.value)}
                  placeholder={payloadLabel}
                />
                {cronForm.errors.message && <div className="crons-field-error">{t(`crons.${cronForm.errors.message}`)}</div>}
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label-block">
                  {payloadLabel} <span className="required">*</span>
                  <InfoTip tooltipKey="tooltipText" />
                </label>
                <textarea
                  className="input-full textarea-resize-vertical crons-prompt-textarea"
                  rows={8}
                  value={cronForm.form.text}
                  onChange={(e) => cronForm.update("text", e.target.value)}
                  placeholder={payloadLabel}
                />
                {cronForm.errors.text && <div className="crons-field-error">{t(`crons.${cronForm.errors.text}`)}</div>}
              </div>
            )}
          </section>

          <section className="crons-form-card">
            <div className="crons-form-section-title">{t("crons.sectionSchedule")}</div>
            <CronScheduleFields
              form={cronForm.form}
              errors={cronForm.errors}
              showRawCron={cronForm.showRawCron}
              onShowRawCronChange={cronForm.setShowRawCron}
              onUpdate={cronForm.update}
            />
          </section>

          <section className="crons-form-card">
            <div className="crons-form-section-title">{t("crons.sectionExecution")}</div>

            <div className="form-group">
              <div className="crons-options-row">
                <label className="crons-checkbox-label">
                  <input
                    type="checkbox"
                    checked={cronForm.form.enabled}
                    onChange={(e) => cronForm.update("enabled", e.target.checked)}
                  />
                  {t("crons.fieldEnabled")}
                </label>
                <label className="crons-checkbox-label">
                  <input
                    type="checkbox"
                    checked={cronForm.form.deleteAfterRun}
                    onChange={(e) => cronForm.update("deleteAfterRun", e.target.checked)}
                  />
                  {t("crons.fieldDeleteAfterRun")}
                  <InfoTip tooltipKey="tooltipDeleteAfterRun" />
                </label>
              </div>
            </div>

            <div className="cron-form-divider" />

            <CronAdvancedFields
              form={cronForm.form}
              onUpdate={cronForm.update}
              selectedRunProfileId={cronForm.selectedRunProfileId}
              onRunProfileChange={cronForm.handleRunProfileChange}
            />
          </section>
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={cronForm.saving}>
          {t("common.cancel")}
        </button>
        <button className="btn btn-primary" onClick={cronForm.handleSubmit} disabled={cronForm.saving}>
          {cronForm.saving ? t("common.loading") : mode === "create" ? t("crons.addJob") : t("common.save")}
        </button>
      </div>
    </Modal>
  );
});
