import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PROVIDER_API_KEY_URLS, PROVIDER_SUBSCRIPTION_URLS, getDefaultModelForProvider } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import {
  fetchSettings,
  updateSettings,
  fetchProviderKeys,
  createProviderKey,
  updateProviderKey,
  activateProviderKey,
  deleteProviderKey,
  validateApiKey,
  fetchPricing,
  startOAuthFlow,
  saveOAuthFlow,
} from "../api.js";
import type { ProviderKeyEntry, ProviderPricing } from "../api.js";
import { ModelSelect } from "../components/ModelSelect.js";
import { ProviderSelect } from "../components/ProviderSelect.js";
import { PricingTable } from "../components/PricingTable.js";


export function ProvidersPage() {
  const { t, i18n } = useTranslation();
  const [keys, setKeys] = useState<ProviderKeyEntry[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string>("");
  const defaultProv = i18n.language === "zh" ? "zhipu" : "openai";
  const [newProvider, setNewProvider] = useState(defaultProv);
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newModel, setNewModel] = useState(getDefaultModelForProvider(defaultProv as LLMProvider)?.modelId ?? "");
  const [newProxyUrl, setNewProxyUrl] = useState("");
  const [editProxyUrl, setEditProxyUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthTokenPreview, setOauthTokenPreview] = useState("");
  const [pricingList, setPricingList] = useState<ProviderPricing[] | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const leftCardRef = useRef<HTMLDivElement>(null);
  const [leftHeight, setLeftHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const el = leftCardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLeftHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    loadData();
    loadPricing();
  }, []);

  async function loadData() {
    try {
      const [keysList, settings] = await Promise.all([fetchProviderKeys(), fetchSettings()]);
      setKeys(keysList);
      if (settings["llm-provider"]) {
        setDefaultProvider(settings["llm-provider"]);
      }
      setError(null);
    } catch (err) {
      setError({ key: "providers.failedToLoad", detail: String(err) });
    }
  }

  async function loadPricing() {
    setPricingLoading(true);
    try {
      // Get deviceId from local panel server status
      const statusRes = await fetch("http://127.0.0.1:3210/api/status");
      const status = await statusRes.json();
      const deviceId = status.deviceId || "unknown";
      const lang = navigator.language?.slice(0, 2) || "en";
      // Platform detection: panel runs in Electron webview
      const platform = navigator.userAgent.includes("Mac") ? "darwin"
        : navigator.userAgent.includes("Win") ? "win32" : "linux";
      const data = await fetchPricing(deviceId, platform, "0.8.0", lang);
      setPricingList(data);
    } catch {
      setPricingList(null);
    } finally {
      setPricingLoading(false);
    }
  }

  async function handleAddKey(provider: string) {
    if (!apiKey.trim()) return;
    setValidating(true);
    setError(null);
    try {
      // Validate API key (with proxy if configured) to prevent IP pollution/bans
      const proxyUrl = newProxyUrl.trim() || undefined;
      const validation = await validateApiKey(provider, apiKey.trim(), proxyUrl);
      if (!validation.valid) {
        setError({ key: "providers.invalidKey", detail: validation.error });
        setValidating(false);
        return;
      }

      const entry = await createProviderKey({
        provider,
        label: newLabel.trim() || t("providers.labelDefault"),
        model: newModel || (getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? ""),
        apiKey: apiKey.trim(),
        proxyUrl,
      });

      // If first key overall, set as active provider
      if (keys.length === 0 || !defaultProvider) {
        await updateSettings({ "llm-provider": provider });
        setDefaultProvider(provider);
      }

      setApiKey("");
      setNewLabel("");
      setNewModel("");
      setNewProxyUrl("");
      setShowAdvanced(false);
      setSavedId(entry.id);
      setTimeout(() => setSavedId(null), 2000);
      await loadData();
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  async function handleGeminiOAuth() {
    setOauthLoading(true);
    setError(null);
    try {
      const result = await startOAuthFlow("google-gemini-cli");
      // Phase 1 complete: show token preview + form for proxy/save
      setOauthTokenPreview(result.tokenPreview || "oauth-token-••••••••");
      setNewLabel(result.email || "Gemini OAuth");
      setNewModel(getDefaultModelForProvider("google-gemini-cli" as LLMProvider)?.modelId ?? "");
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
      const proxyUrl = newProxyUrl.trim() || undefined;
      const result = await saveOAuthFlow("google-gemini-cli", {
        proxyUrl,
        label: newLabel.trim() || t("providers.labelDefault"),
        model: newModel || (getDefaultModelForProvider("google-gemini-cli" as LLMProvider)?.modelId ?? ""),
      });

      // If first key overall, set as active provider
      if (keys.length === 0 || !defaultProvider) {
        await updateSettings({ "llm-provider": "google-gemini-cli" });
        setDefaultProvider("google-gemini-cli");
      }

      setOauthTokenPreview("");
      setNewLabel("");
      setNewModel("");
      setNewProxyUrl("");
      setShowAdvanced(false);
      setSavedId(result.providerKeyId);
      setTimeout(() => setSavedId(null), 2000);
      await loadData();
    } catch (err) {
      setError({ key: "providers.invalidKey", detail: String(err) });
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  async function handleUpdateKey(keyId: string, provider: string) {
    if (!apiKey.trim()) return;
    setValidating(true);
    setError(null);
    try {
      // Delete old and create new (update key = re-add with same metadata)
      const existing = keys.find((k) => k.id === keyId);
      await deleteProviderKey(keyId);
      const entry = await createProviderKey({
        provider,
        label: existing?.label || t("providers.labelDefault"),
        model: existing?.model || (getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? ""),
        apiKey: apiKey.trim(),
      });

      // If the deleted key was default, activate the new one
      if (existing?.isDefault) {
        await activateProviderKey(entry.id);
      }

      setApiKey("");
      setExpandedKeyId(null);
      setSavedId(entry.id);
      setTimeout(() => setSavedId(null), 2000);
      await loadData();
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
      await loadData();
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  async function handleActivate(keyId: string, provider: string) {
    setError(null);
    try {
      await activateProviderKey(keyId);
      await updateSettings({ "llm-provider": provider });
      setDefaultProvider(provider);
      await loadData();
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    }
  }

  async function handleRemoveKey(keyId: string) {
    setError(null);
    try {
      const removed = keys.find((k) => k.id === keyId);
      const wasActive = removed && removed.isDefault && removed.provider === defaultProvider;
      await deleteProviderKey(keyId);

      if (wasActive) {
        const remaining = keys.filter((k) => k.id !== keyId);
        if (remaining.length > 0) {
          const next = remaining[0];
          await activateProviderKey(next.id);
          await updateSettings({ "llm-provider": next.provider });
          setDefaultProvider(next.provider);
        } else {
          await updateSettings({ "llm-provider": "" });
          setDefaultProvider("");
        }
      }

      await loadData();
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    }
  }

  async function handleModelChange(keyId: string, model: string) {
    setError(null);
    try {
      await updateProviderKey(keyId, { model });
      setKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, model } : k)));
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    }
  }

  async function handleProxyChange(keyId: string, proxyUrl: string) {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateProviderKey(keyId, { proxyUrl: proxyUrl || null as any });
      setKeys((prev) => prev.map((k) => (k.id === keyId ? updated : k)));
      setSavedId(keyId);
      setTimeout(() => setSavedId(null), 2000);
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
    }
  }

  function handleNewProviderChange(p: string) {
    setNewProvider(p);
    setNewModel(getDefaultModelForProvider(p as LLMProvider)?.modelId ?? "");
    setApiKey("");
    setNewLabel("");
    setNewProxyUrl("");
    setShowAdvanced(false);
    setOauthTokenPreview("");
  }

  return (
    <div>
      <h1>{t("providers.title")}</h1>
      <p>{t("providers.description")}</p>

      {error && (
        <div className="error-alert">{t(error.key)}{error.detail ?? ""}</div>
      )}

      {/* Section A: Add Key — left form + right pricing table */}
      <div className="page-two-col">
      <div ref={leftCardRef} className="section-card page-col-main">
        <h3>{t("providers.addTitle")}</h3>
        <div className="mb-sm">
          <div className="form-label text-secondary">{t("onboarding.providerLabel")}</div>
          <ProviderSelect value={newProvider} onChange={handleNewProviderChange} />
          {newProvider !== "google-gemini-cli" && (
          <div className="form-help-sm provider-links">
            <a
              href={PROVIDER_API_KEY_URLS[newProvider as LLMProvider]}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("providers.getApiKey")} &rarr;
            </a>
            {PROVIDER_SUBSCRIPTION_URLS[newProvider as LLMProvider] && (
              <a
                href={PROVIDER_SUBSCRIPTION_URLS[newProvider as LLMProvider]}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("providers.subscribeForValue")} &rarr;
              </a>
            )}
          </div>
          )}
        </div>

        {newProvider === "google-gemini-cli" ? (
          <>
            {/* OAuth form — label, model, token (or info), proxy, sign-in/save */}
            <div className="form-row mb-sm">
              <div style={{ flex: 4 }}>
                <div className="form-label text-secondary">{t("providers.keyLabel")}</div>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t("providers.labelPlaceholder")}
                  className="input-full"
                />
              </div>
              <div style={{ flex: 6 }}>
                <div className="form-label text-secondary">{t("providers.modelLabel")}</div>
                <ModelSelect
                  provider={newProvider}
                  value={newModel || (getDefaultModelForProvider(newProvider as LLMProvider)?.modelId ?? "")}
                  onChange={setNewModel}
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
                <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                {t("providers.advancedSettings")}
              </button>
              {showAdvanced && (
                <div className="advanced-content">
                  <div className="form-label text-secondary">{t("providers.proxyLabel")}</div>
                  <input
                    type="text"
                    value={newProxyUrl}
                    onChange={(e) => setNewProxyUrl(e.target.value)}
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
                  {validating ? t("providers.validating") : saving ? "..." : t("common.save")}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleGeminiOAuth}
                  disabled={oauthLoading}
                >
                  {oauthLoading ? t("providers.oauthLoading") : t("providers.oauthSignIn")}
                </button>
              )}
            </div>
          </>
        ) : (
        <>
        {newProvider === "anthropic" && (
          <div className="info-box info-box-yellow">
            {t("providers.anthropicTokenWarning")}
          </div>
        )}

        <div className="form-row mb-sm">
          <div style={{ flex: 4 }}>
            <div className="form-label text-secondary">{t("providers.keyLabel")}</div>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("providers.labelPlaceholder")}
              className="input-full"
            />
          </div>
          <div style={{ flex: 6 }}>
            <div className="form-label text-secondary">{t("providers.modelLabel")}</div>
            <ModelSelect
              provider={newProvider}
              value={newModel || (getDefaultModelForProvider(newProvider as LLMProvider)?.modelId ?? "")}
              onChange={setNewModel}
            />
          </div>
        </div>

        <div className="mb-sm">
          <div className="form-label text-secondary">
            {newProvider === "anthropic" ? t("providers.anthropicTokenLabel") : t("providers.apiKeyLabel")} <span className="required">*</span>
          </div>
          <input
            type="password"
            autoComplete="off"
            data-1p-ignore
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={newProvider === "anthropic" ? t("providers.anthropicTokenPlaceholder") : t("providers.apiKeyPlaceholder")}
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
            <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
            {t("providers.advancedSettings")}
          </button>
          {showAdvanced && (
            <div className="advanced-content">
              <div className="form-label text-secondary">{t("providers.proxyLabel")}</div>
              <input
                type="text"
                value={newProxyUrl}
                onChange={(e) => setNewProxyUrl(e.target.value)}
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
            onClick={() => handleAddKey(newProvider)}
            disabled={saving || validating || !apiKey.trim()}
          >
            {validating ? t("providers.validating") : saving ? "..." : t("common.save")}
          </button>
        </div>
        </>
        )}
      </div>

      {/* Right: Pricing table */}
      <div className="page-col-side" style={{ height: leftHeight }}>
        <PricingTable provider={newProvider} pricingList={pricingList} loading={pricingLoading} />
      </div>
      </div>

      {/* Section B: Configured Keys */}
      <div className="section-card">
        <h3>{t("providers.configuredKeysTitle")}</h3>
        {keys.length === 0 ? (
          <div className="empty-cell">
            {t("providers.noKeys")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {keys.map((k) => {
              const isActive = k.isDefault && k.provider === defaultProvider;
              const isExp = expandedKeyId === k.id;
              return (
                <div
                  key={k.id}
                  className={`key-card ${isActive ? "key-card-active" : "key-card-inactive"}`}
                >
                  {/* Row: info left, actions right */}
                  <div className="key-row">
                    {/* Left: provider info */}
                    <div className="key-info">
                      <div className="key-meta">
                        <strong style={{ fontSize: 13 }}>{t(`providers.label_${k.provider}`)}</strong>
                        {isActive && (
                          <span className="badge badge-active">
                            {t("providers.active")}
                          </span>
                        )}
                        {k.proxyUrl && (
                          <span className="has-tooltip" data-tooltip={t("providers.proxyTooltip")} style={{ display: "inline-flex", alignItems: "center" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <rect x="3" y="11" width="18" height="11" rx="2" fill="#f5d060" stroke="#b8860b" strokeWidth="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#b8860b" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </span>
                        )}
                        {savedId === k.id && (
                          <span className="badge-saved">{t("common.saved")}</span>
                        )}
                      </div>
                      <div className="key-details">
                        <span className="key-label">
                          {k.label}
                        </span>
                        <ModelSelect
                          provider={k.provider}
                          value={k.model}
                          onChange={(model) => handleModelChange(k.id, model)}
                        />
                      </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="td-actions">
                      {!isActive && (
                        <button className="btn btn-outline btn-sm" onClick={() => handleActivate(k.id, k.provider)}>
                          {t("providers.activate")}
                        </button>
                      )}
                      {k.authType === "oauth" ? (
                        <button className="btn btn-secondary btn-sm" onClick={handleGeminiOAuth} disabled={oauthLoading}>
                          {oauthLoading ? t("providers.oauthLoading") : t("providers.oauthReauthenticate")}
                        </button>
                      ) : (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setExpandedKeyId(isExp ? null : k.id);
                            setApiKey("");
                            setEditProxyUrl(k.proxyUrl || "");
                          }}
                        >
                          {t("providers.updateKey")}
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => handleRemoveKey(k.id)}>
                        {t("providers.removeKey")}
                      </button>
                    </div>
                  </div>

                  {/* Expanded: update key / proxy form */}
                  {isExp && (
                    <div className="key-expanded">
                      <div className="form-row">
                        <input
                          type="password"
                          autoComplete="off"
                          data-1p-ignore
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={k.provider === "anthropic" ? t("providers.anthropicUpdatePlaceholder") : t("providers.updateKeyPlaceholder")}
                          className="flex-1 input-mono"
                        />
                        <button
                          className="btn btn-primary"
                          onClick={() => handleUpdateKey(k.id, k.provider)}
                          disabled={saving || validating || !apiKey.trim()}
                        >
                          {validating ? t("providers.validating") : saving ? "..." : t("common.save")}
                        </button>
                      </div>
                      <small className="form-help-sm">{t("providers.apiKeyHelp")}</small>
                      {k.provider === "anthropic" && (
                        <div className="info-box info-box-yellow" style={{ marginTop: 6 }}>
                          {t("providers.anthropicTokenWarning")}
                        </div>
                      )}
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid var(--color-border)` }}>
                        <div className="form-label text-secondary">{t("providers.proxyLabel")}</div>
                        <div className="form-row">
                          <input
                            type="text"
                            value={editProxyUrl}
                            onChange={(e) => setEditProxyUrl(e.target.value)}
                            placeholder={t("providers.proxyPlaceholder")}
                            className="flex-1 input-mono"
                          />
                          <button
                            className="btn btn-primary"
                            onClick={() => handleProxyChange(k.id, editProxyUrl)}
                            disabled={saving || editProxyUrl === (k.proxyUrl || "")}
                          >
                            {saving ? "..." : t("common.save")}
                          </button>
                        </div>
                        <small className="form-help-sm">{t("providers.proxyHelp")}</small>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
