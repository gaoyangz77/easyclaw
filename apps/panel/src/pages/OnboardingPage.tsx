import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PROVIDER_API_KEY_URLS, getDefaultModelForProvider } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { updateSettings, createProviderKey, validateApiKey, fetchPricing, trackEvent } from "../api.js";
import type { ProviderPricing } from "../api.js";
import { ProviderSelect } from "../components/ProviderSelect.js";
import { ModelSelect } from "../components/ModelSelect.js";
import { PricingTable } from "../components/PricingTable.js";

function StepDot({ step, currentStep }: { step: number; currentStep: number }) {
  const isActive = step === currentStep;
  const isCompleted = step < currentStep;
  const highlight = isCompleted || isActive;
  return (
    <div
      className="onboarding-step-dot"
      style={{
        backgroundColor: highlight ? "var(--color-primary)" : "var(--color-border)",
        color: highlight ? "#fff" : "var(--color-text-muted)",
      }}
    >
      {isCompleted ? "\u2713" : step + 1}
    </div>
  );
}

export function OnboardingPage({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);

  // Step 0 state
  const defaultProv = i18n.language === "zh" ? "zhipu" : "openai";
  const [provider, setProvider] = useState(defaultProv);
  const [model, setModel] = useState(getDefaultModelForProvider(defaultProv as LLMProvider)?.modelId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [providerError, setProviderError] = useState<{ key: string; detail?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [pricingList, setPricingList] = useState<ProviderPricing[] | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const formRef = useRef<HTMLDivElement>(null);
  const [formHeight, setFormHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    trackEvent("onboarding.started", { language: i18n.language });
  }, []);

  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFormHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentStep]);

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
  }, []);

  const panelSections = [
    { name: t("onboarding.sectionRules"), desc: t("onboarding.sectionRulesDesc") },
    { name: t("onboarding.sectionProviders"), desc: t("onboarding.sectionProvidersDesc") },
    { name: t("onboarding.sectionChannels"), desc: t("onboarding.sectionChannelsDesc") },
    { name: t("onboarding.sectionPermissions"), desc: t("onboarding.sectionPermissionsDesc") },
    { name: t("onboarding.sectionUsage"), desc: t("onboarding.sectionUsageDesc") },
  ];

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    setModel(getDefaultModelForProvider(newProvider as LLMProvider)?.modelId ?? "");
  }

  async function handleSaveProvider() {
    if (!apiKey.trim()) {
      setProviderError({ key: "onboarding.apiKeyRequired" });
      return;
    }
    setValidating(true);
    setProviderError(null);
    try {
      // Validate API key (with proxy if configured) to prevent IP pollution/bans
      const proxy = proxyUrl.trim() || undefined;
      const validation = await validateApiKey(provider, apiKey.trim(), proxy);
      if (!validation.valid) {
        setProviderError({ key: "providers.invalidKey", detail: validation.error });
        setValidating(false);
        return;
      }

      setValidating(false);
      setSaving(true);

      // Create provider key entry
      await createProviderKey({
        provider,
        label: "Default",
        model,
        apiKey: apiKey.trim(),
        proxyUrl: proxy,
      });
      // Set as active provider
      await updateSettings({ "llm-provider": provider });
      trackEvent("onboarding.provider_saved", { provider });
      setCurrentStep(1);
    } catch (err) {
      setProviderError({ key: "onboarding.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-top-controls">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}
        >
          {i18n.language === "zh" ? "English" : "中文"}
        </button>
        <button
          className="btn-ghost"
          onClick={onComplete}
        >
          {t("onboarding.skipSetup")}
        </button>
      </div>

      <div
        className="onboarding-card"
        style={{ maxWidth: currentStep === 0 ? 960 : 560 }}
      >
        {/* Step indicator */}
        <div className="onboarding-steps">
          <StepDot step={0} currentStep={currentStep} />
          <div
            className="onboarding-connector"
            style={{ backgroundColor: currentStep > 0 ? "var(--color-primary)" : "var(--color-border)" }}
          />
          <StepDot step={1} currentStep={currentStep} />
        </div>

        {/* Step 0: Welcome + Provider */}
        {currentStep === 0 && (
          <div className="page-two-col">
            {/* Left: form */}
            <div ref={formRef} className="flex-1">
            <h1>
              {t("onboarding.welcomeTitle")}
            </h1>
            <p>
              {t("onboarding.welcomeDesc")}
            </p>

            {providerError && (
              <div className="text-danger mb-sm">
                {t(providerError.key)}{providerError.detail ? ` (${providerError.detail})` : ""}
              </div>
            )}

            <div className="form-group">
              <div className="form-label">{t("onboarding.providerLabel")}</div>
              <ProviderSelect value={provider} onChange={handleProviderChange} />
              <div className="form-help-sm" style={{ marginTop: 6 }}>
                {t(`providers.hint_${provider}`, { cmd: "", defaultValue: "" }) ? (
                  <span className="text-secondary">
                    {(() => {
                      const cmd = provider === "anthropic" ? "claude setup-token" : provider === "amazon-bedrock" ? "aws configure" : "";
                      const hint = t(`providers.hint_${provider}`, { cmd });
                      if (!cmd) return hint;
                      const parts = hint.split(cmd);
                      return parts.length === 2 ? (
                        <>{parts[0]}<code>{cmd}</code>{parts[1]}</>
                      ) : hint;
                    })()}
                    {" "}
                  </span>
                ) : null}
                <a
                  href={PROVIDER_API_KEY_URLS[provider as LLMProvider]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("providers.getApiKey")} &rarr;
                </a>
              </div>
            </div>

            <div className="form-group">
              <div className="form-label">{t("onboarding.modelLabel")}</div>
              <ModelSelect provider={provider} value={model} onChange={setModel} />
            </div>

            <label className="form-group" style={{ display: "block" }}>
              {provider === "anthropic" ? t("onboarding.anthropicTokenLabel") : t("onboarding.apiKeyLabel")}
              <input
                className="input-full input-mono"
                type="text"
                autoComplete="off"
                data-1p-ignore
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "anthropic" ? t("onboarding.anthropicTokenPlaceholder") : t("onboarding.apiKeyPlaceholder")}
                style={{ display: "block", marginTop: 4 }}
              />
              <small className="form-help-sm">
                {t("onboarding.apiKeyHelp")}
              </small>
              {provider === "anthropic" && (
                <div className="info-box info-box-yellow" style={{ marginTop: 8 }}>
                  {t("providers.anthropicTokenWarning")}
                </div>
              )}
            </label>

            <div className="mb-md">
              <button
                className="advanced-toggle"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>&#9654;</span>
                {t("providers.advancedSettings")}
              </button>
              {showAdvanced && (
                <div className="advanced-content">
                  <div className="form-label text-secondary">{t("providers.proxyLabel")}</div>
                  <input
                    className="input-full input-mono"
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder={t("providers.proxyPlaceholder")}
                  />
                  <small className="form-help-sm">
                    {t("providers.proxyHelp")}
                  </small>
                </div>
              )}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleSaveProvider}
              disabled={saving || validating}
            >
              {validating ? t("onboarding.validating") : saving ? t("onboarding.saving") : t("onboarding.saveAndContinue")}
            </button>
            </div>

            {/* Right: pricing table */}
            <div className="page-col-side" style={{ height: formHeight }}>
              <PricingTable provider={provider} pricingList={pricingList} loading={pricingLoading} />
            </div>
          </div>
        )}

        {/* Step 1: All set */}
        {currentStep === 1 && (
          <div>
            <h1>
              {t("onboarding.allSetTitle")}
            </h1>
            <p>
              {t("onboarding.allSetDesc")}
            </p>

            <div className="mb-lg">
              {panelSections.map((s) => (
                <div
                  key={s.name}
                  className="onboarding-section-item"
                >
                  <strong>{s.name}</strong>
                  <span className="text-secondary" style={{ marginLeft: 8 }}>
                    — {s.desc}
                  </span>
                </div>
              ))}
            </div>

            <button
              className="btn btn-primary"
              onClick={() => {
                trackEvent("onboarding.completed");
                onComplete();
              }}
            >
              {t("onboarding.goToDashboard")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
