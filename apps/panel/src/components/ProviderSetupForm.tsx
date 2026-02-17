import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SUBSCRIPTION_PROVIDER_IDS, API_PROVIDER_IDS, getProviderMeta, getDefaultModelForProvider } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import {
  fetchProviderKeys,
  updateSettings,
  createProviderKey,
  validateApiKey,
  fetchPricing,
  startOAuthFlow,
  saveOAuthFlow,
} from "../api.js";
import type { ProviderPricing } from "../api.js";
import { ModelSelect } from "./ModelSelect.js";
import { ProviderSelect } from "./ProviderSelect.js";
import { PricingTable, SubscriptionPricingTable } from "./PricingTable.js";


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
  const { t, i18n } = useTranslation();

  const defaultProv = i18n.language === "zh" ? "zhipu-coding" : "gemini";
  const [tab, setTab] = useState<"subscription" | "api">("subscription");
  const [provider, setProvider] = useState(defaultProv);
  const [model, setModel] = useState(getDefaultModelForProvider(defaultProv as LLMProvider)?.modelId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthTokenPreview, setOauthTokenPreview] = useState("");
  const [pricingList, setPricingList] = useState<ProviderPricing[] | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [existingKeyCount, setExistingKeyCount] = useState<number | null>(null);
  const leftCardRef = useRef<HTMLDivElement>(null);
  const [leftHeight, setLeftHeight] = useState<number | undefined>(undefined);

  // Height sync between left form and right pricing table
  useEffect(() => {
    const el = leftCardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLeftHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch pricing data and existing key count on mount
  useEffect(() => {
    (async () => {
      try {
        const statusRes = await fetch("http://127.0.0.1:3210/api/status");
        const status = await statusRes.json();
        const deviceId = status.deviceId || "unknown";
        const lang = navigator.language?.slice(0, 2) || "en";
        const platform = navigator.userAgent.includes("Mac") ? "darwin"
          : navigator.userAgent.includes("Win") ? "win32" : "linux";
        const data = await fetchPricing(deviceId, platform, "0.8.0", lang);
        setPricingList(data);
      } catch {
        setPricingList(null);
      } finally {
        setPricingLoading(false);
      }
    })();
    fetchProviderKeys().then((keys) => setExistingKeyCount(keys.length)).catch(() => {});
  }, []);

  function handleProviderChange(p: string) {
    setProvider(p);
    setModel(getDefaultModelForProvider(p as LLMProvider)?.modelId ?? "");
    setApiKey("");
    setLabel("");
    setProxyUrl("");
    setShowAdvanced(false);
    setOauthTokenPreview("");
  }

  function handleTabChange(newTab: "subscription" | "api") {
    setTab(newTab);
    const prov = newTab === "subscription"
      ? (i18n.language === "zh" ? "zhipu-coding" : "gemini")
      : (i18n.language === "zh" ? "zhipu" : "openai");
    handleProviderChange(prov);
  }

  async function handleAddKey() {
    if (!apiKey.trim()) return;
    setValidating(true);
    setError(null);
    try {
      const proxy = proxyUrl.trim() || undefined;
      const validation = await validateApiKey(provider, apiKey.trim(), proxy);
      if (!validation.valid) {
        setError({ key: "providers.invalidKey", detail: validation.error });
        setValidating(false);
        return;
      }

      await createProviderKey({
        provider,
        label: label.trim() || t("providers.labelDefault"),
        model: model || (getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? ""),
        apiKey: apiKey.trim(),
        proxyUrl: proxy,
        authType: "api_key",
      });

      // Auto-activate if this is the first key
      if (existingKeyCount === 0) {
        await updateSettings({ "llm-provider": provider });
      }

      setApiKey("");
      setLabel("");
      setModel("");
      setProxyUrl("");
      setShowAdvanced(false);
      setExistingKeyCount((c) => (c ?? 0) + 1);
      onSave(provider);
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  async function handleOAuth() {
    setOauthLoading(true);
    setError(null);
    try {
      const result = await startOAuthFlow(provider);
      setOauthTokenPreview(result.tokenPreview || "oauth-token-••••••••");
      setLabel(result.email || getProviderMeta(provider as LLMProvider)?.label || "OAuth");
      setModel(getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? "");
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    } finally {
      setOauthLoading(false);
    }
  }

  async function handleOAuthSave() {
    setValidating(true);
    setError(null);
    try {
      const proxy = proxyUrl.trim() || undefined;
      await saveOAuthFlow(provider, {
        proxyUrl: proxy,
        label: label.trim() || t("providers.labelDefault"),
        model: model || (getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? ""),
      });

      if (existingKeyCount === 0) {
        await updateSettings({ "llm-provider": provider });
      }

      setOauthTokenPreview("");
      setLabel("");
      setModel("");
      setProxyUrl("");
      setShowAdvanced(false);
      setExistingKeyCount((c) => (c ?? 0) + 1);
      onSave(provider);
    } catch (err) {
      setError({ key: "providers.invalidKey", detail: String(err) });
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  const providerFilter = tab === "subscription" ? SUBSCRIPTION_PROVIDER_IDS : API_PROVIDER_IDS;
  const isOAuth = !!getProviderMeta(provider as LLMProvider)?.oauth;
  const isAnthropicSub = provider === "claude";
  const btnSave = saveButtonLabel || t("common.save");
  const btnValidating = validatingLabel || t("providers.validating");
  const btnSaving = savingLabel || "...";

  return (
    <div className="page-two-col">
      <div ref={leftCardRef} className={variant === "card" ? "section-card page-col-main" : "flex-1"}>
        {title && (variant === "card" ? <h3>{title}</h3> : <h1>{title}</h1>)}
        {description && <p>{description}</p>}

        {error && (
          <div className="error-alert">{t(error.key)}{error.detail ? ` (${error.detail})` : ""}</div>
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
        </div>

        <div className="mb-sm">
          <div className="form-label text-secondary">{t("onboarding.providerLabel")}</div>
          <ProviderSelect value={provider} onChange={handleProviderChange} providers={providerFilter} />
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
            </div>
            )
          ) : (
            !isOAuth && (
            <div className="form-help-sm provider-links">
              <a
                href={getProviderMeta(provider as LLMProvider)?.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("providers.getApiKey")} &rarr;
              </a>
              {getProviderMeta(provider as LLMProvider)?.subscriptionUrl && (
                <a
                  href={getProviderMeta(provider as LLMProvider)?.subscriptionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("providers.subscribeForValue")} &rarr;
                </a>
              )}
            </div>
            )
          )}
        </div>

        {isOAuth ? (
          <>
            {/* OAuth form */}
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

            {oauthTokenPreview ? (
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
              {oauthTokenPreview ? (
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
        ) : (
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
          <small className="form-help-sm">
            {t("providers.apiKeyHelp")}
          </small>
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
        )}
      </div>

      {/* Right: Pricing table */}
      <div className="page-col-side" style={{ height: leftHeight }}>
        {tab === "subscription" ? (
          <SubscriptionPricingTable provider={provider} pricingList={pricingList} loading={pricingLoading} />
        ) : (
          <PricingTable provider={provider} pricingList={pricingList} loading={pricingLoading} />
        )}
      </div>
    </div>
  );
}
