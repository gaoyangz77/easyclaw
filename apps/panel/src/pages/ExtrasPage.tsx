import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchSettings, updateSettings, trackEvent } from "../api/index.js";
import type { SttProvider } from "@rivonclaw/core";
import { Select } from "../components/inputs/Select.js";

type WebSearchProvider = "brave" | "perplexity" | "grok" | "gemini" | "kimi";
type EmbeddingProvider = "openai" | "gemini" | "voyage" | "mistral" | "ollama";

export function ExtrasPage() {
  const { t, i18n } = useTranslation();
  const defaultSttProvider: SttProvider = i18n.language === "zh" ? "volcengine" : "groq";

  // STT state
  const [sttEnabled, setSttEnabled] = useState(false);
  const [sttProvider, setSttProvider] = useState<SttProvider>(defaultSttProvider);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [volcengineAppKey, setVolcengineAppKey] = useState("");
  const [volcengineAccessKey, setVolcengineAccessKey] = useState("");
  const [hasGroqKey, setHasGroqKey] = useState(false);
  const [hasVolcengineKeys, setHasVolcengineKeys] = useState(false);

  // Web Search state
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchProvider, setWebSearchProvider] = useState<WebSearchProvider>("brave");
  const [webSearchApiKey, setWebSearchApiKey] = useState("");
  const [hasWebSearchKeys, setHasWebSearchKeys] = useState<Record<string, boolean>>({});

  // Embedding state
  const [embeddingEnabled, setEmbeddingEnabled] = useState(false);
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>("openai");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [hasEmbeddingKeys, setHasEmbeddingKeys] = useState<Record<string, boolean>>({});

  // Per-section UI state
  const [sttSaving, setSttSaving] = useState(false);
  const [sttSaved, setSttSaved] = useState(false);
  const [webSearchSaving, setWebSearchSaving] = useState(false);
  const [webSearchSaved, setWebSearchSaved] = useState(false);
  const [embeddingSaving, setEmbeddingSaving] = useState(false);
  const [embeddingSaved, setEmbeddingSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const settings = await fetchSettings();
      setSttEnabled(settings["stt.enabled"] === "true");
      setSttProvider((settings["stt.provider"] as SttProvider) || defaultSttProvider);
      setWebSearchEnabled(settings["webSearch.enabled"] === "true");
      setWebSearchProvider((settings["webSearch.provider"] as WebSearchProvider) || "brave");
      setEmbeddingEnabled(settings["embedding.enabled"] === "true");
      setEmbeddingProvider((settings["embedding.provider"] as EmbeddingProvider) || "openai");

      // Check STT credentials
      try {
        const credentialsRes = await fetch("/api/stt/credentials");
        if (credentialsRes.ok) {
          const contentType = credentialsRes.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const credentials = await credentialsRes.json() as { groq: boolean; volcengine: boolean };
            setHasGroqKey(credentials.groq);
            setHasVolcengineKeys(credentials.volcengine);
          }
        }
      } catch (credErr) {
        console.warn("Failed to check STT credentials:", credErr);
      }

      // Check extras credentials
      try {
        const extrasRes = await fetch("/api/extras/credentials");
        if (extrasRes.ok) {
          const contentType = extrasRes.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const extras = await extrasRes.json() as {
              webSearch: Record<string, boolean>;
              embedding: Record<string, boolean>;
            };
            setHasWebSearchKeys(extras.webSearch || {});
            setHasEmbeddingKeys(extras.embedding || {});
          }
        }
      } catch (credErr) {
        console.warn("Failed to check extras credentials:", credErr);
      }

      setError(null);
    } catch (err) {
      setError(t("extras.failedToLoad") + String(err));
    }
  }

  async function handleSaveStt() {
    setSttSaving(true);
    setError(null);
    setSttSaved(false);

    try {
      // Validate STT credentials
      if (sttEnabled) {
        if (sttProvider === "groq" && !groqApiKey.trim() && !hasGroqKey) {
          setError(t("stt.groqApiKeyRequired"));
          setSttSaving(false);
          return;
        }
        if (sttProvider === "volcengine" && !hasVolcengineKeys) {
          if (!volcengineAppKey.trim() || !volcengineAccessKey.trim()) {
            setError(t("stt.volcengineKeysRequired"));
            setSttSaving(false);
            return;
          }
        }
      }

      // Save settings
      await updateSettings({
        "stt.enabled": sttEnabled.toString(),
        "stt.provider": sttProvider,
      });

      // Save STT credentials
      if (sttEnabled) {
        if (sttProvider === "groq" && groqApiKey.trim()) {
          const res = await fetch("/api/stt/credentials", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "groq",
              apiKey: groqApiKey.trim(),
            }),
          });
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to save Groq credentials: ${res.status} ${errorText}`);
          }
          setHasGroqKey(true);
          setGroqApiKey("");
        }
        if (sttProvider === "volcengine" && volcengineAppKey.trim() && volcengineAccessKey.trim()) {
          const res = await fetch("/api/stt/credentials", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "volcengine",
              appKey: volcengineAppKey.trim(),
              accessKey: volcengineAccessKey.trim(),
            }),
          });
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to save Volcengine credentials: ${res.status} ${errorText}`);
          }
          setHasVolcengineKeys(true);
          setVolcengineAppKey("");
          setVolcengineAccessKey("");
        }
      }

      setSttSaved(true);
      trackEvent("extras.stt.saved", { provider: sttProvider, enabled: sttEnabled });
      setTimeout(() => setSttSaved(false), 2000);
    } catch (err) {
      setError(t("extras.failedToSave") + String(err));
    } finally {
      setSttSaving(false);
    }
  }

  async function handleSaveWebSearch() {
    setWebSearchSaving(true);
    setError(null);
    setWebSearchSaved(false);

    try {
      // Validate
      if (webSearchEnabled && !webSearchApiKey.trim() && !hasWebSearchKeys[webSearchProvider]) {
        setError(t("extras.webSearchApiKeyRequired"));
        setWebSearchSaving(false);
        return;
      }

      // Save settings
      await updateSettings({
        "webSearch.enabled": webSearchEnabled.toString(),
        "webSearch.provider": webSearchProvider,
      });

      // Save credentials
      if (webSearchEnabled && webSearchApiKey.trim()) {
        const res = await fetch("/api/extras/credentials", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "webSearch",
            provider: webSearchProvider,
            apiKey: webSearchApiKey.trim(),
          }),
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Failed to save credentials: ${res.status} ${errorText}`);
        }
        setHasWebSearchKeys((prev) => ({ ...prev, [webSearchProvider]: true }));
        setWebSearchApiKey("");
      }

      setWebSearchSaved(true);
      trackEvent("extras.webSearch.saved", { provider: webSearchProvider, enabled: webSearchEnabled });
      setTimeout(() => setWebSearchSaved(false), 2000);
    } catch (err) {
      setError(t("extras.failedToSave") + String(err));
    } finally {
      setWebSearchSaving(false);
    }
  }

  async function handleSaveEmbedding() {
    setEmbeddingSaving(true);
    setError(null);
    setEmbeddingSaved(false);

    try {
      // Validate (Ollama key is optional)
      if (embeddingEnabled && embeddingProvider !== "ollama" && !embeddingApiKey.trim() && !hasEmbeddingKeys[embeddingProvider]) {
        setError(t("extras.embeddingApiKeyRequired"));
        setEmbeddingSaving(false);
        return;
      }

      // Save settings
      await updateSettings({
        "embedding.enabled": embeddingEnabled.toString(),
        "embedding.provider": embeddingProvider,
      });

      // Save credentials
      if (embeddingEnabled && embeddingApiKey.trim()) {
        const res = await fetch("/api/extras/credentials", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "embedding",
            provider: embeddingProvider,
            apiKey: embeddingApiKey.trim(),
          }),
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Failed to save credentials: ${res.status} ${errorText}`);
        }
        setHasEmbeddingKeys((prev) => ({ ...prev, [embeddingProvider]: true }));
        setEmbeddingApiKey("");
      }

      setEmbeddingSaved(true);
      trackEvent("extras.embedding.saved", { provider: embeddingProvider, enabled: embeddingEnabled });
      setTimeout(() => setEmbeddingSaved(false), 2000);
    } catch (err) {
      setError(t("extras.failedToSave") + String(err));
    } finally {
      setEmbeddingSaving(false);
    }
  }

  return (
    <div className="page-enter extras-page">
      <div className="extras-header">
        <h1>{t("extras.title")}</h1>
        <p className="extras-subtitle">{t("extras.description")}</p>
      </div>

      {error && <div className="error-alert">{error}</div>}

      <div className="extras-list">
        {/* ── Card 1: Speech-to-Text ── */}
        <div className="section-card extras-card">
          <div className="extras-card-head">
            <div className="extras-card-icon extras-card-icon--stt">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            </div>
            <div className="extras-card-title-group">
              <h3>{t("extras.sttSection")}</h3>
              <p className="extras-card-desc">{t("stt.enableHelp")}</p>
            </div>
            <label className="extras-toggle">
              <input type="checkbox" checked={sttEnabled} onChange={(e) => setSttEnabled(e.target.checked)} />
              <span className="extras-toggle-track" />
            </label>
          </div>

          {sttEnabled && (
            <div className="extras-card-body">
              <div className="extras-fields">
                <div className="form-group">
                  <div className="form-label">{t("stt.provider")}</div>
                  <Select
                    value={sttProvider}
                    onChange={(v) => setSttProvider(v as SttProvider)}
                    options={[
                      { value: "groq", label: t("stt.providerGroq") },
                      { value: "volcengine", label: t("stt.providerVolcengine") },
                    ]}
                  />
                  <p className="form-help">{t("stt.providerHelp")}</p>
                </div>

                {sttProvider === "groq" && (
                  <div className="form-group">
                    <div className="form-label stt-label-with-badge">
                      {t("stt.groqApiKey")}
                      {hasGroqKey && !groqApiKey && <span className="badge-saved">{t("stt.keySaved")}</span>}
                    </div>
                    <input
                      type="password"
                      className="input-full input-mono"
                      value={groqApiKey}
                      onChange={(e) => setGroqApiKey(e.target.value)}
                      placeholder={hasGroqKey ? `${t("stt.groqApiKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.groqApiKeyPlaceholder")}
                    />
                    <p className="form-help">
                      {t("stt.groqHelp")}{" "}
                      <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com/keys</a>
                    </p>
                  </div>
                )}

                {sttProvider === "volcengine" && (
                  <>
                    <div className="info-box info-box-blue">
                      <div className="stt-free-tier-content">
                        <span>{t("stt.volcengineFreeTier")}</span>
                        <a href="https://console.volcengine.com/speech/app" target="_blank" rel="noopener noreferrer" className="font-medium">{t("stt.volcentineFreeLink")}</a>
                        <span className="stt-tooltip-wrapper">
                          <span className="volcengine-help-trigger stt-help-icon">?</span>
                          <div className="volcengine-help-tooltip">
                            <div className="stt-tooltip-title">{t("stt.volcengineStepsTitle")}</div>
                            <div>{t("stt.volcengineStep1")}</div>
                            <div>{t("stt.volcengineStep2")}</div>
                            <div>{t("stt.volcengineStep3")}</div>
                          </div>
                        </span>
                      </div>
                    </div>

                    <div className="extras-fields-row">
                      <div className="form-group">
                        <div className="form-label stt-label-with-badge">
                          {t("stt.volcengineAppKey")}
                          {hasVolcengineKeys && !volcengineAppKey && <span className="badge-saved">{t("stt.keySaved")}</span>}
                        </div>
                        <input type="password" className="input-full input-mono" value={volcengineAppKey} onChange={(e) => setVolcengineAppKey(e.target.value)} placeholder={hasVolcengineKeys ? `${t("stt.volcengineAppKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.volcengineAppKeyPlaceholder")} />
                      </div>

                      <div className="form-group">
                        <div className="form-label">{t("stt.volcengineAccessKey")}</div>
                        <input type="password" className="input-full input-mono" value={volcengineAccessKey} onChange={(e) => setVolcengineAccessKey(e.target.value)} placeholder={hasVolcengineKeys ? `${t("stt.volcengineAccessKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.volcengineAccessKeyPlaceholder")} />
                      </div>
                    </div>

                    <p className="form-help stt-volcengine-help">
                      {t("stt.volcengineHelp")}{" "}
                      <a href="https://console.volcengine.com/speech/app" target="_blank" rel="noopener noreferrer">console.volcengine.com/speech/app</a>
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="extras-card-foot">
            <button className="btn btn-primary btn-action" onClick={handleSaveStt} disabled={sttSaving}>
              {sttSaving ? t("common.loading") : t("common.save")}
            </button>
            {sttSaved && <span className="text-success">{t("common.saved")}</span>}
          </div>
        </div>

        {/* ── Card 2: Web Search ── */}
        <div className="section-card extras-card">
          <div className="extras-card-head">
            <div className="extras-card-icon extras-card-icon--search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            </div>
            <div className="extras-card-title-group">
              <h3>{t("extras.webSearchSection")}</h3>
              <p className="extras-card-desc">{t("extras.webSearchDescription")}</p>
            </div>
            <label className="extras-toggle">
              <input type="checkbox" checked={webSearchEnabled} onChange={(e) => setWebSearchEnabled(e.target.checked)} />
              <span className="extras-toggle-track" />
            </label>
          </div>

          {webSearchEnabled && (
            <div className="extras-card-body">
              <div className="extras-fields">
                <div className="form-group">
                  <div className="form-label">{t("extras.webSearchProvider")}</div>
                  <Select
                    value={webSearchProvider}
                    onChange={(v) => setWebSearchProvider(v as WebSearchProvider)}
                    options={[
                      { value: "brave", label: t("extras.webSearchProviderBrave") },
                      { value: "perplexity", label: t("extras.webSearchProviderPerplexity") },
                      { value: "grok", label: t("extras.webSearchProviderGrok") },
                      { value: "gemini", label: t("extras.webSearchProviderGemini") },
                      { value: "kimi", label: t("extras.webSearchProviderKimi") },
                    ]}
                  />
                  <p className="form-help">{t("extras.webSearchProviderHelp")}</p>
                </div>

                <div className="form-group">
                  <div className="form-label stt-label-with-badge">
                    {t("extras.webSearchApiKey")}
                    {hasWebSearchKeys[webSearchProvider] && !webSearchApiKey && <span className="badge-saved">{t("extras.keySaved")}</span>}
                  </div>
                  <input
                    type="password"
                    className="input-full input-mono"
                    value={webSearchApiKey}
                    onChange={(e) => setWebSearchApiKey(e.target.value)}
                    placeholder={hasWebSearchKeys[webSearchProvider] ? `${t("extras.webSearchApiKeyPlaceholder")} (${t("extras.keyNotChanged")})` : t("extras.webSearchApiKeyPlaceholder")}
                  />
                  <p className="form-help">
                    {webSearchProvider === "brave" && (<>{t("extras.webSearchBraveHelp")}{" "}<a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer">brave.com/search/api</a></>)}
                    {webSearchProvider === "perplexity" && (<>{t("extras.webSearchPerplexityHelp")}{" "}<a href="https://docs.perplexity.ai/" target="_blank" rel="noopener noreferrer">docs.perplexity.ai</a></>)}
                    {webSearchProvider === "grok" && (<>{t("extras.webSearchGrokHelp")}{" "}<a href="https://console.x.ai/" target="_blank" rel="noopener noreferrer">console.x.ai</a></>)}
                    {webSearchProvider === "gemini" && (<>{t("extras.webSearchGeminiHelp")}{" "}<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com</a></>)}
                    {webSearchProvider === "kimi" && (<>{t("extras.webSearchKimiHelp")}{" "}<a href="https://platform.moonshot.cn/console/api-keys" target="_blank" rel="noopener noreferrer">platform.moonshot.cn</a></>)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="extras-card-foot">
            <button className="btn btn-primary btn-action" onClick={handleSaveWebSearch} disabled={webSearchSaving}>
              {webSearchSaving ? t("common.loading") : t("common.save")}
            </button>
            {webSearchSaved && <span className="text-success">{t("common.saved")}</span>}
          </div>
        </div>

        {/* ── Card 3: Embedding / Memory ── */}
        <div className="section-card extras-card">
          <div className="extras-card-head">
            <div className="extras-card-icon extras-card-icon--memory">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
            </div>
            <div className="extras-card-title-group">
              <h3>{t("extras.embeddingSection")}</h3>
              <p className="extras-card-desc">{t("extras.embeddingDescription")}</p>
            </div>
            <label className="extras-toggle">
              <input type="checkbox" checked={embeddingEnabled} onChange={(e) => setEmbeddingEnabled(e.target.checked)} />
              <span className="extras-toggle-track" />
            </label>
          </div>

          {embeddingEnabled && (
            <div className="extras-card-body">
              <div className="extras-fields">
                <div className="form-group">
                  <div className="form-label">{t("extras.embeddingProvider")}</div>
                  <Select
                    value={embeddingProvider}
                    onChange={(v) => setEmbeddingProvider(v as EmbeddingProvider)}
                    options={[
                      { value: "openai", label: t("extras.embeddingProviderOpenai") },
                      { value: "gemini", label: t("extras.embeddingProviderGemini") },
                      { value: "voyage", label: t("extras.embeddingProviderVoyage") },
                      { value: "mistral", label: t("extras.embeddingProviderMistral") },
                      { value: "ollama", label: t("extras.embeddingProviderOllama") },
                    ]}
                  />
                  <p className="form-help">{t("extras.embeddingProviderHelp")}</p>
                </div>

                <div className="form-group">
                  <div className="form-label stt-label-with-badge">
                    {t("extras.embeddingApiKey")}
                    {hasEmbeddingKeys[embeddingProvider] && !embeddingApiKey && <span className="badge-saved">{t("extras.keySaved")}</span>}
                  </div>
                  <input
                    type="password"
                    className="input-full input-mono"
                    value={embeddingApiKey}
                    onChange={(e) => setEmbeddingApiKey(e.target.value)}
                    placeholder={hasEmbeddingKeys[embeddingProvider] ? `${t("extras.embeddingApiKeyPlaceholder")} (${t("extras.keyNotChanged")})` : t("extras.embeddingApiKeyPlaceholder")}
                  />
                  <p className="form-help">
                    {embeddingProvider === "openai" && (<>{t("extras.embeddingOpenaiHelp")}{" "}<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com</a></>)}
                    {embeddingProvider === "gemini" && (<>{t("extras.embeddingGeminiHelp")}{" "}<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com</a></>)}
                    {embeddingProvider === "voyage" && (<>{t("extras.embeddingVoyageHelp")}{" "}<a href="https://dash.voyageai.com/api-keys" target="_blank" rel="noopener noreferrer">dash.voyageai.com</a></>)}
                    {embeddingProvider === "mistral" && (<>{t("extras.embeddingMistralHelp")}{" "}<a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener noreferrer">console.mistral.ai</a></>)}
                    {embeddingProvider === "ollama" && t("extras.embeddingOllamaHelp")}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="extras-card-foot">
            <button className="btn btn-primary btn-action" onClick={handleSaveEmbedding} disabled={embeddingSaving}>
              {embeddingSaving ? t("common.loading") : t("common.save")}
            </button>
            {embeddingSaved && <span className="text-success">{t("common.saved")}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
