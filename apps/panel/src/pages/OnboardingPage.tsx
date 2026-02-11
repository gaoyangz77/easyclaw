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
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          isCompleted || isActive ? "#1a73e8" : "#e0e0e0",
        color: isCompleted || isActive ? "#fff" : "#888",
        fontWeight: 600,
        fontSize: 14,
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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f8f9fa",
        padding: 24,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 28,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <button
          onClick={() => i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}
          style={{
            padding: "4px 12px",
            border: "1px solid #e0e0e0",
            borderRadius: 4,
            backgroundColor: "transparent",
            cursor: "pointer",
            fontSize: 13,
            color: "#555",
          }}
        >
          {i18n.language === "zh" ? "English" : "中文"}
        </button>
        <button
          onClick={onComplete}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            fontSize: 14,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {t("onboarding.skipSetup")}
        </button>
      </div>

      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "48px 40px",
          maxWidth: currentStep === 0 ? 960 : 560,
          width: "100%",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          transition: "max-width 0.3s ease",
        }}
      >
        {/* Step indicator */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
            marginBottom: 36,
          }}
        >
          <StepDot step={0} currentStep={currentStep} />
          <div style={{ width: 40, height: 2, backgroundColor: currentStep > 0 ? "#1a73e8" : "#e0e0e0" }} />
          <StepDot step={1} currentStep={currentStep} />
        </div>

        {/* Step 0: Welcome + Provider */}
        {currentStep === 0 && (
          <div style={{ display: "flex", gap: 28, alignItems: "stretch" }}>
            {/* Left: form */}
            <div ref={formRef} style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>
              {t("onboarding.welcomeTitle")}
            </h1>
            <p style={{ color: "#5f6368", marginBottom: 24 }}>
              {t("onboarding.welcomeDesc")}
            </p>

            {providerError && (
              <div style={{ color: "red", marginBottom: 12 }}>
                {t(providerError.key)}{providerError.detail ? ` (${providerError.detail})` : ""}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 4 }}>{t("onboarding.providerLabel")}</div>
              <ProviderSelect value={provider} onChange={handleProviderChange} />
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {t(`providers.hint_${provider}`, { cmd: "", defaultValue: "" }) ? (
                  <span style={{ color: "#5f6368" }}>
                    {(() => {
                      const cmd = provider === "anthropic" ? "claude setup-token" : provider === "amazon-bedrock" ? "aws configure" : "";
                      const hint = t(`providers.hint_${provider}`, { cmd });
                      if (!cmd) return hint;
                      const parts = hint.split(cmd);
                      return parts.length === 2 ? (
                        <>{parts[0]}<code style={{ backgroundColor: "#f1f3f4", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace" }}>{cmd}</code>{parts[1]}</>
                      ) : hint;
                    })()}
                    {" "}
                  </span>
                ) : null}
                <a
                  href={PROVIDER_API_KEY_URLS[provider as LLMProvider]}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1a73e8" }}
                >
                  {t("providers.getApiKey")} &rarr;
                </a>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 4 }}>{t("onboarding.modelLabel")}</div>
              <ModelSelect provider={provider} value={model} onChange={setModel} />
            </div>

            <label style={{ display: "block", marginBottom: 20 }}>
              {provider === "anthropic" ? t("onboarding.anthropicTokenLabel") : t("onboarding.apiKeyLabel")}
              <input
                type="text"
                autoComplete="off"
                data-1p-ignore
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "anthropic" ? t("onboarding.anthropicTokenPlaceholder") : t("onboarding.apiKeyPlaceholder")}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #e0e0e0",
                  boxSizing: "border-box",
                  fontFamily: "monospace",
                }}
              />
              <small style={{ color: "#888" }}>
                {t("onboarding.apiKeyHelp")}
              </small>
              {provider === "anthropic" && (
                <div style={{ marginTop: 8, padding: "8px 12px", backgroundColor: "#fff8e1", borderRadius: 4, fontSize: 12, color: "#7a6200", lineHeight: 1.5 }}>
                  {t("providers.anthropicTokenWarning")}
                </div>
              )}
            </label>

            <div style={{ marginBottom: 20 }}>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  padding: "6px 0",
                  background: "none",
                  border: "none",
                  color: "#1a73e8",
                  cursor: "pointer",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                {t("providers.advancedSettings")}
              </button>
              {showAdvanced && (
                <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid #e0e0e0" }}>
                  <div style={{ fontSize: 13, marginBottom: 4, color: "#555" }}>{t("providers.proxyLabel")}</div>
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder={t("providers.proxyPlaceholder")}
                    style={{
                      width: "100%",
                      padding: 8,
                      borderRadius: 4,
                      border: "1px solid #e0e0e0",
                      fontSize: 13,
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                  <small style={{ color: "#888", fontSize: 11 }}>
                    {t("providers.proxyHelp")}
                  </small>
                </div>
              )}
            </div>

            <button
              onClick={handleSaveProvider}
              disabled={saving || validating}
              style={{
                padding: "10px 24px",
                backgroundColor: "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: saving || validating ? "default" : "pointer",
                opacity: saving || validating ? 0.7 : 1,
              }}
            >
              {validating ? t("onboarding.validating") : saving ? t("onboarding.saving") : t("onboarding.saveAndContinue")}
            </button>
            </div>

            {/* Right: pricing table */}
            <div style={{ width: 320, flexShrink: 0, height: formHeight }}>
              <PricingTable provider={provider} pricingList={pricingList} loading={pricingLoading} />
            </div>
          </div>
        )}

        {/* Step 1: All set */}
        {currentStep === 1 && (
          <div>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>
              {t("onboarding.allSetTitle")}
            </h1>
            <p style={{ color: "#5f6368", marginBottom: 20 }}>
              {t("onboarding.allSetDesc")}
            </p>

            <div style={{ marginBottom: 24 }}>
              {panelSections.map((s) => (
                <div
                  key={s.name}
                  style={{
                    padding: "10px 12px",
                    marginBottom: 6,
                    borderRadius: 6,
                    backgroundColor: "#f8f9fa",
                  }}
                >
                  <strong>{s.name}</strong>
                  <span style={{ color: "#5f6368", marginLeft: 8 }}>
                    — {s.desc}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                trackEvent("onboarding.completed");
                onComplete();
              }}
              style={{
                padding: "10px 24px",
                backgroundColor: "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
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
