import { getProviderMeta, getDefaultModelForProvider } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { ModelSelect } from "../ModelSelect.js";
import type { ProviderFormState } from "./use-provider-form.js";

export function OAuthProviderForm({
  form,
  saveButtonLabel,
  validatingLabel,
  savingLabel,
}: {
  form: ProviderFormState;
  saveButtonLabel?: string;
  validatingLabel?: string;
  savingLabel?: string;
}) {
  const {
    t,
    provider, label, setLabel, model, setModel,
    proxyUrl, setProxyUrl,
    showAdvanced, setShowAdvanced,
    saving, validating,
    oauthLoading, oauthTokenPreview, oauthManualMode,
    oauthAuthUrl, oauthCallbackUrl, setOauthCallbackUrl, oauthManualLoading,
    handleOAuth, handleManualOAuthComplete, handleOAuthSave,
  } = form;

  const btnSave = saveButtonLabel || t("common.save");
  const btnValidating = validatingLabel || t("providers.validating");
  const btnSaving = savingLabel || "...";

  return (
    <>
      {/* OAuth form */}
      <div className="form-row mb-sm">
        <div className="form-col-4">
          <div className="form-label text-secondary">{t("providers.keyLabel")}</div>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("providers.labelPlaceholder")}
            className="input-full"
          />
        </div>
        <div className="form-col-6">
          <div className="form-label text-secondary">{t("providers.modelLabel")}</div>
          <ModelSelect
            provider={provider}
            value={model || (getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? "")}
            onChange={setModel}
          />
        </div>
      </div>

      {getProviderMeta(provider as LLMProvider)?.subscriptionUrl && (
      <div className="form-help-sm provider-links">
        <a
          href={getProviderMeta(provider as LLMProvider)?.subscriptionUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("providers.getSubscription")} &rarr;
        </a>
        {/* No "Get API key" link for OAuth providers — they use web login, not API keys. */}
      </div>
      )}

      {oauthManualMode ? (
        <div className="mb-sm">
          <div className="info-box info-box-yellow">
            {t("providers.oauthManualInfo")}
          </div>
          <div className="mb-sm">
            <div className="form-label text-secondary">
              {t("providers.oauthManualUrlLabel")}
            </div>
            <div className="oauth-manual-url-row">
              <input
                type="text"
                readOnly
                value={oauthAuthUrl}
                className="input-full input-mono input-readonly"
              />
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => navigator.clipboard.writeText(oauthAuthUrl)}
              >
                {t("common.copy")}
              </button>
            </div>
          </div>
          <div>
            <div className="form-label text-secondary">
              {t("providers.oauthManualCallbackLabel")} <span className="required">*</span>
            </div>
            <input
              type="text"
              value={oauthCallbackUrl}
              onChange={(e) => setOauthCallbackUrl(e.target.value)}
              placeholder={t("providers.oauthManualCallbackPlaceholder")}
              className="input-full input-mono"
            />
            <small className="form-help-sm">
              {t("providers.oauthManualCallbackHelp")}
            </small>
          </div>
        </div>
      ) : oauthTokenPreview ? (
        <div className="mb-sm">
          <div className="form-label text-secondary">
            {t("providers.oauthTokenLabel")}
          </div>
          <input
            type="text"
            readOnly
            value={oauthTokenPreview}
            className="input-full input-mono input-readonly"
          />
          <small className="form-help-sm">
            {t("providers.oauthTokenHelp")}
          </small>
        </div>
      ) : (
        <div className="info-box info-box-green">
          {t("providers.oauthGeminiInfo")}
        </div>
      )}

      {!oauthManualMode && (
      <div className="mb-sm">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="advanced-toggle"
        >
          <span className={`advanced-chevron${showAdvanced ? " advanced-chevron-open" : ""}`}>&#9654;</span>
          {t("providers.advancedSettings")}
        </button>
        {showAdvanced && (
          <div className="advanced-content">
            <div className="form-label text-secondary">{t("providers.proxyLabel")}</div>
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder={t("providers.proxyPlaceholder")}
              className="input-full input-mono"
            />
            <small className="form-help-sm">
              {t("providers.proxyHelp")}
            </small>
          </div>
        )}
      </div>
      )}

      <div className="form-actions">
        {oauthManualMode ? (
          <button
            className="btn btn-primary"
            onClick={handleManualOAuthComplete}
            disabled={oauthManualLoading || !oauthCallbackUrl.trim()}
          >
            {oauthManualLoading ? t("providers.oauthLoading") : t("providers.oauthManualSubmit")}
          </button>
        ) : oauthTokenPreview ? (
          <button
            className="btn btn-primary"
            onClick={handleOAuthSave}
            disabled={saving || validating}
          >
            {validating ? btnValidating : saving ? btnSaving : btnSave}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleOAuth}
            disabled={oauthLoading}
          >
            {oauthLoading ? t("providers.oauthLoading") : t("providers.oauthSignIn")}
          </button>
        )}
      </div>
    </>
  );
}
