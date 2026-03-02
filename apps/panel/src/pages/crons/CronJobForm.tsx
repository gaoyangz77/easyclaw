import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal.js";
import { Select } from "../../components/Select.js";
import { fetchChannelStatus, fetchAllowlist, setRecipientLabel, type ChannelsStatusSnapshot } from "../../api/channels.js";
import type { CronJob, CronJobFormData, ScheduleKind, PayloadKind, EveryUnit, CronWakeMode, CronDeliveryMode, FormErrors } from "./cron-utils.js";
import { defaultFormData, cronJobToFormData, formDataToCreateParams, formDataToPatch, validateCronForm, TIMEZONE_ENTRIES } from "./cron-utils.js";

interface CronJobFormProps {
  mode: "create" | "edit";
  initialData?: CronJob;
  onSubmit: (params: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

const SCHEDULE_KINDS: ScheduleKind[] = ["cron", "every", "at"];
const EVERY_UNITS: EveryUnit[] = ["seconds", "minutes", "hours"];
const PAYLOAD_KINDS: PayloadKind[] = ["agentTurn", "systemEvent"];
const DELIVERY_MODES: CronDeliveryMode[] = ["none", "announce", "webhook"];
const WAKE_MODES: CronWakeMode[] = ["now", "next-heartbeat"];


const CRON_PRESETS: { key: string; expr: string }[] = [
  { key: "presetEveryMinute", expr: "* * * * *" },
  { key: "presetEvery5Min", expr: "*/5 * * * *" },
  { key: "presetEvery15Min", expr: "*/15 * * * *" },
  { key: "presetEveryHour", expr: "0 * * * *" },
  { key: "presetEveryDay", expr: "0 0 * * *" },
  { key: "presetEveryMonday9am", expr: "0 9 * * 1" },
  { key: "presetEvery1stOfMonth", expr: "0 0 1 * *" },
];

/** Parse a cron expression into its 5 fields. */
function parseCronFields(expr: string): [string, string, string, string, string] {
  const parts = expr.trim().split(/\s+/);
  return [parts[0] || "*", parts[1] || "*", parts[2] || "*", parts[3] || "*", parts[4] || "*"];
}

const MONTH_KEYS = ["cronJan", "cronFeb", "cronMar", "cronApr", "cronMay", "cronJun", "cronJul", "cronAug", "cronSep", "cronOct", "cronNov", "cronDec"] as const;
const DOW_KEYS = ["cronSun", "cronMon", "cronTue", "cronWed", "cronThu", "cronFri", "cronSat"] as const;

function InfoTip({ tooltipKey }: { tooltipKey: string }) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // Position below the trigger if space allows, otherwise above
    const top = spaceBelow > 120 ? rect.bottom + 6 : rect.top - 6;
    setBubble({ top, left: rect.left + rect.width / 2 });
  }, []);

  const hide = useCallback(() => setBubble(null), []);

  return (
    <>
      <span
        ref={triggerRef}
        className="crons-tip-trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        ?
      </span>
      {bubble && createPortal(
        <div
          className="crons-tip-bubble"
          style={{
            top: bubble.top,
            left: bubble.left,
            transform: "translateX(-50%)",
          }}
        >
          {t(`crons.${tooltipKey}`)}
        </div>,
        document.body,
      )}
    </>
  );
}

export function CronJobForm({ mode, initialData, onSubmit, onCancel }: CronJobFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CronJobFormData>(
    initialData ? cronJobToFormData(initialData) : defaultFormData(),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRawCron, setShowRawCron] = useState(false);

  // Channel status (fetched once on mount)
  const [channelSnapshot, setChannelSnapshot] = useState<ChannelsStatusSnapshot | null>(null);
  const [channelStatusLoading, setChannelStatusLoading] = useState(true);
  // Allowlist for the currently selected delivery channel
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [recipientLabels, setRecipientLabels] = useState<Record<string, string>>({});
  const [allowlistLoading, setAllowlistLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchChannelStatus(false).then((snapshot) => {
      if (!cancelled) {
        setChannelSnapshot(snapshot);
        setChannelStatusLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setChannelStatusLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (form.deliveryMode !== "announce" || !form.deliveryChannel) {
      setAllowlist([]);
      setRecipientLabels({});
      return;
    }
    let cancelled = false;
    setAllowlistLoading(true);
    fetchAllowlist(form.deliveryChannel).then((result) => {
      if (!cancelled) {
        setAllowlist(result.allowlist);
        setRecipientLabels(result.labels);
        setAllowlistLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setAllowlist([]);
        setRecipientLabels({});
        setAllowlistLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [form.deliveryChannel, form.deliveryMode]);

  const update = useCallback(<K extends keyof CronJobFormData>(key: K, value: CronJobFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const fieldErrors = validateCronForm(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const params = mode === "edit" && initialData
        ? formDataToPatch(initialData, form)
        : formDataToCreateParams(form);
      await onSubmit(params);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [form, mode, initialData, onSubmit]);

  /** Build translated option lists for the 5 cron fields. */
  const cronFieldDefs = useMemo(() => {
    const minuteOpts = [
      { value: "*", label: t("crons.cronAny") },
      { value: "*/5", label: t("crons.cronEveryNMin", { n: 5 }) },
      { value: "*/10", label: t("crons.cronEveryNMin", { n: 10 }) },
      { value: "*/15", label: t("crons.cronEveryNMin", { n: 15 }) },
      { value: "*/30", label: t("crons.cronEveryNMin", { n: 30 }) },
      { value: "0", label: ":00" },
      { value: "15", label: ":15" },
      { value: "30", label: ":30" },
      { value: "45", label: ":45" },
    ];
    const hourOpts = [
      { value: "*", label: t("crons.cronAny") },
      { value: "*/2", label: t("crons.cronEveryNH", { n: 2 }) },
      { value: "*/3", label: t("crons.cronEveryNH", { n: 3 }) },
      { value: "*/4", label: t("crons.cronEveryNH", { n: 4 }) },
      { value: "*/6", label: t("crons.cronEveryNH", { n: 6 }) },
      { value: "*/12", label: t("crons.cronEveryNH", { n: 12 }) },
      { value: "0", label: "0:00" },
      { value: "6", label: "6:00" },
      { value: "8", label: "8:00" },
      { value: "9", label: "9:00" },
      { value: "12", label: "12:00" },
      { value: "18", label: "18:00" },
    ];
    const domOpts = [
      { value: "*", label: t("crons.cronAny") },
      { value: "1", label: "1" },
      { value: "15", label: "15" },
    ];
    const monthOpts = [
      { value: "*", label: t("crons.cronAny") },
      ...MONTH_KEYS.map((k, i) => ({ value: String(i + 1), label: t(`crons.${k}`) })),
    ];
    const dowOpts = [
      { value: "*", label: t("crons.cronAny") },
      { value: "1-5", label: t("crons.cronWeekdays") },
      { value: "0,6", label: t("crons.cronWeekends") },
      ...DOW_KEYS.map((k, i) => ({ value: String(i), label: t(`crons.${k}`) })),
    ];
    return [
      { label: t("crons.cronFieldMinute"), options: minuteOpts },
      { label: t("crons.cronFieldHour"), options: hourOpts },
      { label: t("crons.cronFieldDay"), options: domOpts },
      { label: t("crons.cronFieldMonth"), options: monthOpts },
      { label: t("crons.cronFieldWeekday"), options: dowOpts },
    ];
  }, [t]);

  const handleCronFieldChange = useCallback((index: number, value: string) => {
    const parts = parseCronFields(form.cronExpr || "* * * * *");
    parts[index] = value;
    update("cronExpr", parts.join(" "));
  }, [form.cronExpr, update]);

  /** Channels that have at least one connected/enabled account. */
  const connectedChannelOptions = useMemo(() => {
    if (!channelSnapshot) return [];
    const connected: { value: string; label: string }[] = [];
    for (const [channelId, accounts] of Object.entries(channelSnapshot.channelAccounts)) {
      const hasActive = accounts.some((a) => a.connected === true || a.enabled === true);
      if (!hasActive) continue;
      connected.push({
        value: channelId,
        label: channelSnapshot.channelLabels[channelId] || channelId,
      });
    }
    const orderMap = new Map(channelSnapshot.channelOrder.map((id, i) => [id, i]));
    connected.sort((a, b) => (orderMap.get(a.value) ?? 999) - (orderMap.get(b.value) ?? 999));
    return connected;
  }, [channelSnapshot]);

  /** Channel options with fallback for disconnected current selection (edit mode). */
  const channelOptions = useMemo(() => {
    if (!form.deliveryChannel) return connectedChannelOptions;
    if (connectedChannelOptions.some((o) => o.value === form.deliveryChannel)) return connectedChannelOptions;
    return [
      { value: form.deliveryChannel, label: `${form.deliveryChannel} (${t("crons.channelDisconnected")})` },
      ...connectedChannelOptions,
    ];
  }, [connectedChannelOptions, form.deliveryChannel, t]);

  /** Recipient options from allowlist, showing label (id) when available. */
  const recipientOptions = useMemo(() => {
    const opts = allowlist.map((entry) => {
      const lbl = recipientLabels[entry];
      return { value: entry, label: lbl ? `${lbl} (${entry})` : entry };
    });
    if (form.deliveryTo && !opts.some((o) => o.value === form.deliveryTo)) {
      const lbl = recipientLabels[form.deliveryTo];
      opts.unshift({ value: form.deliveryTo, label: lbl ? `${lbl} (${form.deliveryTo})` : form.deliveryTo });
    }
    return opts;
  }, [allowlist, form.deliveryTo, recipientLabels]);

  const handleChannelChange = useCallback((v: string) => {
    update("deliveryChannel", v);
    update("deliveryTo", "");
  }, [update]);

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={mode === "create" ? t("crons.createTitle") : t("crons.editTitle")}
      maxWidth={640}
    >
      <div className="modal-form-col">
        {submitError && <div className="error-alert">{submitError}</div>}

        {/* Name */}
        <div className="form-group">
          <label className="form-label-block">{t("crons.fieldName")} <span className="required">*</span></label>
          <input
            className="input-full"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder={t("crons.fieldName")}
          />
          {errors.name && <div className="crons-field-error">{t(`crons.${errors.name}`)}</div>}
        </div>

        {/* Description */}
        <div className="form-group">
          <label className="form-label-block">{t("crons.fieldDescription")}</label>
          <textarea
            className="input-full textarea-resize-vertical"
            rows={2}
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </div>

        <div className="cron-form-divider" />

        {/* Schedule type */}
        <div className="form-group">
          <label className="form-label-block">{t("crons.fieldScheduleType")} <span className="required">*</span></label>
          <div className="crons-schedule-type-row">
            {SCHEDULE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`crons-schedule-type-btn${form.scheduleKind === kind ? " crons-schedule-type-btn-active" : ""}`}
                onClick={() => update("scheduleKind", kind)}
              >
                {t(`crons.schedule${kind.charAt(0).toUpperCase()}${kind.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule fields */}
        {form.scheduleKind === "cron" && (
          <>
            <div className="form-group">
              <label className="form-label-block">{t("crons.fieldCronExpr")} <span className="required">*</span></label>
              {/* Quick presets */}
              <div className="crons-preset-grid">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.expr}
                    type="button"
                    className={`crons-preset-chip${form.cronExpr === p.expr ? " crons-preset-chip-active" : ""}`}
                    onClick={() => update("cronExpr", p.expr)}
                  >
                    {t(`crons.${p.key}`)}
                  </button>
                ))}
              </div>
              {/* Expression display + mode toggle */}
              <div className="crons-expr-bar">
                {showRawCron ? (
                  <input
                    className="crons-expr-input input-mono"
                    value={form.cronExpr}
                    onChange={(e) => update("cronExpr", e.target.value)}
                    placeholder="*/5 * * * *"
                  />
                ) : (
                  <code className="crons-expr-value">{form.cronExpr || "* * * * *"}</code>
                )}
                <div className="crons-mode-toggle">
                  <button
                    type="button"
                    className={`crons-mode-btn${!showRawCron ? " crons-mode-btn-active" : ""}`}
                    onClick={() => setShowRawCron(false)}
                  >
                    {t("crons.cronModeVisual")}
                  </button>
                  <button
                    type="button"
                    className={`crons-mode-btn${showRawCron ? " crons-mode-btn-active" : ""}`}
                    onClick={() => setShowRawCron(true)}
                  >
                    {t("crons.cronModeRaw")}
                  </button>
                </div>
              </div>
              {/* Visual builder (hidden in raw mode) */}
              {!showRawCron && (
                <div className="crons-builder-row">
                  {cronFieldDefs.map((field, i) => {
                    const parts = parseCronFields(form.cronExpr || "* * * * *");
                    const currentVal = parts[i];
                    const options = field.options.some((o) => o.value === currentVal)
                      ? field.options
                      : [{ value: currentVal, label: currentVal }, ...field.options];
                    return (
                      <div key={i}>
                        <span className="crons-builder-field-label">{field.label}</span>
                        <Select
                          value={currentVal}
                          onChange={(v) => handleCronFieldChange(i, v)}
                          options={options}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {errors.cronExpr && <div className="crons-field-error">{t(`crons.${errors.cronExpr}`)}</div>}
            </div>
            <div className="form-group">
              <label className="form-label-block">{t("crons.fieldTimezone")}</label>
              <Select
                searchable
                value={form.cronTz}
                onChange={(v) => update("cronTz", v)}
                options={TIMEZONE_ENTRIES.map((tz) => ({
                  value: tz.value,
                  label: t(`crons.${tz.i18nKey}`),
                }))}
              />
            </div>
          </>
        )}

        {form.scheduleKind === "every" && (
          <div className="form-group">
            <label className="form-label-block">{t("crons.fieldInterval")} <span className="required">*</span></label>
            <div className="crons-form-row">
              <input
                type="number"
                className="input-full"
                min={1}
                value={form.everyValue}
                onChange={(e) => update("everyValue", Number(e.target.value))}
              />
              <Select
                value={form.everyUnit}
                onChange={(v) => update("everyUnit", v as EveryUnit)}
                options={EVERY_UNITS.map((u) => ({ value: u, label: t(`crons.unit${u.charAt(0).toUpperCase()}${u.slice(1)}`) }))}
              />
            </div>
            {errors.everyValue && <div className="crons-field-error">{t(`crons.${errors.everyValue}`)}</div>}
          </div>
        )}

        {form.scheduleKind === "at" && (
          <div className="form-group">
            <label className="form-label-block">{t("crons.fieldRunAt")} <span className="required">*</span></label>
            <input
              type="datetime-local"
              className="input-full"
              value={form.atDatetime}
              onChange={(e) => {
                update("atDatetime", e.target.value);
                update("deleteAfterRun", true);
              }}
            />
            {errors.atDatetime && <div className="crons-field-error">{t(`crons.${errors.atDatetime}`)}</div>}
          </div>
        )}

        <div className="cron-form-divider" />

        {/* Payload kind */}
        <div className="form-group">
          <label className="form-label-block">
            {t("crons.fieldPayloadKind")} <span className="required">*</span>
            <InfoTip tooltipKey="tooltipPayloadKind" />
          </label>
          <Select
            value={form.payloadKind}
            onChange={(v) => update("payloadKind", v as PayloadKind)}
            options={PAYLOAD_KINDS.map((k) => ({
              value: k,
              label: t(`crons.payload${k.charAt(0).toUpperCase()}${k.slice(1)}`),
            }))}
          />
          <div className="form-hint">
            {form.payloadKind === "agentTurn"
              ? t("crons.sessionTargetIsolated")
              : t("crons.sessionTargetMain")
            }
          </div>
        </div>

        {/* Payload content */}
        {form.payloadKind === "agentTurn" ? (
          <div className="form-group">
            <label className="form-label-block">
              {t("crons.fieldMessage")} <span className="required">*</span>
              <InfoTip tooltipKey="tooltipMessage" />
            </label>
            <textarea
              className="input-full textarea-resize-vertical"
              rows={3}
              value={form.message}
              onChange={(e) => update("message", e.target.value)}
              placeholder={t("crons.fieldMessage")}
            />
            {errors.message && <div className="crons-field-error">{t(`crons.${errors.message}`)}</div>}
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label-block">
              {t("crons.fieldText")} <span className="required">*</span>
              <InfoTip tooltipKey="tooltipText" />
            </label>
            <textarea
              className="input-full textarea-resize-vertical"
              rows={3}
              value={form.text}
              onChange={(e) => update("text", e.target.value)}
              placeholder={t("crons.fieldText")}
            />
            {errors.text && <div className="crons-field-error">{t(`crons.${errors.text}`)}</div>}
          </div>
        )}

        {/* Delivery */}
        <div className="form-group">
          <label className="form-label-block">
            {t("crons.fieldDeliveryMode")}
            <InfoTip tooltipKey="tooltipDeliveryMode" />
          </label>
          {form.payloadKind === "systemEvent" ? (
            <>
              <Select
                value="none"
                onChange={() => {}}
                options={[{ value: "none", label: t("crons.deliveryNone") }]}
                disabled
              />
              <div className="form-hint">{t("crons.deliveryAgentOnly")}</div>
            </>
          ) : (
            <>
              <Select
                value={form.deliveryMode}
                onChange={(v) => update("deliveryMode", v as CronDeliveryMode)}
                options={DELIVERY_MODES.map((m) => ({
                  value: m,
                  label: t(`crons.delivery${m.charAt(0).toUpperCase()}${m.slice(1)}`),
                }))}
              />
              {form.deliveryMode === "announce" && (
                <>
                  <div className="form-group">
                    <label className="form-label-block">{t("crons.fieldDeliveryChannel")}</label>
                    {channelStatusLoading ? (
                      <Select
                        value=""
                        onChange={() => {}}
                        options={[]}
                        placeholder={t("crons.channelStatusLoading")}
                        disabled
                      />
                    ) : (
                      <>
                        <Select
                          value={form.deliveryChannel}
                          onChange={handleChannelChange}
                          options={channelOptions}
                          placeholder={t("crons.fieldDeliveryChannel")}
                        />
                        {channelOptions.length === 0 && (
                          <div className="form-hint">{t("crons.noConnectedChannels")}</div>
                        )}
                      </>
                    )}
                  </div>
                  {form.deliveryChannel && (
                    <div className="form-group">
                      <label className="form-label-block">{t("crons.fieldDeliveryRecipient")}</label>
                      <Select
                        searchable
                        creatable
                        value={form.deliveryTo}
                        onChange={(v) => update("deliveryTo", v)}
                        options={recipientOptions}
                        placeholder={
                          allowlistLoading
                            ? t("crons.channelStatusLoading")
                            : t("crons.recipientSelectOrType")
                        }
                        disabled={allowlistLoading}
                      />
                      {form.deliveryTo && (
                        <input
                          className="input-full"
                          value={recipientLabels[form.deliveryTo] ?? ""}
                          onChange={(e) => setRecipientLabels((prev) => ({ ...prev, [form.deliveryTo]: e.target.value }))}
                          onBlur={() => {
                            const label = recipientLabels[form.deliveryTo] ?? "";
                            setRecipientLabel(form.deliveryChannel, form.deliveryTo, label).catch(() => {});
                          }}
                          placeholder={t("crons.recipientLabelPlaceholder")}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
              {form.deliveryMode === "webhook" && (
                <div className="form-group">
                  <label className="form-label-block">{t("crons.fieldDeliveryTo")} <span className="required">*</span></label>
                  <input
                    className="input-full"
                    value={form.deliveryTo}
                    onChange={(e) => update("deliveryTo", e.target.value)}
                    placeholder="https://example.com/webhook"
                  />
                  {errors.deliveryTo && <div className="crons-field-error">{t(`crons.${errors.deliveryTo}`)}</div>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="cron-form-divider" />

        {/* Options */}
        <div className="form-group">
          <div className="crons-options-row">
            <label className="crons-checkbox-label">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => update("enabled", e.target.checked)}
              />
              {t("crons.fieldEnabled")}
            </label>
            <label className="crons-checkbox-label">
              <input
                type="checkbox"
                checked={form.deleteAfterRun}
                onChange={(e) => update("deleteAfterRun", e.target.checked)}
              />
              {t("crons.fieldDeleteAfterRun")}
              <InfoTip tooltipKey="tooltipDeleteAfterRun" />
            </label>
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          className="crons-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "▾" : "▸"} {t("crons.advancedOptions")}
        </button>

        {showAdvanced && (
          <div className="crons-advanced-content">
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
                    onChange={(e) => update("model", e.target.value)}
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
                    onChange={(v) => update("thinking", v)}
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
                    onChange={(e) => update("timeoutSeconds", e.target.value)}
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
                onChange={(v) => update("wakeMode", v as CronWakeMode)}
                options={WAKE_MODES.map((m) => ({
                  value: m,
                  label: t(`crons.wakeMode${m === "now" ? "Now" : "Heartbeat"}`),
                }))}
              />
            </div>
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {t("common.cancel")}
        </button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? t("common.loading") : mode === "create" ? t("crons.addJob") : t("common.save")}
        </button>
      </div>
    </Modal>
  );
}
