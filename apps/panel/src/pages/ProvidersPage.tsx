import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getDefaultModelForProvider, SUBSCRIPTION_PROVIDER_IDS } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import {
  fetchSettings,
  updateSettings,
  fetchProviderKeys,
  createProviderKey,
  updateProviderKey,
  activateProviderKey,
  deleteProviderKey,
} from "../api/index.js";
import { configManager } from "../lib/config-manager.js";
import type { ProviderKeyEntry } from "../api/index.js";
import { ModelSelect } from "../components/ModelSelect.js";
import { ProviderSetupForm } from "../components/ProviderSetupForm.js";

export function ProvidersPage() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<ProviderKeyEntry[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string>("");
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);
  const [updateApiKey, setUpdateApiKey] = useState("");
  const [editProxyUrl, setEditProxyUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");

  useEffect(() => {
    loadData();
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

  async function handleUpdateKey(keyId: string, provider: string) {
    if (!updateApiKey.trim()) return;
    setValidating(true);
    setError(null);
    try {
      const existing = keys.find((k) => k.id === keyId);
      await deleteProviderKey(keyId);
      const entry = await createProviderKey({
        provider,
        label: existing?.label || t("providers.labelDefault"),
        model: existing?.model || (getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? ""),
        apiKey: updateApiKey.trim(),
        authType: existing?.authType,
        baseUrl: existing?.authType === "custom" ? (existing.baseUrl || undefined) : undefined,
        customProtocol: existing?.authType === "custom" ? (existing.customProtocol as "openai" | "anthropic" || undefined) : undefined,
        customModelsJson: existing?.authType === "custom" ? (existing.customModelsJson || undefined) : undefined,
      });

      if (existing?.isDefault) {
        await activateProviderKey(entry.id);
      }

      setUpdateApiKey("");
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
      await configManager.activateProvider(keyId, provider);
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
      await configManager.switchModel(keyId, model);
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

  async function handleBaseUrlChange(keyId: string, newBaseUrl: string) {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateProviderKey(keyId, { baseUrl: newBaseUrl || null as any });
      setKeys((prev) => prev.map((k) => (k.id === keyId ? updated : k)));
      setSavedId(keyId);
      setTimeout(() => setSavedId(null), 2000);
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleLabelSave(keyId: string) {
    const trimmed = editLabelValue.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const updated = await updateProviderKey(keyId, { label: trimmed });
      setKeys((prev) => prev.map((k) => (k.id === keyId ? updated : k)));
      setEditingLabelId(null);
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    }
  }

  return (
    <div className="page-enter">
      <h1>{t("providers.title")}</h1>
      <p>{t("providers.description")}</p>

      {error && (
        <div className="error-alert">{t(error.key)}{error.detail ?? ""}</div>
      )}

      {/* Section A: Add Key */}
      <ProviderSetupForm
        onSave={async () => { await loadData(); }}
        title={t("providers.addTitle")}
      />

      {/* Section B: Configured Keys */}
      <div className="section-card">
        <h3>{t("providers.configuredKeysTitle")}</h3>
        {keys.length === 0 ? (
          <div className="empty-cell">
            {t("providers.noKeys")}
          </div>
        ) : (
          <div className="flex-col-gap-1">
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
                        <strong className="text-sm">
                          {k.authType === "custom" ? k.label : t(`providers.label_${k.provider}`)}
                        </strong>
                        <span className="badge badge-muted">
                          {k.authType === "custom"
                            ? t("providers.authTypeCustom")
                            : k.authType === "local"
                              ? t("providers.badgeLocal")
                              : k.authType === "oauth" || SUBSCRIPTION_PROVIDER_IDS.includes(k.provider as LLMProvider)
                                ? t("providers.authTypeSubscription")
                                : t("providers.authTypeApiKey")}
                        </span>
                        {isActive && (
                          <span className="badge badge-active">
                            {t("providers.active")}
                          </span>
                        )}
                        {k.proxyUrl && (
                          <span className="has-tooltip inline-flex-center" data-tooltip={t("providers.proxyTooltip")}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <rect x="3" y="11" width="18" height="11" rx="2" fill="#f5d060" stroke="#b8860b" strokeWidth="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#b8860b" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </span>
                        )}
                        {(k.authType === "local" || k.authType === "custom") && k.baseUrl && (
                          <span className="text-secondary text-sm">{k.baseUrl}</span>
                        )}
                        {savedId === k.id && (
                          <span className="badge-saved">{t("common.saved")}</span>
                        )}
                      </div>
                      <div className="key-details">
                        {editingLabelId === k.id ? (
                          <input
                            className="key-label-input"
                            value={editLabelValue}
                            onChange={(e) => setEditLabelValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleLabelSave(k.id);
                              if (e.key === "Escape") setEditingLabelId(null);
                            }}
                            onBlur={() => handleLabelSave(k.id)}
                            autoFocus
                          />
                        ) : (
                          <span className="key-label">
                            {k.label}
                            <button
                              className="key-label-edit-btn"
                              onClick={() => {
                                setEditingLabelId(k.id);
                                setEditLabelValue(k.label);
                              }}
                              title={t("common.edit")}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
                          </span>
                        )}
                        {k.authType === "custom" && k.customModelsJson ? (
                          <select
                            value={k.model}
                            onChange={(e) => handleModelChange(k.id, e.target.value)}
                            className="input-mono"
                          >
                            {(JSON.parse(k.customModelsJson) as string[]).map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        ) : (
                          <ModelSelect
                            provider={k.provider}
                            value={k.model}
                            onChange={(model) => handleModelChange(k.id, model)}
                          />
                        )}
                      </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="td-actions">
                      {!isActive && (
                        <button className="btn btn-outline btn-sm" onClick={() => handleActivate(k.id, k.provider)}>
                          {t("providers.activate")}
                        </button>
                      )}
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setExpandedKeyId(isExp ? null : k.id);
                          setUpdateApiKey("");
                          setEditProxyUrl(k.proxyUrl || "");
                          setEditBaseUrl(k.baseUrl || "");
                        }}
                      >
                        {k.authType === "local" ? t("providers.updateUrl") : k.authType === "custom" ? t("providers.updateKey") : t("providers.updateKey")}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleRemoveKey(k.id)}>
                        {t("providers.removeKey")}
                      </button>
                    </div>
                  </div>

                  {/* Expanded: update key / proxy / baseUrl form */}
                  {isExp && (
                    <div className="key-expanded">
                      {k.authType === "local" ? (
                        <>
                          <div className="form-row">
                            <input
                              type="text"
                              value={editBaseUrl}
                              onChange={(e) => setEditBaseUrl(e.target.value)}
                              placeholder={t("providers.baseUrlPlaceholder")}
                              className="flex-1 input-mono"
                            />
                            <button
                              className="btn btn-primary"
                              onClick={() => handleBaseUrlChange(k.id, editBaseUrl)}
                              disabled={saving || editBaseUrl === (k.baseUrl || "")}
                            >
                              {saving ? "..." : t("common.save")}
                            </button>
                          </div>
                          <small className="form-help-sm">{t("providers.baseUrlHelp")}</small>
                        </>
                      ) : k.authType === "custom" ? (
                        <>
                          <div className="form-row">
                            <input
                              type="password"
                              autoComplete="off"
                              data-1p-ignore
                              value={updateApiKey}
                              onChange={(e) => setUpdateApiKey(e.target.value)}
                              placeholder={t("providers.updateKeyPlaceholder")}
                              className="flex-1 input-mono"
                            />
                            <button
                              className="btn btn-primary"
                              onClick={() => handleUpdateKey(k.id, k.provider)}
                              disabled={saving || validating || !updateApiKey.trim()}
                            >
                              {validating ? t("providers.validating") : saving ? "..." : t("common.save")}
                            </button>
                          </div>
                          <small className="form-help-sm">{t("providers.apiKeyHelp")}</small>
                          <div className="key-section-border">
                            <div className="form-label text-secondary">{t("providers.customEndpointLabel")}</div>
                            <div className="form-row">
                              <input
                                type="text"
                                value={editBaseUrl}
                                onChange={(e) => setEditBaseUrl(e.target.value)}
                                placeholder={t("providers.customEndpointPlaceholder")}
                                className="flex-1 input-mono"
                              />
                              <button
                                className="btn btn-primary"
                                onClick={() => handleBaseUrlChange(k.id, editBaseUrl)}
                                disabled={saving || editBaseUrl === (k.baseUrl || "")}
                              >
                                {saving ? "..." : t("common.save")}
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="form-row">
                            <input
                              type="password"
                              autoComplete="off"
                              data-1p-ignore
                              value={updateApiKey}
                              onChange={(e) => setUpdateApiKey(e.target.value)}
                              placeholder={k.provider === "anthropic" || k.provider === "claude" ? t("providers.anthropicUpdatePlaceholder") : t("providers.updateKeyPlaceholder")}
                              className="flex-1 input-mono"
                            />
                            <button
                              className="btn btn-primary"
                              onClick={() => handleUpdateKey(k.id, k.provider)}
                              disabled={saving || validating || !updateApiKey.trim()}
                            >
                              {validating ? t("providers.validating") : saving ? "..." : t("common.save")}
                            </button>
                          </div>
                          <small className="form-help-sm">{t("providers.apiKeyHelp")}</small>
                          {(k.provider === "anthropic" || k.provider === "claude") && (
                            <div className="info-box info-box-yellow mt-sm">
                              {t("providers.anthropicTokenWarning")}
                            </div>
                          )}
                          <div className="key-section-border">
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
                        </>
                      )}
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
