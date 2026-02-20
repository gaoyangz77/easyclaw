import { useTranslation } from "react-i18next";
import { getProviderMeta } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import type { ProviderPricing, ProviderSubscription, Plan } from "../api.js";

/** Find a subscription by ID across all provider documents. */
function findSubscription(
  pricingList: ProviderPricing[] | null,
  subId: string,
): { sub: ProviderSubscription; currency: string; pricingUrl: string } | null {
  for (const pp of pricingList ?? []) {
    const sub = pp.subscriptions?.find((s) => s.id === subId);
    if (sub) return { sub, currency: pp.currency, pricingUrl: sub.pricingUrl };
  }
  return null;
}

function isFree(price: string): boolean {
  return price === "0" || price === "0.00" || price === "—";
}

export function PricingTable({
  provider,
  pricingList,
  loading,
}: {
  provider: string;
  pricingList: ProviderPricing[] | null;
  loading: boolean;
}) {
  const { t } = useTranslation();

  const data = pricingList?.find((p) => p.provider === provider) ?? null;
  const currencySymbol = data?.currency === "CNY" ? "¥" : "$";
  const providerLabel = getProviderMeta(provider as LLMProvider)?.label ?? provider;

  return (
    <div className="section-card pricing-card">
      <h4 className="pricing-heading">
        {providerLabel} — {t("providers.pricingTitle")}
        <span className="pricing-subtitle">
          {t("providers.pricingPerMillion")}
        </span>
      </h4>

      {loading && (
        <div className="pricing-status">
          <span className="spinner" style={{ marginRight: 6 }} />
          {t("common.loading")}
        </div>
      )}

      {!loading && !data && (
        <div className="pricing-status-compact">
          <div>{t("providers.pricingUnavailable")}</div>
          <a
            href={getProviderMeta(provider as LLMProvider)?.url}
            target="_blank"
            rel="noopener noreferrer"
            className="pricing-link"
            style={{ marginTop: 6, display: "inline-block" }}
          >
            {t("providers.pricingViewFull")} &rarr;
          </a>
        </div>
      )}

      {!loading && data && (
        <>
          {data.currency !== "USD" && (
            <div className="pricing-currency-note">
              {t("providers.pricingCurrency")}: {data.currency}
            </div>
          )}
          <div className="pricing-scroll">
            <table className="pricing-inner-table">
              <thead>
                <tr>
                  <th>
                    {t("providers.pricingModel")}
                  </th>
                  <th>
                    {t("providers.pricingInput")}
                  </th>
                  <th>
                    {t("providers.pricingOutput")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m) => {
                  const modelFree = isFree(m.inputPricePerMillion) && isFree(m.outputPricePerMillion);
                  return (
                    <tr key={m.modelId}>
                      <td>
                        <div className="pricing-model-name">
                          {m.displayName}
                        </div>
                        {m.note && (
                          <div className="pricing-model-note">{m.note}</div>
                        )}
                      </td>
                      <td className="pricing-price">
                        {modelFree ? t("providers.pricingFree") : m.inputPricePerMillion === "—" ? "—" : `${currencySymbol}${m.inputPricePerMillion}`}
                      </td>
                      <td className="pricing-price">
                        {modelFree ? t("providers.pricingFree") : m.outputPricePerMillion === "—" ? "—" : `${currencySymbol}${m.outputPricePerMillion}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pricing-disclaimer">
            {t("providers.pricingDisclaimer")}
          </div>
          <div className="pricing-footer-link">
            <a
              href={data.pricingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pricing-link"
            >
              {t("providers.pricingViewFull")} &rarr;
            </a>
          </div>
        </>
      )}
    </div>
  );
}

export function SubscriptionPricingTable({
  provider,
  pricingList,
  loading,
}: {
  provider: string;
  pricingList: ProviderPricing[] | null;
  loading: boolean;
}) {
  const { t } = useTranslation();

  const result = findSubscription(pricingList, provider);
  const plans: Plan[] = result?.sub.plans ?? [];
  const providerLabel = getProviderMeta(provider as LLMProvider)?.label ?? provider;

  return (
    <div className="section-card pricing-card">
      <h4 className="pricing-heading">
        {providerLabel} — {t("providers.pricingPlansTitle")}
      </h4>

      {loading && (
        <div className="pricing-status">
          <span className="spinner" style={{ marginRight: 6 }} />
          {t("common.loading")}
        </div>
      )}

      {!loading && plans.length === 0 && (
        <div className="pricing-status-compact">
          <div>{t("providers.pricingPlansUnavailable")}</div>
          {getProviderMeta(provider as LLMProvider)?.subscriptionUrl && (
            <a
              href={getProviderMeta(provider as LLMProvider)?.subscriptionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pricing-link"
              style={{ marginTop: 6, display: "inline-block" }}
            >
              {t("providers.pricingViewFull")} &rarr;
            </a>
          )}
        </div>
      )}

      {!loading && plans.length > 0 && (
        <>
          <div className="pricing-scroll">
            {plans.map((plan) => {
              const symbol = plan.currency === "CNY" ? "¥" : "$";
              return (
                <div key={plan.planName} className="pricing-plan-block">
                  <div className="pricing-plan-header">
                    <span className="pricing-plan-name">{plan.planName}</span>
                    <span className="pricing-plan-price">{symbol}{plan.price}</span>
                  </div>
                  {plan.planDetail.length > 0 && (
                    <table className="pricing-inner-table">
                      <tbody>
                        {plan.planDetail.map((d) => (
                          <tr key={d.modelName}>
                            <td>{d.modelName}</td>
                            <td className="pricing-plan-volume">{d.volume}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pricing-disclaimer">
            {t("providers.pricingDisclaimer")}
          </div>
          {(getProviderMeta(provider as LLMProvider)?.subscriptionUrl || result?.pricingUrl) && (
            <div className="pricing-footer-link">
              <a
                href={getProviderMeta(provider as LLMProvider)?.subscriptionUrl || result?.pricingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pricing-link"
              >
                {t("providers.pricingViewFull")} &rarr;
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
