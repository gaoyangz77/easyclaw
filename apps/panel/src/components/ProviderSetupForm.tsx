import { SUBSCRIPTION_PROVIDER_IDS, API_PROVIDER_IDS, getProviderMeta } from "@rivonclaw/core";
import type { LLMProvider } from "@rivonclaw/core";
import { ProviderSelect } from "./inputs/ProviderSelect.js";
import { useProviderForm } from "./provider-setup/use-provider-form.js";
import { LocalModelForm } from "./provider-setup/LocalModelForm.js";
import { ApiKeyForm } from "./provider-setup/ApiKeyForm.js";
import { OAuthProviderForm } from "./provider-setup/OAuthProviderForm.js";
import { CustomProviderForm } from "./provider-setup/CustomProviderForm.js";


export interface ProviderSetupFormProps {
  /** Called after a provider key is successfully saved. */
  onSave: (provider: string) => void;
  /** Form card title. */
  title?: string;
  /** Description below the title. */
  description?: string;
  /** Primary save button label (defaults to t("common.save")). */
  saveButtonLabel?: string;
  /** Validating state label (defaults to t("providers.validating")). */
  validatingLabel?: string;
  /** Saving state label (defaults to "..."). */
  savingLabel?: string;
  /** "card" (default): section-card with h3. "page": no card, h1 heading for standalone pages like onboarding. */
  variant?: "card" | "page";
}

export function ProviderSetupForm({
  onSave,
  title,
  description,
  saveButtonLabel,
  validatingLabel,
  savingLabel,
  variant = "card",
}: ProviderSetupFormProps) {
  const form = useProviderForm(onSave);
  const { t, tab, handleTabChange, provider, handleProviderChange, error } = form;

  const providerFilter = tab === "subscription" ? SUBSCRIPTION_PROVIDER_IDS : API_PROVIDER_IDS;
  const isOAuth = !!getProviderMeta(provider as LLMProvider)?.oauth;

  return (
    <div className={variant === "card" ? "section-card" : ""}>
      {title && (variant === "card" ? <h3>{title}</h3> : <h1>{title}</h1>)}
      {description && <p>{description}</p>}

      {error && (
        <div className="error-alert">
          {t(error.key)}{error.detail}
          {error.hover && <details className="error-details"><summary>{t("providers.errorDetails")}</summary><code>{error.hover}</code></details>}
        </div>
      )}

      <div className="tab-bar">
        <button
          className={`tab-btn${tab === "subscription" ? " tab-btn-active" : ""}`}
          onClick={() => handleTabChange("subscription")}
        >
          {t("providers.tabSubscription")}
        </button>
        <button
          className={`tab-btn${tab === "api" ? " tab-btn-active" : ""}`}
          onClick={() => handleTabChange("api")}
        >
          {t("providers.tabApi")}
        </button>
        <button
          className={`tab-btn${tab === "local" ? " tab-btn-active" : ""}`}
          onClick={() => handleTabChange("local")}
        >
          {t("providers.tabLocal")}
        </button>
        <button
          className={`tab-btn${tab === "custom" ? " tab-btn-active" : ""}`}
          onClick={() => handleTabChange("custom")}
        >
          {t("providers.tabCustom")}
        </button>
      </div>

      {tab === "custom" ? (
        <CustomProviderForm form={form} saveButtonLabel={saveButtonLabel} validatingLabel={validatingLabel} savingLabel={savingLabel} />
      ) : tab === "local" ? (
        <LocalModelForm form={form} saveButtonLabel={saveButtonLabel} savingLabel={savingLabel} />
      ) : (
        <>
          <div className="mb-sm">
            <div className="form-label text-secondary">{t("onboarding.providerLabel")}</div>
            <ProviderSelect value={provider} onChange={handleProviderChange} providers={providerFilter} />
          </div>

          {isOAuth ? (
            <OAuthProviderForm form={form} saveButtonLabel={saveButtonLabel} validatingLabel={validatingLabel} savingLabel={savingLabel} />
          ) : (
            <ApiKeyForm form={form} saveButtonLabel={saveButtonLabel} validatingLabel={validatingLabel} savingLabel={savingLabel} />
          )}
        </>
      )}
    </div>
  );
}
