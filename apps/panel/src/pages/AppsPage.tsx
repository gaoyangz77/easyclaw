import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { formatError } from "@easyclaw/core";
import {
  fetchCSStatus,
  startCS,
  stopCS,
  updateCSConfig,
  fetchCSPlatforms,
  fetchWeComConfigStatus,
  saveWeComConfig,
  deleteWeComConfig,
  type CustomerServiceStatus,
  type WeComConfigInput,
} from "../api/index.js";

/** Map raw backend error messages to i18n keys for user-friendly display. */
function translateBackendError(rawMessage: string, t: (key: string) => string): string {
  if (rawMessage.includes("Invalid or missing panel token") || rawMessage.includes("Invalid or missing API token")) {
    return t("customerService.errorInvalidToken");
  }
  if (rawMessage.includes("Panel token is not configured")) {
    return t("customerService.errorTokenNotConfigured");
  }
  if (rawMessage.includes("Invalid WeCom credentials")) {
    return t("customerService.errorInvalidCredentials");
  }
  if (rawMessage.includes("No customer service accounts found")) {
    return t("customerService.errorNoKfAccounts");
  }
  if (rawMessage.includes("No customer service account matches")) {
    return t("customerService.errorKfLinkIdMismatch");
  }
  if (rawMessage.includes("corpId does not match")) {
    return t("customerService.errorCorpIdMismatch");
  }
  if (rawMessage.includes("WeCom API request failed") || rawMessage.includes("Failed to list CS accounts")) {
    return t("customerService.errorApiUnavailable");
  }
  if (rawMessage.includes("GraphQL API returned") || rawMessage.includes("fetch failed") || rawMessage.includes("ECONNREFUSED")) {
    return t("customerService.errorServerUnavailable");
  }
  return t("customerService.errorUnknown");
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className={`toggle-track ${checked ? "toggle-track-on" : "toggle-track-off"} ${disabled ? "toggle-track-disabled" : ""}`}>
        <span className={`toggle-thumb ${checked ? "toggle-thumb-on" : "toggle-thumb-off"}`} />
      </span>
    </label>
  );
}

export function AppsPage() {
  const { t, i18n } = useTranslation();

  // WeCom config state
  const [wecomForm, setWecomForm] = useState<WeComConfigInput>({
    corpId: "",
    appSecret: "",
    token: "",
    encodingAesKey: "",
    kfLinkId: "",
  });
  const [wecomPanelToken, setWecomPanelToken] = useState("");
  const [wecomConfigStatus, setWecomConfigStatus] = useState<"idle" | "saving" | "saved" | "error" | "deleting" | "deleted">("idle");
  const [wecomConfigError, setWecomConfigError] = useState<string | null>(null);
  const [wecomSavedCorpId, setWecomSavedCorpId] = useState<string | null>(null);
  const [wecomHasToken, setWecomHasToken] = useState(false);

  // Dialog state
  const [showCredentialDialog, setShowCredentialDialog] = useState(false);
  const [showPromptDialog, setShowPromptDialog] = useState(false);

  // Connection state
  const [status, setStatus] = useState<CustomerServiceStatus | null>(null);
  const [connectionState, setConnectionState] = useState<"connected" | "disconnected" | "connecting">("disconnected");

  // Business prompt state
  const [businessPrompt, setBusinessPrompt] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Starting/stopping
  const [actionLoading, setActionLoading] = useState(false);

  // Poll timer ref
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      const data = await fetchCSStatus();
      if (data) {
        setStatus(data);
        setConnectionState(data.connected ? "connected" : "disconnected");
      } else {
        setStatus(null);
        setConnectionState("disconnected");
      }
    } catch {
      setConnectionState("disconnected");
    }
  }, []);

  // Load WeCom config status on mount
  useEffect(() => {
    fetchWeComConfigStatus()
      .then((data) => {
        setWecomSavedCorpId(data.corpId);
        setWecomHasToken(data.hasToken);
      })
      .catch(() => {});
  }, []);

  // Poll status every 5 seconds
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      await pollStatus();
      if (!cancelled) {
        pollTimerRef.current = setTimeout(poll, 5000);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, [pollStatus]);

  function updateWecomField(field: keyof WeComConfigInput, value: string) {
    setWecomForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSaveWecomConfig() {
    setWecomConfigStatus("saving");
    setWecomConfigError(null);
    const lang = i18n.language === "zh" ? "zh" : "en";
    try {
      await saveWeComConfig(wecomForm, wecomPanelToken, lang);
      setWecomConfigStatus("saved");
      setWecomSavedCorpId(wecomForm.corpId);
      setWecomHasToken(true);
      setTimeout(() => {
        setWecomConfigStatus("idle");
        setShowCredentialDialog(false);
      }, 1500);
    } catch (err) {
      setWecomConfigStatus("error");
      setWecomConfigError(translateBackendError(formatError(err), t));
    }
  }

  async function handleDeleteWecomConfig() {
    const corpId = wecomForm.corpId || wecomSavedCorpId;
    if (!corpId) return;

    const confirmed = window.confirm(t("customerService.wecomConfigDeleteConfirm"));
    if (!confirmed) return;

    setWecomConfigStatus("deleting");
    setWecomConfigError(null);
    const lang = i18n.language === "zh" ? "zh" : "en";
    try {
      await deleteWeComConfig(corpId, wecomPanelToken, lang);
      setWecomConfigStatus("deleted");
      setWecomSavedCorpId(null);
      setWecomForm({ corpId: "", appSecret: "", token: "", encodingAesKey: "", kfLinkId: "" });
      setTimeout(() => {
        setWecomConfigStatus("idle");
      }, 1500);
    } catch (err) {
      setWecomConfigStatus("error");
      setWecomConfigError(translateBackendError(formatError(err), t));
    }
  }

  const wecomFormValid =
    wecomForm.corpId.trim() !== "" &&
    wecomForm.appSecret.trim() !== "" &&
    wecomForm.token.trim() !== "" &&
    wecomForm.encodingAesKey.trim() !== "" &&
    wecomForm.kfLinkId.trim() !== "" &&
    (wecomPanelToken.trim() !== "" || wecomHasToken);

  const isRunning = status !== null;
  const isConnected = connectionState === "connected";

  async function handleToggle(enabled: boolean) {
    setActionLoading(true);
    try {
      if (enabled) {
        setConnectionState("connecting");
        await startCS({ businessPrompt, platforms: ["wecom"] });
        await pollStatus();
      } else {
        await stopCS();
        setConnectionState("disconnected");
        setStatus(null);
      }
    } catch {
      setConnectionState("disconnected");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSavePrompt() {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      setBusinessPrompt(promptDraft);
      await updateCSConfig({ businessPrompt: promptDraft });
      setSaveStatus("saved");
      setTimeout(() => {
        setSaveStatus("idle");
        setShowPromptDialog(false);
      }, 1500);
    } catch (err) {
      setSaveStatus("error");
      setSaveError(formatError(err));
    }
  }

  function openPromptDialog() {
    setPromptDraft(businessPrompt);
    setSaveStatus("idle");
    setSaveError(null);
    setShowPromptDialog(true);
  }

  function openCredentialDialog() {
    setWecomConfigStatus("idle");
    setWecomConfigError(null);
    setShowCredentialDialog(true);
  }

  const boundCustomers = status?.platforms?.find((p) => p.platform === "wecom")?.boundCustomers ?? 0;

  return (
    <div>
      <h1>{t("customerService.title")}</h1>

      <div className="section-card cs-card">
        <h3>{t("customerService.wecomCardTitle")}</h3>
        <p className="form-hint cs-card-desc">{t("customerService.wecomCardDesc")}</p>

        {/* Config rows */}
        <div className="cs-card-rows">
          <div className="cs-card-row">
            <span className="cs-card-row-label">{t("customerService.wecomCredentials")}</span>
            <span className="cs-card-row-value">
              {wecomSavedCorpId ? (
                <span className="badge badge-success">{t("customerService.wecomConfigured")}</span>
              ) : (
                <span className="badge badge-muted">{t("customerService.wecomNotConfigured")}</span>
              )}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={openCredentialDialog} type="button">
              {t("customerService.configure")}
            </button>
          </div>

          <div className="cs-card-row">
            <span className="cs-card-row-label">{t("customerService.businessPromptSection")}</span>
            <span className="cs-card-row-value">
              {businessPrompt ? (
                <span className="cs-card-prompt-preview">{businessPrompt.slice(0, 40)}{businessPrompt.length > 40 ? "..." : ""}</span>
              ) : (
                <span className="badge badge-muted">{t("customerService.promptNotSet")}</span>
              )}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={openPromptDialog} type="button">
              {t("common.edit")}
            </button>
          </div>

          {isRunning && (
            <div className="cs-card-row">
              <span className="cs-card-row-label">{t("customerService.boundCustomers")}</span>
              <span className="cs-card-row-value">{boundCustomers}</span>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="cs-card-footer">
          <ToggleSwitch
            checked={isRunning}
            onChange={handleToggle}
            disabled={actionLoading}
          />
          <span className="cs-card-footer-label">
            {isRunning ? t("customerService.enabled") : t("customerService.disabled")}
          </span>
          {isRunning && (
            <span className={`badge ${isConnected ? "badge-success" : connectionState === "connecting" ? "badge-warning" : "badge-danger"}`}>
              {isConnected ? t("customerService.connected") : connectionState === "connecting" ? t("customerService.connecting") : t("customerService.disconnected")}
            </span>
          )}
        </div>
      </div>

      {/* Credential Dialog */}
      {showCredentialDialog && (
        <div className="modal-backdrop" onClick={() => setShowCredentialDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t("customerService.wecomConfigSection")}</h2>
              <button className="modal-close-btn" onClick={() => setShowCredentialDialog(false)} type="button">&times;</button>
            </div>

            <p className="form-hint">{t("customerService.wecomConfigDescription")}</p>

            <div className="form-group">
              <label className="form-label-block">{t("customerService.wecomInvitationCode")}</label>
              <div className="form-hint">{t("customerService.wecomInvitationCodeHint")}</div>
              <input
                type="password"
                className="input-full"
                placeholder={t("customerService.wecomInvitationCodePlaceholder")}
                value={wecomPanelToken}
                onChange={(e) => setWecomPanelToken(e.target.value)}
              />
            </div>

            <div className="cs-credential-group">
              <div className="form-hint">
                {t("customerService.wecomCallbackCredentialsHint")}
                {" — "}
                <a href="https://kf.weixin.qq.com/kf/frame#/config" target="_blank" rel="noopener noreferrer">
                  {t("customerService.wecomCallbackCredentialsLink")} ↗
                </a>
              </div>

              <div className="form-group">
                <label className="form-label-block">{t("customerService.wecomCorpId")}</label>
                <input type="text" className="input-full" placeholder={t("customerService.wecomCorpIdPlaceholder")} value={wecomForm.corpId} onChange={(e) => updateWecomField("corpId", e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label-block">{t("customerService.wecomAppSecret")}</label>
                <input type="password" className="input-full" placeholder={t("customerService.wecomAppSecretPlaceholder")} value={wecomForm.appSecret} onChange={(e) => updateWecomField("appSecret", e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label-block">{t("customerService.wecomToken")}</label>
                <input type="text" className="input-full" placeholder={t("customerService.wecomTokenPlaceholder")} value={wecomForm.token} onChange={(e) => updateWecomField("token", e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label-block">{t("customerService.wecomEncodingAesKey")}</label>
                <input type="password" className="input-full" placeholder={t("customerService.wecomEncodingAesKeyPlaceholder")} value={wecomForm.encodingAesKey} onChange={(e) => updateWecomField("encodingAesKey", e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label-block">{t("customerService.wecomKfLinkId")}</label>
              <input type="text" className="input-full" placeholder={t("customerService.wecomKfLinkIdPlaceholder")} value={wecomForm.kfLinkId} onChange={(e) => updateWecomField("kfLinkId", e.target.value)} />
            </div>

            {wecomConfigError && (
              <div className="error-alert">{wecomConfigError}</div>
            )}

            <div className="modal-actions">
              {wecomConfigStatus === "saved" && (
                <span className="badge badge-success">{t("customerService.wecomConfigSaved")}</span>
              )}
              {wecomConfigStatus === "deleted" && (
                <span className="badge badge-success">{t("customerService.wecomConfigDeleted")}</span>
              )}
              {wecomSavedCorpId && (
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteWecomConfig}
                  disabled={wecomConfigStatus === "deleting" || wecomConfigStatus === "saving"}
                  type="button"
                >
                  {wecomConfigStatus === "deleting" ? t("customerService.wecomConfigDeleting") : t("customerService.wecomConfigDelete")}
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSaveWecomConfig}
                disabled={!wecomFormValid || wecomConfigStatus === "saving" || wecomConfigStatus === "deleting"}
                type="button"
              >
                {wecomConfigStatus === "saving" ? t("customerService.wecomConfigSaving") : t("customerService.wecomConfigSave")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Business Prompt Dialog */}
      {showPromptDialog && (
        <div className="modal-backdrop" onClick={() => setShowPromptDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t("customerService.businessPromptSection")}</h2>
              <button className="modal-close-btn" onClick={() => setShowPromptDialog(false)} type="button">&times;</button>
            </div>

            <div className="form-group">
              <div className="form-hint">{t("customerService.businessPromptHelp")}</div>
              <textarea
                className="input-full cs-prompt-textarea"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
              />
            </div>

            {saveError && (
              <div className="error-alert">{saveError}</div>
            )}

            <div className="modal-actions">
              {saveStatus === "saved" && (
                <span className="badge badge-success">{t("customerService.saved")}</span>
              )}
              <button className="btn btn-secondary" onClick={() => setShowPromptDialog(false)} type="button">
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSavePrompt}
                disabled={saveStatus === "saving"}
                type="button"
              >
                {saveStatus === "saving" ? t("common.loading") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
