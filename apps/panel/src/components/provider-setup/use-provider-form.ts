import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getDefaultModelForProvider, getProviderMeta } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import {
  fetchProviderKeys,
  updateSettings,
  createProviderKey,
  validateApiKey,
  validateCustomApiKey,
  fetchPricing,
  startOAuthFlow,
  saveOAuthFlow,
  completeManualOAuth,
  detectLocalModels,
  fetchLocalModels,
  checkLocalModelHealth,
} from "../../api/index.js";
import type { ProviderPricing, LocalModelServer } from "../../api/index.js";

export function useProviderForm(onSave: (provider: string) => void) {
  const { t, i18n } = useTranslation();

  const defaultProv = i18n.language === "zh" ? "zhipu-coding" : "gemini";
  const [tab, setTab] = useState<"subscription" | "api" | "local" | "custom">("subscription");
  const [provider, setProvider] = useState(defaultProv);
  // Custom provider state
  const [customName, setCustomName] = useState("");
  const [customProtocol, setCustomProtocol] = useState<"openai" | "anthropic">("openai");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [model, setModel] = useState(getDefaultModelForProvider(defaultProv as LLMProvider)?.modelId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);
  const [modelName, setModelName] = useState("");
  const [detectedServer, setDetectedServer] = useState<LocalModelServer | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [localModels, setLocalModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; version?: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<{ key: string; detail?: string; hover?: string } | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthTokenPreview, setOauthTokenPreview] = useState("");
  const [oauthManualMode, setOauthManualMode] = useState(false);
  const [oauthAuthUrl, setOauthAuthUrl] = useState("");
  const [oauthCallbackUrl, setOauthCallbackUrl] = useState("");
  const [oauthManualLoading, setOauthManualLoading] = useState(false);
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

  // Auto-detect local servers when switching to local tab
  useEffect(() => {
    if (tab !== "local") return;
    setDetecting(true);
    detectLocalModels()
      .then((servers) => {
        const ollama = servers.find((s) => s.type === "ollama" && s.status === "detected");
        if (ollama) {
          setDetectedServer(ollama);
          setBaseUrl(ollama.baseUrl.replace(/\/v1\/?$/, ""));
          setBaseUrlTouched(true);
          setHealthStatus({ ok: true, version: ollama.version });
        }
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
  }, [tab]);

  // Fetch models when baseUrl changes (debounced)
  useEffect(() => {
    if (tab !== "local" || !baseUrl.trim() || !baseUrlTouched) return;
    setLocalModels([]);
    setLoadingModels(true);
    const timer = setTimeout(() => {
      const url = baseUrl.trim().replace(/\/+$/, "");
      checkLocalModelHealth(url)
        .then((h) => {
          setHealthStatus(h);
          if (h.ok) {
            return fetchLocalModels(url).then((models) => {
              setLocalModels(models);
              if (models.length > 0 && !modelName) {
                setModelName(models[0].id);
              }
            });
          }
        })
        .catch(() => setHealthStatus({ ok: false }))
        .finally(() => setLoadingModels(false));
    }, 1500);
    return () => clearTimeout(timer);
  }, [tab, baseUrl, baseUrlTouched]);

  function handleProviderChange(p: string) {
    setProvider(p);
    setModel(getDefaultModelForProvider(p as LLMProvider)?.modelId ?? "");
    setApiKey("");
    setLabel("");
    setProxyUrl("");
    setShowAdvanced(false);
    setOauthTokenPreview("");
    setOauthManualMode(false);
    setOauthAuthUrl("");
    setOauthCallbackUrl("");
  }

  function handleTabChange(newTab: "subscription" | "api" | "local" | "custom") {
    setTab(newTab);
    setError(null);
    if (newTab === "custom") {
      setCustomName("");
      setCustomProtocol("openai");
      setCustomEndpoint("");
      setApiKey("");
      setCustomModels([]);
      return;
    }
    const prov = newTab === "local"
      ? "ollama"
      : newTab === "subscription"
        ? (i18n.language === "zh" ? "zhipu-coding" : "gemini")
        : (i18n.language === "zh" ? "zhipu" : "openai");
    handleProviderChange(prov);
    if (newTab === "local") {
      setBaseUrl("http://localhost:11434");
      setBaseUrlTouched(false);
      setModelName("");
      setHealthStatus(null);
    }
  }

  async function handleAddLocalKey() {
    if (!modelName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const url = baseUrl.trim().replace(/\/+$/, "");
      await createProviderKey({
        provider: "ollama",
        label: label.trim() || "Ollama",
        model: modelName.trim(),
        apiKey: apiKey.trim() || undefined,
        authType: "local",
        baseUrl: url,
      });

      if (existingKeyCount === 0) {
        await updateSettings({ "llm-provider": "ollama" });
      }

      setBaseUrl("http://localhost:11434");
      setModelName("");
      setApiKey("");
      setLabel("");
      setShowAdvanced(false);
      setExistingKeyCount((c) => (c ?? 0) + 1);
      onSave("ollama");
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddKey() {
    if (!apiKey.trim()) return;
    setValidating(true);
    setError(null);
    try {
      const proxy = proxyUrl.trim() || undefined;
      const validation = await validateApiKey(provider, apiKey.trim(), proxy, model || undefined);
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
      if (result.manualMode) {
        setOauthManualMode(true);
        setOauthAuthUrl(result.authUrl || "");
      } else {
        setOauthTokenPreview(result.tokenPreview || "oauth-token-••••••••");
        setLabel(result.email || getProviderMeta(provider as LLMProvider)?.label || "OAuth");
        setModel(getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? "");
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError({ key: "providers.oauthFailed", detail: e.message, hover: (e as Error & { detail?: string }).detail });
    } finally {
      setOauthLoading(false);
    }
  }

  async function handleManualOAuthComplete() {
    if (!oauthCallbackUrl.trim()) return;
    setOauthManualLoading(true);
    setError(null);
    try {
      const result = await completeManualOAuth(provider, oauthCallbackUrl.trim());
      setOauthTokenPreview(result.tokenPreview || "oauth-token-••••••••");
      setLabel(result.email || getProviderMeta(provider as LLMProvider)?.label || "OAuth");
      setModel(getDefaultModelForProvider(provider as LLMProvider)?.modelId ?? "");
      setOauthManualMode(false);
      setOauthAuthUrl("");
      setOauthCallbackUrl("");
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError({ key: "providers.oauthFailed", detail: e.message, hover: (e as Error & { detail?: string }).detail });
    } finally {
      setOauthManualLoading(false);
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
      const e = err instanceof Error ? err : new Error(String(err));
      setError({ key: "providers.failedToSave", detail: e.message, hover: (e as Error & { detail?: string }).detail });
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  async function handleAddCustomProvider() {
    if (!customEndpoint.trim() || !apiKey.trim() || customModels.length === 0) return;
    setValidating(true);
    setError(null);
    try {
      const validation = await validateCustomApiKey(
        customEndpoint.trim(), apiKey.trim(), customProtocol, customModels[0],
      );
      if (!validation.valid) {
        setError({ key: "providers.invalidKey", detail: validation.error });
        setValidating(false);
        return;
      }

      const providerSlug = "custom-" + crypto.randomUUID().slice(0, 8);
      await createProviderKey({
        provider: providerSlug,
        label: customName.trim() || t("providers.customDefault"),
        model: customModels[0],
        apiKey: apiKey.trim(),
        authType: "custom",
        baseUrl: customEndpoint.trim(),
        customProtocol,
        customModelsJson: JSON.stringify(customModels),
      });

      if (existingKeyCount === 0) {
        await updateSettings({ "llm-provider": providerSlug });
      }

      setCustomName("");
      setCustomProtocol("openai");
      setCustomEndpoint("");
      setApiKey("");
      setCustomModels([]);
      setExistingKeyCount((c) => (c ?? 0) + 1);
      onSave(providerSlug);
    } catch (err) {
      setError({ key: "providers.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
      setValidating(false);
    }
  }

  return {
    t, i18n,
    // Tab state
    tab, handleTabChange,
    // Provider state
    provider, handleProviderChange, model, setModel,
    // Key state
    apiKey, setApiKey, label, setLabel, proxyUrl, setProxyUrl,
    // Local state
    baseUrl, setBaseUrl, baseUrlTouched, setBaseUrlTouched,
    modelName, setModelName, detectedServer,
    detecting, localModels, loadingModels, healthStatus,
    // Custom provider state
    customName, setCustomName, customProtocol, setCustomProtocol,
    customEndpoint, setCustomEndpoint, customModels, setCustomModels,
    // UI state
    showAdvanced, setShowAdvanced, saving, validating, error,
    // OAuth state
    oauthLoading, oauthTokenPreview, oauthManualMode,
    oauthAuthUrl, oauthCallbackUrl, setOauthCallbackUrl, oauthManualLoading,
    // Pricing state
    pricingList, pricingLoading,
    // Refs
    leftCardRef, leftHeight,
    // Handlers
    handleAddLocalKey, handleAddKey, handleAddCustomProvider,
    handleOAuth, handleManualOAuthComplete, handleOAuthSave,
  };
}

export type ProviderFormState = ReturnType<typeof useProviderForm>;
