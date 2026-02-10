import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PROVIDER_URLS, getDefaultModelForProvider } from "@easyclaw/core";
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

  function renderHint(provider: string) {
    const cmd = provider === "anthropic" ? "claude setup-token" : provider === "amazon-bedrock" ? "aws configure" : "";
    const hint = t(`providers.hint_${provider}`, { cmd, defaultValue: "" });
    if (!hint) return null;
    if (!cmd) return <span style={{ color: "#5f6368" }}>{hint} </span>;
    const parts = hint.split(cmd);
    if (parts.length === 2) {
      return (
        <span style={{ color: "#5f6368" }}>
          {parts[0]}
          <code style={{ backgroundColor: "#f1f3f4", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace" }}>{cmd}</code>
          {parts[1]}{" "}
        </span>
      );
    }
    return <span style={{ color: "#5f6368" }}>{hint} </span>;
  }

  function handleNewProviderChange(p: string) {
    setNewProvider(p);
    setNewModel(getDefaultModelForProvider(p as LLMProvider)?.modelId ?? "");
    setApiKey("");
    setNewLabel("");
    setNewProxyUrl("");
    setShowAdvanced(false);
  }

  return (
    <div>
      <h1>{t("providers.title")}</h1>
      <p>{t("providers.description")}</p>

      {error && (
        <div className="error-alert">{t(error.key)}{error.detail ?? ""}</div>
      )}

      {/* Section A: Add Key — left form + right pricing table */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div ref={leftCardRef} className="section-card" style={{ flex: 1, maxWidth: 680, minWidth: 320 }}>
        <h3>{t("providers.addTitle")}</h3>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>{t("onboarding.providerLabel")}</div>
          <ProviderSelect value={newProvider} onChange={handleNewProviderChange} />
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {renderHint(newProvider)}
            <a
              href={PROVIDER_URLS[newProvider as LLMProvider]}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1a73e8", fontSize: 12 }}
            >
              {t("providers.viewPricing")} &rarr;
            </a>
          </div>
        </div>

        {newProvider === "anthropic" && (
          <div style={{ marginBottom: 8, padding: "6px 10px", backgroundColor: "#fff8e1", borderRadius: 4, fontSize: 11, color: "#7a6200", lineHeight: 1.5 }}>
            {t("providers.anthropicTokenWarning")}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>{t("providers.keyLabel")}</div>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("providers.labelPlaceholder")}
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 4,
                border: "1px solid #e0e0e0",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>{t("providers.modelLabel")}</div>
            <ModelSelect
              provider={newProvider}
              value={newModel || (getDefaultModelForProvider(newProvider as LLMProvider)?.modelId ?? "")}
              onChange={setNewModel}
            />
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>
            {newProvider === "anthropic" ? t("providers.anthropicTokenLabel") : t("providers.apiKeyLabel")} <span style={{ color: "#d32f2f" }}>*</span>
          </div>
          <input
            type="text"
            autoComplete="off"
            data-1p-ignore
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={newProvider === "anthropic" ? t("providers.anthropicTokenPlaceholder") : t("providers.apiKeyPlaceholder")}
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
            {t("providers.apiKeyHelp")}
          </small>
        </div>

        <div style={{ marginBottom: 8 }}>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              padding: "6px 0",
              background: "none",
              border: "none",
              color: "#1a73e8",
              cursor: "pointer",
              fontSize: 12,
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
              <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>{t("providers.proxyLabel")}</div>
              <input
                type="text"
                value={newProxyUrl}
                onChange={(e) => setNewProxyUrl(e.target.value)}
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

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={() => handleAddKey(newProvider)}
            disabled={saving || validating || !apiKey.trim()}
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            {validating ? t("providers.validating") : saving ? "..." : t("common.save")}
          </button>
        </div>
      </div>

      {/* Right: Pricing table */}
      <div style={{ width: 380, flexShrink: 0, height: leftHeight }}>
        <PricingTable provider={newProvider} pricingList={pricingList} loading={pricingLoading} />
      </div>
      </div>

      {/* Section B: Configured Keys table */}
      <div className="section-card">
        <h3>{t("providers.configuredKeysTitle")}</h3>
        <table>
          <thead>
            <tr>
              <th>{t("providers.colProvider")}</th>
              <th>{t("providers.colLabel")}</th>
              <th>{t("providers.colModel")}</th>
              <th>{t("providers.colStatus")}</th>
              <th>{t("providers.colActions")}</th>
            </tr>
          </thead>
        <tbody>
          {keys.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "#888", padding: "24px 14px" }}>
                {t("providers.noKeys")}
              </td>
            </tr>
          ) : (
            keys.map((k) => {
              const isActive = k.isDefault && k.provider === defaultProvider;
              const isExp = expandedKeyId === k.id;
              return (
                <tr key={k.id} className="table-hover-row">
                  <td>
                    <strong>{t(`providers.label_${k.provider}`)}</strong>
                    {savedId === k.id && (
                      <span style={{ marginLeft: 8, color: "green", fontSize: 12 }}>{t("common.saved")}</span>
                    )}
                  </td>
                  <td>
                    <span style={{ color: "#555" }}>{k.label}</span>
                    {k.proxyUrl && (
                      <span
                        className="has-tooltip"
                        data-tooltip={t("providers.proxyTooltip")}
                        style={{ marginLeft: 8, display: "inline-flex", alignItems: "center" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="11" width="18" height="11" rx="2" fill="#f5d060" stroke="#b8860b" strokeWidth="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#b8860b" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </span>
                    )}
                  </td>
                  <td>
                    <ModelSelect
                      provider={k.provider}
                      value={k.model}
                      onChange={(model) => handleModelChange(k.id, model)}
                    />
                  </td>
                  <td>
                    {isActive && (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 500,
                          backgroundColor: "#c2d9fc",
                          color: "#1a56c4",
                        }}
                      >
                        {t("providers.active")}
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {!isActive && (
                        <button
                          className="btn btn-outline"
                          onClick={() => handleActivate(k.id, k.provider)}
                        >
                          {t("providers.activate")}
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setExpandedKeyId(isExp ? null : k.id);
                          setApiKey("");
                          setEditProxyUrl(k.proxyUrl || "");
                        }}
                      >
                        {t("providers.updateKey")}
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleRemoveKey(k.id)}
                      >
                        {t("providers.removeKey")}
                      </button>
                    </div>
                    {isExp && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="text"
                            autoComplete="off"
                            data-1p-ignore
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={k.provider === "anthropic" ? t("providers.anthropicUpdatePlaceholder") : t("providers.updateKeyPlaceholder")}
                            style={{
                              flex: 1,
                              padding: 8,
                              borderRadius: 4,
                              border: "1px solid #e0e0e0",
                              fontSize: 13,
                              fontFamily: "monospace",
                            }}
                          />
                          <button
                            className="btn btn-primary"
                            onClick={() => handleUpdateKey(k.id, k.provider)}
                            disabled={saving || validating || !apiKey.trim()}
                            style={{ padding: "8px 16px", fontSize: 13 }}
                          >
                            {validating ? t("providers.validating") : saving ? "..." : t("common.save")}
                          </button>
                        </div>
                        <small style={{ color: "#888", fontSize: 11 }}>
                          {t("providers.apiKeyHelp")}
                        </small>
                        {k.provider === "anthropic" && (
                          <div style={{ marginTop: 6, padding: "6px 10px", backgroundColor: "#fff8e1", borderRadius: 4, fontSize: 11, color: "#7a6200", lineHeight: 1.5 }}>
                            {t("providers.anthropicTokenWarning")}
                          </div>
                        )}
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e0e0e0" }}>
                          <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>{t("providers.proxyLabel")}</div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              type="text"
                              value={editProxyUrl}
                              onChange={(e) => setEditProxyUrl(e.target.value)}
                              placeholder={t("providers.proxyPlaceholder")}
                              style={{
                                flex: 1,
                                padding: 8,
                                borderRadius: 4,
                                border: "1px solid #e0e0e0",
                                fontSize: 13,
                                fontFamily: "monospace",
                              }}
                            />
                            <button
                              className="btn btn-primary"
                              onClick={() => handleProxyChange(k.id, editProxyUrl)}
                              disabled={saving || editProxyUrl === (k.proxyUrl || "")}
                              style={{ padding: "8px 16px", fontSize: 13 }}
                            >
                              {saving ? "..." : t("common.save")}
                            </button>
                          </div>
                          <small style={{ color: "#888", fontSize: 11 }}>
                            {t("providers.proxyHelp")}
                          </small>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
