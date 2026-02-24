import { getProviderMeta, getDefaultModelForProvider } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { ModelSelect } from "../ModelSelect.js";
import type { ProviderFormState } from "./use-provider-form.js";

export function ApiKeyForm({
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
    tab, provider, label, setLabel, model, setModel,
    apiKey, setApiKey, proxyUrl, setProxyUrl,
    showAdvanced, setShowAdvanced,
    saving, validating, handleAddKey,
  } = form;

  const isAnthropicSub = provider === "claude";
  const btnSave = saveButtonLabel || t("common.save");
  const btnValidating = validatingLabel || t("providers.validating");
  const btnSaving = savingLabel || "...";

  return (
    <>
      {isAnthropicSub && (
        <div className="info-box info-box-yellow">
          {t("providers.anthropicTokenWarning")}
        </div>
      )}

      <div className="form-row mb-sm">
        <div style={{ flex: 4 }}>
          <div className="form-label text-secondary">{t("providers.keyLabel")}</div>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("providers.labelPlaceholder")}
            className="input-full"
          />
        </div>
        <div style={{ flex: 6 }}>
          <div className="form-label text-secondary">{t("providers.modelLabel")}</div>
          <ModelSelect
            provider={provider}
            value={model || (getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? "")}
            onChange={setModel}
          />
        </div>
      </div>

      <div className="mb-sm">
        <div className="form-label text-secondary">
          {isAnthropicSub ? t("providers.anthropicTokenLabel") : t("providers.apiKeyLabel")} <span className="required">*</span>
        </div>
        <input
          type="password"
          autoComplete="off"
          data-1p-ignore
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={isAnthropicSub ? t("providers.anthropicTokenPlaceholder") : t("providers.apiKeyPlaceholder")}
          className="input-full input-mono"
        />
        {tab === "subscription" ? (
          getProviderMeta(provider as LLMProvider)?.subscriptionUrl && (
          <div className="form-help-sm provider-links">
            <a
              href={getProviderMeta(provider as LLMProvider)?.subscriptionUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("providers.getSubscription")} &rarr;
            </a>
            {getProviderMeta(provider as LLMProvider)?.apiKeyUrl &&
             getProviderMeta(provider as LLMProvider)?.apiKeyUrl !== getProviderMeta(provider as LLMProvider)?.subscriptionUrl && (
            <a
              href={getProviderMeta(provider as LLMProvider)?.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("providers.getApiKey")} &rarr;
            </a>
            )}
          </div>
          )
        ) : (
          getProviderMeta(provider as LLMProvider)?.apiKeyUrl && (
          <div className="form-help-sm provider-links">
            <a
              href={getProviderMeta(provider as LLMProvider)?.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("providers.getApiKey")} &rarr;
            </a>
          </div>
          )
        )}
      </div>

      <div className="mb-sm">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="advanced-toggle"
        >
          <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>&#9654;</span>
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

      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleAddKey}
          disabled={saving || validating || !apiKey.trim()}
        >
          {validating ? btnValidating : saving ? btnSaving : btnSave}
        </button>
      </div>
    </>
  );
}
