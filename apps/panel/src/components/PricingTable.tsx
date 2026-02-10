import { useTranslation } from "react-i18next";
import { PROVIDER_URLS, PROVIDER_LABELS } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import type { ProviderPricing } from "../api.js";

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
  const providerLabel = PROVIDER_LABELS[provider as LLMProvider] ?? provider;

  return (
    <div className="section-card" style={{ padding: "16px 18px" }}>
      <h4 style={{ margin: "0 0 4px 0", fontSize: 14 }}>
        {providerLabel} — {t("providers.pricingTitle")}
        <span style={{ fontSize: 11, color: "#888", fontWeight: 400, marginLeft: 8 }}>
          {t("providers.pricingPerMillion")}
        </span>
      </h4>

      {loading && (
        <div style={{ padding: "24px 0", textAlign: "center", color: "#888", fontSize: 12 }}>
          <span className="spinner" style={{ marginRight: 6 }} />
          {t("common.loading")}
        </div>
      )}

      {!loading && !data && (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12, color: "#888" }}>
          <div>{t("providers.pricingUnavailable")}</div>
          <a
            href={PROVIDER_URLS[provider as LLMProvider]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#1a73e8", fontSize: 12, marginTop: 6, display: "inline-block" }}
          >
            {t("providers.pricingViewFull")} &rarr;
          </a>
        </div>
      )}

      {!loading && data && (
        <>
          {data.currency !== "USD" && (
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
              {t("providers.pricingCurrency")}: {data.currency}
            </div>
          )}
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e0e0e0" }}>
                <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 500, color: "#555" }}>
                  {t("providers.pricingModel")}
                </th>
                <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 500, color: "#555", whiteSpace: "nowrap" }}>
                  {t("providers.pricingInput")}
                </th>
                <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 500, color: "#555", whiteSpace: "nowrap" }}>
                  {t("providers.pricingOutput")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.modelId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "5px 6px" }}>
                    <div style={{ fontWeight: 500 }}>{m.displayName}</div>
                    {m.note && (
                      <div style={{ fontSize: 10, color: "#999", marginTop: 1 }}>{m.note}</div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", padding: "5px 6px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {m.inputPricePerMillion === "—" ? "—" : `${currencySymbol}${m.inputPricePerMillion}`}
                  </td>
                  <td style={{ textAlign: "right", padding: "5px 6px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {m.outputPricePerMillion === "—" ? "—" : `${currencySymbol}${m.outputPricePerMillion}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 6 }}>
            <a
              href={data.pricingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1a73e8", fontSize: 12 }}
            >
              {t("providers.pricingViewFull")} &rarr;
            </a>
          </div>
        </>
      )}
    </div>
  );
}
