import type { ProviderFormState } from "./use-provider-form.js";

export function LocalModelForm({
  form,
  saveButtonLabel,
  savingLabel,
}: {
  form: ProviderFormState;
  saveButtonLabel?: string;
  savingLabel?: string;
}) {
  const {
    t,
    baseUrl, setBaseUrl, setBaseUrlTouched,
    modelName, setModelName, label, setLabel,
    apiKey, setApiKey, saving, healthStatus,
    detecting, localModels, loadingModels,
    showAdvanced, setShowAdvanced,
    handleAddLocalKey,
  } = form;

  return (
    <>
      {/* Local LLM form */}
      <div className="mb-sm">
        <div className="form-label text-secondary">{t("providers.baseUrlLabel")}</div>
        <div className="form-row form-row-vcenter">
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); setBaseUrlTouched(true); }}
            placeholder={t("providers.baseUrlPlaceholder")}
            className="flex-1 input-mono"
          />
          {healthStatus && (
            <span className={`badge ${healthStatus.ok ? "badge-success" : "badge-danger"}`}>
              {healthStatus.ok ? t("providers.connectionSuccess") : t("providers.connectionFailed")}
            </span>
          )}
          {detecting && <span className="badge badge-muted">...</span>}
        </div>
        <small className="form-help-sm">{t("providers.baseUrlHelp")}</small>
      </div>

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
          <div className="form-label text-secondary">{t("providers.modelNameLabel")}</div>
          <select
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            className="input-full input-mono"
          >
            {localModels.length === 0 && <option value="">—</option>}
            {localModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </select>
          <small className="form-help-sm">
            {loadingModels ? "..." : t("providers.modelNameHelp")}
          </small>
        </div>
      </div>

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
            <div className="form-label text-secondary">{t("providers.apiKeyLabel")}</div>
            <input
              type="password"
              autoComplete="off"
              data-1p-ignore
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="input-full input-mono"
            />
            <small className="form-help-sm">{t("providers.localApiKeyHelp")}</small>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleAddLocalKey}
          disabled={saving || !modelName.trim()}
        >
          {saving ? (savingLabel || "...") : (saveButtonLabel || t("common.save"))}
        </button>
      </div>
    </>
  );
}
