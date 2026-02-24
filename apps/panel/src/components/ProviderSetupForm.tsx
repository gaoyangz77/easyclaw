import { SUBSCRIPTION_PROVIDER_IDS, API_PROVIDER_IDS, getProviderMeta } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { ProviderSelect } from "./ProviderSelect.js";
import { PricingTable, SubscriptionPricingTable } from "./PricingTable.js";
import { useProviderForm } from "./provider-setup/use-provider-form.js";
import { LocalModelForm } from "./provider-setup/LocalModelForm.js";
import { ApiKeyForm } from "./provider-setup/ApiKeyForm.js";
import { OAuthProviderForm } from "./provider-setup/OAuthProviderForm.js";


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
  const { t, tab, handleTabChange, provider, handleProviderChange, error, leftCardRef, leftHeight, pricingList, pricingLoading } = form;

  const providerFilter = tab === "subscription" ? SUBSCRIPTION_PROVIDER_IDS : API_PROVIDER_IDS;
  const isOAuth = !!getProviderMeta(provider as LLMProvider)?.oauth;

  return (
    <div className="page-two-col">
      <div ref={leftCardRef} className={variant === "card" ? "section-card page-col-main" : "flex-1"}>
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
        </div>

        {tab === "local" ? (
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

      {/* Right: Pricing table / Local info */}
      <div className="page-col-side" style={{ height: leftHeight }}>
        {tab === "local" ? (
          <div className="info-box info-box-blue local-info-box">
            <strong>{t("providers.localInfoTitle")}</strong>
            <p className="local-info-body">
              {t("providers.localInfoBody")}
            </p>
          </div>
        ) : tab === "subscription" ? (
          <SubscriptionPricingTable provider={provider} pricingList={pricingList} loading={pricingLoading} />
        ) : (
          <PricingTable provider={provider} pricingList={pricingList} loading={pricingLoading} />
        )}
      </div>
    </div>
  );
}
